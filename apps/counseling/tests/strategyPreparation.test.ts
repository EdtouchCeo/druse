import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareStrategies} from '../src/lib/strategyPreparation'
import {emptyProfile} from '../src/lib/profile'
import type {GradeRecord,Student,StudentProfile} from '../src/lib/types'
import type {SchoolAssessment,SchoolContext} from '../src/lib/schoolContext'

const student:Student={student_id:'synthetic',student_number:'00000',academic_year:2026,school_stage:'high',grade:1}
const profile=(values:Partial<StudentProfile>={}):StudentProfile=>({...emptyProfile(),...values})
const grade=(values:Partial<GradeRecord>={}):GradeRecord=>({id:crypto.randomUUID(),subject:'수학',academic_year:2026,semester:1,grade_scale:'5',rank_grade:3,score:null,achievement:'',...values})
const task:SchoolAssessment={id:'current',subject:'공통국어1',school_stage:'high',grade:1,academic_year:2026,semester:1,title:'합성 과제',learning_topics:['합성 개념'],steps:[],outputs:[],conditions:['합성 AI 금지 조건'],timing:'원문 기간',source_label:'합성 학교 계획',source_ref:{source_id:'synthetic-source',json_pointer:'/tasks/0'},revision:1,verified_current:false}
const school:SchoolContext={schema_version:'1.0',reviewed_on:'2026-09-11',sources:[],applicability_rules:{},assessments:[task,{...task,id:'old',academic_year:2025},{...task,id:'grade2',grade:2},{...task,id:'semester2',semester:2},{...task,id:'other-subject',subject:'공통국어2'}],clubs:[],activities:[]}

test('empty inputs produce three teacher preparation choices without invented deficits or achievements',()=>{
 const cards=prepareStrategies(profile(),student,school)
 assert.equal(cards.length,3)
 assert.ok(cards.every(card=>card.proposal.startsWith('교사가 선택할 방향:')))
 assert.ok(cards.every(card=>card.counselingQuestions.length>0&&card.verification.length>0))
 assert.ok(cards.some(card=>card.evidence.some(text=>text.includes('아직 입력되지 않았습니다'))))
 for(const card of cards)for(const key of Object.keys(card.strategyPatch||{}))assert.ok(!['strengths','gaps','student_message'].includes(key))
 assert.equal(cards.find(card=>card.id==='school-alignment')!.strategyPatch,undefined)
 assert.equal(cards.find(card=>card.id==='inquiry-design')!.strategyPatch,undefined)
})

test('reported learning concerns support an error-example and feedback task, without diagnosing their cause',()=>{
 const cards=prepareStrategies(profile({learning_concerns:'서술형 답안에서 근거를 빠뜨린다고 학생이 말함',study_habits:'답을 보고 풀이를 다시 적음'}),student)
 const card=cards.find(item=>item.id==='learning-support')!
 assert.ok(card.evidence.some(text=>text.includes('서술형 답안에서 근거를 빠뜨린다고 학생이 말함')))
 assert.match(card.strategyPatch!.subject_plan!,/오류 사례를 분류/)
 assert.match(card.strategyPatch!.subject_plan!,/교사 피드백/)
 assert.match(card.proposal,/원인을 확정하지/)
 assert.equal(cards.length,4)
})

test('zero additional time constrains every proposal, adoptable plan and action to existing classes',()=>{
 const cards=prepareStrategies(profile({learning_concerns:'문제를 다시 설명하기 어려움',activities:'합성 모둠 기록',interests:'합성 관심 주제',selected_subjects:['공통국어1'],weekly_minutes:0}),student,school)
 assert.equal(cards.length,5)
 for(const card of cards){
  assert.match(card.proposal,/추가 과제·시간을 요구하지 않고 기존 수업·활동 안에서/)
  for(const text of Object.values(card.strategyPatch||{}))assert.match(text,/추가 과제·시간을 요구하지 않고 기존 수업·활동 안에서/)
  for(const text of card.actions||[])assert.match(text,/^기존 수업·활동 안에서:/)
 }
})

test('unknown available time is not treated as zero or a made-up allocation',()=>{
 const cards=prepareStrategies(profile({interests:'합성 관심',weekly_minutes:null}),student)
 assert.ok(cards.every(card=>card.proposal.includes('주간 가용 시간은 미확인')))
 assert.ok(cards.every(card=>(card.actions||[]).every(text=>text.startsWith('가용 시간 확인 후'))))
 assert.ok(cards.every(card=>!card.proposal.includes('0분')))
})

