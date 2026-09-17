import test from 'node:test'
import assert from 'node:assert/strict'
import {analysisDashboardSections,analysisDetailIssue,dashboardSource,isStale,latestReport,normalizeReport,readReports,reportQualityIssue,resultDashboardSections,schoolConnectionContext,stageIssue,stageSections,type Report} from '../src/lib/preparationReports'
import {emptyProfile} from '../src/lib/profile'
import type {AdmissionTarget,Session} from '../src/lib/types'

const target:AdmissionTarget={id:'target-one',university:'합성대학교',major:'생명과학과',admission_type:'학생부종합',admission_name:'서류형',admission_year:2028}
function session():Session{return {id:'session-local-id',date:'2026-09-17',topic:'합성 상담',student_question:'',context:'',evidence_notes:'',teacher_opinion:'',actions:[],next_date:'',review:null,confirmed:null,profile:{...emptyProfile(),admission_targets:[target]},record:{id:'record-local-id',filename:'never-display-private-filename.pdf',sha256:'record-hash',page_count:2,school_stage:'high',readable_pages:[1],unreadable_pages:[2],warnings:['2쪽 판독 확인 필요'],sections:[{id:'evidence-one',category:'subject_detail',label:'생명과학 세부능력',school_stage:'high',academic_year:2026,grade:2,semester:1,pages:[1],text:'합성 학생이 두 자료의 차이를 비교해 설명함.',status:'present'}]},analysis:{summary:'자료 비교에서 출발하여 질문과 설명을 발전시키는 학습을 준비합니다.',strengths:[{area:'학업',text:'학업 강점 근거',guidance:'개념을 설명하는 방법',evidence_ids:['evidence-one']},{area:'진로',text:'진로 강점 근거',guidance:'관심 변화 확인',evidence_ids:['evidence-one']},{area:'공동체',text:'공동체 강점 근거',guidance:'개인 기여 확인',evidence_ids:[]}],improvements:[{area:'기타',text:'추가 확인할 별도 근거',guidance:'원문 확인',evidence_ids:[]}],questions:['자료 선택 이유를 어떻게 설명하나요?'],actions:[{area:'탐구',text:'자료의 비교 기준 만들기',reason:'주장의 차이를 확인하기 위해',evidence_ids:['evidence-one'],expected_output:'비교 기준 설명',review_criteria:'근거와 주장 연결',teacher_support:'자료 접근 확인'}],limitations:['제공되지 않은 활동은 판단하지 않습니다.'],model:'local-model',created_at:'2026-09-17',record_sha256:'record-hash'}}}
function report(kind:Report['kind']='admissions'):Report{return {id:kind+'-local-id',kind,target_id:target.id,title:'합성 대학·학과 준비',summary:'학생부 분석과 공개 자료를 연결한 준비 방향입니다.',source_hash:'current-input-hash',created_at:'2026-09-17T03:00:00Z',model:'synthetic-model',sources:[{id:'university-source',title:'합성대학교 공개 자료',url:'https://admissions.example.test/2028',year:2028}],evidence_map:{'strength:compare':{label:'자료 비교 · 학생부 분석',details:['합성 자료에서 확인한 비교 기준 설명.']}},sections:stageSections[kind].map((section,index)=>({id:section.id,title:section.title,overview:'공식 자료의 적용 범위를 먼저 확인하고 학생의 현재 학습에 연결합니다. 자료가 부족하면 확인 가능한 근거와 추가 확인할 부분을 구분합니다.',items:[0,1,2].map(itemIndex=>({title:section.title+'의 준비 '+(itemIndex+1),detail:`${index+1}영역 ${itemIndex+1}번째 합성 제안입니다. 수업에서 다룬 개념을 직접 설명하고, 두 자료의 설명이 달라지는 지점을 찾아 비교 기준을 세웁니다. 자료의 작성 목적과 비교 범위를 함께 기록하여 같은 조건에서 판단할 수 있는지 확인합니다. 확인하지 못한 조건은 결론에 섞지 않고 추가로 읽어야 할 자료와 필요한 개념으로 구분합니다.`,reason:'현재 확인된 학생의 자료 비교 경험을 발전시키고, 근거의 차이를 이해하여 자신의 설명을 수정하는 학습으로 연결하기 위한 제안입니다.',steps:['수업에서 사용한 개념과 자료의 비교 기준을 자신의 말로 설명합니다.','두 자료에서 같은 기준으로 비교할 수 있는 부분과 추가 확인할 부분을 구분합니다.'],evidence_refs:['strength:compare','public:university-source']}))}))}}

