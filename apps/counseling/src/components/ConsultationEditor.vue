<script setup lang="ts">
import {computed} from 'vue'
import {ArrowRight} from 'lucide-vue-next'
import {consultationFields,consultationIssues} from '../lib/workflow'
import {profileQuestions} from '../lib/profile'
import type {Session} from '../lib/types'
import FieldExample from './FieldExample.vue'
import {consultationExamples} from '../lib/inputExamples'
const props=defineProps<{session:Session;locked:boolean;importedReference?:boolean}>()
const emit=defineEmits<{prepare:[];complete:[];final:[]}>()
const consultation=computed(()=>props.session.consultation!)
const issues=computed(()=>consultationIssues({...consultation.value,status:'completed'}))
const questions=computed(()=>props.session.profile?profileQuestions(props.session.profile):[])
</script>
<template>
 <section class="consultation-workspace">
  <div class="workflow-heading"><h2>상담 내용</h2><small>{{consultation.status==='completed'?'상담 반영 완료':'선택 입력'}}</small></div>
   <section class="card consultation-form"><div class="section-heading"><h3>학생의 관심·상황과 합의한 방향</h3><small>교사 전용</small></div><fieldset :disabled="locked"><label class="consultation-date">상담일 <span class="field-required">완료 기록 시</span><input v-model="consultation.date" type="date"></label><div class="consultation-fields"><div v-for="field in consultationFields" :key="field.key" class="input-field"><label :for="'consultation-'+field.key">{{field.label}}<span v-if="['student_response','agreed_direction'].includes(field.key)" class="field-required">필수</span></label><textarea :id="'consultation-'+field.key" v-model="consultation[field.key]" :aria-label="field.label" maxlength="6000" rows="3" :placeholder="'예: '+consultationExamples[field.key]"></textarea><FieldExample :text="consultationExamples[field.key]!"/></div></div></fieldset>
    <details v-if="questions.length||session.analysis?.questions.length" class="consultation-questions"><summary>상담에서 참고할 확인 질문</summary><article v-for="question in questions" :key="question.id"><small>{{question.source}} · {{question.evidence}}</small><p>{{question.question}}</p></article><p v-for="question in session.analysis?.questions||[]" :key="question">{{question}}</p></details>
    <div class="consultation-complete"><p v-if="issues.length&&consultation.status!=='completed'" class="help">{{issues[0]}}</p><div class="button-row"><button v-if="!locked" class="primary" :disabled="issues.length>0" @click="emit('complete')">{{consultation.status==='completed'?'상담 내용 저장':'상담 반영 완료'}} <ArrowRight :size="17"/></button><button v-if="consultation.status==='completed'" class="secondary" @click="emit('final')">전략 보고서 보기</button></div></div>
   </section>
 </section>
</template>
