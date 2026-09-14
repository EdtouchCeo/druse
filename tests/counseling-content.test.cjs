'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../netlify/functions/_lib/counseling');
const student={student_id:'a0000000-0000-4000-8000-000000000001',student_number:'10101',academic_year:2026,school_stage:'high',grade:1,name:'합성 학생'};
function sample(){const c=C.newCase(student,{id:'a0000000-0000-4000-8000-000000000002',display_name:'합성 교사'}),s=c.sessions[0];delete s.workflow_version;s.topic='합성 학생 계획';s.strategy.subject_plan='수업의 두 자료를 비교한다.';s.strategy.student_message='비교표를 가져와 함께 확인합시다.';s.actions=[{id:C.newId(),text:'비교표 작성',due_date:'2026-09-21',status:'planned'}];return c;}

test('rules expose prediction, unfinished preparation and repeated prose as teacher review requests',()=>{
 const c=sample(),s=c.sessions[0],repeat='과제별 조건과 직접 인용은 확인한 원문대로 유지해야 합니다.';
 s.strategy.student_message='인용 예시: 합격 가능성이 높습니다.\n교사 준비안: 산출물을 정합니다.\n'+repeat+'\n'+repeat;
 const original=structuredClone(s),review=C.reviewSession(s),notes=review.notes.join('\n');
 for(const text of ['합격 가능성','준비 단계','같은 설명','학교 과제의 조건','AI 모델의 문체 평가'])assert.ok(notes.includes(text),text);
 assert.equal(review.state,'pending');assert.equal(review.method,'manual');assert.deepEqual(s,original);
});
test('minimum missing delivery content alone blocks a new review without requiring all optional fields',()=>{
 const s=sample().sessions[0];assert.equal(C.reviewSession(s).state,'pending');s.strategy.student_message='';assert.equal(C.reviewSession(s).state,'needs_revision');s.strategy.student_message='안내';s.actions[0].text=' ';assert.equal(C.reviewSession(s).state,'needs_revision');
});
test('student print keeps repeated task conditions and HTML escaping while omitting empty and private fields',()=>{
 const c=sample(),s=c.sessions[0],condition='수업 시간에만 작성 · 자료 두 개 출처 표시 · 수치 1 2 보존';
 s.strategy.subject_plan+='\n'+condition;s.strategy.inquiry_plan='<script>synthetic</script>\n'+condition;
 s.profile.teacher_observations='PRIVATE_PROFILE';s.evidence_notes='PRIVATE_NOTE\n출처: SOURCE-01 · /assessment/0';
 const original=structuredClone(c),output=C.report(c,s,{audience:'student'});
 assert.equal(output.split(condition).length-1,2);assert.ok(!output.includes('PRIVATE_'));assert.ok(!output.includes('/assessment/0'));
 assert.ok(output.includes('&lt;script&gt;synthetic&lt;/script&gt;'));assert.ok(!output.includes('<script>'));
 assert.ok(!output.includes('<h3>목표 전공·관심 분야</h3>'));assert.ok(output.includes('<h2>다음 점검</h2><p>미정</p>'));
 assert.ok(output.indexOf('<h2>학생에게 전하는 안내')<output.indexOf('<h3>교과 학습 계획'));
 const teacher=C.report(c,s);assert.ok(teacher.includes('<span class="source-line">출처: SOURCE-01 · /assessment/0</span>'));
 assert.deepEqual(c,original);
});
test('optional blank profile sections are omitted and present next-review date is printed',()=>{
 const c=sample(),s=c.sessions[0];s.next_date='2026-09-28';
 const output=C.report(c,s);assert.ok(!output.includes('교사용 학생 입력 자료'));assert.ok(output.includes('다음 전략 점검'));assert.ok(output.includes('2026-09-28'));
});
test('student final print places actions and schedule before direction and long school plans',()=>{
 const c=sample(),s=c.sessions[0];s.next_date='2026-09-28';s.strategy.target_major='환경 분야 탐색';s.strategy.strengths='표에서 비교 조건을 표시했다.';
 s.strategy.subject_plan='긴 수업 계획과 확인 조건을 보존합니다.\n'.repeat(40);
 const original=structuredClone(c),html=C.report(c,s,{audience:'student'});
 const sequence=['<h2>학생에게 전하는 안내','<h2>이번 실행 과제','기한: 2026-09-21','<h2>다음 점검','2026-09-28','<h2>선택한 방향과 근거','<h2>교과·탐구·활동 계획','<h3>교과 학습 계획'];
 const positions=sequence.map(text=>html.indexOf(text));assert.ok(positions.every(position=>position>=0));assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
 assert.ok(html.includes('상태: 예정'));assert.ok(!html.includes('<h2>전략 주제'));
 assert.deepEqual(c,original);
});
test('missing action date and next check remain explicitly undecided',()=>{
 const c=sample(),s=c.sessions[0];s.actions[0].due_date='';s.actions[0].status='deferred';
 const html=C.report(c,s,{audience:'student'});
 assert.ok(html.includes('기한: 미정 · 상태: 보류'));assert.ok(html.includes('<h2>다음 점검</h2><p>미정</p>'));
 assert.ok(!html.includes('선택한 방향과 근거'));assert.ok(!html.includes('<h3>활동 계획'));
});
test('reference styling never parses away free text, repeated conditions or source pointers',()=>{
 const c=sample(),s=c.sessions[0],lines=['교사 계획: 비교표 작성','학교 계획 참고: 합성 수업 자료','원문 시기: 확인 필요','조건: 수치 1 2 보존','AI 관련 원문: 초안 대필 금지','교사 추가 조건: 단위 먼저 표시','출처: 합성 자료 · 자료 SOURCE-SYNTHETIC · /assessment/0 · 개정 1','교사의 이어 쓴 설명은 이 위치에 그대로 남는다.','학교 활동 참고: 끝 표시 없는 교사 글','원문 대상: 확인 필요','조건: 수치 1 2 보존'];
 s.strategy.subject_plan=lines.join('\n');s.evidence_notes='PRIVATE_SOURCE';const original=structuredClone(c),html=C.report(c,s,{audience:'student'});
 let previous=-1;for(const line of lines){const position=html.indexOf(line,previous+1);assert.ok(position>previous,line);previous=position;}
 assert.ok(html.includes('<strong class="school-reference">학교 계획 참고:'));assert.ok(html.includes('<span class="school-condition">AI 관련 원문:'));
 assert.ok(!html.includes('PRIVATE_SOURCE'));assert.deepEqual(c,original);
});
test('delivery advice is nonblocking and does not invent schedules or approve school participation',()=>{
 const c=sample(),s=c.sessions[0];s.actions[0].due_date='';s.strategy.student_message='가'.repeat(451);s.strategy.activity_plan='학교 활동 참고: 합성 모임\n대상·운영 확인 전 참고 자료';
 const original=structuredClone(c),digest=C.hashSession(s),review=C.reviewSession(s),notes=review.notes.join('\n');
 for(const text of ['기한과 다음 점검 시점이 모두 미정','학생 안내가 길어','활동 참여가 확정된 것은 아닙니다'])assert.ok(notes.includes(text));
 assert.equal(review.state,'pending');assert.deepEqual(c,original);assert.equal(C.hashSession(s),digest);
 for(const schedule of ['due','next']){s.actions[0].due_date=schedule==='due'?'2026-09-21':'';s.next_date=schedule==='next'?'2026-09-28':'';s.strategy.student_message='가'.repeat(450);const messages=C.reviewSession(s).notes.join('\n');assert.ok(!messages.includes('기한과 다음 점검 시점이 모두 미정'));assert.ok(!messages.includes('학생 안내가 길어'));}
});
test('author line breaks and blank lines survive printable block grouping without clipping styles',()=>{
 const c=sample(),s=c.sessions[0],lines=['활동 첫 문장과 마지막 글자까지 같은 단위로 읽는다.','','조건: 수업 시간에만 진행한다.','출처: 합성 자료 · /activity/0'];
 s.strategy.activity_plan=lines.join('\n');const original=structuredClone(c),html=C.report(c,s,{audience:'student'});
 const paragraph=html.match(/<h3>활동 계획<\/h3><p>([\s\S]*?)<\/p>/)[1];
 assert.equal(paragraph.replace(/<[^>]*>/g,''),lines.join('\n'));
 assert.ok(paragraph.includes('<span class="prose-line"><br></span>'));
 assert.ok(html.includes('.prose-line{display:block;white-space:pre-wrap;break-inside:avoid-page;overflow-wrap:anywhere}'));
 assert.ok(!/overflow\s*:\s*(?:hidden|clip)|max-height\s*:/.test(html));
 assert.deepEqual(c,original);
});
