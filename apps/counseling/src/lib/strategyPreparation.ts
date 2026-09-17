import {gradeTrends,hasGradeData,profileIssues,type GradeTrend} from './profile'
import {schoolMatches,type SchoolContext} from './schoolContext'
import type {Student,StudentProfile,Strategy} from './types'

/** Teacher preparation only. Card order is not a diagnosis or a priority score. */
export type StrategyPreparationCard = {
 id:string
 title:string
 evidence:string[]
 source:string[]
 proposal:string
 verification:string[]
 counselingQuestions:string[]
 strategyPatch?:Partial<Strategy>
 actions?:string[]
 schoolTaskIds?:string[]
}

const excerpt=(value:string)=>value.trim().length>240?value.trim().slice(0,240)+'… (입력 발췌)':value.trim()
const observation=(label:string,value:string)=>value.trim()?[`${label} · 교사 입력: ${excerpt(value)}`]:[]

function executionScope(profile:StudentProfile):string {
 const scheduling='구체적인 시간 계획은 학생 본인이 세웁니다.'
 return profile.weekly_minutes===0?`기존 수업·활동 안에서만 진행합니다. ${scheduling}`:scheduling
}

function gradeEvidence(profile:StudentProfile):string[] {
 const trends:GradeTrend[]=gradeTrends(profile)
 const compared=trends.map(trend=>`성적 관찰 · ${trend.subject} / ${trend.scale}: ${trend.description}`)
 const other=profile.grades.filter(row=>hasGradeData(row)&&(!['5','9'].includes(row.grade_scale)||row.rank_grade===null))
 return [...compared,...other.map(row=>`입력 성적 · ${row.academic_year}학년도 ${row.semester}학기 ${row.subject}: 원점수 ${row.score??'미확인'}, 성취도 ${row.achievement.trim()||'미확인'} (등급 추이로 환산하지 않음)`)]
}

/**
 * Return three to five optional directions: observed inputs, proposed work,
 * evidence to verify, then supporting consultation questions. No remote calls,
 * inferred achievements, automatic task assignment, or input mutation occurs.
 * Profile is the existing normalized UI contract. Invalid live numeric/length
 * input disables adoption until the existing profile validation is resolved.
 */