test('same-scale grade observations do not choose a support priority or change proposals',()=>{
 const base=profile({grades:[grade(),grade({semester:2,rank_grade:2}),grade({grade_scale:'9',rank_grade:7})]})
 const observed=prepareStrategies(base,student)
 const without=prepareStrategies(profile(),student)
 assert.deepEqual(observed.map(card=>[card.id,card.proposal,card.strategyPatch,card.actions]),without.map(card=>[card.id,card.proposal,card.strategyPatch,card.actions]))
 const evidence=observed.find(card=>card.id==='school-alignment')!.evidence.join('\n')
 assert.match(evidence,/5등급제.*3 → 2026년 2학기 2등급/)
 assert.match(evidence,/9등급제.*다른 학기 기록이 추가/)
 assert.doesNotMatch(evidence,/7 →.*2등급/)
 const duplicate=prepareStrategies(profile({grades:[grade(),grade({rank_grade:1})]}),student)
 assert.match(duplicate.find(card=>card.id==='school-alignment')!.evidence.join('\n'),/중복되어 추이를 연결하지/)
})

test('score zero remains an observation, while unfinished grade rows do not become poor performance',()=>{
 const cards=prepareStrategies(profile({grades:[grade({grade_scale:'unknown',rank_grade:null,score:0}),grade({subject:'',rank_grade:null})]}),student)
 const evidence=cards.find(card=>card.id==='school-alignment')!.evidence.join('\n')
 assert.match(evidence,/원점수 0/)
 assert.equal(cards.some(card=>card.id==='learning-support'),false)
 assert.equal(cards.length,3)
})

test('school matching reuses exact year, grade, subject and optional semester without assigning tasks',()=>{
 const input=profile({selected_subjects:['공통국어 1']})
 const card=prepareStrategies(input,student,school,1).find(card=>card.id==='school-alignment')!
 assert.deepEqual(card.schoolTaskIds,['current'])
 assert.match(card.evidence.join('\n'),/후보 1개.*미확인/)
 assert.match(card.strategyPatch!.subject_plan!,/배정 과제로 자동 확정하지/)
 assert.match(card.verification.join('\n'),/AI 및 자료 조건·채점표 발췌·출처·원문 충돌/)
 assert.deepEqual(prepareStrategies(input,{...student,academic_year:2027},school).find(card=>card.id==='school-alignment')!.schoolTaskIds,[])
 assert.deepEqual(prepareStrategies(profile(),student,school).find(card=>card.id==='school-alignment')!.schoolTaskIds,[])
})

test('middle-school students get high-school exploration only, with no matched or newly assigned task',()=>{
 const card=prepareStrategies(profile({selected_subjects:['공통국어1']}),{...student,school_stage:'middle',grade:3},school).find(card=>card.id==='school-alignment')!
 assert.deepEqual(card.schoolTaskIds,[])
 assert.match(card.evidence.join('\n'),/탐색 참고.*현재 중학교 과제로 연결하지/)
 assert.ok(!card.strategyPatch!.subject_plan!.includes(task.title))
})

test('activity claims and private teacher observations stay in evidence; future proposals do not assert completion',()=>{
 const cards=prepareStrategies(profile({activities:'학생이 합성 모형을 만들었다고 설명함',teacher_observations:'교사 전용 관찰 메모 합성표식'}),student)
 const card=cards.find(item=>item.id==='activity-evidence')!
 assert.match(card.evidence.join('\n'),/학생이 합성 모형을 만들었다고 설명함/)
 assert.match(card.proposal,/입력만으로 확정하지/)
 assert.match(card.strategyPatch!.activity_plan!,/^교사 제안:/)
 assert.doesNotMatch(JSON.stringify(cards.map(item=>item.strategyPatch)),/교사 전용 관찰 메모 합성표식/)
 assert.match(card.verification.join('\n'),/역할·작업 자료·피드백/)
})

test('interest produces a preparation design without inventing school submissions or final student advice',()=>{
 const card=prepareStrategies(profile({interests:'학교 주변 물의 변화',target_major:'탐색 중'}),student).find(item=>item.id==='inquiry-design')!
 assert.match(card.strategyPatch!.inquiry_plan!,/학교 주변 물의 변화/)
 assert.match(card.strategyPatch!.inquiry_plan!,/질문 → 자료 비교·관찰 등 가능한 방법 선택 → 설명할 산출물 선택 → 교사 피드백/)
 assert.match(card.verification.join('\n'),/분량·발표 시간·제출일은 만들지/)
 assert.equal(card.strategyPatch!.student_message,undefined)
})

test('cards are deterministic and leave profile, source data and student unchanged',()=>{
 const input=profile({interests:'합성 관심',selected_subjects:['공통국어1']})
 const snapshot=JSON.stringify({input,school,student})
 assert.deepEqual(prepareStrategies(input,student,school),prepareStrategies(input,student,school))
 assert.equal(JSON.stringify({input,school,student}),snapshot)
 const cards=prepareStrategies(input,student,school);cards.find(card=>card.id==='school-alignment')!.schoolTaskIds!.push('not-a-source')
 assert.equal(school.assessments.length,5)
})

test('invalid live time edits cannot be adopted as plans or actions',()=>{
 for(const weekly_minutes of [-1,2401,1.5]){
  const cards=prepareStrategies(profile({interests:'합성 주제',weekly_minutes}),student)
  assert.ok(cards.every(card=>!card.strategyPatch&&!card.actions))
  assert.ok(cards.every(card=>card.verification[0]!.includes('입력 범위를 수정')))
 }
})
