-- Optional SQL adapter upgrade. Apply after the existing counseling migrations.
-- Deletion removes one teacher-owned case and its versions in one transaction.
begin;

create function public.counseling_delete_case(p_actor uuid,p_id uuid,p_expected integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.counseling_cases;
begin
 if not public.counseling_has_role(p_actor,'teacher') then raise exception 'access denied' using errcode='42501'; end if;
 if p_id is null or p_expected is null or p_expected<1 then raise exception 'invalid deletion' using errcode='22023'; end if;
 select * into old from public.counseling_cases where id=p_id for update;
 if not found then raise exception 'revision conflict' using errcode='40001'; end if;
 if old.created_by<>p_actor or old.data->'teacher'->>'id' is distinct from p_actor::text
  or not public.counseling_actor_can_read(p_actor,old.student_id) then raise exception 'access denied' using errcode='42501'; end if;
 if old.revision<>p_expected then raise exception 'revision conflict' using errcode='40001'; end if;
 -- Published guidance is inside case JSON; removing all versions also removes
 -- prior guidance. Student identities, assignments and other cases are kept.
 delete from public.counseling_case_versions where case_id=p_id;
 delete from public.counseling_cases where id=p_id;
 return jsonb_build_object('deleted',true,'id',p_id);
end;
$$;
revoke all on function public.counseling_delete_case(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.counseling_delete_case(uuid,uuid,integer) to service_role;

commit;
