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

function timeScope(profile:StudentProfile):string {
 if(profile.weekly_minutes===0)return '추가 과제·시간을 요구하지 않고 기존 수업·활동 안에서 수행합니다.'
 if(profile.weekly_minutes===null)return '주간 가용 시간은 미확인입니다. 추가 시간 배정은 학교 일정과 휴식, 실제 여유 시간을 확인한 뒤 정합니다.'
 return `입력한 주간 가용 시간은 ${profile.weekly_minutes}분입니다. 전체 시간을 자동 배정하지 않고 학교 일정과 휴식, 과제 부담을 확인한 뒤 실행 범위를 정합니다.`
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
 const scope=timeScope(profile)
 const propose=(text:string)=>`${text}\n${scope}`
 const action=(text:string)=>`${profile.weekly_minutes===0?'기존 수업·활동 안에서':profile.weekly_minutes===null?'가용 시간 확인 후 범위를 정해':'입력한 가용 시간과 수업 일정을 확인해'}: ${text}`
 const selected=school?schoolMatches(school,student,profile.selected_subjects,'',semester).selected:[]
 const grades=gradeEvidence(profile)

 if(profile.learning_concerns.trim()||profile.study_habits.trim()){
  const plan='교사 제안: 현재 수업에서 어려움이 드러난 문제나 설명 사례를 골라 개념 이해·풀이 과정·근거 표현으로 오류 사례를 분류합니다. 기존 공부 방법에서 유지할 부분과 바꿀 부분을 정하고, 같은 개념을 다시 설명한 결과와 교사 피드백을 대조합니다.'
  cards.push({
   id:'learning-support',title:'학습 사례에 맞춰 수업 안의 공부 방법 조정',
   evidence:[...observation('학습 고민',profile.learning_concerns),...observation('공부 방법',profile.study_habits)],
   source:['교사 입력 · 학습 고민 / 학습 습관'],
   proposal:propose('교사가 선택할 방향: 입력된 고민과 공부 방법에 대응하는 학습 과제의 틀을 먼저 정합니다. 오류 사례 분류 → 공부 방법 조정 → 다시 설명하기 → 피드백 대조를 제안하며, 입력만으로 학업의 약점이나 원인을 확정하지 않습니다.'),
   verification:['현재 단원의 실제 답안·설명 사례와 평가 기준을 확인합니다.','오류 분류는 교사가 원자료를 본 뒤 결정하며, 조정 전후 설명과 피드백을 남깁니다.'],
   counselingQuestions:['제안한 방법이 실제로 어려웠던 상황과 맞는지, 이미 효과가 있었던 방법은 무엇인지 학생에게 확인합니다.'],
   strategyPatch:{subject_plan:propose(plan)},
   actions:[action('현재 단원의 오류 사례를 분류하고 다시 설명한 결과를 교사 피드백과 대조하기')],
  })
 }

 const courseEvidence=profile.selected_subjects.length?[`실제 이수 과목 · 교사 입력: ${profile.selected_subjects.join(', ')}`]:['실제 이수 과목이 아직 입력되지 않았습니다.']
 const schoolEvidence=!school?['학교 계획 자료가 연결되지 않았습니다.']:
  student.school_stage==='middle'?['고등학교 계획 자료는 진학 후 학습을 살펴보는 탐색 참고입니다. 현재 중학교 과제로 연결하지 않습니다.']:
  [`입력 학년도·학년·이수 과목${semester===null?'':`·${semester}학기`}에 맞는 학교 계획 후보 ${selected.length}개입니다. 실제 배정·현행 시행은 미확인입니다.`]
 const coursePlan=profile.selected_subjects.length?{
  subject_plan:propose(`교사 제안: 입력한 이수 과목(${profile.selected_subjects.join(', ')})에서 현재 배우는 개념과 기존 과제 범위를 확인합니다. 교사가 점검할 개념·활용할 자료·남길 결과·피드백 기준을 정한 뒤 학생과 적용 범위를 확인합니다. 학교 계획 후보를 현재 배정 과제로 자동 확정하지 않습니다.`),
 }:undefined
 cards.push({
  id:'school-alignment',title:'실제 교과와 학교 계획을 대조해 준비 범위 선택',
  evidence:[...courseEvidence,...schoolEvidence,...grades],
  source:['교사 입력 · 실제 이수 과목',...(grades.length?['교사 입력 · 성적 기록 (같은 과목·등급 체계 관찰)']:[]),...(school?[`학교 자료 · ${school.reviewed_on} 검토 판본`]:[])],
  proposal:propose('교사가 선택할 방향: 학생이 실제로 배우는 교과에서 준비할 개념과 과제 범위를 정합니다. 학교 자료 카드를 대조한 뒤 활용할 자료를 직접 선택합니다. 성적 관찰은 평가 맥락 확인에 사용하며 지원의 우선순위·과목 적합성으로 단정하지 않습니다.'),
  verification:[
   '학교급·학년도·학년·학기와 실제 수강, 현재 과제 배정 여부를 함께 확인합니다.',
   '선택할 과제 카드의 원문 시기·단계·산출물·AI 및 자료 조건·채점표 발췌·출처·원문 충돌을 확인합니다. 미확정 계획을 마감이나 참여 의무로 바꾸지 않습니다.',
   ...(grades.length?['성적의 과목·등급 체계·학기와 평가 조건을 원자료로 확인합니다. 다른 등급제 환산이나 합격 가능성을 산출하지 않습니다.']:[]),
  ],
  counselingQuestions:['교사가 선택한 교과 준비 범위가 현재 수업과 과제 상황에 맞는지 학생에게 확인합니다.'],
  strategyPatch:coursePlan,
  actions:profile.selected_subjects.length?[action('실제 이수 교과의 현재 개념·과제 범위와 원문 조건을 확인하고 점검할 학습 자료 정하기')]:[],
  schoolTaskIds:selected.map(task=>task.id),
 })

 const inquiryEvidence=[...observation('관심 주제',profile.interests),...observation('관심 전공·계열',profile.target_major),...observation('읽기 경험',profile.reading)]
 const inquiryPlan=inquiryEvidence.length?{
  inquiry_plan:propose(`교사 제안: ${profile.interests.trim()?`입력한 관심 주제 “${excerpt(profile.interests)}”를 참고하여 `:'입력한 진로 관심 또는 읽기 경험을 참고하여 '}현재 수업에서 다룰 질문을 정합니다. 질문 → 자료 비교·관찰 등 가능한 방법 선택 → 설명할 산출물 선택 → 교사 피드백 순서로 설계합니다. 자료와 방법의 적합성을 확인한 뒤 학생과 질문·범위를 조정하며, 학교의 새 필수 과제로 간주하지 않습니다.`),
 }:undefined
 cards.push({
  id:'inquiry-design',title:'관심을 질문·방법·산출물·피드백 계획으로 구체화',
  evidence:inquiryEvidence.length?inquiryEvidence:['관심 주제·전공·읽기 경험이 아직 입력되지 않았습니다. 탐구 주제나 적합 전공을 추정하지 않습니다.'],
  source:['교사 입력 · 관심 주제 / 관심 전공·계열 / 읽기 경험'],
  proposal:propose('교사가 선택할 방향: 확인한 관심과 수업 내용을 연결해 탐구 준비의 틀을 정합니다. 먼저 설명하고 싶은 질문, 확인할 자료와 방법, 남길 산출물, 피드백 기준을 선택하고 이후 학생의 경험과 설명을 반영해 조정합니다.'),
  verification:['입력한 관심과 읽기 경험의 실제 내용, 현재 수업과 연결되는 개념을 확인합니다.','자료의 출처·이용 조건과 질문을 확인할 수 있는 방법인지 검토합니다. 미기재된 보고서 분량·발표 시간·제출일은 만들지 않습니다.'],
  counselingQuestions:['교사가 마련한 탐구 방향에서 학생이 직접 설명하거나 확인하고 싶은 부분은 무엇인지 묻습니다.'],
  strategyPatch:inquiryPlan,
  actions:inquiryEvidence.length?[action('관심과 수업을 연결한 질문·방법·산출물·피드백 기준의 초안을 교사와 정하기')]:[],
 })

 if(profile.activities.trim()||profile.teacher_observations.trim()){
  cards.push({
   id:'activity-evidence',title:'활동의 역할·산출물·피드백 근거와 후속 계획 정리',
   evidence:[...observation('활동 경험',profile.activities),...observation('교사 관찰',profile.teacher_observations)],
   source:['교사 입력 · 활동 경험 / 교사 관찰'],
   proposal:propose('교사가 선택할 방향: 입력된 경험과 앞으로 제안할 활동을 나눕니다. 학생의 역할·직접 만든 산출물·받은 피드백을 확인할 자료를 먼저 정하고, 확인한 경험에서 이어 할 보완·설명·공유 계획을 선택합니다. 참여나 성과를 입력만으로 확정하지 않습니다.'),
   verification:['활동명이나 교사 관찰만으로 수행 사실을 확정하지 않고 역할·작업 자료·피드백을 대조합니다.','이미 수행한 내용과 교사의 향후 제안을 구분하며, 학교 활동의 대상 학년·운영·참여 가능 여부를 확인합니다.'],
   counselingQuestions:['교사가 정리한 역할과 산출물이 학생이 직접 수행한 범위와 맞는지, 제안한 후속 계획이 가능한지 확인합니다.'],
   strategyPatch:{activity_plan:propose('교사 제안: 기존 활동에서 역할·산출물·피드백을 확인할 자료를 정리합니다. 확인된 경험과 향후 계획을 나누어 기록하고, 기존 결과를 보완하거나 설명·공유할 후속 범위를 학생과 조정합니다.')},
   actions:[action('기존 활동의 역할·산출물·피드백 근거를 확인하고 앞으로 제안할 내용을 구분하기')],
  })
 }

 cards.push({
  id:'implementation-review',title:'실행 범위와 점검 기준을 교사가 선택',
  evidence:[profile.weekly_minutes===null?'주간 가용 시간이 아직 입력되지 않았습니다.':`주간 가용 시간 · 교사 입력: ${profile.weekly_minutes}분`],
  source:['교사 입력 · 주간 가용 시간'],
  proposal:propose('교사가 선택할 방향: 위 방향 중 이번 회차에 먼저 다룰 계획을 선택하고 실행과제와 확인할 결과를 정합니다. 학생과의 상담에서는 제안의 적합성과 실행 가능성을 확인하고, 그 내용을 반영한 뒤 최종 결과물을 검토합니다.'),
  verification:['학생의 학교 일정·기존 과제·휴식과 계획의 실행 부담을 확인합니다.','교사의 초기 제안, 상담에서 확인한 내용, 반영한 변경과 최종 검토 결과를 구분해 남깁니다.'],
  counselingQuestions:['교사가 제안한 우선 계획과 점검 방식이 실제 시간 여건에 맞는지, 조정이 필요한 부분을 확인합니다.'],
  strategyPatch:{semester_plan:propose('교사 제안: 이번 회차에서 다룰 교과·탐구·활동 계획 중 먼저 실행할 범위를 선택하고 확인할 결과와 점검일을 정합니다. 상담으로 실행 가능성과 학생의 경험을 확인한 뒤 계획을 조정하고 최종 안내를 검토합니다.')},
  actions:[action('교사가 우선 계획과 점검 기준을 정하고 상담에서 확인할 사항을 구분해 기록하기')],
 })

 // Do not offer adoptable proposals while live edits violate the shared profile contract.
 const issues=profileIssues(profile)
 if(issues.length)return cards.map(({strategyPatch:_patch,actions:_actions,...card})=>({
  ...card,verification:['입력 범위를 수정한 다음 계획을 선택하세요.',...issues,...card.verification],
 }))
 return cards
}
