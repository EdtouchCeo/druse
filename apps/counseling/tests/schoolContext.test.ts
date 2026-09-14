import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {adoptSchoolTask,adoptSchoolActivity,schoolActivityAction,activityApplicability,schoolMatches,schoolAiLabel,taskReference,activityReference,type SchoolContext,type SchoolActivity} from '../src/lib/schoolContext'
import {emptyStrategy,studentView} from '../src/lib/model'
import type {Student,CounselingCase} from '../src/lib/types'
import {finalCase} from './fixtures/studentResult'

const data:SchoolContext=JSON.parse(readFileSync(new URL('../src/data/school-context.json',import.meta.url),'utf8'))
const student:Student={student_id:'synthetic-audit',student_number:'00000',school_stage:'high',academic_year:2026,grade:2}
const forbidden=data.assessments.find(task=>task.subject==='화법과 언어'&&task.conditions.includes('AI 활용 금지'))!
const activity=data.activities.find(row=>row.id==='AP-S002-A01')!
const options={student,semester:2,weekly_minutes:30}
const studentProjection=(strategy:ReturnType<typeof emptyStrategy>)=>studentView({schema_version:1,id:'synthetic',revision:1,privacy:'standard',student,teacher:{display_name:'합성'},current_session_id:'session',sessions:[{id:'session',strategy,actions:[],evidence_notes:'비공개 합성 교사 메모',guidance:{published_at:'2026-09-14',published_by:'synthetic'}}]} as unknown as CounselingCase)!

