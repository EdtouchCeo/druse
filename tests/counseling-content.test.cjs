'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../netlify/functions/_lib/counseling');
test('online display helper is generated from the current browser implementation',t=>{
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
 const sourcePath=path.resolve(__dirname,'../../../apps/counseling/src/lib/reportContent.ts');
 if(!fs.existsSync(sourcePath))return t.skip('The standalone deployment uses the checked-in generated helper; source parity runs in the full workspace.');
 const source=fs.readFileSync(sourcePath,'utf8').replace(/\r\n/g,'\n');
 const generated=fs.readFileSync(path.resolve(__dirname,'../netlify/functions/_lib/counseling-report-content.js'),'utf8');
 assert.ok(generated.includes('// Source SHA-256: '+crypto.createHash('sha256').update(source).digest('hex')),'Run node scripts/sync-counseling-report-content.cjs after changing reportContent.ts.');
});
const student={student_id:'a0000000-0000-4000-8000-000000000001',student_number:'10101',academic_year:2026,school_stage:'high',grade:1,name:'합성 학생'};
function sample(){const c=C.newCase(student,{id:'a0000000-0000-4000-8000-000000000002',display_name:'합성 교사'}),s=c.sessions[0];delete s.workflow_version;s.topic='합성 학생 계획';s.strategy.subject_plan='수업의 두 자료를 비교한다.';s.strategy.student_message='비교표를 가져와 함께 확인합시다.';s.actions=[{id:C.newId(),text:'비교표 작성',due_date:'2026-09-21',status:'planned'}];return c;}

test('rules expose prediction, unfinished preparation and repeated prose as teacher review requests',()=>{
 const c=sample(),s=c.sessions[0],repeat='과제별 조건과 직접 인용은 확인한 원문대로 유지해야 합니다.';
 s.strategy.student_message='인용 예시: 합격 가능성이 높습니다.\n교사 준비안: 산출물을 정합니다.\n'+repeat+'\n'+repeat;
 const original=structuredClone(s),review=C.reviewSession(s),notes=review.notes.join('\n');
 for(const text of ['합격 가능성','준비 단계','같은 설명','학교 과제의 조건','AI 모델의 문체 평가'])assert.ok(notes.includes(text),text);
 assert.equal(review.state,'pending');assert.equal(review.method,'manual');assert.deepEqual(s,original);
});

test('final content requires strategy and guidance but no actions, schedules or completed consultation',()=>{
 const s=sample().sessions[0];s.actions=[];assert.equal(C.reviewSession(s).state,'pending');assert.equal(C.guidanceReady(s),true);
 s.strategy.student_message='';assert.equal(C.reviewSession(s).state,'needs_revision');s.strategy.student_message='안내';s.strategy.subject_plan='';assert.equal(C.reviewSession(s).state,'needs_revision');assert.equal(C.guidanceReady(s),false);
});
test('reports preserve repeated school conditions, HTML escaping and original records while omitting private fields',()=>{
 const c=sample(),s=c.sessions[0],condition='수업 시간에만 작성 · 자료 두 개 출처 표시 · 수치 1 2 보존';
 s.strategy.subject_plan+='\n'+condition;s.strategy.inquiry_plan='<script>synthetic</script>\n'+condition;
 s.profile.teacher_observations='PRIVATE_PROFILE';s.evidence_notes='PRIVATE_NOTE\n출처: SOURCE-01 · /assessment/0';
 const original=structuredClone(c);
 for(const audience of ['student','teacher']){const html=C.report(c,s,{audience});assert.equal(html.split(condition).length-1,2);assert.ok(!html.includes('PRIVATE_'));assert.ok(!html.includes('/assessment/0'));assert.ok(!html.includes('synthetic'));assert.ok(!html.includes('<script>'));}
 assert.deepEqual(c,original);
});
test('consumer titles are student-specific and download appears after the document body',()=>{
 const c=sample(),s=c.sessions[0];
 for(const [audience,title] of [['student','합성 학생 학습·진로 전략 보고서'],['teacher','합성 학생 학생부 분석 자료']]){const html=C.report(c,s,{audience});assert.ok(html.includes('<title>'+title+'</title>'));assert.ok(html.indexOf('<button')>html.indexOf('수업의 두 자료를 비교한다.'));assert.ok(html.includes('검토용 초안'));}
 c.student.name='<학생> & 합성';assert.ok(C.report(c,s).includes('&lt;학생&gt; &amp; 합성 학생부 분석 자료'));
});
test('legacy action fallback appears only for teacher records without a structured strategy',()=>{
 const c=sample(),s=c.sessions[0];s.next_date='2026-09-28';s.preparation={topic:'PRIVATE_SNAPSHOT',strategy:C.strategyOf(s),actions:[{text:'PRIVATE_OLD_ACTION'}]};
 s.actions[0].text='현재 비교 과제 <script>합성</script>\n조건: 수치 1 2 보존\n출처: 합성 자료 · /assessment/0';const original=structuredClone(c);
 for(const audience of ['student','teacher']){const html=C.report(c,s,{audience});assert.ok(!html.includes('<section class="preparation-items">'));assert.ok(!html.includes('현재 비교 과제'));assert.ok(html.includes('수업의 두 자료를 비교한다.'));}
 assert.deepEqual(c,original);
 const legacy=structuredClone(c);legacy.sessions[0].strategy=C.strategyOf({});const html=C.report(legacy,legacy.sessions[0]);assert.ok(html.includes('<section class="preparation-items">'));assert.ok(html.includes('<th scope="col">준비할 내용</th>'));assert.ok(!html.includes('&lt;script&gt;'));assert.ok(html.includes('현재 비교 과제'));assert.ok(html.includes('조건: 수치 1 2 보존'));assert.ok(html.includes('출처: 합성 자료'));for(const absent of ['PRIVATE_','/assessment/0','2026-09-21','2026-09-28','점검일','상태:','다음 점검'])assert.ok(!html.includes(absent),absent);
 assert.ok(!C.report(legacy,legacy.sessions[0],{audience:'student'}).includes('현재 비교 과제'));assert.deepEqual(c,original);
});
test('empty actions create no empty task or unknown-check placeholders',()=>{
 const c=sample(),s=c.sessions[0];s.actions=[];const html=C.report(c,s,{audience:'student'});for(const absent of ['실행 과제: 미정','다음 점검','학생이 준비할 내용','<h3>창체·봉사·독서·행동특성 전략'])assert.ok(!html.includes(absent));assert.ok(html.includes('수업의 두 자료를 비교한다.'));
});

