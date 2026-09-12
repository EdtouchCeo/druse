'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../netlify/functions/_lib/counseling');
const cases=require('../netlify/functions/_lib/handlers/counseling-cases').handler;
const createAi=require('../netlify/functions/_lib/handlers/counseling-ai').createHandler;
const ids={auth:'60000000-0000-4000-8000-000000000001',teacher:'60000000-0000-4000-8000-000000000002',student:'60000000-0000-4000-8000-000000000003',studentUser:'60000000-0000-4000-8000-000000000004'};
const student={student_id:ids.student,name:'합성 학생',student_number:'10101',academic_year:2026,school_stage:'high',grade:1};
const actor={id:ids.teacher,display_name:'합성 교사'};
function sample(){const c=C.newCase(student,actor),s=c.sessions[0];s.topic='실험 조건을 구체화하는 전략';s.strategy.subject_plan='PRIVATE_PREPARATION_PLAN';s.strategy.student_message='실험 조건표를 작성하고 검토합니다.';s.actions=[{id:C.newId(),text:'실험 조건표 작성',due_date:'2026-10-01',status:'planned'}];s.profile.teacher_observations='PRIVATE_PROFILE';return c;}
function prepared(c=sample()){const s=c.sessions[0];s.preparation={prepared_at:'2026-09-12T00:00:00.000Z',prepared_by:ids.teacher,topic:'PRIVATE_PREPARATION_TOPIC',strategy:C.strategyOf(s),actions:structuredClone(s.actions)};s.consultation={...C.consultationOf(s),status:'in_progress'};s.strategy.subject_plan='학생에게 전달할 교과 학습 계획';return c;}
function completed(c=prepared()){c.sessions[0].consultation={status:'completed',date:'2026-09-12',student_response:'PRIVATE_STUDENT_RESPONSE',agreed_direction:'PRIVATE_AGREED_DIRECTION',adjustments:'PRIVATE_ADJUSTMENTS',summary:'PRIVATE_SUMMARY'};return c;}
function confirmed(c=completed()){const s=c.sessions[0];s.review={...C.reviewSession(s),state:'passed'};s.confirmed={at:C.now(),teacher_id:ids.teacher,display_name:actor.display_name,content_hash:C.hashSession(s)};return c;}
function published(c=confirmed()){c.sessions[0].guidance={published_at:C.now(),published_by:ids.teacher};return c;}
const event=(method='GET',body,q={})=>({httpMethod:method,headers:{authorization:'Bearer synthetic-only'},body:body===undefined?null:JSON.stringify(body),queryStringParameters:q});
const parsed=r=>JSON.parse(r.body);
function mock(records=[sample()],{studentActor=false,assigned=true,revokeAt=Infinity,conflict=false}={}){
 const rows=new Map(records.map(c=>[c.id,structuredClone(c)])),calls=[];let studentMode=studentActor,assignmentReads=0;
 global.fetch=async(input,options={})=>{
  const url=new URL(input);calls.push({url,options});let data;
  if(url.pathname.endsWith('/auth/v1/user'))data={id:ids.auth};
  else if(url.pathname.endsWith('/users'))data=[{id:studentMode?ids.studentUser:ids.teacher,google_id:ids.auth,name:'합성 계정',role:studentMode?'학생':'교사',approved:true}];
  else if(url.pathname.endsWith('/counseling_roles'))data=[{role:studentMode?'student':'teacher'}];
  else if(url.pathname.endsWith('/counseling_assignments'))data=assigned&&++assignmentReads<revokeAt?[{student_id:ids.student}]:[];
  else if(url.pathname.endsWith('/counseling_students'))data=[{id:ids.student,user_id:ids.studentUser,name:student.name}];
  else if(url.pathname.endsWith('/counseling_student_numbers'))data=[student];
  else if(url.pathname.endsWith('/counseling_cases')){const id=url.searchParams.get('id')?.slice(3);data=(id?[rows.get(id)].filter(Boolean):[...rows.values()]).map(c=>({data:c,student_id:c.student.student_id}));}
  else if(url.pathname.endsWith('/rpc/counseling_write_case')){const b=JSON.parse(options.body);if(conflict||b.p_expected!==(rows.get(b.p_case.id)?.revision||0))return Response.json({code:'40001'},{status:409});rows.set(b.p_case.id,structuredClone(b.p_case));data=b.p_case;}
  else throw Error('Unexpected synthetic route');
  return Response.json(data);
 };
 return {rows,calls,asStudent:()=>{studentMode=true;},asTeacher:()=>{studentMode=false;},writes:()=>calls.filter(c=>c.url.pathname.includes('/rpc/'))};
}
const post=(c,action,extra={})=>cases(event('POST',{revision:c.revision,session_id:c.current_session_id,...extra},{id:c.id,action}));
test.beforeEach(()=>{process.env.COUNSELING_STORAGE='supabase';process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_KEY='synthetic-only';process.env.COUNSELING_SERVER_AI_ENABLED='false';});
test.afterEach(()=>{delete global.fetch;});

