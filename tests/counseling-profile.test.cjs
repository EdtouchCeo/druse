'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../netlify/functions/_lib/counseling');
const P=require('../netlify/functions/_lib/counseling-profile');
const cases=require('../netlify/functions/_lib/handlers/counseling-cases').handler;
const createAi=require('../netlify/functions/_lib/handlers/counseling-ai').createHandler;
const ids={auth:'50000000-0000-4000-8000-000000000001',teacher:'50000000-0000-4000-8000-000000000002',student:'50000000-0000-4000-8000-000000000003',studentUser:'50000000-0000-4000-8000-000000000004'};
const student={student_id:ids.student,name:'합성 학생',student_number:'10101',academic_year:2026,school_stage:'high',grade:1};
const row=()=>({id:C.newId(),subject:'PRIVATE_PROFILE_SUBJECT',academic_year:2026,semester:1,grade_scale:'5',rank_grade:2,score:87.5,achievement:'B'});
// Existing pre-workflow fixtures intentionally retain legacy behavior.
function legacySample(){const c=C.newCase(student,{id:ids.teacher,display_name:'합성 교사'}),s=c.sessions[0];delete s.workflow_version;s.topic='학습 자료 점검';s.teacher_opinion='자료를 확인하고 다음 질문을 정한다.';s.strategy.student_message='다음 시간에 학습 계획을 함께 점검합니다.';s.actions=[{id:C.newId(),text:'학습 계획 작성',status:'planned',due_date:''}];s.profile={...C.profileOf({}),interests:'PRIVATE_PROFILE_INTEREST',teacher_observations:'PRIVATE_PROFILE_OBSERVATION',selected_subjects:['PRIVATE_SELECTED_SUBJECT'],weekly_minutes:240,grades:[row()]};return c;}
function publish(c){const s=c.sessions[0];s.review={...C.reviewSession(s),state:'passed'};s.confirmed={at:C.now(),content_hash:C.hashSession(s),teacher_id:ids.teacher};s.guidance={published_at:C.now(),published_by:ids.teacher};return c;}
const event=(method='GET',body,q={})=>({httpMethod:method,headers:{authorization:'Bearer synthetic-only'},body:body===undefined?null:JSON.stringify(body),queryStringParameters:q});
function mock(c=legacySample(),studentMode=false){let stored=structuredClone(c);const calls=[];global.fetch=async(input,options={})=>{const url=new URL(input);calls.push({url,options});let data;
 if(url.pathname.endsWith('/auth/v1/user'))data={id:ids.auth};
 else if(url.pathname.endsWith('/users'))data=[{id:studentMode?ids.studentUser:ids.teacher,google_id:ids.auth,name:'합성 계정',role:studentMode?'학생':'교사',approved:true}];
 else if(url.pathname.endsWith('/counseling_roles'))data=[{role:studentMode?'student':'teacher'}];
 else if(url.pathname.endsWith('/counseling_assignments'))data=[{student_id:ids.student}];
 else if(url.pathname.endsWith('/counseling_students'))data=[{id:ids.student,user_id:ids.studentUser,name:student.name}];
 else if(url.pathname.endsWith('/counseling_student_numbers'))data=[student];
 else if(url.pathname.endsWith('/counseling_cases'))data=[{data:stored,student_id:ids.student}];
 else if(url.pathname.endsWith('/rpc/counseling_write_case')){stored=JSON.parse(options.body).p_case;data=stored;}
 else throw Error('Unexpected synthetic route');return Response.json(data);};
 return {calls,current:()=>stored,writes:()=>calls.filter(call=>call.url.pathname.includes('/rpc/'))};
}
test.beforeEach(()=>{process.env.COUNSELING_STORAGE='supabase';process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_KEY='synthetic-only';process.env.COUNSELING_SERVER_AI_ENABLED='false';});
test.afterEach(()=>{delete global.fetch;});

