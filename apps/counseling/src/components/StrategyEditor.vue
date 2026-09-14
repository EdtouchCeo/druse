<script setup lang="ts">
import {strategyFields} from '../lib/model'
import type {Strategy} from '../lib/types'
import FieldExample from './FieldExample.vue'
import {strategyExamples} from '../lib/inputExamples'
defineProps<{strategy:Strategy;topic:string;readOnly:boolean;locked:boolean;phase?:'preparation'|'final'|'published'}>()
const emit=defineEmits<{'update:topic':[value:string]}>()
</script>
<template>
 <section class="card strategy-editor">
  <div class="section-heading"><h2>{{phase==='published'?'나의 학종 전략':phase==='final'?'최종 전략':'상담 전 교사 전략'}}</h2></div>
  <h3 v-if="readOnly" class="strategy-title">{{topic}}</h3><label v-else>전략 제목<input :value="topic" :disabled="locked" maxlength="200" placeholder="예: 수업 자료 비교로 시작하는 환경공학 탐색" @input="emit('update:topic',($event.target as HTMLInputElement).value)"></label>
  <div v-if="readOnly" class="strategy-read-grid"><section v-for="field in strategyFields.filter(f=>strategy[f.key]?.trim())" :key="field.key" :class="{'strategy-wide':['semester_plan','student_message'].includes(field.key)}"><h3>{{field.label}}</h3><p>{{strategy[field.key]}}</p></section></div>
  <fieldset v-else :disabled="locked" class="strategy-field-grid">
   <div v-for="field in strategyFields" :key="field.key" class="input-field" :class="{'strategy-wide':['semester_plan','student_message'].includes(field.key)}">
    <label :for="'strategy-'+field.key">{{field.label}}<span v-if="phase==='final'&&field.key==='student_message'" class="field-required">필수</span></label>
    <textarea :id="'strategy-'+field.key" v-model="strategy[field.key]" :aria-label="field.label" :rows="['target_major','target_path'].includes(field.key)?2:4" maxlength="12000" :placeholder="'예: '+strategyExamples[field.key]"></textarea>
    <FieldExample :text="strategyExamples[field.key]!"/>
   </div>
  </fieldset>
 </section>
</template>
