<script setup lang="ts">
import {computed} from 'vue'
import {ArrowRight} from 'lucide-vue-next'
import {strategyFields} from '../lib/model'
import {consultationFields,consultationIssues} from '../lib/workflow'
import {profileQuestions} from '../lib/profile'
import type {Session} from '../lib/types'
import FieldExample from './FieldExample.vue'
import {consultationExamples} from '../lib/inputExamples'
const props=defineProps<{session:Session;locked:boolean;importedReference?:boolean}>()
const emit=defineEmits<{prepare:[];complete:[];final:[]}>()
const preparedTime=computed(()=>{const raw=props.session.preparation?.prepared_at||'';if(!/(Z|[+-]\d{2}:\d{2})$/.test(raw))return raw+' (원본 시각 · 시간대 미확인)';const date=new Date(raw);return Number.isNaN(date.valueOf())?'시각 확인 필요':date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'})+' (한국 시간)'})
const consultation=computed(()=>props.session.consultation!)
const issues=computed(()=>consultationIssues({...consultation.value,status:'completed'}))
const questions=computed(()=>props.session.profile?profileQuestions(props.session.profile):[])
</script>
<template>
 <section class="consultation-workspace">
  <div class="workflow-heading"><h2>학생 상담·반영</h2><small>{{consultation.status==='completed'?'상담 반영 완료':session.preparation?'작성 중':'전략 준비 전'}}</small></div>
  <section v-if="!session.preparation" class="card workflow-gate"><p>교사 전략을 먼저 준비해 주세요.</p><button class="primary" :disabled="locked" @click="emit('prepare')">교사 전략 수립으로 <ArrowRight :size="17"/></button></section>
  <template v-else>
   <details class="card preparation-snapshot"><summary>{{importedReference?'가져온 사전 전략 참고본':'상담 전 교사 전략'}} 보기</summary><div class="profile-section-title"><div><h3>{{session.preparation.topic}}</h3><small>{{preparedTime}} · {{importedReference?'원본 작성자·시각 미검증':'읽기 전용'}}</small></div></div><div class="preparation-summary-grid"><article v-for="field in strategyFields.filter(f=>session.preparation!.strategy[f.key].trim())" :key="field.key"><h3>{{field.label}}</h3><p>{{session.preparation.strategy[field.key]}}</p></article></div><div v-if="session.preparation.actions.length" class="snapshot-actions"><h3>상담 전 실행과제</h3><ul><li v-for="action in session.preparation.actions" :key="action.id">{{action.text}}<small>{{action.due_date?'점검일 '+action.due_date:'점검일 미정'}}</small></li></ul></div></details>
   <section class="card consultation-form"><div class="section-heading"><h2>학생 상담 기록</h2><small>교사 전용</small></div><fieldset :disabled="locked"><label class="consultation-date">상담일 <span class="field-required">필수</span><input v-model="consultation.date" type="date"></label><div class="consultation-fields"><div v-for="field in consultationFields" :key="field.key" class="input-field"><label :for="'consultation-'+field.key">{{field.label}}<span v-if="['student_response','agreed_direction'].includes(field.key)" class="field-required">필수</span></label><textarea :id="'consultation-'+field.key" v-model="consultation[field.key]" :aria-label="field.label" maxlength="6000" rows="3" :placeholder="'예: '+consultationExamples[field.key]"></textarea><FieldExample :text="consultationExamples[field.key]!"/></div></div></fieldset>
    <details v-if="questions.length||session.analysis?.questions.length" class="consultation-questions"><summary>상담에서 참고할 확인 질문</summary><article v-for="question in questions" :key="question.id"><small>{{question.source}} · {{question.evidence}}</small><p>{{question.question}}</p></article><p v-for="question in session.analysis?.questions||[]" :key="question">{{question}}</p></details>
    <div class="consultation-complete"><p v-if="issues.length&&consultation.status!=='completed'" class="help">{{issues[0]}}</p><div class="button-row"><button v-if="!locked" class="primary" :disabled="issues.length>0" @click="emit('complete')">{{consultation.status==='completed'?'상담 수정 저장·최종 전략으로':'상담 반영 완료'}} <ArrowRight :size="17"/></button><button v-if="consultation.status==='completed'" class="secondary" @click="emit('final')">최종 전략 확인</button></div></div>
   </section>
  </template>
 </section>
</template>