test('legacy and partially entered profiles normalize without inventing missing data',()=>{
 const c=legacySample();delete c.sessions[0].profile;const before=C.hashSession(c.sessions[0]);C.validateCase(c);const normalized=C.normalizeCase(c);assert.equal(C.hashSession(normalized.sessions[0]),before);assert.deepEqual(normalized.sessions[0].profile,{...Object.fromEntries(P.textFields.map(k=>[k,''])),selected_subjects:[],weekly_minutes:null,grades:[]});
 c.sessions[0].profile={interests:'수학 질문'};C.validateCase(c);assert.equal(C.profileOf(c.sessions[0]).interests,'수학 질문');assert.equal(C.profileOf(c.sessions[0]).weekly_minutes,null);assert.deepEqual(C.profileOf(c.sessions[0]).grades,[]);
});
test('all profile fields participate in the hash and zero minutes is retained',()=>{
 const s=legacySample().sessions[0];s.profile=C.profileOf({});const empty=C.hashSession(s);
 for(const key of P.textFields){const copy=structuredClone(s);copy.profile[key]='입력 근거';assert.notEqual(C.hashSession(copy),empty,key);}
 for(const change of [p=>{p.selected_subjects=['물리학']},p=>{p.weekly_minutes=0},p=>{p.grades=[row()]}]){const copy=structuredClone(s);change(copy.profile);assert.notEqual(C.hashSession(copy),empty);}
 s.profile.weekly_minutes=0;assert.equal(C.profileOf(s).weekly_minutes,0);
});
test('profile validates field sizes, selected subjects and integer weekly time',()=>{
 for(const mutate of [p=>{p.interests='x'.repeat(6001)},p=>{p.reading=null},p=>{p.extra='not allowed'},p=>{p.selected_subjects=Array(21).fill('과목')},p=>{p.selected_subjects=['x'.repeat(101)]},p=>{p.selected_subjects=[3]},p=>{p.weekly_minutes=-1},p=>{p.weekly_minutes=2401},p=>{p.weekly_minutes=0.5},p=>{p.weekly_minutes=true},p=>{p.grades=Array.from({length:61},row)}]){const c=legacySample();mutate(c.sessions[0].profile);assert.throws(()=>C.validateCase(c),C.HttpError);}
 const c=legacySample();c.sessions[0].profile.interests='x'.repeat(6000);c.sessions[0].profile.selected_subjects=Array.from({length:20},(_,i)=>String(i).padStart(2,'0')+'x'.repeat(98));c.sessions[0].profile.weekly_minutes=2400;c.sessions[0].profile.grades=Array.from({length:60},row);C.validateCase(c);
});
test('profile trims author input and rejects empty subjects, normalized duplicates and NUL characters',()=>{
 const c=legacySample(),profile=c.sessions[0].profile;profile.interests='  관심 질문\n';profile.selected_subjects=['  물리학 ', '수학\t'];profile.grades[0].subject=' 수학 ';profile.grades[0].achievement=' B ';C.validateCase(c);
 const normalized=C.profileOf(c.sessions[0]);assert.equal(normalized.interests,'관심 질문');assert.deepEqual(normalized.selected_subjects,['물리학','수학']);assert.equal(normalized.grades[0].subject,'수학');assert.equal(normalized.grades[0].achievement,'B');assert.equal(C.hashSession({...c.sessions[0],profile:normalized}),C.hashSession(c.sessions[0]));
 const mutations=[...P.textFields.map(key=>p=>{p[key]='before\0after'}),p=>{p.selected_subjects=[' ']},p=>{p.selected_subjects=['수학',' 수학 ']},p=>{p.selected_subjects=['수\0학']},p=>{p.grades[0].subject='수\0학'},p=>{p.grades[0].achievement='A\0'}];
 for(const mutate of mutations){const copy=legacySample();mutate(copy.sessions[0].profile);assert.throws(()=>C.validateCase(copy),C.HttpError);}
});
test('unfinished grade subject survives backup import and is clearly labeled in teacher PDF',async()=>{
 const c=legacySample();c.sessions[0].profile.grades[0].subject=' ';C.validateCase(c);const m=mock(c);
 const response=await cases(event('POST',{bundle:{format:'daeryun-counseling',version:1,case:c},student_id:ids.student,student_confirmed:true},{action:'import'}));assert.equal(response.statusCode,201);assert.equal(JSON.parse(response.body).case.sessions[0].profile.grades[0].subject,'');
 const restored=m.current();const pdf=await cases(event('GET',undefined,{id:restored.id,action:'report',audience:'teacher'}));assert.equal(pdf.statusCode,200);assert.ok(pdf.body.includes('과목 미입력'));
});
test('grade scales preserve unknown and achievement nulls and enforce numeric boundaries',()=>{
 const accepted=[{grade_scale:'5',rank_grade:5,score:0},{grade_scale:'9',rank_grade:9,score:100},{grade_scale:'achievement',rank_grade:null,score:89.25},{grade_scale:'unknown',rank_grade:null,score:null},{grade_scale:'5',rank_grade:null,score:null}];
 for(const change of accepted){const c=legacySample();Object.assign(c.sessions[0].profile.grades[0],change);C.validateCase(c);}
 const invalid=[{grade_scale:'5',rank_grade:6},{grade_scale:'9',rank_grade:10},{rank_grade:0},{rank_grade:1.5},{grade_scale:'unknown',rank_grade:1},{grade_scale:'achievement',rank_grade:1},{grade_scale:5},{score:-1},{score:100.1},{score:true},{score:NaN},{academic_year:1989},{academic_year:2101},{academic_year:2026.5},{semester:3},{subject:'x'.repeat(101)},{achievement:'x'.repeat(21)},{id:'invalid'}];
 for(const change of invalid){const c=legacySample();Object.assign(c.sessions[0].profile.grades[0],change);assert.throws(()=>C.validateCase(c),C.HttpError,JSON.stringify(change));}
});
test('duplicate grade IDs and unexpected grade fields cannot enter a backup',()=>{
 const c=legacySample();c.sessions[0].profile.grades.push(structuredClone(c.sessions[0].profile.grades[0]));assert.throws(()=>C.validateCase(c),C.HttpError);c.sessions[0].profile.grades.pop();c.sessions[0].profile.grades[0].comment='unexpected';assert.throws(()=>C.validateCase(c),C.HttpError);
});
test('profile edits invalidate review and cannot modify a confirmed session',async()=>{
 const c=legacySample();c.sessions[0].review=C.reviewSession(c.sessions[0]);mock(c);const incoming=structuredClone(c);incoming.sessions[0].profile.weekly_minutes=300;
 const updated=await cases(event('PUT',{case:incoming},{id:c.id}));assert.equal(updated.statusCode,200);const saved=JSON.parse(updated.body).case;assert.equal(saved.sessions[0].review,null);assert.equal(saved.sessions[0].confirmed,null);assert.equal(saved.sessions[0].guidance,null);
 const fixed=publish(legacySample()),m=mock(fixed),changed=structuredClone(fixed);changed.sessions[0].profile.grades[0].score=90;assert.equal((await cases(event('PUT',{case:changed},{id:fixed.id}))).statusCode,409);assert.equal(m.writes().length,0);
});
test('student list, detail, export and reports never contain profile keys or private values',async()=>{
 const c=publish(legacySample());mock(c,true);
 for(const q of [{},{id:c.id},{id:c.id,action:'export'},{id:c.id,action:'report',audience:'student'},{id:c.id,action:'report',audience:'teacher'}]){const response=await cases(event('GET',undefined,q));assert.equal(response.statusCode,200);assert.ok(!response.body.includes('PRIVATE_'));assert.ok(!response.body.includes('"profile"'));assert.ok(!response.body.includes('teacher_observations'));assert.ok(!response.body.includes('입력 성적표'));}
});
test('teacher PDF includes escaped profile summary and grades while student preview omits both',async()=>{
 const c=legacySample();c.sessions[0].profile.teacher_observations='<script>PRIVATE_PROFILE_XSS</script>';mock(c);
 const teacher=await cases(event('GET',undefined,{id:c.id,action:'report',audience:'teacher'}));assert.equal(teacher.statusCode,200);for(const label of ['교사용 학생 입력 자료','입력 성적표','5등급','87.5','주간 학습 시간','240분'])assert.ok(teacher.body.includes(label),label);assert.ok(teacher.body.includes('&lt;script&gt;'));assert.ok(!teacher.body.includes('<script>PRIVATE_PROFILE_XSS'));
 const studentPreview=await cases(event('GET',undefined,{id:c.id,action:'report',audience:'student'}));assert.equal(studentPreview.statusCode,200);assert.ok(!studentPreview.body.includes('PRIVATE_'));assert.ok(!studentPreview.body.includes('입력 성적표'));
});
test('next and valid import retain profile with independent copies and reset publication',async()=>{
 const c=publish(legacySample());mock(c);const next=await cases(event('POST',{revision:1},{id:c.id,action:'next'}));assert.equal(next.statusCode,200);const nextCase=JSON.parse(next.body).case;assert.deepEqual(nextCase.sessions[1].profile,c.sessions[0].profile);assert.equal(nextCase.sessions[1].guidance,null);nextCase.sessions[1].profile.selected_subjects.push('새 과목');assert.notDeepEqual(nextCase.sessions[1].profile,nextCase.sessions[0].profile);
 mock(c);const imported=await cases(event('POST',{bundle:{format:'daeryun-counseling',version:1,case:c},student_id:ids.student,student_confirmed:true},{action:'import'}));assert.equal(imported.statusCode,201);const copy=JSON.parse(imported.body).case;assert.deepEqual(copy.sessions[0].profile,c.sessions[0].profile);assert.equal(copy.sessions[0].guidance,null);assert.equal(copy.sessions[0].confirmed,null);
});
test('invalid profile import fails before any storage write',async()=>{
 const c=legacySample();c.sessions[0].profile.grades[0].grade_scale='unknown';const m=mock();const response=await cases(event('POST',{bundle:{format:'daeryun-counseling',version:1,case:c},student_id:ids.student,student_confirmed:true},{action:'import'}));assert.equal(response.statusCode,400);assert.equal(m.writes().length,0);
});
test('teacher AI receives stored profile and evidence-first instructions without changing data',async()=>{
 const c=legacySample(),m=mock(c);process.env.COUNSELING_SERVER_AI_ENABLED='true';process.env.GEMINI_API_KEY='synthetic-only';let prompt;
 const ai=createAi(async args=>{prompt=args.payload.contents[0].parts[0].text;return {ok:true,data:{candidates:[{content:{parts:[{text:'합성 분석 자료'}]}}]}};});
 const response=await ai(event('POST',{case_id:c.id,session_id:c.current_session_id,revision:1,privacy:'standard',purpose:'counseling'}));assert.equal(response.statusCode,200);assert.ok(prompt.includes('PRIVATE_PROFILE_OBSERVATION'));assert.ok(prompt.includes('"score":87.5'));assert.ok(prompt.includes('입력 근거에 따른 관찰 → 확인이 필요한 자료 → 교과 연결 → 다음 상담 질문 → 실행 제안'));assert.ok(prompt.includes('약점·역량 부족으로 판단하지 않는다'));assert.ok(prompt.includes('합격 가능성이나 합격 등급을 만들지 않는다'));assert.equal(m.writes().length,0);
 mock(c,true);let calls=0;const forbidden=createAi(async()=>{calls++;});assert.equal((await forbidden(event('POST',{case_id:c.id,session_id:c.current_session_id,revision:1,privacy:'standard',purpose:'counseling'}))).statusCode,403);assert.equal(calls,0);
});