test('new create and next sessions start workflow 2 with no preparation or consultation',async()=>{
 const m=mock([]),response=await cases(event('POST',{student:{student_id:ids.student}}));assert.equal(response.statusCode,201);const c=parsed(response).case,s=c.sessions[0];assert.equal(s.workflow_version,2);assert.equal(s.preparation,null);assert.deepEqual(s.consultation,C.consultationOf({}));
 const next=await cases(event('POST',{revision:c.revision},{id:c.id,action:'next'}));assert.equal(next.statusCode,200);assert.equal(parsed(next).case.sessions[1].workflow_version,2);assert.equal(m.writes().length,2);
});

test('prepare records one server-owned snapshot and preserves it while final strategy changes',async()=>{
 const c=sample();c.sessions[0].review=C.reviewSession(c.sessions[0]);const m=mock([c]);const response=await post(c,'prepare');assert.equal(response.statusCode,200);const saved=parsed(response).case,s=saved.sessions[0];assert.equal(saved.revision,2);assert.equal(s.preparation.prepared_by,ids.teacher);assert.deepEqual(s.preparation.strategy,c.sessions[0].strategy);assert.deepEqual(s.preparation.actions,c.sessions[0].actions);assert.equal(s.consultation.status,'in_progress');assert.equal(s.review,null);
 const incoming=structuredClone(saved);incoming.sessions[0].strategy.subject_plan='상담에서 수정할 교과 계획';const updated=await cases(event('PUT',{case:incoming},{id:saved.id}));assert.equal(updated.statusCode,200);assert.deepEqual(parsed(updated).case.sessions[0].preparation,s.preparation);assert.equal(JSON.parse(m.writes()[0].options.body).p_action,'prepare');
 assert.equal((await post(parsed(updated).case,'prepare')).statusCode,409);
});

test('prepare requires a subject and an actionable plan, teacher assignment, revision and CAS',async()=>{
 for(const c of [(()=>{const c=sample();c.sessions[0].topic=' ';return c;})(),(()=>{const c=sample();c.sessions[0].strategy.subject_plan=' ';return c;})(),confirmed()]){const m=mock([c]);assert.equal((await post(c,'prepare')).statusCode,409);assert.equal(m.writes().length,0);}
 const c=sample();for(const options of [{studentActor:true},{assigned:false},{revokeAt:2}]){const m=mock([c],options);assert.equal((await post(c,'prepare')).statusCode,options.studentActor?403:404);assert.equal(m.writes().length,0);}
 let m=mock([c]);assert.equal((await post(c,'prepare',{revision:99})).statusCode,409);assert.equal(m.writes().length,0);m=mock([c],{conflict:true});assert.equal((await post(c,'prepare')).statusCode,409);assert.equal(m.rows.get(c.id).sessions[0].preparation,null);
});

test('legacy drafts can explicitly enter the new workflow but direct version or snapshot edits are rejected',async()=>{
 const legacy=sample();delete legacy.sessions[0].workflow_version;mock([legacy]);const upgraded=await post(legacy,'prepare');assert.equal(upgraded.statusCode,200);assert.equal(parsed(upgraded).case.sessions[0].workflow_version,2);
 for(const [source,mutate]of [[sample(),s=>{delete s.workflow_version;}],[sample(),s=>{s.preparation=prepared().sessions[0].preparation;s.consultation.status='in_progress';}],[prepared(),s=>{s.preparation.strategy.subject_plan='위조';}],[prepared(),s=>{s.preparation=null;s.consultation=C.consultationOf({});}]]){const m=mock([source]),incoming=structuredClone(source);mutate(incoming.sessions[0]);assert.equal((await cases(event('PUT',{case:incoming},{id:source.id}))).statusCode,400);assert.equal(m.writes().length,0);}
});

