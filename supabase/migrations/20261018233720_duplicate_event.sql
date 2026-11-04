-- Additive only. Apply to an isolated Supabase environment first; never auto-run.
-- Service-role-only RPCs use invoker rights: no SECURITY DEFINER / public execute.
create table public.event_duplicate_operations (
 operation_id uuid primary key, admin_id uuid not null references public.admin_clients(id),
 source_id uuid references public.live_events(id), source_version text,
 request_hash text, plan jsonb, event_id uuid unique,
 state text not null default 'pending' check(state in ('pending','complete','cleanup_pending','cancelled')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(state in ('cancelled','cleanup_pending') or (source_id is not null and source_version is not null and request_hash is not null and plan is not null and event_id is not null))
);
-- Track every in-flight copy. No timeout silently declares a lost worker safe.
create table public.event_duplicate_workers (
 operation_id uuid not null references public.event_duplicate_operations(operation_id),
 worker_id uuid not null, settled boolean not null default false,
 created_at timestamptz not null default now(), primary key(operation_id,worker_id)
);
alter table public.event_duplicate_workers enable row level security;
revoke all on public.event_duplicate_workers from public,anon,authenticated;
grant select,insert,update on public.event_duplicate_workers to service_role;
create index event_duplicate_workers_active on public.event_duplicate_workers(operation_id) where not settled;
create index event_duplicate_operations_admin_created on public.event_duplicate_operations(admin_id,created_at desc);
create index event_duplicate_operations_source on public.event_duplicate_operations(source_id);
create index event_duplicate_operations_cleanup on public.event_duplicate_operations(state,updated_at) where state<>'complete';
alter table public.event_duplicate_operations enable row level security;
revoke all on public.event_duplicate_operations from public, anon, authenticated;
grant select, insert, update on public.event_duplicate_operations to service_role;

create function public.mercury_duplicate_snapshot(p_slug text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare e public.live_events%rowtype; s public.event_settings%rowtype; races jsonb; logo jsonb;
begin
 select * into strict e from public.live_events where slug=p_slug for share;
 select * into strict s from public.event_settings where event_id=e.id for share;
 -- Lock existing aliases and logo metadata while reserving/committing. Recomputed
 -- fingerprints also detect additions and source writes between separate requests.
 perform 1 from public.event_race_aliases where event_id=e.id order by id for share;
 select coalesce(jsonb_agg(to_jsonb(a) order by sort_order,id),'[]') into races
 from public.event_race_aliases a where event_id=e.id and active;
 select jsonb_build_object('updated_at',updated_at,'metadata',metadata) into logo
 from storage.objects where bucket_id='event-assets' and name=s.event_logo_path for share;
 return jsonb_build_object('event',to_jsonb(e),'settings',to_jsonb(s),'races',races,'logo',logo);
exception when no_data_found then raise exception 'source_not_found' using errcode='P0001';
end $$;

create function public.mercury_duplicate_plan(p_snapshot jsonb,p_draft jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare e jsonb:=p_snapshot->'event'; s jsonb:=p_snapshot->'settings';
 g jsonb:=p_draft->'groups'; n jsonb:=p_draft->'event'; rs jsonb:=p_draft->'races';
 st jsonb; r jsonb; a jsonb; t jsonb; k text; v jsonb; item jsonb; starts boolean;
 featured text; source_seen text[]:='{}'; key_seen text[]:='{}'; final_races jsonb:='[]';
 d date; minimum integer; maximum integer;
begin
 if jsonb_typeof(p_draft) is distinct from 'object' or
    p_draft - array['event','groups','races','featured_race_key'] <> '{}' or
    jsonb_typeof(n) is distinct from 'object' or n - array['name','slug','event_date','location','timezone'] <> '{}' or
    jsonb_typeof(g) is distinct from 'object' or g - array['races','awards','branding','display','team','starts'] <> '{}'
 then raise exception 'invalid_configuration'; end if;
 foreach k in array array['races','awards','branding','display','team','starts'] loop
  if jsonb_typeof(g->k) is distinct from 'boolean' then raise exception 'invalid_configuration'; end if;
 end loop;
 if jsonb_typeof(n->'name') is distinct from 'string' or length(btrim(n->>'name')) not between 1 and 180
 or btrim(n->>'name')=btrim(e->>'name') then raise exception 'invalid_event_name'; end if;
 if jsonb_typeof(n->'slug') is distinct from 'string' or length(n->>'slug')>120
 or (n->>'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or n->>'slug'=e->>'slug' then raise exception 'invalid_slug'; end if;
 if coalesce(n->>'event_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_event_date'; end if;
 begin d:=(n->>'event_date')::date; exception when others then raise exception 'invalid_event_date'; end;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=n->>'timezone') then raise exception 'invalid_timezone'; end if;
 if jsonb_typeof(n->'timezone') is distinct from 'string' or jsonb_typeof(n->'event_date') is distinct from 'string' then raise exception 'invalid_configuration'; end if;
 if coalesce(jsonb_typeof(n->'location'),'null') not in ('string','null') or length(coalesce(n->>'location',''))>500 then raise exception 'invalid_location'; end if;
 if exists(select 1 from public.live_events where slug=n->>'slug') then raise exception 'slug_already_exists'; end if;
 if jsonb_typeof(rs) is distinct from 'array' or jsonb_array_length(rs) not between 1 and 20 then raise exception 'race_required'; end if;
 starts:=(g->>'starts')::boolean;
 for r in select value from jsonb_array_elements(rs) loop
  if jsonb_typeof(r) is distinct from 'object' or r-array['source_label','race_key','display_label','scheduled_start_time'] <> '{}' then raise exception 'invalid_race'; end if;
  if jsonb_typeof(r->'source_label') is distinct from 'string' or length(btrim(r->>'source_label')) not between 1 and 160 then raise exception 'invalid_race_source_label'; end if;
  if jsonb_typeof(r->'race_key') is distinct from 'string' or length(r->>'race_key')>80 or (r->>'race_key') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'invalid_race_key'; end if;
  if jsonb_typeof(r->'display_label') is distinct from 'string' or length(btrim(r->>'display_label')) not between 1 and 80 then raise exception 'invalid_race_display_label'; end if;
  if lower(btrim(r->>'source_label'))=any(source_seen) then raise exception 'duplicate_race_source_label'; end if;
  if r->>'race_key'=any(key_seen) then raise exception 'duplicate_race_key'; end if;
  source_seen:=array_append(source_seen,lower(btrim(r->>'source_label'))); key_seen:=array_append(key_seen,r->>'race_key');
  if coalesce(r->>'scheduled_start_time','')<>'' and (r->>'scheduled_start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then raise exception 'invalid_race_scheduled_start'; end if;
  final_races:=final_races||jsonb_build_array(jsonb_build_object('source_label',btrim(r->>'source_label'),'race_key',r->>'race_key','display_label',btrim(r->>'display_label'),
    'scheduled_start_time',nullif(r->>'scheduled_start_time',''),'sort_order',jsonb_array_length(final_races),'active',true));
 end loop;
 -- The race editor can change local times after defaults are seeded. 'starts'
 -- describes inheritance, not permission to enter a new time manually.
 featured:=p_draft->>'featured_race_key';
 if featured is null or not(featured=any(key_seen)) then raise exception 'invalid_featured_race_key'; end if;
 st:=jsonb_build_object('timezone',n->>'timezone','accent_color','#b30f2b','event_logo_path',null,'event_logo_alt',null,
 'show_overall_place',true,'show_bib',true,'show_name',true,'show_gender',true,'show_age',false,'show_age_group',true,'show_team',false,
 'show_entry_list',false,'show_podium',true,'show_grade',false,'grade_source','category','podium_mode','featured','podium_configs','[]'::jsonb,
 'show_gun_time',true,'show_chip_time',true,'show_pace',true,'show_recent_finishers',true,'recent_finishers_default_count',10,'featured_race_key',featured,
 'awards',jsonb_build_object('overall_places',3,'remove_overall_from_age_groups',true,'age_groups','[]'::jsonb,'special_divisions','[]'::jsonb),
 'team_scoring',jsonb_build_object('ruleset','custom','min_complete_teams_to_publish',3,'enabled',false,'scorers_per_team',5,'displacers_per_team',2,'unattached_mode','skip_compress','division_mode','all','tiebreaker','ncaa_head_to_head'));
 if (g->>'branding')::boolean then
  if coalesce(s->>'accent_color','') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid_accent_color'; end if;
  if nullif(s->>'event_logo_path','') is not null and (s->>'event_logo_path' ~ '(^/|//|(^|/)\.\.?(/|$)|[\\?#])') then raise exception 'invalid_logo_path'; end if;
  if nullif(s->>'event_logo_path','') is not null and (p_snapshot->'logo')='null'::jsonb then raise exception 'source_logo_missing'; end if;
  st:=st||jsonb_build_object('accent_color',s->>'accent_color');
 end if;
 if (g->>'display')::boolean then
  foreach k in array array['show_overall_place','show_bib','show_name','show_gender','show_age','show_age_group','show_team','show_gun_time','show_chip_time','show_pace','show_recent_finishers','show_entry_list','show_podium','show_grade'] loop
   if jsonb_typeof(s->k) is distinct from 'boolean' then raise exception 'invalid_display_configuration'; end if;
   st:=st||jsonb_build_object(k,s->k);
  end loop;
  if s->>'recent_finishers_default_count' not in ('5','10','15','20') then raise exception 'invalid_display_configuration'; end if;
  if coalesce(s->>'grade_source','') not in ('category','age') or coalesce(s->>'podium_mode','') not in ('featured','custom','off')
    or jsonb_typeof(s->'podium_configs') is distinct from 'array' then raise exception 'invalid_display_configuration'; end if;
  if jsonb_array_length(s->'podium_configs')>100 or (s->>'podium_mode'='custom' and jsonb_array_length(s->'podium_configs')=0) then raise exception 'invalid_display_configuration'; end if;
  for item in select value from jsonb_array_elements(s->'podium_configs') loop
   if jsonb_typeof(item) is distinct from 'object' or item-array['race_key','gender','places']<>'{}'
    or coalesce(item->>'race_key','')<>all(key_seen) or coalesce(item->>'gender','') not in ('Male','Female','Both')
    or coalesce(item->>'places','') !~ '^[0-9]+$' then raise exception 'invalid_display_configuration'; end if;
   if (item->>'places')::numeric not between 1 and 20 then raise exception 'invalid_display_configuration'; end if;
  end loop;
  st:=st||jsonb_build_object('recent_finishers_default_count',s->'recent_finishers_default_count','grade_source',s->'grade_source','podium_mode',s->'podium_mode','podium_configs',s->'podium_configs');
 end if;
 if (g->>'awards')::boolean then
  a:=s->'awards';
  if jsonb_typeof(a) is distinct from 'object' or a-array['overall_places','remove_overall_from_age_groups','age_groups','special_divisions']<>'{}'
    or jsonb_typeof(a->'age_groups') is distinct from 'array' or jsonb_typeof(a->'special_divisions') is distinct from 'array'
    or jsonb_typeof(a->'remove_overall_from_age_groups') is distinct from 'boolean'
    or (coalesce(a->>'overall_places','3') !~ '^[0-9]+$') then raise exception 'invalid_awards_configuration'; end if;
  if coalesce(a->>'overall_places','3')::numeric not between 0 and 20 then raise exception 'invalid_awards_configuration'; end if;
  if jsonb_array_length(a->'age_groups')>200 or jsonb_array_length(a->'special_divisions')>100 then raise exception 'invalid_awards_configuration'; end if;
  for item in select value from jsonb_array_elements(a->'age_groups') loop
   if jsonb_typeof(item) is distinct from 'object' or item-array['label','min','max','division']<>'{}'
    or length(coalesce(item->>'label','')) not between 1 and 80 or coalesce(item->>'min','') !~ '^[0-9]+$'
    or coalesce(item->>'max','999') !~ '^[0-9]+$' or coalesce(item->>'division','') not in ('Male','Female','All') then raise exception 'invalid_awards_configuration'; end if;
   minimum:=(item->>'min')::integer; maximum:=coalesce(item->>'max','999')::integer;
   if minimum>maximum or minimum>120 or maximum>999 then raise exception 'invalid_awards_configuration'; end if;
  end loop;
  for item in select value from jsonb_array_elements(a->'special_divisions') loop
   if jsonb_typeof(item) is distinct from 'object' or item-array['label','name','division','gender','category','places']<>'{}' then raise exception 'unsupported_special_division'; end if;
   for k,v in select * from jsonb_each(item) loop
    if k='places' then
     if coalesce(v#>>'{}','') !~ '^[0-9]+$' or (v#>>'{}')::numeric>20 then raise exception 'unsupported_special_division'; end if;
    elsif jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>160 then raise exception 'unsupported_special_division'; end if;
   end loop;
  end loop;
  st:=st||jsonb_build_object('awards',a);
 end if;
 if (g->>'team')::boolean then
  t:=s->'team_scoring';
  if jsonb_typeof(t) is distinct from 'object' or t-array['ruleset','min_complete_teams_to_publish','enabled','scorers_per_team','displacers_per_team','unattached_mode','division_mode','tiebreaker']<>'{}'
    or jsonb_typeof(t->'enabled') is distinct from 'boolean' or coalesce(t->>'scorers_per_team','') !~ '^[0-9]+$'
    or coalesce(t->>'displacers_per_team','') !~ '^[0-9]+$'
    or coalesce(t->>'unattached_mode','') not in ('skip_compress','count_in_sequence')
    or coalesce(t->>'division_mode','') not in ('all','gender','category','gender_category')
    or coalesce(t->>'tiebreaker','') not in ('ncaa_head_to_head','nfhs_next_runner','aggregate_time','usatf_last_scorer') then raise exception 'invalid_team_configuration'; end if;
  if (t->>'scorers_per_team')::numeric not between 1 and 20 or (t->>'displacers_per_team')::numeric not between 0 and 20 then raise exception 'invalid_team_configuration'; end if;
  if coalesce(t->>'ruleset','custom') not in ('custom','usatf') or coalesce(t->>'min_complete_teams_to_publish','3') !~ '^[0-9]+$' then raise exception 'invalid_team_configuration'; end if;
  if coalesce(t->>'min_complete_teams_to_publish','3')::numeric not between 1 and 50 then raise exception 'invalid_team_configuration'; end if;
  if t->>'ruleset'='usatf' and t->>'tiebreaker'<>'usatf_last_scorer' then raise exception 'invalid_team_configuration'; end if;
  st:=st||jsonb_build_object('team_scoring',t);
 end if;
 return jsonb_build_object('event',jsonb_build_object('name',btrim(n->>'name'),'slug',n->>'slug','event_date',d,'location',nullif(btrim(n->>'location'),'')),
   'settings',st,'races',final_races,'groups',g,'source_name',e->>'name','source_slug',e->>'slug',
   'logo_source',case when (g->>'branding')::boolean then nullif(s->>'event_logo_path','') else null end);
end $$;

create function public.mercury_duplicate_event(p_mode text,p_admin_id uuid,p_operation_id uuid default null,
 p_source_slug text default null,p_source_version text default null,p_draft jsonb default null,
 p_session_hash text default null,p_worker_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare snap jsonb; ver text; plan jsonb; op public.event_duplicate_operations%rowtype;
 out_event public.live_events%rowtype; st jsonb; r jsonb; summary text; start_label text;
 target text; request_hash text; rid uuid; active_workers integer;
begin
 if not exists(select 1 from public.admin_sessions ss join public.admin_clients a on a.id=ss.admin_client_id
  where a.id=p_admin_id and a.active and ss.token_hash=p_session_hash and ss.expires_at>clock_timestamp()) then raise exception 'unauthorized'; end if;
 if p_mode in ('status','reserve','commit','cancel','cleaned','worker_start','worker_finish') then
  if p_operation_id is null then raise exception 'operation_id_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  select * into op from public.event_duplicate_operations where operation_id=p_operation_id for update;
  if found and op.admin_id<>p_admin_id then raise exception 'operation_not_found'; end if;
  if p_mode='worker_finish' and op.operation_id is not null then
   if p_worker_id is null then raise exception 'invalid_worker'; end if;
   update public.event_duplicate_workers set settled=true where operation_id=p_operation_id and worker_id=p_worker_id;
  end if;
  select count(*) into active_workers from public.event_duplicate_workers where operation_id=p_operation_id and not settled;
  if op.state='complete' then
   if p_mode='reserve' and op.request_hash<>md5(jsonb_build_object('source',p_source_slug,'version',p_source_version,'draft',p_draft)::text) then raise exception 'operation_payload_mismatch'; end if;
   select * into out_event from public.live_events where id=op.event_id;
   return jsonb_build_object('state','complete','operation_id',op.operation_id,'event',jsonb_build_object('id',out_event.id,'slug',out_event.slug,'name',out_event.name));
  end if;
  if p_mode='status' then
   return jsonb_build_object('state',coalesce(op.state,'not_found'),'operation_id',p_operation_id,'active_workers',active_workers);
  end if;
  if p_mode='worker_finish' then
   return jsonb_build_object('state',op.state,'active_workers',active_workers,'logo_target',op.plan->>'logo_target');
  end if;
  if p_mode in ('cancel','cleaned') then
   if op.operation_id is null then
    if p_mode='cancel' then
     -- Tombstone blocks a create that reaches reserve AFTER cancellation.
     insert into public.event_duplicate_operations(operation_id,admin_id,state) values(p_operation_id,p_admin_id,'cancelled');
     return jsonb_build_object('state','cancelled','active_workers',0);
    end if;
    raise exception 'operation_not_found';
   end if;
   if p_mode='cleaned' then
    if op.state not in ('cleanup_pending','cancelled') then raise exception 'invalid_operation_state'; end if;
    if active_workers>0 or exists(select 1 from storage.objects where bucket_id='event-assets' and name=op.plan->>'logo_target') then
     return jsonb_build_object('state','cleanup_pending','active_workers',active_workers,'logo_target',op.plan->>'logo_target');
    end if;
   end if;
   update public.event_duplicate_operations set state=case when p_mode='cancel' then 'cleanup_pending' else 'cancelled' end,updated_at=now() where operation_id=p_operation_id;
   return jsonb_build_object('state',case when p_mode='cancel' then 'cleanup_pending' else 'cancelled' end,'active_workers',active_workers,'logo_target',op.plan->>'logo_target');
  end if;
  if op.state in ('cancelled','cleanup_pending') then raise exception 'operation_cancelled'; end if;
  if p_mode='worker_start' then
   if op.operation_id is null then raise exception 'operation_not_found'; end if;
   if p_worker_id is null then raise exception 'invalid_worker'; end if;
   insert into public.event_duplicate_workers(operation_id,worker_id) values(p_operation_id,p_worker_id);
   return jsonb_build_object('state','pending');
  end if;
  if p_mode='reserve' and op.operation_id is not null then
   request_hash:=md5(jsonb_build_object('source',p_source_slug,'version',p_source_version,'draft',p_draft)::text);
   if request_hash<>op.request_hash then raise exception 'operation_payload_mismatch'; end if;
   return jsonb_build_object('state','pending','operation_id',op.operation_id,'plan',op.plan);
  end if;
 end if;
 if p_mode='commit' then
  if op.operation_id is null then raise exception 'operation_not_found'; end if;
  snap:=public.mercury_duplicate_snapshot(op.plan->>'source_slug');
  if md5(snap::text)<>op.source_version then raise exception 'source_changed'; end if;
  plan:=op.plan; st:=plan->'settings';
  if nullif(plan->>'logo_target','') is not null and not exists(select 1 from storage.objects where bucket_id='event-assets' and name=plan->>'logo_target') then raise exception 'logo_copy_required'; end if;
  select string_agg(value->>'display_label',' + ' order by (value->>'sort_order')::int),
   string_agg((value->>'display_label')||' '||to_char((value->>'scheduled_start_time')::time,'FMHH12:MI AM'),' · ' order by (value->>'scheduled_start_time')::time)
   filter(where nullif(value->>'scheduled_start_time','') is not null) into summary,start_label from jsonb_array_elements(plan->'races');
  -- Recheck after waits/copy and serialize against session revocation/admin disable.
  perform 1 from public.admin_sessions ss join public.admin_clients a on a.id=ss.admin_client_id
   where a.id=p_admin_id and a.active and ss.token_hash=p_session_hash and ss.expires_at>clock_timestamp()
   for share of ss,a;
  if not found then raise exception 'unauthorized'; end if;
  insert into public.live_events(id,slug,name,event_date,location,status,is_public,current_revision,last_published_at,distance_label,start_time_label)
   values(op.event_id,plan#>>'{event,slug}',plan#>>'{event,name}',(plan#>>'{event,event_date}')::date,plan#>>'{event,location}','setup',false,0,null,summary,start_label) returning * into out_event;
  insert into public.event_settings(event_id,timezone,accent_color,event_logo_path,event_logo_alt,
   show_overall_place,show_bib,show_name,show_gender,show_age,show_age_group,show_team,show_gun_time,show_chip_time,show_pace,show_recent_finishers,recent_finishers_default_count,featured_race_key,awards,team_scoring,show_entry_list,show_podium,show_grade,grade_source,podium_mode,podium_configs)
   values(op.event_id,st->>'timezone',st->>'accent_color',plan->>'logo_target',case when nullif(plan->>'logo_target','') is not null then (plan#>>'{event,name}')||' logo' else null end,
   (st->>'show_overall_place')::boolean,(st->>'show_bib')::boolean,(st->>'show_name')::boolean,(st->>'show_gender')::boolean,(st->>'show_age')::boolean,(st->>'show_age_group')::boolean,(st->>'show_team')::boolean,(st->>'show_gun_time')::boolean,(st->>'show_chip_time')::boolean,(st->>'show_pace')::boolean,(st->>'show_recent_finishers')::boolean,(st->>'recent_finishers_default_count')::int,st->>'featured_race_key',st->'awards',st->'team_scoring',(st->>'show_entry_list')::boolean,(st->>'show_podium')::boolean,(st->>'show_grade')::boolean,st->>'grade_source',st->>'podium_mode',st->'podium_configs');
  insert into public.bridge_event_policies(event_id,require_lease) values(op.event_id,true);
  for r in select value from jsonb_array_elements(plan->'races') loop
   insert into public.event_race_aliases(event_id,source_label,race_key,display_label,sort_order,active,scheduled_start_time,running_clock_enabled,running_clock_start_at,running_clock_source)
    values(op.event_id,r->>'source_label',r->>'race_key',r->>'display_label',(r->>'sort_order')::int,true,(r->>'scheduled_start_time')::time,false,null,null);
  end loop;
  insert into public.event_admin_activity(event_id,action,detail) values(op.event_id,'event_duplicated',jsonb_build_object('source_event_id',op.source_id,'new_event_id',op.event_id,'groups',plan->'groups','operation_id',op.operation_id));
  update public.event_duplicate_operations set state='complete',updated_at=now() where operation_id=p_operation_id;
  return jsonb_build_object('state','complete','operation_id',op.operation_id,'event',jsonb_build_object('id',out_event.id,'slug',out_event.slug,'name',out_event.name));
 end if;
 if p_mode not in ('source','preview','reserve') then raise exception 'invalid_mode'; end if;
 snap:=public.mercury_duplicate_snapshot(p_source_slug); ver:=md5(snap::text);
 if p_mode='source' then
  return jsonb_build_object('source_version',ver,'event',jsonb_build_object('name',snap#>>'{event,name}','slug',p_source_slug,'location',snap#>>'{event,location}'),
   'timezone',snap#>>'{settings,timezone}','featured_race_key',snap#>>'{settings,featured_race_key}',
   'races',(select coalesce(jsonb_agg(jsonb_build_object('source_label',value->>'source_label','race_key',value->>'race_key','display_label',value->>'display_label','scheduled_start_time',value->>'scheduled_start_time')),'[]') from jsonb_array_elements(snap->'races')));
 end if;
 if ver is distinct from p_source_version then raise exception 'source_changed'; end if;
 plan:=public.mercury_duplicate_plan(snap,p_draft);
 if p_mode='preview' then return jsonb_build_object('source_version',ver,'plan',plan); end if;
 loop
  rid:=gen_random_uuid();
  exit when not exists(select 1 from public.live_events where id=rid) and not exists(select 1 from public.event_duplicate_operations where event_id=rid) and not exists(select 1 from storage.objects where bucket_id='event-assets' and name like rid::text||'/%');
 end loop;
 target:=case when nullif(plan->>'logo_source','') is not null then rid::text||'/event-logo.'||lower(substring(plan->>'logo_source' from '\.([a-zA-Z0-9]+)$')) else null end;
 if nullif(plan->>'logo_source','') is not null and (target is null or target !~ '\.(png|jpg|jpeg|svg|webp)$') then raise exception 'unsupported_logo'; end if;
 plan:=plan||jsonb_build_object('logo_target',target);
 insert into public.event_duplicate_operations(operation_id,admin_id,source_id,source_version,request_hash,plan,event_id)
 values(p_operation_id,p_admin_id,(snap#>>'{event,id}')::uuid,ver,md5(jsonb_build_object('source',p_source_slug,'version',p_source_version,'draft',p_draft)::text),plan,rid);
 return jsonb_build_object('state','pending','operation_id',p_operation_id,'plan',plan);
end $$;

revoke all on function public.mercury_duplicate_snapshot(text) from public,anon,authenticated;
revoke all on function public.mercury_duplicate_plan(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.mercury_duplicate_event(text,uuid,uuid,text,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.mercury_duplicate_snapshot(text),public.mercury_duplicate_plan(jsonb,jsonb),public.mercury_duplicate_event(text,uuid,uuid,text,text,jsonb,text,uuid) to service_role;