test('analysis dashboard keeps all findings, questions and source locations in five distinct sections',()=>{
 const value=session();value.analysis!.strengths.push({area:'자기관리',text:'자기관리 행동 근거',guidance:'지속한 행동 확인',evidence_ids:[]})
 const before=structuredClone(value),sections=analysisDashboardSections(value)
 assert.equal(sections.length,5)
 assert.match(sections[0]!.overview,/1쪽 판독.*1쪽 추가 확인 필요/)
 assert.match(sections[0]!.items[0]!.detail,/2026학년도.*2학년.*1학기.*1쪽/)
 assert.ok(sections[1]!.items.some(item=>item.detail==='학업 강점 근거'))
 assert.ok(sections[2]!.items.some(item=>item.detail==='진로 강점 근거'))
 assert.ok(sections[3]!.items.some(item=>item.detail==='공동체 강점 근거'))
 assert.ok(sections[3]!.items.some(item=>item.detail==='자기관리 행동 근거'))
 assert.ok(sections[4]!.items.some(item=>item.detail==='추가 확인할 별도 근거'))
 assert.ok(sections[4]!.items.some(item=>item.title==='추가 확인 질문'))
 assert.ok(sections[4]!.items.some(item=>item.steps.includes('필요한 도움: 자료 접근 확인')))
 assert.ok(!JSON.stringify(sections).includes('never-display-private-filename'))
 assert.deepEqual(value,before)
})

test('report reading keeps typed local evidence but drops unrelated metadata and executable source links',()=>{
 const input={...report(),filename:'never-display-private-path',student_id:'never-display-internal-student',sources:[{id:'unsafe',title:'차단할 자료 링크',url:'javascript:alert(1)'}]}
 const normalized=normalizeReport(input)!
 assert.equal(normalized.sources![0]!.url,'')
 assert.equal(normalized.evidence_map!['strength:compare']!.details[0],'합성 자료에서 확인한 비교 기준 설명.')
 assert.ok(!JSON.stringify(normalized).includes('never-display-'))
 normalized.sections[0]!.items[0]!.steps.push('로컬 수정')
 assert.notDeepEqual(normalized.sections,input.sections)
 assert.equal(readReports({version:1,reports:[input,{kind:'invalid'},null]}).length,1)
 assert.equal(readReports({version:2,reports:[input]}).length,0)
 assert.equal(normalizeReport({...input,sections:[{id:'unsafe'}]}),null)
})

test('target selection and stage readiness use the selected goal and current source hash',()=>{
 const first=report(),other={...report(),id:'other-target',target_id:'target-two',created_at:'2026-09-18T03:00:00Z'},next={...report(),id:'latest',created_at:'2026-09-18T03:00:00Z'}
 assert.equal(latestReport([first,other,next],'admissions',target.id)?.id,'latest')
 assert.equal(latestReport([first,other],'inquiry',target.id),undefined)
 assert.equal(isStale(first,undefined),true)
 assert.equal(isStale(first,'changed'),true)
 assert.equal(isStale(first,'current-input-hash'),false)
 assert.match(stageIssue(session(),'inquiry',target),/먼저 생성/)
 assert.match(stageIssue(session(),'inquiry',target,first,'changed'),/입력 내용이 달라/)
 assert.equal(stageIssue(session(),'inquiry',target,first,'current-input-hash'),'')
 assert.match(stageIssue(session(),'admissions',{...target,major:''}),/대학과 학과/)
 assert.match(stageIssue({...session(),imported_unverified:true},'admissions',target),/다시 확인/)
 assert.match(stageIssue({...session(),confirmed:{by:'synthetic'}},'admissions',target),/새 회차/)
 assert.match(stageIssue({...session(),guidance:{published_at:'2026-09-17',published_by:'synthetic'}},'inquiry',target,first,'current-input-hash'),/새 회차/)
 assert.equal(stageIssue({...session(),confirmed:{by:'synthetic'}},'analysis',target),'')
 assert.match(stageIssue({...session(),analysis:{...session().analysis!,record_sha256:'old-record'}},'admissions',target),/다시 분석/)
})