test('consultation cannot start or contain notes before preparation or return to not_started after it',()=>{
 for(const mutate of [s=>{s.consultation.status='in_progress';},s=>{s.consultation.student_response='아직 상담하지 않은 발언';},s=>{s.consultation.date='2026-09-12';}]){const c=sample();mutate(c.sessions[0]);assert.throws(()=>C.validateCase(c),e=>e.code==='PREPARATION_REQUIRED');}
 const c=prepared();c.sessions[0].consultation.status='not_started';assert.throws(()=>C.validateCase(c),C.HttpError);
 const legacy=sample();delete legacy.sessions[0].workflow_version;legacy.sessions[0].consultation={};C.validateCase(legacy);legacy.sessions[0].consultation.student_response='미준비 상담 입력';assert.throws(()=>C.validateCase(legacy),C.HttpError);
});

test('consultation validates real dates, required completion fields, strings, NUL and limits',()=>{
 for(const mutate of [s=>{s.consultation=null;},s=>{s.consultation.extra='x';},s=>{s.consultation.status='done';},s=>{s.consultation.date='2026-02-30';},s=>{s.consultation.date='2026-9-2';},s=>{s.consultation.student_response=' ';},s=>{s.consultation.agreed_direction='';},s=>{s.consultation.summary='x'.repeat(6001);},s=>{s.consultation.adjustments='a\0b';},s=>{s.consultation.student_response=[];}]){const c=completed();mutate(c.sessions[0]);assert.throws(()=>C.validateCase(c),C.HttpError);}
 const c=completed();c.sessions[0].consultation.date='2024-02-29';c.sessions[0].consultation.summary='x'.repeat(6000);C.validateCase(c);c.sessions[0].consultation.date='0000-01-01';assert.throws(()=>C.validateCase(c),C.HttpError);
});

test('imported preparation validates portable authors, timezone timestamps and the full strategy/action schema',()=>{
 const good=prepared();good.sessions[0].preparation.prepared_by='synthetic-demo';C.validateCase(good);
 for(const change of [p=>{p.prepared_at='2026-09-12T24:00:00Z';},p=>{p.topic='x'.repeat(201);},p=>{p.strategy.subject_plan='a\0b';}]){const c=prepared();change(c.sessions[0].preparation);assert.throws(()=>C.validateCase(c),C.HttpError);}
 for(const mutate of [s=>{delete s.workflow_version;},s=>{s.preparation.prepared_by='';},s=>{s.preparation.prepared_by='x'.repeat(161);},s=>{s.preparation.prepared_by='a\0b';},s=>{s.preparation.prepared_at='2026-09-12';},s=>{s.preparation.prepared_at='2026-09-12T10:00:00';},s=>{s.preparation.prepared_at='2026-02-30T10:00:00Z';},s=>{s.preparation.topic='';},s=>{s.preparation.strategy.subject_plan='';},s=>{s.preparation.strategy.extra='x';},s=>{s.preparation.actions[0].status='invalid';}]){const c=prepared();mutate(c.sessions[0]);assert.throws(()=>C.validateCase(c),C.HttpError);}
});

test('workflow content participates in hashes while empty legacy defaults preserve old reviews',()=>{
 const legacy=sample().sessions[0];delete legacy.workflow_version;delete legacy.preparation;delete legacy.consultation;const old=C.hashSession(legacy);assert.equal(C.hashSession({...legacy,preparation:null,consultation:C.consultationOf({})}),old);assert.notEqual(C.hashSession({...legacy,workflow_version:2}),old);
 const s=completed().sessions[0],hash=C.hashSession(s);for(const k of ['date','student_response','agreed_direction','adjustments','summary','status']){const copy=structuredClone(s);copy.consultation[k]+='changed';assert.notEqual(C.hashSession(copy),hash,k);}const copy=structuredClone(s);copy.preparation.strategy.subject_plan+='changed';assert.notEqual(C.hashSession(copy),hash);
});

test('prepare and completed consultation gate confirmation, publication and student PDF preview',async()=>{
 for(const c of [sample(),prepared()]){const s=c.sessions[0];s.review={...C.reviewSession(s),state:'passed'};mock([c]);for(const action of ['confirm','publish'])assert.equal((await post(c,action,action==='confirm'?{review_acknowledged:true}:{})).statusCode,409);assert.equal((await cases(event('GET',undefined,{id:c.id,action:'report',audience:'student'}))).statusCode,409);assert.equal((await cases(event('GET',undefined,{id:c.id,action:'report',audience:'teacher'}))).statusCode,200);}
 const c=completed(),m=mock([c]);const preview=await cases(event('GET',undefined,{id:c.id,action:'report',audience:'student'}));assert.equal(preview.statusCode,409);assert.equal(parsed(preview).error.code,'CONFIRM_REQUIRED');assert.equal(m.writes().length,0);
});

