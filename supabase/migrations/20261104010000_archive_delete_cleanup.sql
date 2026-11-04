-- Archive records remain immutable except inside confirmed event deletion.
create or replace function mercury_archive.immutable() returns trigger
language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' and exists(select 1 from public.live_events e join public.event_deletions d on d.event_id=e.id
  where e.slug=OLD.slug and d.confirmed_name=e.name) then return OLD; end if;
 raise exception 'immutable_record';
end $$;
-- Delete separate archive records in the same transaction as their event.
grant select(slug), delete on mercury_archive.audit, mercury_archive.candidates, mercury_archive.state to service_role;
create or replace function public.mercury_delete_event(p_admin_id uuid,p_session_hash text,p_event_id uuid,p_confirm_name text,p_cleanup_done boolean default false)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare e public.live_events%rowtype; receipt public.event_deletions%rowtype; paths jsonb; op record;
begin
 if not exists(select 1 from public.admin_sessions s join public.admin_clients a on a.id=s.admin_client_id
  where a.id=p_admin_id and a.active and s.token_hash=p_session_hash and s.expires_at>now()) then raise exception 'unauthorized'; end if;
 perform pg_advisory_xact_lock(hashtext('delete-event'),hashtext(p_event_id::text));
 select * into receipt from public.event_deletions where event_id=p_event_id for update;
 if found then
  if receipt.admin_id<>p_admin_id or receipt.confirmed_name is distinct from p_confirm_name then raise exception 'confirmation_mismatch'; end if;
  if p_cleanup_done then update public.event_deletions set assets_cleaned=true,logo_paths='[]' where event_id=p_event_id returning * into receipt; end if;
  return jsonb_build_object('deleted',true,'event_id',p_event_id,'assets_cleaned',receipt.assets_cleaned,'logo_paths',receipt.logo_paths);
 end if;
 if p_cleanup_done then raise exception 'event_not_found'; end if;
 -- Lock duplication operations before the source event, matching duplication's
 -- lock order. Pending copies must be resolved before deleting their source.
 for op in select operation_id from public.event_duplicate_operations where source_id=p_event_id or event_id=p_event_id order by operation_id loop
  perform pg_advisory_xact_lock(hashtextextended(op.operation_id::text,0));
 end loop;
 select * into e from public.live_events where id=p_event_id for update;
 if not found then raise exception 'event_not_found'; end if;
 if e.name is distinct from p_confirm_name then raise exception 'confirmation_mismatch'; end if;
 if exists(select 1 from public.event_duplicate_operations where (source_id=p_event_id or event_id=p_event_id) and state in ('pending','cleanup_pending'))
 then raise exception 'duplication_in_progress'; end if;
 select coalesce(jsonb_agg(o.name),'[]') into paths from storage.objects o
 where o.bucket_id='event-assets' and (starts_with(o.name,p_event_id::text||'/') or o.name=(select event_logo_path from public.event_settings where event_id=p_event_id))
 and not exists(select 1 from public.event_settings s where s.event_id<>p_event_id and s.event_logo_path=o.name);
 -- Preserve cancellation tombstones so old create requests cannot recreate a
 -- deleted event. Already-created copies remain independent live_events rows.
 update public.event_duplicate_operations set state='cancelled',source_id=null,source_version=null,plan=null,updated_at=now()
 where source_id=p_event_id or event_id=p_event_id;
 insert into public.event_deletions(event_id,admin_id,confirmed_name,logo_paths,assets_cleaned)
 values(p_event_id,p_admin_id,p_confirm_name,paths,jsonb_array_length(paths)=0) returning * into receipt;
 perform pg_advisory_xact_lock(hashtextextended('mercury-archive:'||e.slug,0));
 delete from mercury_archive.audit where slug=e.slug;
 delete from mercury_archive.candidates where slug=e.slug;
 delete from mercury_archive.state where slug=e.slug;
 delete from mercury_archive.admin_grants where event_id=p_event_id;
 -- All public event-owned records have verified ON DELETE CASCADE constraints:
 -- snapshots, finishers, entries, settings, aliases, activity, grants and leases.
 delete from public.live_events where id=p_event_id;
 return jsonb_build_object('deleted',true,'event_id',p_event_id,'assets_cleaned',receipt.assets_cleaned,'logo_paths',receipt.logo_paths);
end $$;
revoke all on function public.mercury_delete_event(uuid,text,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.mercury_delete_event(uuid,text,uuid,text,boolean) to service_role;
