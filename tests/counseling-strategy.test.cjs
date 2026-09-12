'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../netlify/functions/_lib/counseling');
const cases=require('../netlify/functions/_lib/handlers/counseling-cases').handler;
const createAi=require('../netlify/functions/_lib/handlers/counseling-ai').createHandler;
const ids={auth:'40000000-0000-4000-8000-000000000001',teacher:'40000000-0000-4000-8000-000000000002',student:'40000000-0000-4000-8000-000000000003',studentUser:'40000000-0000-4000-8000-000000000004'};
const person={id:ids.teacher,google_id:ids.auth,name:'합성 교사',role:'교사',approved:true};
const student={student_id:ids.student,name:'합성 학생',student_number:'10101',academic_year:2026,school_stage:'high',grade:1};
function sample(){const c=C.newCase(student,{id:ids.teacher,display_name:'합성 교사'}),s=c.sessions[0];s.topic='물리 탐구의 근거를 구체화하기';s.student_question='PRIVATE_STUDENT_QUESTION';s.context='PRIVATE_CONTEXT';s.evidence_notes='PRIVATE_EVIDENCE';s.teacher_opinion='PRIVATE_TEACHER_OPINION';s.strategy={target_major:'물리학',target_path:'학종 준비',strengths:'측정 오차를 질문한 경험',gaps:'반복 측정 근거 보완',subject_plan:'수학 함수와 측정값 비교',inquiry_plan:'반복 실험 조건 설계',activity_plan:'동아리 측정 계획',semester_plan:'2학기 탐구 기록 점검',student_message:'다음 상담까지 실험 조건과 반복 횟수를 계획해 오세요.'};s.actions=[{id:C.newId(),text:'측정 조건표 작성',due_date:'2026-10-01',status:'planned'}];return c;}
function confirmed(c=sample()){const s=c.sessions[0];s.review={...C.reviewSession(s),state:'passed'};s.confirmed={at:C.now(),teacher_id:ids.teacher,display_name:'PRIVATE_CONFIRM_METADATA',content_hash:C.hashSession(s)};return c;}
function published(c=confirmed()){c.sessions[0].guidance={published_at:C.now(),published_by:ids.teacher};return c;}
const event=(method='GET',body,q={})=>({httpMethod:method,headers:{authorization:'Bearer synthetic-only'},body:body===undefined?null:JSON.stringify(body),queryStringParameters:q});
const parsed=response=>JSON.parse(response.body);
function mock(records=[sample()],{studentActor=false,assigned=true,revokeAt=Infinity}={}){
 const rows=new Map(records.map(c=>[c.id,structuredClone(c)]));const calls=[];let studentMode=studentActor,assignmentReads=0;
 global.fetch=async(input,options={})=>{
  const url=new URL(input),query=url.searchParams;calls.push({url,options});let data;
  if(url.pathname.endsWith('/auth/v1/user'))data={id:ids.auth};
  else if(url.pathname.endsWith('/users'))data=[studentMode?{...person,id:ids.studentUser,role:'학생'}:person];
  else if(url.pathname.endsWith('/counseling_roles'))data=[{role:studentMode?'student':'teacher'}];
  else if(url.pathname.endsWith('/counseling_assignments'))data=assigned&&++assignmentReads<revokeAt?[{student_id:ids.student}]:[];
  else if(url.pathname.endsWith('/counseling_students'))data=[{id:ids.student,user_id:ids.studentUser,name:student.name}];
  else if(url.pathname.endsWith('/counseling_student_numbers'))data=[student];
  else if(url.pathname.endsWith('/counseling_cases')){const id=query.get('id')?.slice(3);data=(id?[rows.get(id)].filter(Boolean):[...rows.values()]).map(c=>({data:c,student_id:c.student.student_id}));}
  else if(url.pathname.endsWith('/rpc/counseling_write_case')){const b=JSON.parse(options.body);rows.set(b.p_case.id,structuredClone(b.p_case));data=b.p_case;}
  else throw Error('Unexpected synthetic route');
  return Response.json(data);
 };
 return {calls,rows,asStudent:()=>{studentMode=true;},asTeacher:()=>{studentMode=false;},writes:()=>calls.filter(call=>call.url.pathname.includes('/rpc/'))};
}
test.beforeEach(()=>{process.env.COUNSELING_STORAGE='supabase';process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_KEY='synthetic-only';process.env.COUNSELING_SERVER_AI_ENABLED='false';});
test.afterEach(()=>{delete global.fetch;});