test('workflow 2 student PDFs require current confirmation while teacher draft reports remain available',async()=>{
 const c=completed(),m=mock([c]);
 assert.equal((await cases(event('GET',undefined,{id:c.id,action:'report',audience:'teacher'}))).statusCode,200);
 assert.equal((await cases(event('GET',undefined,{id:c.id,action:'report',audience:'student'}))).statusCode,409);
 const fixed=confirmed(c);m.rows.set(fixed.id,structuredClone(fixed));
 const report=await cases(event('GET',undefined,{id:fixed.id,action:'report',audience:'student'}));assert.equal(report.statusCode,200);assert.ok(report.body.includes('확정 · 학생 안내 전'));assert.ok(!report.body.includes('PRIVATE_'));
 fixed.sessions[0].strategy.subject_plan+=' tampered';m.rows.set(fixed.id,structuredClone(fixed));
 const invalid=await cases(event('GET',undefined,{id:fixed.id,action:'report',audience:'student'}));assert.equal(invalid.statusCode,409);assert.equal(parsed(invalid).error.code,'CONFIRM_REQUIRED');assert.equal(m.writes().length,0);
});

test('teacher plan, preparation, consultation, final revision, review, confirm and publish form a complete journey',async()=>{
 let c=sample();const m=mock([c]);c=parsed(await post(c,'prepare')).case;let incoming=structuredClone(c);incoming.sessions[0].consultation={...completed().sessions[0].consultation};incoming.sessions[0].strategy.subject_plan='학생과 합의한 최종 교과 계획';c=parsed(await cases(event('PUT',{case:incoming},{id:c.id}))).case;
 c=parsed(await post(c,'review')).case;assert.equal(c.sessions[0].review.state,'pending');c=parsed(await post(c,'confirm',{review_acknowledged:true})).case;assert.ok(c.sessions[0].confirmed);
 m.asStudent();assert.equal((await cases(event('GET',undefined,{id:c.id}))).statusCode,404);m.asTeacher();c=parsed(await post(c,'publish')).case;m.asStudent();const response=await cases(event('GET',undefined,{id:c.id}));assert.equal(response.statusCode,200);assert.equal(parsed(response).case.sessions[0].strategy.subject_plan,'학생과 합의한 최종 교과 계획');assert.ok(!response.body.includes('PRIVATE_'));
});

test('consultation edits invalidate review and confirmed consultation stays immutable',async()=>{
 const c=completed();c.sessions[0].review=C.reviewSession(c.sessions[0]);mock([c]);const incoming=structuredClone(c);incoming.sessions[0].consultation.summary+=' 추가 확인';const updated=await cases(event('PUT',{case:incoming},{id:c.id}));assert.equal(updated.statusCode,200);assert.equal(parsed(updated).case.sessions[0].review,null);assert.equal(parsed(updated).case.sessions[0].consultation.status,'completed');
 const fixed=confirmed(),m=mock([fixed]),changed=structuredClone(fixed);changed.sessions[0].consultation.summary+=' 변경';assert.equal((await cases(event('PUT',{case:changed},{id:fixed.id}))).statusCode,409);assert.equal(m.writes().length,0);
});

test('student lists, details, JSON and either report audience exclude preparation and consultation completely',async()=>{
 const c=published();mock([c],{studentActor:true});for(const q of [{},{id:c.id},{id:c.id,action:'export'},{id:c.id,action:'report',audience:'teacher'},{id:c.id,action:'report',audience:'student'}]){const response=await cases(event('GET',undefined,q));assert.equal(response.statusCode,200);for(const privateText of ['PRIVATE_','"profile"','"preparation"','"consultation"','prepared_by','student_response','합의한 방향','사전 전략'])assert.ok(!response.body.includes(privateText),privateText);}
 const invalid=published();invalid.sessions[0].consultation.status='in_progress';invalid.sessions[0].confirmed.content_hash=C.hashSession(invalid.sessions[0]);mock([invalid],{studentActor:true});assert.equal((await cases(event('GET',undefined,{id:invalid.id}))).statusCode,404);
});