test('all six school-life preparation areas remain distinct and complete in consumer reports',()=>{
 const c=sample(),s=c.sessions[0],areas=['자율·자치활동','동아리활동','진로활동','봉사활동','독서활동','행동특성 및 종합의견'];
 const fields=['현재 근거: 제공된 자료에서 경험이 확인되지 않음.','준비 방향: 기존 수업 자료에서 선택 가능한 질문을 먼저 고른다.','준비할 자료·결과물: <비교표> & 학생 설명','필요한 도움: 교사와 접근 가능한 자료의 조건을 확인한다.','연결할 교과·탐구: 국어 자료 해석과 관련 질문'];
 s.strategy.activity_plan=areas.map((area,index)=>`영역: ${area}\n${fields.join('\n')}\n조건: 합성 영역 ${index+1}의 선택 조건 보존`).join('\n\n');
 const original=structuredClone(c);
 for(const audience of ['student','teacher']){
  const html=C.report(c,s,{audience});assert.ok(html.includes('<h3>창체·봉사·독서·행동특성 전략</h3>'));
  let last=-1;
  for(const [index,area] of areas.entries()){
   const heading=`<h4>영역: ${area}</h4>`,at=html.indexOf(heading);assert.ok(at>last,area);last=at;
   const section=html.slice(at,html.indexOf(`조건: 합성 영역 ${index+1}의 선택 조건 보존`,at));
   for(const field of fields){const label=field.slice(0,field.indexOf(':')+1);assert.ok(section.includes(`<strong>${label}</strong>`),`${area} ${label}`);}
   assert.ok(section.includes('&lt;비교표&gt; &amp; 학생 설명'));assert.ok(section.includes('제공된 자료에서 경험이 확인되지 않음.'));
  }
  assert.ok(!html.includes('<비교표>'));assert.ok(!html.includes('비교표 작성'));
 }
 assert.deepEqual(c,original);
});
test('structured inquiry headings and year-by-year tables do not discard extra cells',()=>{
 const c=sample(),s=c.sessions[0];s.strategy.inquiry_plan='### 자료 비교 연구\n- **핵심 질문**: 조건은 결과에 어떤 영향을 주는가?\n| 단계 | 산출물 |\n| --- | --- |\n| 1학년 | 비교표 | 추가 근거 |\n| 2학년 | &lt;분석&gt; |';
 const html=C.report(c,s,{audience:'student'});assert.ok(html.includes('<h4>자료 비교 연구</h4>'));assert.ok(html.includes('<strong>핵심 질문</strong>'));assert.ok(html.includes('<th scope="col">단계</th>'));assert.ok(html.includes('<td>추가 근거</td>'));assert.ok(html.includes('&lt;분석&gt;'));
});
test('source names, author lines, repeated conditions and blank lines remain while internal pointers are hidden',()=>{
 const c=sample(),s=c.sessions[0],lines=['교사 계획: 비교표 작성','','학교 계획 참고: 합성 수업 자료','원문 시기: 확인 필요','조건: 수치 1 2 보존','AI 관련 원문: 초안 대필 금지','교사 추가 조건: 단위 먼저 표시','출처: 합성 자료 · /assessment/0','교사의 이어 쓴 설명','조건: 수치 1 2 보존'];
 s.strategy.subject_plan=lines.join('\n');const original=structuredClone(c),html=C.report(c,s,{audience:'student'});const paragraph=html.match(/<h3>교과 학습 계획<\/h3><p class="prose-lines">([\s\S]*?)<\/p>/)[1];assert.equal(paragraph.replace(/<[^>]*>/g,''),lines.map(line=>line.replace(' · /assessment/0','')).join('\n'));assert.ok(paragraph.includes('<span class="prose-line"><br></span>'));assert.ok(!/overflow\s*:\s*(?:hidden|clip)|max-height\s*:/.test(html));assert.deepEqual(c,original);
});

