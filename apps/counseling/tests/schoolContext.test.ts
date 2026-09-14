import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {adoptSchoolTask,adoptSchoolActivity,schoolActivityAction,activityApplicability,schoolMatches,type SchoolContext,type SchoolActivity} from '../src/lib/schoolContext'
import {emptyStrategy,studentView} from '../src/lib/model'
import type {Student,CounselingCase} from '../src/lib/types'

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
  assert.ok(publicSession.strategy.subject_plan.includes(forbidden.source_ref.source_id))
  for(const condition of forbidden.conditions)assert.ok(publicSession.strategy.subject_plan.includes(condition))
  assert.equal(publicSession.evidence_notes,'')
  assert.doesNotMatch(JSON.stringify(publicSession),/비공개 합성 교사 메모/)
  assert.deepEqual(adoptSchoolTask(forbidden,result),result)
  assert.equal(before.subject_plan,subject_plan)
 }
})

test('every curated assessment retains its original conditions, AI text and source in a public plan',()=>{
 assert.equal(data.assessments.length,111)
 for(const task of data.assessments){
  const result=adoptSchoolTask(task,{...emptyStrategy(),subject_plan:'합성 기존 계획',inquiry_plan:'합성 탐구 계획'})
  for(const condition of task.conditions)assert.ok(result.subject_plan.includes(condition),task.id)
  if(task.ai_status)assert.ok(result.subject_plan.includes(task.ai_status),task.id)
  assert.ok(result.subject_plan.includes(task.source_ref.source_id),task.id)
  assert.ok(result.subject_plan.includes(task.source_ref.json_pointer),task.id)
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
 assert.ok(studentProjection(result).sessions[0]!.strategy!.activity_plan.includes(activity.source_ref.source_id))
 assert.deepEqual(adoptSchoolActivity(activity,result,options),result)
 assert.match(schoolActivityAction(activity),/성장 활동 일지/)
 assert.equal(before.activity_plan,'합성 기존 활동 계획')
})

test('all 57 curated programs can be adopted with their available steps, outputs and source intact',()=>{
 const programs=[...data.clubs,...data.activities]
 assert.equal(programs.length,57)
 for(const program of programs){
  const before=JSON.stringify(program)
  const result=adoptSchoolActivity(program,emptyStrategy(),options)
  for(const value of [...(program.steps||[]),...(program.outputs||[])])assert.ok(result.activity_plan.includes(value),program.id)
  assert.ok(result.activity_plan.includes(program.source_ref.source_id),program.id)
  assert.ok(result.activity_plan.includes(program.source_ref.json_pointer),program.id)
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