export function prepareStrategies(
 profile:StudentProfile,
 student:Student,
 school?:SchoolContext,
 semester:1|2|null=null,
):StrategyPreparationCard[] {
 const cards:StrategyPreparationCard[]=[]
 const scope=executionScope(profile)
 const propose=(text:string)=>profile.weekly_minutes===0?`${text}\n${scope}`:text
 const action=(text:string)=>profile.weekly_minutes===0?`기존 수업·활동 안에서: ${text}`:text
 const selected=school?schoolMatches(school,student,profile.selected_subjects,'',semester).selected:[]
 const grades=gradeEvidence(profile)

 if(profile.learning_concerns.trim()||profile.study_habits.trim()){
  const concerns=profile.learning_concerns.trim()
  const evidenceFocus=concerns?`“${excerpt(concerns)}”`: `공부 방법 “${excerpt(profile.study_habits)}”`
  const plan=concerns?`실행 초안: ${evidenceFocus}와 관련된 현재 단원의 답안·설명 사례를 고릅니다. 실제 자료에서 확인된 경우에만 개념·풀이 과정·근거 표현으로 오류 사례를 분류합니다. 같은 내용을 다시 설명하고 전후 답안과 교사 피드백을 비교합니다.\n남길 결과(제안): 기존 답안에서 다시 설명한 부분과 근거를 표시한 수정본.\n점검 기준(제안): 바꾼 설명이 근거와 연결되는지, 받은 피드백을 반영했는지 확인합니다.`:`실행 초안: ${evidenceFocus}를 활용한 최근 학습 자료를 고릅니다. 도움이 된 방법과 적용하기 어려웠던 상황을 확인하고, 효과가 확인된 방법을 다음 수업에도 이어갑니다.\n남길 결과(제안): 사용한 공부 방법과 도움이 된 점을 표시한 기존 학습 자료.\n점검 기준(제안): 자료의 내용을 스스로 설명할 수 있는지, 같은 방법을 이어갈 수 있는지 확인합니다.`
  cards.push({
   id:'learning-support',title:concerns?'학습 고민을 답안·피드백으로 점검':'효과 있는 공부 방법 이어가기',
   evidence:[...observation('학습 고민',profile.learning_concerns),...observation('공부 방법',profile.study_habits)],
   source:['교사 입력 · 학습 고민 / 학습 습관'],
   proposal:concerns?'관련 답안 고르기 → 확인된 어려움 살피기 → 다시 설명하기 → 피드백 비교':'최근 학습 자료 고르기 → 도움 된 방법 확인 → 다음 수업에서 이어가기',
   verification:concerns?['현재 단원의 답안·설명과 평가 기준 확인','입력만으로 약점·원인을 확정하지 않음. 오류 분류는 실제 자료 확인 후 결정']:['입력한 공부 방법을 사용한 자료와 학생 설명 확인','습관 입력만으로 학습 어려움이나 성취를 단정하지 않음'],
   counselingQuestions:[concerns?'고른 답안이 실제로 어려웠던 상황을 보여 주나요?':'이 방법이 도움이 된 수업과 자료는 무엇인가요?'],
   strategyPatch:{subject_plan:propose(plan)},
   actions:[action(concerns?'고민과 관련된 답안·설명 사례를 골라 확인한 부분을 다시 설명하고 피드백 비교하기':'공부 방법을 사용한 최근 학습 자료를 골라 도움이 된 점과 다음에 이어갈 방법 정하기')],
  })
 }

 const courseEvidence=profile.selected_subjects.length?[`실제 이수 과목 · 교사 입력: ${profile.selected_subjects.join(', ')}`]:['실제 이수 과목이 아직 입력되지 않았습니다.']
 const schoolEvidence=!school?['학교 계획 자료가 연결되지 않았습니다.']:
  student.school_stage==='middle'?['고등학교 계획 자료는 진학 후 학습을 살펴보는 탐색 참고입니다. 현재 중학교 과제로 연결하지 않습니다.']:
  [`입력 학년도·학년·이수 과목${semester===null?'':`·${semester}학기`}에 맞는 학교 계획 후보 ${selected.length}개입니다. 실제 배정·현행 시행은 미확인입니다.`]
 const coursePlan=profile.selected_subjects.length?{
  subject_plan:propose(`실행 초안: ${profile.selected_subjects.join(', ')}의 현재 단원과 배정 과제를 확인합니다. 배운 개념을 수업 사례와 연결해 설명하고, 수업 자료에서 그 근거를 표시합니다.\n남길 결과(제안): 개념·사례·근거를 함께 남긴 설명. 실제 과제에 맞는 형식은 확인 필요합니다.\n점검 기준(제안): 개념과 사례의 연결을 자신의 말로 설명하는지, 근거와 교사 피드백이 설명에 반영됐는지 확인합니다.\n학교 계획은 실제 수강·현행 과제와 조건을 확인한 뒤 참고합니다. 특정 학교 자료를 고르기 전에는 과제명·산출물·일정을 확정하지 않습니다.`),
 }:undefined
 cards.push({
  id:'school-alignment',title:'이수 과목에서 준비할 내용 고르기',
  evidence:[...courseEvidence,...schoolEvidence,...grades],
  source:['교사 입력 · 실제 이수 과목',...(grades.length?['교사 입력 · 성적 기록 (같은 과목·등급 체계 관찰)']:[]),...(school?[`학교 자료 · ${school.reviewed_on} 검토 판본`]:[])],
  proposal:profile.selected_subjects.length?`${profile.selected_subjects.join(', ')}: 현재 단원 확인 → 참고할 학교 자료 선택 → 개념·결과·점검 기준 정하기`:'이수 과목 입력 → 현재 단원·배정 과제 확인',
  verification:[
   '학교급·학년도·학년·학기, 실제 수강·현재 배정 확인',
   '원문 시기·단계·산출물·AI 및 자료 조건·채점표 발췌·출처·원문 충돌 확인. 미확정 계획은 참여 의무가 아님',
   ...(grades.length?['성적의 과목·등급 체계·학기와 평가 조건을 원자료로 확인합니다. 다른 등급제 환산이나 합격 가능성을 산출하지 않습니다.']:[]),
  ],
  counselingQuestions:['선택한 내용이 현재 배우는 단원과 과제에 맞나요?'],
  strategyPatch:coursePlan,
  actions:profile.selected_subjects.length?[action(`제안 · ${profile.selected_subjects.join(', ')}의 배정 범위를 확인한 뒤, 배운 개념과 수업 사례를 연결해 설명하고 근거를 수업 자료에 표시하기`)]:[],
  schoolTaskIds:selected.map(task=>task.id),
 })

 const inquiryEvidence=[...observation('관심 주제',profile.interests),...observation('관심 전공·계열',profile.target_major),...observation('읽기 경험',profile.reading)]
 const inquiryPlan=inquiryEvidence.length?{
  inquiry_plan:propose(`실행 초안: ${profile.interests.trim()?`관심 주제 “${excerpt(profile.interests)}”`:profile.target_major.trim()?`관심 전공·계열 “${excerpt(profile.target_major)}”`:`읽기 경험 “${excerpt(profile.reading)}”`}와 연결되는 부분을 현재 수업 자료에서 고르고, 직접 설명하고 싶은 질문으로 좁힙니다. 질문 → 방법 → 산출물 → 피드백을 연결하는 초안입니다.\n방법 예시: 자료 비교 또는 관찰. 산출물 예시: 비교표 또는 설명문. 실제 질문·수업에 맞춰 선택합니다.\n할 일(제안): 고른 자료에서 질문에 답하는 근거와 아직 설명하기 어려운 부분을 구분해 표시합니다.\n점검 기준(제안): 자료의 근거로 질문에 답할 수 있는지, 교사 피드백 뒤 설명이 달라졌는지 확인합니다.\n구체 질문·자료와 제출 조건은 확인 필요합니다.`),
 }:undefined
 cards.push({
  id:'inquiry-design',title:'관심을 탐구 질문으로 바꾸기',
  evidence:inquiryEvidence.length?inquiryEvidence:['관심 주제·전공·읽기 경험이 아직 입력되지 않았습니다. 탐구 주제나 적합 전공을 추정하지 않습니다.'],
  source:['교사 입력 · 관심 주제 / 관심 전공·계열 / 읽기 경험'],
  proposal:inquiryEvidence.length?'수업과 연결할 질문 → 자료·방법 → 남길 결과 → 피드백 기준':'관심 주제나 읽기 경험을 입력하면 탐구 초안을 준비합니다.',
  verification:['입력한 관심과 읽기 경험의 실제 내용, 현재 수업과 연결되는 개념을 확인합니다.','자료의 출처·이용 조건과 질문을 확인할 수 있는 방법인지 검토합니다. 미기재된 보고서 분량·발표 시간·제출일은 만들지 않습니다.'],
  counselingQuestions:['이 주제에서 직접 확인하거나 설명하고 싶은 점은 무엇인가요?'],
  strategyPatch:inquiryPlan,
  actions:inquiryEvidence.length?[action(`제안 · ${profile.interests.trim()?`관심 “${excerpt(profile.interests)}”`:profile.target_major.trim()?`관심 전공·계열 “${excerpt(profile.target_major)}”`:'입력한 읽기 경험'}와 연결되는 수업 자료에서 질문에 답하는 근거와 확인할 부분을 구분해 표시하기 (질문·범위 확인 후)`)]:[],
 })

 if(profile.activities.trim()||profile.teacher_observations.trim()){
  cards.push({
   id:'activity-evidence',title:'활동 근거를 확인하고 다음 단계 정하기',
   evidence:[...observation('활동 경험',profile.activities),...observation('교사 관찰',profile.teacher_observations)],
   source:['교사 입력 · 활동 경험 / 교사 관찰'],
   proposal:'역할·작업 자료·피드백 확인 → 다음에 보완하거나 공유할 내용 선택',
   verification:['활동명이나 교사 관찰만으로 수행 사실을 확정하지 않고 역할·작업 자료·피드백을 대조합니다.','이미 수행한 내용과 교사의 향후 제안을 구분하며, 학교 활동의 대상 학년·운영·참여 가능 여부를 확인합니다.'],
   counselingQuestions:['직접 맡은 역할과 만든 자료는 무엇이며, 다음에 더 해 보고 싶은 부분은 무엇인가요?'],
   strategyPatch:{activity_plan:propose('실행 초안: 기존 작업 자료에서 자신이 맡은 부분과 받은 피드백을 찾아 표시합니다. 그중 설명하거나 보완할 부분을 고르고, 고친 내용과 이유를 남깁니다.\n남길 결과(제안): 역할·근거·수정 이유를 표시한 기존 작업 자료. 이미 한 내용과 앞으로 할 내용은 구분합니다.\n점검 기준(제안): 자신의 역할을 자료로 설명할 수 있는지, 받은 피드백과 수정 이유가 연결되는지 확인합니다. 참여·성과는 근거 확인 후 기록합니다.')},
   actions:[action('제안 · 기존 활동 자료에서 맡은 부분과 받은 피드백을 표시하고, 확인 후 고친 부분과 이유 남기기')],
  })
 }

 cards.push({
  id:'implementation-review',title:'먼저 할 일과 점검 방법 정하기',
  evidence:['교사가 선택한 전략의 실행 행동·산출물·확인 기준을 검토합니다.'],
  source:['계획 검토 기준'],
  proposal:`먼저 할 일 → 확인할 결과 → 교사 피드백. ${scope}`,
  verification:['선택한 과제가 기존 수업·활동과 연결되고 확인할 결과가 구체적인지 검토합니다.','교사의 초기 제안, 상담에서 확인한 내용, 반영한 변경과 최종 검토 결과를 구분해 남깁니다.'],
  counselingQuestions:['제안된 방향과 확인할 결과 중 먼저 시도할 것은 무엇인가요?'],
  strategyPatch:{semester_plan:`실행 초안: 선택한 계획에서 먼저 할 일과 확인할 결과를 정합니다. 교사 피드백으로 다음 방향을 점검합니다.\n${scope}`},
  actions:[action('선택한 계획의 첫 실행과제·확인할 결과·피드백 기준 정하기')],
 })

 // Do not offer adoptable proposals while live edits violate the shared profile contract.
 const issues=profileIssues(profile)
 if(issues.length)return cards.map(({strategyPatch:_patch,actions:_actions,...card})=>({
  ...card,verification:['입력 범위를 수정한 다음 계획을 선택하세요.',...issues,...card.verification],
 }))
 return cards
}
