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
 assert.ok(!output.includes('<h2>희망 전공</h2>'));assert.ok(!output.includes('<h2>다음 전략 점검</h2>'));
 assert.ok(output.indexOf('<h2>학생에게 안내할 내용')<output.indexOf('<h2>교과 학습 계획'));
 const teacher=C.report(c,s);assert.ok(teacher.includes('<span class="source-line">출처: SOURCE-01 · /assessment/0</span>'));
 assert.deepEqual(c,original);
});
test('optional blank profile sections are omitted and present next-review date is printed',()=>{
 const c=sample(),s=c.sessions[0];s.next_date='2026-09-28';
 const output=C.report(c,s);assert.ok(!output.includes('교사용 학생 입력 자료'));assert.ok(output.includes('다음 전략 점검'));assert.ok(output.includes('2026-09-28'));
});
