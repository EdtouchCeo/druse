-- Optional SQL adapter upgrade after 202609130001_school_teacher_strategy_access.sql.
-- Blobs stores the same student/number/self-assignment in one configuration CAS.
-- This creates a strategy roster entry, never a school membership or login.
begin;

alter table public.counseling_students alter column user_id drop not null;
alter table public.counseling_students add column created_by uuid references public.users(id);
alter table public.counseling_students add constraint counseling_student_origin
 check(user_id is not null or created_by is not null);

create function public.counseling_create_student(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 student_name text; number_value text; year_value integer; stage_value text; grade_value integer;
 sid uuid; existing public.counseling_students; number_row public.counseling_student_numbers;
begin
 if not public.counseling_has_role(p_actor,'teacher') then raise exception 'teacher required' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid student' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_input) as k(key) where key not in ('name','student_number','academic_year','school_stage','grade')) then raise exception 'invalid fields' using errcode='22023'; end if;
 if jsonb_typeof(p_input->'name') is distinct from 'string' or
    jsonb_typeof(p_input->'student_number') is distinct from 'string' or
    jsonb_typeof(p_input->'academic_year') is distinct from 'number' or
    jsonb_typeof(p_input->'school_stage') is distinct from 'string' or
    jsonb_typeof(p_input->'grade') is distinct from 'number' then raise exception 'invalid student' using errcode='22023'; end if;
 student_name:=btrim(p_input->>'name'); number_value:=btrim(p_input->>'student_number'); stage_value:=p_input->>'school_stage';
 if char_length(student_name) not between 1 and 80 or student_name ~ '[[:cntrl:]]' or number_value !~ '^[0-9]{4,8}$' or
    (p_input->>'academic_year') !~ '^[0-9]{4}$' or (p_input->>'grade') !~ '^[1-3]$' or stage_value not in ('middle','high') then raise exception 'invalid student' using errcode='22023'; end if;
 year_value:=(p_input->>'academic_year')::integer; grade_value:=(p_input->>'grade')::integer;
 if year_value not between 2020 and 2100 then raise exception 'invalid year' using errcode='22023'; end if;

 -- Serialize retries on the unique academic-year/number key. The database
 -- unique constraint also protects against simultaneous manager registration.
 perform pg_advisory_xact_lock(hashtextextended('counseling-student:'||year_value::text||':'||number_value,0));
 -- Fresh approval check after any wait; protect it until this transaction ends.
 perform 1 from public.users where id=p_actor and approved is true and role='교사' for share;
 if not found then raise exception 'teacher required' using errcode='42501'; end if;
 select * into number_row from public.counseling_student_numbers where academic_year=year_value and student_number=number_value for update;
 if found then
  select * into existing from public.counseling_students where id=number_row.student_id for update;
  if existing.user_id is null and existing.created_by=p_actor and existing.active and existing.name=student_name and number_row.school_stage=stage_value and number_row.grade=grade_value then
   perform 1 from public.counseling_assignments where student_id=existing.id and teacher_user_id=p_actor and active for share;
   if found then return jsonb_build_object('student_id',existing.id,'name',student_name,'student_number',number_value,'academic_year',year_value,'school_stage',stage_value,'grade',grade_value,'account_linked',false); end if;
  end if;
  -- Do not disclose the existing student's identity or acquire their assignment.
  raise exception 'student number already registered' using errcode='23505';
 end if;

 sid:=gen_random_uuid();
 insert into public.counseling_students(id,user_id,created_by,name) values(sid,null,p_actor,student_name);
 insert into public.counseling_student_numbers(student_id,academic_year,student_number,school_stage,grade) values(sid,year_value,number_value,stage_value,grade_value);
 insert into public.counseling_assignments(student_id,teacher_user_id,active) values(sid,p_actor,true);
 insert into public.counseling_role_history(actor_id,target_user_id,action,previous,current_value)
 values(p_actor,null,'create_student',null,jsonb_build_object('student_id',sid,'name',student_name,'student_number',number_value,'academic_year',year_value,'school_stage',stage_value,'grade',grade_value));
 return jsonb_build_object('student_id',sid,'name',student_name,'student_number',number_value,'academic_year',year_value,'school_stage',stage_value,'grade',grade_value,'account_linked',false);
end;
$$;
revoke all on function public.counseling_create_student(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.counseling_create_student(uuid,jsonb) to service_role;

commit;
