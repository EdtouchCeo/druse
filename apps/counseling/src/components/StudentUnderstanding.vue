<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {ArrowRight,FileText,PenLine} from 'lucide-vue-next'
import ProfileEditor from './ProfileEditor.vue'
import AdmissionTargetInfo from './AdmissionTargetInfo.vue'
import {profileQuestions,gradeTrends,gradeScaleLabel,profileDraft,profileIssues,admissionTargetSummary,hasAdmissionTarget} from '../lib/profile'
import type {Session,Student} from '../lib/types'
import {prepareStrategies,type StrategyPreparationCard} from '../lib/strategyPreparation'
import type {SchoolContext} from '../lib/schoolContext'
const props=defineProps<{session:Session;student:Student;locked:boolean;planLocked:boolean;localMode:boolean;schoolContext:SchoolContext}>()
const emit=defineEmits<{adopt:[];'select-plan':[card:StrategyPreparationCard];strategy:[];record:[];evidence:[id:string];analysis:[]}>()
const profile=computed(()=>props.session.profile!)
const questions=computed(()=>profileQuestions(profile.value))
const trends=computed(()=>gradeTrends(profile.value))
const ready=computed(()=>questions.value.length>0)
const plans=computed(()=>prepareStrategies(profile.value,props.student,props.schoolContext).filter(plan=>plan.id!=='implementation-review'))
const editing=ref(false),showAllQuestions=ref(false)
watch(()=>props.session.id,()=>{editing.value=!props.session.confirmed&&!props.session.guidance&&!ready.value;showAllQuestions.value=false},{immediate:true})
const canAdopt=computed(()=>Object.keys(profileDraft(profile.value)).some(key=>!props.session.strategy?.[key as keyof NonNullable<Session['strategy']>]?.trim())&&!profileIssues(profile.value).length)
const summaryCards=computed(()=>[
 {label:'관심과 진로 탐색',source:'관심 전공·계열 / 관심 주제',text:[profile.value.target_major,profile.value.interests].filter(v=>v.trim()).join('\n')},
 {label:'희망 대학·전공·전형',source:'학생이 입력한 희망',text:profile.value.admission_targets.filter(hasAdmissionTarget).map(admissionTargetSummary).join('\n')},
 {label:'활동과 읽기',source:'활동 경험 / 읽기 경험',text:[profile.value.activities,profile.value.reading].filter(v=>v.trim()).join('\n')},
 {label:'학습 경험과 필요한 도움',source:'학습 고민 / 학습 습관',text:[profile.value.learning_concerns,profile.value.study_habits].filter(v=>v.trim()).join('\n')},
 {label:'교사가 확인할 맥락',source:'교사 관찰 / 출결 참고',text:[profile.value.teacher_observations,profile.value.attendance_notes].filter(v=>v.trim()).join('\n')},
])
</script>
<template>
 <section class="understanding-dashboard">
  <section class="card profile-editor-card">
   <div class="profile-section-title"><div><h2>학생 기본자료</h2><small>교사 전용 · 아는 항목부터 입력</small></div><button class="secondary compact" @click="editing=!editing"><PenLine :size="16"/>{{editing?'입력 접기':'기본자료 입력·수정'}}</button></div>
   <ProfileEditor v-if="editing" :profile="profile" :academic-year="student.academic_year" :locked="locked"/>
   <div v-else-if="ready" class="profile-summary-grid"><article v-for="card in summaryCards.filter(c=>c.text)" :key="card.label"><h3>{{card.label}}</h3><p>{{card.text}}</p></article></div>
   <p v-else class="profile-empty">입력한 자료가 없습니다.</p>
   <AdmissionTargetInfo v-if="!editing" :profile="profile"/>
   <p v-if="locked" class="help">수정은 새 회차에서 할 수 있습니다.</p>
   <div class="profile-primary-actions"><button class="secondary" :disabled="planLocked||!canAdopt" @click="emit('adopt')">입력 자료로 전략 초안 준비</button><button class="primary" @click="emit('strategy')">상담·전략 수립으로 <ArrowRight :size="17"/></button></div>
  </section>
  <section v-if="profile.grades.length" class="card profile-academics">
   <div class="profile-section-title"><h2>학업 기록과 추이</h2><small>같은 과목·등급 체계 기준</small></div>
   <div class="profile-table-wrap"><table><caption class="sr-only">입력한 과목별 성적 원자료</caption><thead><tr><th>과목</th><th>학년도·학기</th><th>등급 체계</th><th>석차등급</th><th>원점수</th><th>성취도</th></tr></thead><tbody><tr v-for="row in profile.grades" :key="row.id"><th>{{row.subject||'과목 미입력'}}</th><td>{{row.academic_year}} · {{row.semester}}학기</td><td>{{gradeScaleLabel(row.grade_scale)}}</td><td>{{row.rank_grade??'미확인'}}</td><td>{{row.score??'미확인'}}</td><td>{{row.achievement||'미확인'}}</td></tr></tbody></table></div>
   <div class="grade-trends"><article v-for="trend in trends" :key="trend.subject+trend.scale"><h3>{{trend.subject}} <small>{{trend.scale}}</small></h3><p>{{trend.description}}</p></article></div>
  </section>
  <slot name="school-context"/>
  <section v-if="ready" class="teacher-strategy-options">
   <div class="profile-section-title"><h2>전략 초안 선택</h2><small>입력 자료 기반 · 선택 후 편집</small></div>
   <div class="strategy-options-grid"><article v-for="plan in plans" :key="plan.id" class="card strategy-option">
    <div class="option-heading"><h3>{{plan.title}}</h3><button class="secondary compact" :disabled="planLocked||!plan.strategyPatch&&!plan.actions?.length" @click="emit('select-plan',plan)">전략에 추가</button></div>
    <details><summary>근거와 초안 보기</summary><div class="option-evidence"><p v-for="item in plan.evidence" :key="item">{{item}}</p></div><p class="option-proposal">{{plan.proposal}}</p><ul v-if="plan.actions?.length"><li v-for="action in plan.actions" :key="action">{{action}}</li></ul><h4>적용 전 확인</h4><ul><li v-for="item in plan.verification" :key="item">{{item}}</li></ul><h4>출처</h4><p v-for="item in plan.source" :key="item">{{item}}</p></details>
   </article></div>
  </section>
  <section v-if="localMode&&session.record" class="card profile-record">
   <div class="profile-section-title"><h2>학생부 분석</h2><button class="text-button" @click="emit('record')"><FileText :size="16"/>학생부 근거 열기</button></div>
   <template v-if="session.analysis"><p>학생부의 강점과 발전 방향, 보완을 위한 준비와 도움을 근거와 함께 확인합니다.</p><button class="secondary" @click="emit('analysis')">학생부 상세 분석 보기 <ArrowRight :size="16"/></button></template>
   <button v-else class="secondary" @click="emit('analysis')">학생부 분석으로</button>
  </section>
  <details v-if="questions.length" class="card profile-questions"><summary>상담 참고 질문 <small>{{questions.length}}개</small></summary><article v-for="question in questions.slice(0,showAllQuestions?questions.length:3)" :key="question.id"><small>{{question.source}}</small><blockquote>{{question.evidence}}</blockquote><p>{{question.question}}</p></article><button v-if="questions.length>3" class="text-button" @click="showAllQuestions=!showAllQuestions">{{showAllQuestions?'접기':'질문 더 보기'}}</button></details>
 </section>
</template>