test('teacher report distinguishes preparation, consultation and final strategy and escapes imported text',()=>{
 const c=completed(),s=c.sessions[0];s.preparation.topic='<script>PRIVATE_PREPARATION</script>';s.consultation.summary='<script>PRIVATE_CONSULTATION</script>';const html=C.report(c,s);for(const text of ['1. 교사의 사전 전략','2. 학생 상담과 반영 사항','3. 상담을 반영한 최종 전략 초안','PRIVATE_PREPARATION_PLAN','PRIVATE_STUDENT_RESPONSE','학생에게 전달할 교과 학습 계획','&lt;script&gt;'])assert.ok(html.includes(text),text);assert.ok(!html.includes('<script>PRIVATE_'));assert.ok(!html.includes('??'));
});

test('import preserves validated preparation as a reference and reopens consultation without inheriting trust',async()=>{
 const c=published(),m=mock([]);const response=await cases(event('POST',{bundle:{format:'daeryun-counseling',version:1,case:c},student_id:ids.student,student_confirmed:true},{action:'import'}));assert.equal(response.statusCode,201);const imported=parsed(response).case,s=imported.sessions[0];assert.deepEqual(s.preparation,c.sessions[0].preparation);assert.equal(s.consultation.status,'in_progress');assert.equal(s.consultation.student_response,'PRIVATE_STUDENT_RESPONSE');assert.equal(s.confirmed,null);assert.equal(s.review,null);assert.equal(s.guidance,null);assert.equal(s.imported_history.preparation_imported,true);assert.ok(C.report(imported,s).includes('가져온 사전 전략 참고본'));assert.equal((await cases(event('GET',undefined,{id:imported.id,action:'report',audience:'student'}))).statusCode,409);assert.equal(m.writes().length,1);
 const invalid=structuredClone(c);invalid.sessions[0].preparation.actions[0].status='bad';const refused=await cases(event('POST',{bundle:{format:'daeryun-counseling',version:1,case:invalid},student_id:ids.student,student_confirmed:true},{action:'import'}));assert.equal(refused.statusCode,400);assert.equal(m.writes().length,1);
});

test('legacy import remains legacy and next begins a fresh workflow while carrying strategy/profile/open actions',async()=>{
 const legacy=sample();delete legacy.sessions[0].workflow_version;mock([]);const response=await cases(event('POST',{bundle:{format:'daeryun-counseling',version:1,case:legacy},student_id:ids.student,student_confirmed:true},{action:'import'}));assert.equal(response.statusCode,201);assert.equal(parsed(response).case.sessions[0].workflow_version,undefined);
 const c=published();mock([c]);const next=await cases(event('POST',{revision:c.revision},{id:c.id,action:'next'}));assert.equal(next.statusCode,200);const s=parsed(next).case.sessions[1];assert.equal(s.workflow_version,2);assert.equal(s.preparation,null);assert.deepEqual(s.consultation,C.consultationOf({}));assert.deepEqual(s.strategy,c.sessions[0].strategy);assert.deepEqual(s.profile,c.sessions[0].profile);assert.notEqual(s.actions[0].id,c.sessions[0].actions[0].id);assert.deepEqual(parsed(next).case.sessions[0],c.sessions[0]);
});

test('AI receives stored preparation and consultation but must draft a teacher strategy before subsidiary questions',async()=>{
 const c=completed(),m=mock([c]);process.env.COUNSELING_SERVER_AI_ENABLED='true';process.env.GEMINI_API_KEY='synthetic-only';let sent;const handler=createAi(async args=>{sent=args;return {ok:true,data:{candidates:[{content:{parts:[{text:'합성 사전 전략'}]}}]}};});
 const response=await handler(event('POST',{case_id:c.id,session_id:c.current_session_id,revision:1,privacy:'standard',purpose:'counseling'}));assert.equal(response.statusCode,200);const prompt=sent.payload.contents[0].parts[0].text;for(const text of ['교사의 사전 전략','부속 자료','상담 전에는 학생의 반응이나 합의를 만들지','최종 전략과 실행 과제에 반영','PRIVATE_PREPARATION_PLAN','PRIVATE_STUDENT_RESPONSE'])assert.ok(prompt.includes(text),text);assert.ok(!prompt.includes('prepared_by'));assert.equal(m.writes().length,0);
});
