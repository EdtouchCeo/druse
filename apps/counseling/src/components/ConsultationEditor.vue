<script setup lang="ts">
import {computed} from 'vue'
import {ArrowRight,ShieldCheck,MessageSquare} from 'lucide-vue-next'
import {strategyFields} from '../lib/model'
import {consultationFields,consultationIssues} from '../lib/workflow'
import {profileQuestions} from '../lib/profile'
import type {Session} from '../lib/types'
const props=defineProps<{session:Session;locked:boolean;importedReference?:boolean}>()
const emit=defineEmits<{prepare:[];complete:[];final:[]}>()
const preparedTime=computed(()=>{const raw=props.session.preparation?.prepared_at||'';if(!/(Z|[+-]\d{2}:\d{2})$/.test(raw))return raw+' (원본 시각 · 시간대 미확인)';const date=new Date(raw);return Number.isNaN(date.valueOf())?'시각 확인 필요':date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'})+' (한국 시간)'})
const consultation=computed(()=>props.session.consultation!)
const issues=computed(()=>consultationIssues({...consultation.value,status:'completed'}))
const questions=computed(()=>props.session.profile?profileQuestions(props.session.profile):[])
</script>
<template>
 <section class="consultation-workspace">
  <div class="workflow-heading"><div><span class="eyebrow">03 학생 상담·반영 · 교사 기록</span><h2>준비한 전략을 학생과 대조하고 조정합니다.</h2><p>학생의 실제 반응과 합의한 방향을 기록한 뒤, 최종 전략과 실행과제에 반영합니다.</p></div><span class="badge" :class="{success:consultation.status==='completed'}">{{consultation.status==='completed'?'상담 반영 완료':session.preparation?'상담 진행 중':'전략 준비 전'}}</span></div>
  <section v-if="!session.preparation" class="card workflow-gate"><ShieldCheck :size="25"/><h2>상담 전에 교사 전략을 먼저 준비하세요.</h2><p>교과·탐구·활동·학기별 계획을 작성하고 준비 완료하면 상담 전 전략이 보존됩니다. 이전 회차의 상담 기록은 교사 참고 메모에서 확인할 수 있습니다.</p><button class="primary" :disabled="locked" @click="emit('prepare')">교사 전략 수립으로 <ArrowRight :size="17"/></button></section>
  <template v-else>
   <section class="card preparation-snapshot"><div class="profile-section-title"><div><span class="eyebrow">{{importedReference?'가져온 사전 전략 참고본 · 읽기 전용':'상담 전 교사 전략 · 읽기 전용'}}</span><h2>{{session.preparation.topic}}</h2><p>{{preparedTime}} · {{importedReference?'원본 작성자·시각은 검증하지 않았습니다. 학생 상담 내용을 다시 확인하세요.':'준비 완료한 내용은 상담 이후에도 보존됩니다.'}}</p></div><ShieldCheck :size="22" class="brand-color"/></div><div class="preparation-summary-grid"><article v-for="field in strategyFields.filter(f=>session.preparation!.strategy[f.key].trim())" :key="field.key"><h3>{{field.label}}</h3><p>{{session.preparation.strategy[field.key]}}</p></article></div><div v-if="session.preparation.actions.length" class="snapshot-actions"><h3>상담 전 실행과제</h3><ul><li v-for="action in session.preparation.actions" :key="action.id">{{action.text}}<small>{{action.due_date?'점검일 '+action.due_date:'점검일 미정'}}</small></li></ul></div></section>
   <section class="card consultation-form"><div class="section-heading"><MessageSquare :size="22"/><div><h2>학생 상담 기록</h2><p>학생 반응을 예상해서 채우지 않습니다. 이 기록과 사전 전략은 학생 화면·학생 안내 PDF에 포함되지 않습니다.</p></div></div><fieldset :disabled="locked"><label class="consultation-date">상담일<input v-model="consultation.date" type="date"></label><div class="consultation-fields"><label v-for="field in consultationFields" :key="field.key">{{field.label}}<span v-if="['student_response','agreed_direction'].includes(field.key)" class="field-required">필수</span><textarea v-model="consultation[field.key]" :aria-label="field.label" maxlength="6000" rows="4" :placeholder="field.hint"></textarea><small>{{field.hint}}</small></label></div></fieldset>
    <details v-if="questions.length||session.analysis?.questions.length" class="consultation-questions"><summary>상담에서 참고할 확인 질문</summary><article v-for="question in questions" :key="question.id"><small>{{question.source}} · {{question.evidence}}</small><p>{{question.question}}</p></article><p v-for="question in session.analysis?.questions||[]" :key="question">{{question}}</p></details>
    <div class="consultation-complete"><p v-if="consultation.status!=='completed'" class="help">상담일·학생 반응·합의한 방향을 입력한 뒤 완료하세요. 작성 중에는 상단 저장으로 보관할 수 있습니다.</p><ul v-if="issues.length&&consultation.status!=='completed'" class="completion-requirements"><li v-for="issue in issues" :key="issue">{{issue}}</li></ul><div class="button-row"><button v-if="!locked" class="primary" :disabled="issues.length>0" @click="emit('complete')">{{consultation.status==='completed'?'상담 수정 저장·최종 전략으로':'상담 반영 완료'}} <ArrowRight :size="17"/></button><button v-if="consultation.status==='completed'" class="secondary" @click="emit('final')">최종 전략 확인</button></div><small>완료 후 최종 결과물에서 전략과 실행과제를 수정하고 문체 검토·확정을 진행합니다. 자동으로 학생에게 공개하지 않습니다.</small></div>
   </section>
  </template>
 </section>
</template>