test('legacy sessions gain empty strategy and null guidance without invalidating old content hashes',()=>{
 const c=sample(),s=c.sessions[0];delete s.strategy;delete s.guidance;
 const oldContent={id:s.id,date:s.date,...Object.fromEntries(['topic','student_question','context','evidence_notes','teacher_opinion','next_date'].map(k=>[k,s[k]||''])),actions:s.actions};
 const oldHash=crypto.createHash('sha256').update(JSON.stringify(oldContent)).digest('hex');
 const normalized=C.normalizeCase(c);assert.equal(C.hashSession(normalized.sessions[0]),oldHash);assert.deepEqual(Object.values(normalized.sessions[0].strategy),Array(9).fill(''));assert.equal(normalized.sessions[0].guidance,null);C.validateCase(c);
});
test('every strategy field changes the review hash while guidance never does',()=>{
 const s=sample().sessions[0],original=C.hashSession(s);
 for(const key of C.strategyFields){const copy=structuredClone(s);copy.strategy[key]+=' 새 계획';assert.notEqual(C.hashSession(copy),original,key);}
 s.guidance={published_at:C.now(),published_by:ids.teacher};assert.equal(C.hashSession(s),original);
});
test('strategy schema rejects extra fields, nonstrings and incomplete objects',()=>{
 for(const mutate of [s=>{s.strategy.extra='private'},s=>{s.strategy.strengths=[]},s=>{delete s.strategy.gaps},s=>{s.strategy=null}]){const c=sample();mutate(c.sessions[0]);assert.throws(()=>C.validateCase(c),C.HttpError);}
});
test('strategy review uses student guidance and actions while retaining internal-only legacy review',()=>{
 const s=sample().sessions[0];s.teacher_opinion='';assert.equal(C.reviewSession(s).state,'pending');s.strategy.student_message='';assert.equal(C.reviewSession(s).state,'needs_revision');s.strategy=C.strategyOf({});s.teacher_opinion='기존 수기 의견';assert.equal(C.reviewSession(s).state,'pending');
});
test('draft strategy edits clear review and confirmed strategy edits are rejected',async()=>{
 const c=sample();c.sessions[0].review=C.reviewSession(c.sessions[0]);let m=mock([c]);const incoming=structuredClone(c);incoming.sessions[0].strategy.semester_plan='다음 학기에 점검';
 let response=await cases(event('PUT',{case:incoming},{id:c.id}));assert.equal(response.statusCode,200);assert.equal(parsed(response).case.sessions[0].review,null);assert.equal(parsed(response).case.sessions[0].guidance,null);
 const fixed=confirmed();m=mock([fixed]);const changed=structuredClone(fixed);changed.sessions[0].strategy.student_message='확정 후 변경';response=await cases(event('PUT',{case:changed},{id:fixed.id}));assert.equal(response.statusCode,409);assert.equal(m.writes().length,0);
});
test('guidance cannot be forged, cleared or replaced with a direct case update',async()=>{
 for(const source of [sample(),published()]){const incoming=structuredClone(source);incoming.sessions[0].guidance=source.sessions[0].guidance?null:{published_at:C.now(),published_by:ids.teacher};const m=mock([source]);const response=await cases(event('PUT',{case:incoming},{id:source.id}));assert.equal(response.statusCode,400);assert.equal(m.writes().length,0);}
});
test('confirmation alone stays private and explicit publish preserves its hash and records the actor',async()=>{
 const c=confirmed(),m=mock([c],{studentActor:true});assert.equal((await cases(event('GET',undefined,{id:c.id}))).statusCode,404);assert.deepEqual(parsed(await cases(event())).cases,[]);
 m.asTeacher();const response=await cases(event('POST',{revision:1,session_id:c.current_session_id},{id:c.id,action:'publish'}));assert.equal(response.statusCode,200);const saved=parsed(response).case;assert.equal(saved.revision,2);assert.equal(saved.sessions[0].guidance.published_by,ids.teacher);assert.equal(C.hashSession(saved.sessions[0]),c.sessions[0].confirmed.content_hash);
 assert.equal(JSON.parse(m.writes()[0].options.body).p_action,'publish');m.asStudent();assert.equal((await cases(event('GET',undefined,{id:c.id}))).statusCode,200);
});
test('publish needs current confirmation hash, student message, actions and is not repeated',async()=>{
 for(const c of [sample(),(()=>{const x=confirmed();x.sessions[0].strategy.gaps+=' changed';return x;})(),(()=>{const x=sample();x.sessions[0].strategy.student_message='';return confirmed(x);})(),(()=>{const x=sample();x.sessions[0].actions=[];return confirmed(x);})(),published()]){const m=mock([c]);const response=await cases(event('POST',{revision:c.revision,session_id:c.current_session_id},{id:c.id,action:'publish'}));assert.equal(response.statusCode,409);assert.equal(m.writes().length,0);}
});
test('publish rejects student actors and rechecks assignment after reading the case',async()=>{
 const c=confirmed();let m=mock([c],{studentActor:true});assert.equal((await cases(event('POST',{revision:1,session_id:c.current_session_id},{id:c.id,action:'publish'}))).statusCode,403);assert.equal(m.writes().length,0);
 for(const options of [{assigned:false},{revokeAt:2}]){m=mock([c],options);const response=await cases(event('POST',{revision:1,session_id:c.current_session_id},{id:c.id,action:'publish'}));assert.equal(response.statusCode,404);assert.equal(m.writes().length,0);}
});
test('student list/detail select only published sessions and remove internal and import metadata',async()=>{
 const c=published(),draft=C.freshSession();draft.topic='PRIVATE_DRAFT';draft.strategy.student_message='PRIVATE_DRAFT_STRATEGY';c.sessions.push(draft);c.current_session_id=draft.id;c.imported_from={id:'PRIVATE_SOURCE'};c.sessions[0].imported_history={review:{notes:['PRIVATE_HISTORY']}};c.teacher.private_note='PRIVATE_TEACHER_META';
 const hidden=sample();hidden.sessions[0].topic='PRIVATE_WHOLE_CASE';mock([c,hidden],{studentActor:true});
 const list=parsed(await cases(event())).cases;assert.equal(list.length,1);assert.equal(list[0].sessions.length,1);assert.equal(list[0].current_session_id,c.sessions[0].id);
 const detail=parsed(await cases(event('GET',undefined,{id:c.id}))).case;assert.equal(detail.sessions[0].strategy.target_major,'물리학');assert.equal(detail.sessions[0].confirmed,null);assert.equal(detail.sessions[0].review,null);assert.equal(detail.sessions[0].record,null);assert.equal(detail.sessions[0].analysis,null);assert.ok(!JSON.stringify(detail).includes('PRIVATE_'));assert.equal(detail.teacher.id,undefined);assert.equal(detail.imported_from,undefined);
 assert.equal((await cases(event('GET',undefined,{id:hidden.id}))).statusCode,404);
});
test('student exports and any requested report audience contain only guidance and reject draft IDs',async()=>{
 const c=published(),draft=C.freshSession();draft.topic='PRIVATE_DRAFT';c.sessions.push(draft);c.current_session_id=draft.id;mock([c],{studentActor:true});
 const exported=await cases(event('GET',undefined,{id:c.id,action:'export'}));assert.equal(exported.statusCode,200);assert.ok(!exported.body.includes('PRIVATE_'));
 for(const audience of ['teacher','student']){const response=await cases(event('GET',undefined,{id:c.id,action:'report',audience}));assert.equal(response.statusCode,200);assert.ok(response.body.includes('학생 안내'));assert.ok(!response.body.includes('PRIVATE_'));assert.ok(!response.body.includes('교사 내부 참고'));}
 assert.equal((await cases(event('GET',undefined,{id:c.id,action:'report',session_id:draft.id,audience:'teacher'}))).statusCode,404);
});
test('teacher can preview an unpublished student PDF without exposing internal notes or publishing',async()=>{
 const c=sample(),m=mock([c]);const preview=await cases(event('GET',undefined,{id:c.id,action:'report',audience:'student'}));assert.equal(preview.statusCode,200);assert.ok(preview.body.includes('초안'));assert.ok(preview.body.includes('물리학'));assert.ok(!preview.body.includes('PRIVATE_'));
 const internal=await cases(event('GET',undefined,{id:c.id,action:'report',audience:'teacher'}));assert.ok(internal.body.includes('PRIVATE_CONTEXT'));assert.equal(m.rows.get(c.id).sessions[0].guidance,null);assert.equal(m.writes().length,0);
});
test('student PDF preview preserves confirmed status and Korean strategy labels',async()=>{
 const c=confirmed();mock([c]);const response=await cases(event('GET',undefined,{id:c.id,action:'report',audience:'student'}));assert.equal(response.statusCode,200);assert.ok(response.body.includes('확정 · 학생 안내 전'));assert.ok(!response.body.includes('초안'));assert.ok(!response.body.includes('PRIVATE_CONFIRM_METADATA'));
 for(const label of ['대륜고 학종 전략 안내','전략 주제','희망 전공','진학 방향','강점','보완할 점','교과 학습 계획','탐구 계획','활동 계획','학기별 계획','학생에게 안내할 내용','학생 실행 과제','다음 전략 점검','인쇄 / PDF 저장'])assert.ok(response.body.includes(label),label);
 assert.ok(!response.body.includes('??'));
});
test('import retains strategy and historical evidence but always resets publication, review and confirmation',async()=>{
 const c=published(),m=mock();const response=await cases(event('POST',{bundle:{format:'daeryun-counseling',version:1,case:c},student_id:ids.student,student_confirmed:true},{action:'import'}));assert.equal(response.statusCode,201);const copy=parsed(response).case;assert.notEqual(copy.id,c.id);assert.deepEqual(copy.sessions[0].strategy,c.sessions[0].strategy);assert.equal(copy.sessions[0].guidance,null);assert.equal(copy.sessions[0].review,null);assert.equal(copy.sessions[0].confirmed,null);assert.ok(copy.sessions[0].imported_history.confirmed);m.asStudent();assert.equal((await cases(event('GET',undefined,{id:copy.id}))).statusCode,404);
});
test('next strategy revision copies strategy and unfinished actions without carrying publication',async()=>{
 const c=published();c.sessions[0].actions.push({id:C.newId(),text:'완료 과제',status:'done',due_date:''},{id:C.newId(),text:'진행 과제',status:'in_progress',due_date:''},{id:C.newId(),text:'보류 과제',status:'deferred',due_date:''});mock([c]);const response=await cases(event('POST',{revision:1},{id:c.id,action:'next'}));assert.equal(response.statusCode,200);const next=parsed(response).case.sessions[1];assert.deepEqual(next.strategy,c.sessions[0].strategy);assert.equal(next.actions.length,3);assert.ok(next.actions.every(a=>a.status!=='done'&&!c.sessions[0].actions.some(old=>old.id===a.id)));assert.equal(next.guidance,null);assert.equal(next.confirmed,null);assert.equal(next.review,null);assert.equal(next.topic,'전략 개정');assert.ok(next.context.includes(c.sessions[0].topic));assert.deepEqual(parsed(response).case.sessions[0],c.sessions[0]);
});
test('AI receives stored strategy context without publication metadata and leaves records unchanged',async()=>{
 const c=sample(),m=mock([c]);process.env.COUNSELING_SERVER_AI_ENABLED='true';process.env.GEMINI_API_KEY='synthetic-only';let sent;const handler=createAi(async args=>{sent=args;return {ok:true,data:{candidates:[{content:{parts:[{text:'합성 전략 초안'}]}}]}};});
 const response=await handler(event('POST',{case_id:c.id,session_id:c.current_session_id,revision:1,privacy:'standard',purpose:'counseling'}));assert.equal(response.statusCode,200);const prompt=sent.payload.contents[0].parts[0].text;assert.ok(prompt.includes('학생부종합전형'));assert.ok(prompt.includes('반복 실험 조건 설계'));assert.ok(!prompt.includes('published_by'));assert.equal(m.writes().length,0);
});
test('optional SQL schema denies direct raw case and version reads before and after upgrade',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const initial=fs.readFileSync(path.join(__dirname,'../supabase/migrations/202609110001_counseling.sql'),'utf8');
 const upgrade=fs.readFileSync(path.join(__dirname,'../supabase/migrations/202609120001_strategy_publication.sql'),'utf8');
 const browserGrants=[...initial.matchAll(/grant select on ([^;]+) to authenticated;/g)].map(match=>match[1]);
 assert.ok(browserGrants.length);assert.ok(browserGrants.every(grant=>!grant.includes('counseling_cases')&&!grant.includes('counseling_case_versions')));
 assert.ok(!/create policy counseling_(case|version)_read/.test(initial));
 assert.ok(upgrade.includes('revoke select on public.counseling_cases,public.counseling_case_versions from public,anon,authenticated;'));
 assert.ok(upgrade.includes('has_any_column_privilege'));assert.ok(upgrade.includes('raise exception'));
 for(const table of ['counseling_cases','counseling_case_versions'])assert.ok(upgrade.includes(`alter table public.${table} enable row level security;`));
 assert.ok(upgrade.includes('to service_role;'));assert.ok(!upgrade.includes('public.users'));assert.ok(!/grant[^;]+to (?:anon|authenticated)/.test(upgrade));
});