test('school source scope and mandatory steps survive reading without claiming current enrollment',()=>{
 const connection={subject:'합성 교과',task:'합성 비교 과제',reason:'교과 개념을 비교하는 참고 후보입니다.',conditions:['AI 활용 금지'],academic_year:2026,grade:3,semester:2,status:'원문 계획 · 현재 적용 확인 필요',steps:['두 자료의 비교 기준을 먼저 정한다.','반례를 검토하고 결론의 범위를 설명한다.'],learning_topics:['자료의 대표성'],source:'합성 학교 계획'}
 const input={...report(),school_connections:[connection]}
 const normalized=normalizeReport(input)!.school_connections![0]!
 assert.deepEqual(normalized,connection)
 normalized.steps!.push('추가 검토');assert.equal(connection.steps.length,2)
 const future=schoolConnectionContext(normalized,{grade:1,academic_year:2026})
 assert.equal(future.scope,'2026학년도 · 3학년 · 2학기');assert.match(future.notice,/이후 학년의 선택 후보.*이수를 확정하지/)
 assert.match(schoolConnectionContext({...normalized,grade:1},{grade:3,academic_year:2026}).notice,/이전 학년/)
 assert.match(schoolConnectionContext({...normalized,academic_year:2025},{grade:3,academic_year:2026}).notice,/다른 학년도/)
 assert.match(schoolConnectionContext(normalized,{grade:3,academic_year:2026}).notice,/현재 이수·과제 공지.*확인/)
 const unknown=schoolConnectionContext({subject:'',task:'',reason:'',conditions:[]},{grade:1,academic_year:2026})
 assert.match(unknown.scope,/학년도 미확인.*대상 학년 미확인.*학기 미확인/)
})

test('sparse analyses are labeled partial while source-valid reading and PDF access remain available',()=>{
 const value=session()
 assert.match(analysisDetailIssue(value),/상세 근거 추가 필요.*학업역량.*진로역량.*공동체역량/)
 assert.equal(stageIssue(value,'analysis',target),'')
 const text='개념을 설명하고 자료의 비교 기준과 판단의 한계를 구분합니다.'.repeat(30)
 value.record!.sections=[...value.record!.sections,{...value.record!.sections[0]!,id:'second'},{...value.record!.sections[0]!,id:'third'}]
 value.analysis!.summary=text
 value.analysis!.strengths=['학업','진로','공동체'].flatMap(area=>[0,1,2].map(index=>({area,text:index+text,guidance:text,evidence_ids:[]})))
 value.analysis!.improvements=[]
 value.analysis!.actions=[0,1,2].map(index=>({area:'탐구',text:index+text,reason:text,evidence_ids:[]}))
 assert.equal(analysisDetailIssue(value),'')
 value.analysis!.strengths=value.analysis!.strengths.filter(item=>item.area!=='진로')
 assert.match(analysisDetailIssue(value),/진로역량/)
 assert.equal(stageIssue(value,'analysis',target),'')
})

test('quality checks reject thin, repeated or incomplete sections without marking them as ready',()=>{
 assert.equal(reportQualityIssue(report()),'')
 const missing=report();missing.sections.pop();assert.match(reportQualityIssue(missing),/다섯/)
 const thin=report();thin.sections[0]!.items[0]!.detail='짧은 설명';assert.match(reportQualityIssue(thin),/보완/)
 const duplicate=report();duplicate.sections[0]!.items[1]!.detail=duplicate.sections[0]!.items[0]!.detail;assert.match(reportQualityIssue(duplicate),/반복/)
 const imported=report();imported.imported_unverified=true;assert.match(reportQualityIssue(imported),/가져온/)
 for(const kind of ['admissions','inquiry'] as const){const empty=resultDashboardSections(kind,undefined);assert.equal(empty.length,5);assert.ok(empty.every(section=>!section.items.length&&!!section.empty))}
})

test('evidence expansion resolves local analysis, original record and official sources without exposing unknown IDs',()=>{
 const value=session(),result=report()
 assert.deepEqual(dashboardSource('strength:compare',value,result),{label:'자료 비교 · 학생부 분석',text:'합성 자료에서 확인한 비교 기준 설명.',available:true})
 const original=dashboardSource('evidence-one',value,result)
 assert.match(original.label,/생명과학 세부능력.*1쪽/)
 assert.equal(original.text,value.record!.sections[0]!.text)
 const official=dashboardSource('public:university-source',value,result)
 assert.equal(official.url,'https://admissions.example.test/2028')
 assert.match(official.label,/2028학년도/)
 const unknown=dashboardSource('private-student-id-unknown',value,result)
 assert.equal(unknown.available,false)
 assert.ok(!JSON.stringify(unknown).includes('private-student-id-unknown'))
 const preceding=dashboardSource('admissions:summary',value,report('inquiry'),result)
 assert.equal(preceding.text,result.summary)
})
