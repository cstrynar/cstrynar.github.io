-- Transactional assertions: synthetic records only; every write rolls back.
-- Never select existing credentials or mutate an existing event.
do $$
declare aid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); copied uuid;
 op uuid:=gen_random_uuid(); slug text:='lifecycle-check-'||eid::text;
 snap jsonb; draft jsonb; result jsonb; version text;
begin
 begin
  set local role service_role;
  insert into public.admin_clients(id,name,key_hash) values(aid,'Rollback lifecycle assertion',repeat('0',64));
  insert into public.admin_sessions(admin_client_id,token_hash,expires_at) values(aid,aid::text,now()+interval '1 hour');
  insert into public.live_events(id,slug,name,event_date,is_public,status) values(eid,slug,'Rollback source',current_date-1,false,'setup');
  insert into public.event_settings(event_id,featured_race_key) values(eid,'5k');
  insert into public.event_race_aliases(event_id,source_label,race_key,display_label) values(eid,'5K','5k','5K');
  insert into public.bridge_event_policies(event_id,require_lease) values(eid,true);
  snap:=public.mercury_duplicate_event('source',aid,null,slug,null,null,aid::text,null);
  version:=snap->>'source_version';
  draft:=jsonb_build_object('event',jsonb_build_object('name','Rollback copy','slug',slug||'-copy','event_date',(current_date+365)::text,'location','','timezone','America/New_York'),
   'groups',jsonb_build_object('races',true,'awards',true,'branding',false,'display',true,'team',true,'starts',false),'races',snap->'races','featured_race_key','5k');
  result:=public.mercury_duplicate_event('reserve',aid,op,slug,version,draft,aid::text,null);
  begin
   perform public.mercury_delete_event(aid,aid::text,eid,'Rollback source');
   raise exception 'Pending duplicate deletion was allowed';
  exception when raise_exception then if sqlerrm<>'duplication_in_progress' then raise; end if; end;
  result:=public.mercury_duplicate_event('commit',aid,op,slug,version,draft,aid::text,null);
  copied:=(result#>>'{event,id}')::uuid;
  if copied is null or not exists(select 1 from public.live_events where id=copied and not is_public and status='setup' and current_revision=0) then raise exception 'Invalid duplicate'; end if;
  if (select count(*) from public.event_race_aliases where event_id=copied)<>1 then raise exception 'Missing copied race'; end if;
  begin
   perform public.mercury_delete_event(aid,'invalid-session',copied,'Rollback copy');
   raise exception 'Unauthorized delete allowed';
  exception when raise_exception then if sqlerrm<>'unauthorized' then raise; end if; end;
  begin
   perform public.mercury_delete_event(aid,aid::text,copied,'wrong name');
   raise exception 'Wrong-name delete allowed';
  exception when raise_exception then if sqlerrm<>'confirmation_mismatch' then raise; end if; end;
  insert into public.result_snapshots(event_id,revision,result_count,checksum,payload) values(copied,1,0,'rollback','{}');
  insert into public.finisher_events(event_id,bib,detected_revision,detected_at) values(copied,'test',1,now());
  result:=public.mercury_delete_event(aid,aid::text,copied,'Rollback copy');
  if result->>'deleted'<>'true' or exists(select 1 from public.live_events where id=copied) or exists(select 1 from public.result_snapshots where event_id=copied)
   or exists(select 1 from public.finisher_events where event_id=copied) or exists(select 1 from public.event_settings where event_id=copied)
   or exists(select 1 from public.event_race_aliases where event_id=copied) or exists(select 1 from public.bridge_event_policies where event_id=copied)
   or exists(select 1 from public.event_admin_activity where event_id=copied) then raise exception 'Deletion incomplete'; end if;
  if not exists(select 1 from public.live_events where id=eid) then raise exception 'Source deleted with copy'; end if;
  result:=public.mercury_delete_event(aid,aid::text,copied,'Rollback copy');
  if result->>'deleted'<>'true' then raise exception 'Retry failed'; end if;
  begin
   perform public.mercury_duplicate_event('reserve',aid,op,slug,version,draft,aid::text,null);
   raise exception 'Deleted copy resurrected';
  exception when raise_exception then if sqlerrm<>'operation_cancelled' then raise; end if; end;
  perform public.mercury_delete_event(aid,aid::text,eid,'Rollback source');
  if exists(select 1 from public.live_events where id=eid) then raise exception 'Source deletion failed'; end if;
  raise exception using errcode='PZ001',message='Rollback successful test fixtures';
 exception when sqlstate 'PZ001' then null;
 end;
end $$;
