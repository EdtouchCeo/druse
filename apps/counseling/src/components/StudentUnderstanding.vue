<script setup lang="ts">
import {computed,ref} from 'vue'
import {BookOpen,ClipboardCheck,ArrowRight,FileText,PenLine,Clock3,MessageSquare} from 'lucide-vue-next'
import ProfileEditor from './ProfileEditor.vue'
import {profileQuestions,hasGradeData,missingProfile,gradeTrends,gradeScaleLabel,profileDraft,profileIssues} from '../lib/profile'
import type {Session,Student} from '../lib/types'
const props=defineProps<{session:Session;student:Student;locked:boolean;localMode:boolean}>()
const emit=defineEmits<{adopt:[];strategy:[];record:[];evidence:[id:string];analysis:[]}>()
const profile=computed(()=>props.session.profile!)
const questions=computed(()=>profileQuestions(profile.value))
const missing=computed(()=>missingProfile(profile.value))
const trends=computed(()=>gradeTrends(profile.value))
const ready=computed(()=>questions.value.length>0)
const editing=ref(false),showAllQuestions=ref(false)
const canAdopt=computed(()=>Object.keys(profileDraft(profile.value)).some(key=>!props.session.strategy?.[key as keyof NonNullable<Session['strategy']>]?.trim())&&!profileIssues(profile.value).length)
const summaryCards=computed(()=>[
 {label:'관심과 진로 탐색',source:'관심 전공·계열 / 관심 주제',text:[profile.value.target_major,profile.value.interests].filter(v=>v.trim()).join('\n')},
 {label:'활동과 읽기',source:'활동 경험 / 읽기 경험',text:[profile.value.activities,profile.value.reading].filter(v=>v.trim()).join('\n')},
 {label:'학습 경험과 필요한 도움',source:'학습 고민 / 학습 습관',text:[profile.value.learning_concerns,profile.value.study_habits].filter(v=>v.trim()).join('\n')},
 {label:'교사가 확인할 맥락',source:'교사 관찰 / 출결 참고',text:[profile.value.teacher_observations,profile.value.attendance_notes].filter(v=>v.trim()).join('\n')},
])
</script>
<template>
 <section class="understanding-dashboard">
  <div class="understanding-heading"><div><span class="eyebrow">01 학생 이해 → 02 전략 수립 → 03 검토·안내</span><h2>학생 자료에서 다음 질문을 찾습니다.</h2><p>입력한 자료와 확인한 근거를 정리하고, 학생과 답을 확인한 뒤 계획을 세웁니다.</p></div><button class="secondary" @click="emit('strategy')">전략 수립으로 <ArrowRight :size="17"/></button></div>
  <div class="profile-stats"><div><BookOpen :size="19"/><span>실제 이수 과목<strong>{{profile.selected_subjects.length}}개</strong></span></div><div><ClipboardCheck :size="19"/><span>성적 기록<strong>{{profile.grades.filter(hasGradeData).length}}건</strong></span></div><div><Clock3 :size="19"/><span>주간 가용 시간<strong>{{profile.weekly_minutes===null?'미확인':profile.weekly_minutes+'분'}}</strong></span></div><div><MessageSquare :size="19"/><span>입력에 따른 질문<strong>{{questions.length}}개</strong></span></div></div>
  <section class="card profile-editor-card"><div class="profile-section-title"><div><h2>학생 기본자료</h2><p>교사 준비용 자료입니다. 학생 공개 화면과 학생 안내 PDF에는 포함하지 않습니다.</p></div><button class="secondary compact" @click="editing=!editing"><PenLine :size="16"/>{{editing?'입력 접기':'기본자료 입력·수정'}}</button></div><p v-if="!ready&&!editing" class="profile-empty">아직 입력한 자료가 없습니다. 관심 주제나 실제 과목 하나부터 입력하면 아래 정리와 확인 질문이 달라집니다.</p><ProfileEditor v-if="editing" :profile="profile" :academic-year="student.academic_year" :locked="locked"/><p v-if="locked" class="help">확정한 자료는 보존합니다. 수정하려면 새 회차를 만드세요.</p></section>
  <div class="understanding-columns"><div class="understanding-content">
   <section class="card profile-summary"><div class="profile-section-title"><h2>입력 자료 정리</h2><span class="badge">현재 입력 기준</span></div><div class="profile-summary-grid"><article v-for="card in summaryCards" :key="card.label"><h3>{{card.label}}</h3><p :class="{'muted':!card.text}">{{card.text||'아직 입력하지 않았습니다.'}}</p><small>근거: 교사 입력 · {{card.source}}</small></article></div><div class="subject-chips"><span v-for="subject in profile.selected_subjects" :key="subject" class="badge">{{subject}}</span><p v-if="!profile.selected_subjects.length" class="help">실제 이수 과목을 입력하면 학교 과제 자료를 연결해 살펴볼 수 있습니다.</p></div></section>
   <section class="card profile-academics"><div class="profile-section-title"><div><h2>학업 기록과 추이</h2><p>동일 과목·동일 등급 체계의 입력 기록만 연결합니다. 과목 난도와 평가 조건은 따로 확인합니다.</p></div></div><div v-if="profile.grades.length" class="profile-table-wrap"><table><caption class="sr-only">입력한 과목별 성적 원자료</caption><thead><tr><th>과목</th><th>학년도·학기</th><th>등급 체계</th><th>석차등급</th><th>원점수</th><th>성취도</th></tr></thead><tbody><tr v-for="row in profile.grades" :key="row.id"><th>{{row.subject||'과목 미입력'}}</th><td>{{row.academic_year}} · {{row.semester}}학기</td><td>{{gradeScaleLabel(row.grade_scale)}}</td><td>{{row.rank_grade??'미확인'}}</td><td>{{row.score??'미확인'}}</td><td>{{row.achievement||'미확인'}}</td></tr></tbody></table></div><p v-else class="profile-empty">입력한 성적 기록이 없습니다. 성적을 추정하거나 학업의 약점으로 판단하지 않습니다.</p><div class="grade-trends"><article v-for="trend in trends" :key="trend.subject+trend.scale"><h3>{{trend.subject}} <span class="badge">{{trend.scale}}</span></h3><p>{{trend.description}}</p></article></div><small>근거: 교사가 입력한 성적 기록. 서로 다른 등급제의 환산, 평균 등급, 합격 확률은 계산하지 않습니다.</small></section>
   <section v-if="localMode" class="card profile-record"><div class="profile-section-title"><div><h2>학생부에서 확인한 근거</h2><p>원본과 추출 항목을 대조한 분석 초안입니다.</p></div><button class="text-button" @click="emit('record')"><FileText :size="16"/>학생부 근거 열기</button></div><template v-if="session.analysis"><p class="profile-analysis-summary">{{session.analysis.summary}}</p><div class="profile-summary-grid"><article v-for="group in [{label:'분석 강점',items:session.analysis.strengths},{label:'분석 보완점',items:session.analysis.improvements}]" :key="group.label"><h3>{{group.label}}</h3><div v-for="(finding,index) in group.items" :key="index" class="profile-finding"><p>{{finding.text}}</p><small>{{finding.guidance}}</small><div class="evidence-links"><button v-for="id in finding.evidence_ids" :key="id" @click="emit('evidence',id)">{{session.record?.sections.find(s=>s.id===id)?.label||'근거 확인'}} · {{session.record?.sections.find(s=>s.id===id)?.pages.join(', ')||'?'}}쪽</button></div></div><p v-if="!group.items.length" class="help">제공된 근거에서 확정한 항목이 없습니다.</p></article></div><button class="text-button" @click="emit('analysis')">분석을 대조하고 전략에 반영 <ArrowRight :size="16"/></button></template><p v-else class="profile-empty">{{session.record?'PDF 항목을 추출했습니다. 판독 상태를 확인한 뒤 필요한 범위만 분석하세요.':'확인할 학생부 PDF가 있으면 로컬에서 추출·분석할 수 있습니다. 기본자료 입력만으로도 전략 준비를 시작할 수 있습니다.'}}</p></section>
   <slot name="school-context"/>
  </div><aside class="understanding-side">
   <section class="card profile-next"><h2>확인한 자료를 전략으로</h2><p>입력 내용으로 만들 수 있는 방향과 계획을 빈 전략 항목에만 옮깁니다. 강점·보완점은 임의로 채우지 않습니다.</p><button class="primary wide" :disabled="locked||!canAdopt" @click="emit('adopt')">입력 자료로 전략 초안 준비</button><small>교사가 편집하고 저장합니다. 자동 저장·공개하지 않습니다.</small></section>
   <section class="card profile-missing-card"><h2>아직 확인할 자료</h2><ul v-if="missing.length" class="profile-missing"><li v-for="item in missing" :key="item">{{item}}</li></ul><p v-else class="help">기본 항목이 입력되었습니다. 원자료와 학생의 설명이 맞는지 확인하세요.</p><small>미입력은 부족함이나 약점을 뜻하지 않습니다.</small></section>
   <section class="card profile-questions"><h2>학생과 확인할 질문</h2><p v-if="!questions.length" class="help">자료를 입력하면 해당 입력을 근거로 질문을 정리합니다.</p><article v-for="question in questions.slice(0,showAllQuestions?questions.length:3)" :key="question.id"><span class="eyebrow">{{question.source}}</span><blockquote>{{question.evidence}}</blockquote><p>{{question.question}}</p></article><button v-if="questions.length>3" class="text-button" @click="showAllQuestions=!showAllQuestions">{{showAllQuestions?'우선 질문만 보기':'다른 질문 '+(questions.length-3)+'개 더 보기'}}</button></section>
  </aside></div>
 </section>
</template>