test('AI ban and public provenance survive adoption after either or both plans already contain text',()=>{
 assert.ok(forbidden)
 for(const subject_plan of ['', '합성 기존 교과 계획'])for(const inquiry_plan of ['', '합성 기존 탐구 계획']){
  const before={...emptyStrategy(),subject_plan,inquiry_plan}
  const result=adoptSchoolTask(forbidden,before)
  const publicSession=studentProjection(result).sessions[0]!
  assert.ok(publicSession.strategy)
  assert.ok(result.subject_plan.startsWith(subject_plan))
  if(inquiry_plan)assert.equal(result.inquiry_plan,inquiry_plan)
  assert.match(publicSession.strategy.subject_plan,/AI 활용 금지/)
  assert.ok(publicSession.strategy.subject_plan.includes(forbidden.source_label))
  assert.ok(publicSession.strategy.subject_plan.includes(String(forbidden.revision)))
  assert.ok(!publicSession.strategy.subject_plan.includes(forbidden.source_ref.json_pointer))
  assert.match(taskReference(forbidden),/\/subjects\//)
  for(const condition of forbidden.conditions)assert.ok(publicSession.strategy.subject_plan.includes(condition))
  assert.equal(publicSession.evidence_notes,'')
  assert.doesNotMatch(JSON.stringify(publicSession),/비공개 합성 교사 메모/)
  assert.deepEqual(adoptSchoolTask(forbidden,result),result)
  assert.equal(before.subject_plan,subject_plan)
 }
})

test('all 111 assessments keep exact conditions and readable source in public while teacher evidence keeps coordinates',()=>{
 assert.equal(data.assessments.length,111)
 for(const task of data.assessments){
  const result=adoptSchoolTask(task,{...emptyStrategy(),subject_plan:'합성 기존 계획',inquiry_plan:'합성 탐구 계획'})
  for(const condition of task.conditions)assert.ok(result.subject_plan.includes(condition),task.id)
  assert.ok(result.subject_plan.includes(schoolAiLabel(task.ai_status)),task.id)
  for(const value of [...task.steps,...task.outputs,...task.learning_topics,...(task.rubric_excerpts||[]),...(task.issues||[])])assert.ok(result.subject_plan.includes(value),task.id)
  if(task.timing)assert.ok(result.subject_plan.includes(task.timing),task.id)
  assert.ok(result.subject_plan.includes(task.source_label),task.id)
  assert.ok(result.subject_plan.includes(String(task.revision)),task.id)
  assert.ok(!result.subject_plan.includes(task.source_ref.json_pointer),task.id)
  assert.ok(taskReference(task).includes(task.source_ref.source_id),task.id)
  assert.ok(taskReference(task).includes(task.source_ref.json_pointer),task.id)
  assert.doesNotMatch(result.subject_plan,/AI 사용 조건: (prohibited|limited|unresolved|allowed_all_as_stated|permitted_all_stages_as_written)/)
 }
})

test('a full field fails atomically instead of silently losing conditions or overwriting teacher content',()=>{
 const before={...emptyStrategy(),subject_plan:'합'.repeat(12000)}
 assert.throws(()=>adoptSchoolTask(forbidden,before),/12,000자/)
 assert.equal(before.subject_plan.length,12000)
 const occupied={...emptyStrategy(),activity_plan:'합'.repeat(12000)}
 assert.throws(()=>adoptSchoolActivity(activity,occupied,options),/12,000자/)
 assert.equal(occupied.activity_plan.length,12000)
})

test('school program adoption includes original steps and outputs as future work and keeps public provenance',()=>{
 assert.ok(activity)
 const before={...emptyStrategy(),activity_plan:'합성 기존 활동 계획'}
 const result=adoptSchoolActivity(activity,before,options)
 assert.ok(result.activity_plan.startsWith(before.activity_plan))
 for(const step of activity.steps!)assert.ok(result.activity_plan.includes(step))
 for(const output of activity.outputs!)assert.ok(result.activity_plan.includes(output))
 assert.match(result.activity_plan,/적용 범위 미확정/)
 assert.match(result.activity_plan,/참여하거나 완성한 실적으로 기록하지/)
 assert.ok(studentProjection(result).sessions[0]!.strategy!.activity_plan.includes(activity.source_label))
 assert.ok(!result.activity_plan.includes(activity.source_ref.json_pointer))
 assert.deepEqual(adoptSchoolActivity(activity,result,options),result)
 assert.match(schoolActivityAction(activity),/활동 계획의 원문 산출물/)
 assert.match(result.activity_plan,/성장 활동 일지/)
 assert.equal(before.activity_plan,'합성 기존 활동 계획')
})

test('all 57 curated programs can be adopted with their available steps, outputs and source intact',()=>{
 const programs=[...data.clubs,...data.activities]
 assert.equal(programs.length,57)
 for(const program of programs){
  const before=JSON.stringify(program)
  const result=adoptSchoolActivity(program,emptyStrategy(),options)
  for(const value of [...(program.steps||[]),...(program.outputs||[])])assert.ok(result.activity_plan.includes(value),program.id)
  assert.ok(result.activity_plan.includes(program.source_label),program.id)
  assert.ok(result.activity_plan.includes(String(program.revision)),program.id)
  assert.ok(!result.activity_plan.includes(program.source_ref.json_pointer),program.id)
  assert.ok(activityReference(program).includes(program.source_ref.source_id),program.id)
  assert.ok(activityReference(program).includes(program.source_ref.json_pointer),program.id)
  assert.equal(JSON.stringify(program),before)
  assert.ok(schoolActivityAction(program).length<1000,program.id)
 }
})

test('known school stage, year, grade and semester mismatches are exploration, never current matches',()=>{
 const club=data.clubs[0]!
 assert.equal(activityApplicability(club,student,2).status,'matched')
 for(const [input,semester] of [[{...student,school_stage:'middle'},2],[{...student,academic_year:2027},2],[{...student,grade:3},2],[student,1]] as const){
  assert.equal(activityApplicability(club,input as Student,semester).status,'reference')
  const matches=schoolMatches(data,input as Student,[],'',semester)
  assert.equal(matches.activityGroups.matched.length,0)
  assert.equal(matches.activityGroups.reference.length,29)
  assert.equal(matches.activityGroups.unverified.length,28)
 }
 const same=schoolMatches(data,student,[],'',2)
 assert.equal(same.activityGroups.matched.length,29)
 assert.equal(same.activityGroups.unverified.length,28)
})

test('unknown activity scope stays unknown and known mismatches take precedence over unknown fields',()=>{
 assert.equal(activityApplicability(activity,student,2).status,'unverified')
 const partial:SchoolActivity={...activity,school_stage:'middle'}
 const scope=activityApplicability(partial,student,2)
 assert.equal(scope.status,'reference')
 assert.ok(scope.reasons.some(reason=>reason.includes('확인 필요')))
 const emptyScope={...activity,grade_range:[]}
 assert.equal(activityApplicability(emptyScope,student).status,'unverified')
})

test('keyword filtering retains applicability groups and does not fill unknown dates or outputs',()=>{
 const matches=schoolMatches(data,student,[],'개인 성장 목표',2)
 assert.ok(matches.activityGroups.unverified.some(row=>row.id===activity.id))
 assert.equal(matches.activityGroups.matched.length,0)
 const unspecified={...activity,steps:[],outputs:[]}
 const result=adoptSchoolActivity(unspecified,emptyStrategy(),options)
 assert.match(result.activity_plan,/절차: 원문에서 확인 필요/)
 assert.match(result.activity_plan,/산출물: 원문에서 확인 필요/)
 assert.doesNotMatch(result.activity_plan,/2026-\d\d-\d\d.*마감/)
 assert.match(schoolActivityAction(unspecified),/남길 결과\(확인 필요\)/)
})

test('zero time restricts program use to existing classes, including the suggested action',()=>{
 const result=adoptSchoolActivity(data.clubs[0]!,emptyStrategy(),{...options,weekly_minutes:0})
 assert.match(result.activity_plan,/기존 수업·활동 안에서/)
 assert.match(result.activity_plan,/새 프로그램 참여를 요구하지/)
 assert.match(schoolActivityAction(activity,{weekly_minutes:0}),/^기존 수업·활동 안에서:/)
})

test('reference program adoption carries the mismatch to the student plan',()=>{
 const result=adoptSchoolActivity(data.clubs[0]!,emptyStrategy(),{student:{...student,school_stage:'middle'},semester:1,weekly_minutes:null})
 assert.match(result.activity_plan,/다른 대상의 탐색 참고/)
 assert.match(result.activity_plan,/학교급이 다름/)
 assert.match(result.activity_plan,/학기가 다름/)
 assert.match(result.activity_plan,/현재 참여 계획으로 확정하지/)
})

test('school selection offers only whole source topics or activity names found in public career text',()=>{
 const task={...forbidden,title:'환경 자료 탐구',learning_topics:['환경 변화 관찰']}
 const connected=adoptSchoolTask(task,{...emptyStrategy(),target_path:'환경 변화 관찰 방법이 궁금함'})
 assert.match(connected.subject_plan,/연결 후보 “환경 변화 관찰”/)
 assert.match(connected.subject_plan,/선택 이유\(상담 확인 필요\)/)
 assert.match(connected.subject_plan,/관심·진로 항목에도 있는 원문 주제/)
 const unconnected=adoptSchoolTask(task,{...emptyStrategy(),target_major:'미정',target_path:'관심 분야 탐색'})
 assert.match(unconnected.subject_plan,/선택 이유\(확인 필요\)/)
 assert.doesNotMatch(unconnected.subject_plan,/연결 후보|적합합니다|역량이 뛰어/)
 const named=adoptSchoolActivity({...activity,title:'환경 변화 관찰'},{...emptyStrategy(),target_path:'환경 변화 관찰 방법이 궁금함'},options)
 assert.match(named.activity_plan,/연결 후보 “환경 변화 관찰”/)
 const descriptionOnly=adoptSchoolActivity({...activity,description:'환경 변화 관찰'},{...emptyStrategy(),target_path:'환경 변화 관찰 방법이 궁금함',strengths:'관찰 자료를 정리함'},options)
 assert.match(descriptionOnly.activity_plan,/선택 이유\(확인 필요\)/)
 assert.doesNotMatch(descriptionOnly.activity_plan,/연결 후보/)
 assert.equal(descriptionOnly.strengths,'관찰 자료를 정리함')
 assert.doesNotMatch(connected.subject_plan,/환경 변화 관찰 방법이 궁금함/)
 for(const text of [connected.subject_plan,named.activity_plan])for(const prefix of ['선택 이유','할 일','점검 기준']){
  const line=text.split('\n').find(value=>value.startsWith(prefix))!
  assert.ok(line.length<100,line)
  assert.equal((line.match(/\./g)||[]).length,1,line)
 }
})

test('the shared final-result fixture does not promote 대한 or other coincidental prose tokens to a selection reason',()=>{
 const session=finalCase().sessions[0]!
 assert.match(session.strategy!.target_path,/대한/)
 for(const text of [session.strategy!.subject_plan,session.strategy!.activity_plan]){
  const reason=text.split('\n').find(line=>line.startsWith('선택 이유'))!
  assert.match(reason,/선택 이유\(확인 필요\)/)
  assert.doesNotMatch(reason,/대한|공통 표현|연결 후보|관심·진로과/)
 }
 const misleading={...forbidden,title:'자료 설명하기',learning_topics:['대한','설명한 자료의 의미']}
 const result=adoptSchoolTask(misleading,{...emptyStrategy(),target_path:'학교 생활에 대한 자료의 의미를 탐색한다'})
 assert.doesNotMatch(result.subject_plan.split('\n').find(line=>line.startsWith('선택 이유'))!,/연결 후보/)
})

test('student school plans expose proposed action, evidence, output and checks without automatic agreement or deadlines',()=>{
 for(const plan of [adoptSchoolTask(forbidden,emptyStrategy()).subject_plan,adoptSchoolActivity(activity,emptyStrategy(),options).activity_plan]){
  assert.match(plan,/할 일\(제안\):/)
  assert.match(plan,/원문 산출물|산출물: 원문에 별도/)
  assert.match(plan,/점검 기준\(제안\):/)
  assert.match(plan,/근거/)
  assert.match(plan,/피드백/)
  assert.match(plan,/출처:/)
  assert.doesNotMatch(plan,/참여를 완료했습니다|상담에서 합의했습니다|최종 확정되었습니다|\/subjects\/\d|\/entries\/\d/)
 }
 const missing=adoptSchoolTask({...forbidden,steps:[],outputs:[],timing:null},emptyStrategy()).subject_plan
 assert.match(missing,/산출물: 원문에 별도 정리되지 않음/)
 assert.match(missing,/명시된 시기 없음/)
 assert.doesNotMatch(missing,/산출물:.*보고서|산출물:.*비교표/)
 assert.doesNotMatch(missing,/\d+쪽|\d+분 발표|2026-\d\d-\d\d/)
 const uniqueTask={...forbidden,outputs:['합성 산출물 고유 표식']}
 const uniqueActivity={...activity,outputs:['합성 활동 결과 고유 표식']}
 assert.equal(adoptSchoolTask(uniqueTask,emptyStrategy()).subject_plan.split(uniqueTask.outputs[0]!).length-1,1)
 assert.equal(adoptSchoolActivity(uniqueActivity,emptyStrategy(),options).activity_plan.split(uniqueActivity.outputs[0]!).length-1,1)
 assert.ok(!schoolActivityAction(uniqueActivity).includes(uniqueActivity.outputs[0]!))
})
