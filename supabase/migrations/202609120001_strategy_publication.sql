-- Optional SQL adapter upgrade only. The production Blobs adapter needs no DDL.
-- Apply after 202609110001_counseling.sql before enabling the SQL adapter.
-- Do not reverse this by restoring raw browser SELECT: use the projection API.
begin;

revoke select on public.counseling_cases,public.counseling_case_versions from public,anon,authenticated;
-- Also remove explicit column grants, which table-level REVOKE does not remove.
revoke select (id,student_id,created_by,revision,data,updated_at)
 on public.counseling_cases from public,anon,authenticated;
revoke select (case_id,revision,data,actor_id,action,created_at)
 on public.counseling_case_versions from public,anon,authenticated;
drop policy if exists counseling_case_read on public.counseling_cases;
drop policy if exists counseling_version_read on public.counseling_case_versions;
alter table public.counseling_cases enable row level security;
alter table public.counseling_case_versions enable row level security;
grant select on public.counseling_cases,public.counseling_case_versions to service_role;

-- Fail the transaction if an inherited or unexpected role still grants a read.
do $$
declare actor text; relation text;
begin
 foreach actor in array array['anon','authenticated'] loop
  foreach relation in array array['public.counseling_cases','public.counseling_case_versions'] loop
   if has_table_privilege(actor,relation,'SELECT') or has_any_column_privilege(actor,relation,'SELECT') then
    raise exception 'raw counseling read privilege remains';
   end if;
  end loop;
 end loop;
end;
$$;
commit;
