-- Apply manually to a reviewed staging database before production. No student data is seeded.
begin;
-- Existing membership writes now go through verified Netlify endpoints only.
alter table public.users add column if not exists student_number text;
revoke insert,update,delete on public.users from anon,authenticated;
create table public.counseling_roles (
 user_id uuid not null references public.users(id), role text not null check(role in ('teacher','student','manager')),
 approved boolean not null default false, updated_at timestamptz not null default now(), primary key(user_id,role)
);
create table public.counseling_students (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.users(id),
 name text not null default '', active boolean not null default true, created_at timestamptz not null default now()
);
create table public.counseling_student_numbers (
 student_id uuid not null references public.counseling_students(id), academic_year integer not null check(academic_year between 2020 and 2100),
 student_number text not null check(student_number ~ '^[0-9]{4,8}$'), school_stage text not null check(school_stage in ('middle','high')),
 grade integer not null check(grade between 1 and 3), primary key(student_id,academic_year), unique(academic_year,student_number)
);
create table public.counseling_assignments (
 student_id uuid not null references public.counseling_students(id), teacher_user_id uuid not null references public.users(id),
 active boolean not null default true, updated_at timestamptz not null default now(), primary key(student_id,teacher_user_id)
);
create table public.counseling_cases (
 id uuid primary key, student_id uuid not null references public.counseling_students(id), created_by uuid not null references public.users(id),
 revision integer not null check(revision>0), data jsonb not null, updated_at timestamptz not null default now(),
 check(data->>'privacy'='standard'), check(data->>'id'=id::text), check((data->>'revision')::integer=revision)
);
create table public.counseling_case_versions (
 case_id uuid not null references public.counseling_cases(id), revision integer not null, data jsonb not null,
 actor_id uuid not null references public.users(id), action text not null, created_at timestamptz not null default now(), primary key(case_id,revision)
);
create table public.counseling_role_history (
 id bigint generated always as identity primary key, actor_id uuid not null references public.users(id),
 target_user_id uuid references public.users(id), action text not null, previous jsonb, current_value jsonb,
 created_at timestamptz not null default now()
);
create index counseling_cases_student on public.counseling_cases(student_id,updated_at desc);
create index counseling_assignments_teacher on public.counseling_assignments(teacher_user_id) where active;

-- Helper called only by owned security-definer functions. Roles selected during signup never grant counseling access.
create function public.counseling_has_role(p_user uuid,p_role text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.counseling_roles r join public.users u on u.id=r.user_id
 where r.user_id=p_user and r.role=p_role and r.approved is true and u.approved is true
 and (p_role='manager' or (p_role='teacher' and u.role='교사') or (p_role='student' and u.role='학생')));
$$;
create function public.counseling_actor_can_read(p_actor uuid,p_student uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.counseling_students s where s.id=p_student and s.active
 and ((s.user_id=p_actor and public.counseling_has_role(p_actor,'student')) or
 (public.counseling_has_role(p_actor,'teacher') and exists(select 1 from public.counseling_assignments a where a.student_id=s.id and a.teacher_user_id=p_actor and a.active))));
$$;
create function public.counseling_can_read(p_student uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.users u where u.google_id::text=auth.uid()::text and public.counseling_actor_can_read(u.id,p_student));
$$;
create function public.counseling_is_self(p_user uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.users u where u.id=p_user and u.google_id::text=auth.uid()::text and u.approved is true);
$$;

alter table public.counseling_roles enable row level security;
alter table public.counseling_students enable row level security;
alter table public.counseling_student_numbers enable row level security;
alter table public.counseling_assignments enable row level security;
alter table public.counseling_cases enable row level security;
alter table public.counseling_case_versions enable row level security;
alter table public.counseling_role_history enable row level security;
revoke all on public.counseling_roles,public.counseling_students,public.counseling_student_numbers,public.counseling_assignments,public.counseling_cases,public.counseling_case_versions,public.counseling_role_history from anon,authenticated;
-- Raw case JSON includes unpublished strategy and internal teacher notes.
-- Student reads must use the Netlify API's explicit publication projection.
revoke all on public.counseling_cases,public.counseling_case_versions from public;
grant select on public.counseling_roles,public.counseling_students,public.counseling_student_numbers,public.counseling_assignments to authenticated;
grant all on public.counseling_roles,public.counseling_students,public.counseling_student_numbers,public.counseling_assignments,public.counseling_cases,public.counseling_case_versions,public.counseling_role_history to service_role;
grant usage,select on sequence public.counseling_role_history_id_seq to service_role;
create policy counseling_own_role on public.counseling_roles for select to authenticated using(public.counseling_is_self(user_id));
create policy counseling_student_read on public.counseling_students for select to authenticated using(public.counseling_can_read(id));
create policy counseling_number_read on public.counseling_student_numbers for select to authenticated using(public.counseling_can_read(student_id));
create policy counseling_assignment_read on public.counseling_assignments for select to authenticated using(public.counseling_can_read(student_id));
-- No browser SELECT policies on case bodies or immutable historical versions.
revoke all on function public.counseling_has_role(uuid,text),public.counseling_actor_can_read(uuid,uuid),public.counseling_can_read(uuid),public.counseling_is_self(uuid) from public,anon,authenticated;
grant execute on function public.counseling_can_read(uuid),public.counseling_is_self(uuid) to authenticated,service_role;

