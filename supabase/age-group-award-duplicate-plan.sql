CREATE OR REPLACE FUNCTION public.mercury_duplicate_plan(p_snapshot jsonb, p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if coalesce(s->>'grade_source','') not in ('grade','category','age','city') or coalesce(s->>'podium_mode','') not in ('featured','custom','off')
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
  if jsonb_typeof(a) is distinct from 'object' or a-array['age_group_places','overall_places','remove_overall_from_age_groups','age_groups','special_divisions']<>'{}'
    or jsonb_typeof(a->'age_groups') is distinct from 'array' or jsonb_typeof(a->'special_divisions') is distinct from 'array'
    or jsonb_typeof(a->'remove_overall_from_age_groups') is distinct from 'boolean'
    or (coalesce(a->>'overall_places','3') !~ '^[0-9]+$') then raise exception 'invalid_awards_configuration'; end if;
  if coalesce(a->>'age_group_places','3') !~ '^[0-9]+$' then raise exception 'invalid_awards_configuration'; end if;
  if coalesce(a->>'age_group_places','3')::numeric not between 0 and 20 then raise exception 'invalid_awards_configuration'; end if;
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
end $function$;
