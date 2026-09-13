-- Optional SQL adapter upgrade. Production Blobs authorization is in the API.
-- Apply after 202609120001_strategy_publication.sql before using the SQL adapter.
-- School approval grants teacher access; manager/student grants remain explicit.
begin;

create or replace function public.counseling_has_role(p_user uuid,p_role text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.users u
 where u.id=p_user and u.approved is true and (
  (p_role='teacher' and u.role='교사') or
  ((p_role='manager' or (p_role='student' and u.role='학생')) and exists(
   select 1 from public.counseling_roles r
   where r.user_id=u.id and r.role=p_role and r.approved is true
  ))
 ));
$$;

-- Existing assignment/RLS checks and service-only mutation RPCs use this helper.
-- No raw case reads, manager rights, or student assignments are added here.
revoke all on function public.counseling_has_role(uuid,text) from public,anon,authenticated;

commit;