test('online display hides evidence audit rows and preserves official references, conditions and currency',()=>{
 const c=sample(),s=c.sessions[0];
 s.strategy.subject_plan=['<h4>다음 학습 준비</h4>','<p>조건을 <strong>비교</strong>합니다.<br>자료 두 개를 읽습니다.</p>',String.raw`관계: $A \rightarrow B$ · 비용 $20 · 자료 $5`,'원문 근거: HIDDEN_QUOTE','**확인 위치:** HIDDEN_LOCATION','자료 ID: HIDDEN_ID','근거 ID: HIDDEN_EVIDENCE','출처: 대학 시행계획 2028 · https://go.hanyang.ac.kr/notice/detail · 2026-09-11 확인','출처: 학교 과제 · 자료 task-123 · /assessment/0 · 개정 3','조건: 자료 두 개 · 2029학년도 적용 여부 확인','현재 근거: 자료의 비교 조건을 설명한 기록이 있습니다.'].join('\n');
 const original=structuredClone(c),hash=C.hashSession(s);
 for(const audience of ['student','teacher']){
  const html=C.report(c,s,{audience});
  for(const value of ['다음 학습 준비','<strong>비교</strong>','자료 두 개를 읽습니다.','A → B','비용 $20 · 자료 $5','대학 시행계획 2028','https://go.hanyang.ac.kr/notice/detail','2026-09-11 확인','출처: 학교 과제','조건: 자료 두 개 · 2029학년도 적용 여부 확인','현재 근거:'])assert.ok(html.includes(value),value);
  for(const value of ['HIDDEN_','원문 근거:','확인 위치:','자료 ID:','근거 ID:','task-123','/assessment/0','개정 3','\\rightarrow','$A','&lt;p&gt;','&lt;h4&gt;'])assert.ok(!html.includes(value),value);
 }
 assert.deepEqual(c,original);assert.equal(C.hashSession(s),hash);
});
test('delivery advice does not require schedules or approve school participation',()=>{
 const c=sample(),s=c.sessions[0];s.actions=[];s.strategy.student_message='가'.repeat(451);s.strategy.activity_plan='학교 활동 참고: 합성 모임\n대상·운영 확인 전 참고 자료';const original=structuredClone(c),review=C.reviewSession(s),notes=review.notes.join('\n');assert.ok(notes.includes('학생 안내에 긴 문단'));assert.ok(notes.includes('활동 참여가 확정된 것은 아닙니다'));assert.ok(!notes.includes('다음 점검'));assert.equal(review.state,'pending');assert.deepEqual(c,original);
});

test('manual review ignores private notes and legacy tasks but preserves their confirmation hash coverage',()=>{
 const s=sample().sessions[0],before=C.reviewSession(s),privateText='무조건 합격. 혁명적. 교사 준비안: 산출물을 정합니다.';
 for(const key of ['student_question','context','evidence_notes','teacher_opinion'])s[key]=privateText;
 s.consultation={...C.consultationOf(s),student_response:privateText,summary:privateText};s.profile.teacher_observations=privateText;s.actions[0].text=privateText;
 const after=C.reviewSession(s);assert.deepEqual(after.notes,before.notes);assert.notEqual(after.content_hash,before.content_hash);
 s.strategy.subject_plan=privateText;assert.ok(C.reviewSession(s).notes.some(note=>note.includes('합격 가능성')));
});
test('review covers analysis explanations and legacy opinions while source quotations stay read only',()=>{
 const s=sample().sessions[0],baseline=C.reviewSession(s).notes;
 s.analysis={summary:'자료의 비교 조건을 구분함.',strengths:[{text:'근거의 단위를 확인함.',guidance:'같은 조건으로 자료를 비교해 봅니다.',quote:'무조건 합격. 혁명적.'}]};
 assert.deepEqual(C.reviewSession(s).notes,baseline);s.analysis.strengths[0].guidance='합격 가능성이 높습니다.';assert.ok(C.reviewSession(s).notes.some(note=>note.includes('합격 가능성')));
 s.analysis=null;s.strategy=C.strategyOf({});s.teacher_opinion='합격 가능성이 높습니다.';assert.ok(C.reviewSession(s).notes.some(note=>note.includes('합격 가능성')));
});
test('detailed student preparation is assessed by paragraph size instead of total length',()=>{
 const s=sample().sessions[0];s.strategy.student_message=Array.from({length:25},(_,index)=>`${index}. 자료의 비교 조건과 출처를 설명하고 결과가 뜻하는 범위를 구분해 준비합니다.`).join('\n');
 assert.ok(s.strategy.student_message.length>1000);assert.ok(!C.reviewSession(s).notes.some(note=>note.includes('학생 안내에 긴 문단')));
 s.strategy.student_message='가'.repeat(451);assert.ok(C.reviewSession(s).notes.some(note=>note.includes('학생 안내에 긴 문단')));
});
