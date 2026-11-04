-- Advisory telemetry only. No triggers or writes to race results or leases.
create table public.bridge_status_reports (
 event_id uuid not null references public.live_events(id) on delete cascade,
 client_id uuid not null references public.bridge_clients(id) on delete cascade,
 session_id text not null check (session_id ~ '^[a-f0-9]{32}$'),
 sequence bigint not null check(sequence>0 and sequence<=9007199254740991),
 version text not null check(length(version)<=30),
 state text not null check(state in ('starting','armed','watching','source_wait','upload_delayed','blocked','paused')),
 source_age_seconds integer check(source_age_seconds between 0 and 31536000),
 pending boolean not null, staged boolean not null, correction boolean not null,
 received_at timestamptz not null default clock_timestamp(),
 primary key(event_id,client_id,session_id)
);
create index bridge_status_client_idx on public.bridge_status_reports(client_id);
alter table public.bridge_status_reports enable row level security;
revoke all on public.bridge_status_reports from public,anon,authenticated;
grant select,insert,update,delete on public.bridge_status_reports to service_role;

create function public.record_bridge_status(p_client uuid,p_event uuid,p_session text,p_sequence bigint,p_version text,p_state text,p_age integer,p_pending boolean,p_staged boolean,p_correction boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 -- Validate permission again in the same transaction as the write.
 perform 1 from public.bridge_clients c join public.bridge_event_grants g on g.bridge_client_id=c.id
 where c.id=p_client and c.active and g.event_id=p_event and g.active and g.can_read for share of c,g;
 if not found then return null; end if;
 -- Serialise sessions per computer/event; each session has its own sequence.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event::text||p_client::text,0));
 insert into public.bridge_status_reports(event_id,client_id,session_id,sequence,version,state,source_age_seconds,pending,staged,correction)
 values(p_event,p_client,p_session,p_sequence,p_version,p_state,p_age,p_pending,p_staged,p_correction)
 on conflict(event_id,client_id,session_id) do update set sequence=excluded.sequence,version=excluded.version,state=excluded.state,
 source_age_seconds=excluded.source_age_seconds,pending=excluded.pending,staged=excluded.staged,correction=excluded.correction,received_at=clock_timestamp()
 where public.bridge_status_reports.sequence<excluded.sequence;
 get diagnostics affected=row_count;
 -- Bound storage to the eight most recently observed sessions per event/client.
 delete from public.bridge_status_reports where event_id=p_event and client_id=p_client and session_id not in (
 select session_id from public.bridge_status_reports where event_id=p_event and client_id=p_client order by received_at desc,session_id limit 8);
 return affected=1;
end $$;
revoke all on function public.record_bridge_status(uuid,uuid,text,bigint,text,text,integer,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_bridge_status(uuid,uuid,text,bigint,text,text,integer,boolean,boolean,boolean) to service_role;