-- Atomic optimistic write and immutable previous versions. Direct browser writes and RPC execution are denied.
create function public.counseling_write_case(p_actor uuid,p_case jsonb,p_expected integer,p_action text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid:=(p_case->>'id')::uuid; sid uuid:=(p_case->'student'->>'student_id')::uuid; old public.counseling_cases; s jsonb;
begin
 if not public.counseling_has_role(p_actor,'teacher') or not public.counseling_actor_can_read(p_actor,sid) then raise exception 'access denied' using errcode='42501'; end if;
 if p_case->>'privacy' is distinct from 'standard' or p_case->>'schema_version' is distinct from '1' or jsonb_typeof(p_case->'sessions') is distinct from 'array' then raise exception 'invalid data' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(p_case->'sessions') loop
  if (s->'record' is not null and s->'record'<>'null'::jsonb) or (s->'analysis' is not null and s->'analysis'<>'null'::jsonb) then raise exception 'local only data' using errcode='42501'; end if;
 end loop;
 if (p_case->>'revision')::integer<>p_expected+1 then raise exception 'revision conflict' using errcode='40001'; end if;
 select * into old from public.counseling_cases where id=cid for update;
 if found then
  if old.revision<>p_expected then raise exception 'revision conflict' using errcode='40001'; end if;
  if old.student_id<>sid or old.data->'student'<>p_case->'student' or old.data->'teacher'<>p_case->'teacher' then raise exception 'identity immutable' using errcode='42501'; end if;
  update public.counseling_cases set revision=p_expected+1,data=p_case,updated_at=now() where id=cid;
 else
  if p_expected<>0 or p_case->'teacher'->>'id'<>p_actor::text then raise exception 'invalid create' using errcode='42501'; end if;
  insert into public.counseling_cases(id,student_id,created_by,revision,data) values(cid,sid,p_actor,1,p_case);
 end if;
 insert into public.counseling_case_versions(case_id,revision,data,actor_id,action) values(cid,p_expected+1,p_case,p_actor,p_action);
 return p_case;
end;
$$;
revoke all on function public.counseling_write_case(uuid,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.counseling_write_case(uuid,jsonb,integer,text) to service_role;

create function public.counseling_administer(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare operation text:=p_input->>'action'; target uuid; sid uuid; previous_value jsonb;
begin
 if not public.counseling_has_role(p_actor,'manager') then raise exception 'manager required' using errcode='42501'; end if;
 if operation='role' then
  target:=(p_input->>'user_id')::uuid;
  if not exists(select 1 from public.users where id=target) then raise exception 'profile required' using errcode='42501'; end if;
  if (p_input->>'approved')::boolean and not exists(select 1 from public.users where id=target and approved is true and ((p_input->>'role')='manager' or (role='교사' and p_input->>'role'='teacher') or (role='학생' and p_input->>'role'='student'))) then raise exception 'approved profile required' using errcode='42501'; end if;
  select to_jsonb(r) into previous_value from public.counseling_roles r where user_id=target and role=p_input->>'role';
  insert into public.counseling_roles(user_id,role,approved) values(target,p_input->>'role',(p_input->>'approved')::boolean)
  on conflict(user_id,role) do update set approved=excluded.approved,updated_at=now();
 elsif operation='student' then
  target:=(p_input->>'user_id')::uuid;
  if not exists(select 1 from public.users where id=target and approved is true and role='학생') then raise exception 'student profile required' using errcode='42501'; end if;
  select id,to_jsonb(s) into sid,previous_value from public.counseling_students s where user_id=target;
  if sid is null then
   sid:=coalesce(nullif(p_input->>'student_id','')::uuid,gen_random_uuid());
   insert into public.counseling_students(id,user_id,name) values(sid,target,p_input->>'name');
  elsif p_input->>'student_id' is not null and sid::text<>p_input->>'student_id' then raise exception 'student id mismatch' using errcode='42501';
  else update public.counseling_students set name=p_input->>'name' where id=sid;
  end if;
  insert into public.counseling_student_numbers(student_id,academic_year,student_number,school_stage,grade)
  values(sid,(p_input->>'academic_year')::integer,p_input->>'student_number',p_input->>'school_stage',(p_input->>'grade')::integer)
  on conflict(student_id,academic_year) do update set student_number=excluded.student_number,school_stage=excluded.school_stage,grade=excluded.grade;
 elsif operation='assign' then
  sid:=(p_input->>'student_id')::uuid;target:=(p_input->>'teacher_user_id')::uuid;
  if (p_input->>'active')::boolean and not public.counseling_has_role(target,'teacher') then raise exception 'approved teacher required' using errcode='42501';end if;
  select to_jsonb(a) into previous_value from public.counseling_assignments a where student_id=sid and teacher_user_id=target;
  insert into public.counseling_assignments(student_id,teacher_user_id,active) values(sid,target,(p_input->>'active')::boolean)
  on conflict(student_id,teacher_user_id) do update set active=excluded.active,updated_at=now();
 else raise exception 'invalid operation' using errcode='22023';
 end if;
 insert into public.counseling_role_history(actor_id,target_user_id,action,previous,current_value) values(p_actor,target,operation,previous_value,p_input);
 return case when operation='student' then jsonb_build_object('student_id',sid) else jsonb_build_object('ok',true) end;
end;
$$;
revoke all on function public.counseling_administer(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.counseling_administer(uuid,jsonb) to service_role;
commit;
