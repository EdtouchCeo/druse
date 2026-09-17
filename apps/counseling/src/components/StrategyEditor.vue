<script setup lang="ts">
import {useId} from 'vue'
import {strategyFields} from '../lib/model'
import type {Strategy} from '../lib/types'
import ResultText from './ResultText.vue'
import ActivityStrategy from './ActivityStrategy.vue'
import FieldExample from './FieldExample.vue'
import {strategyExamples,strategyTitleExample} from '../lib/inputExamples'
defineProps<{strategy:Strategy;topic:string;readOnly:boolean;locked:boolean;phase?:'preparation'|'final'|'published'}>()
const emit=defineEmits<{'update:topic':[value:string]}>()
const topicHintId=useId()
</script>
<template>
 <section class="card strategy-editor">
  <div class="section-heading"><h2>{{phase==='published'?'나의 학종 전략':phase==='final'?'최종 전략':'전략 내용 작성·수정'}}</h2></div>
  <h3 v-if="readOnly" class="strategy-title">{{topic}}</h3><template v-else><label>전략 제목<input :value="topic" :disabled="locked" :aria-describedby="topicHintId" maxlength="200" :placeholder="'예: '+strategyTitleExample" @input="emit('update:topic',($event.target as HTMLInputElement).value)"></label><p :id="topicHintId" class="help">탐구질문 형식으로 적습니다. 무엇을·왜·어떻게·어떤 조건에서 탐구할지 드러나는 하나의 중심 질문으로 작성하세요.</p></template>
  <div v-if="readOnly" class="strategy-read-grid"><section v-for="field in strategyFields.filter(f=>strategy[f.key]?.trim())" :key="field.key" :class="{'strategy-wide':['activity_plan','semester_plan','student_message'].includes(field.key)}"><h3>{{field.label}}</h3><ActivityStrategy v-if="field.key==='activity_plan'" :text="strategy[field.key]"/><ResultText v-else :text="strategy[field.key]"/></section></div>
  <fieldset v-else :disabled="locked" class="strategy-field-grid">
   <div v-for="field in strategyFields" :key="field.key" class="input-field" :class="{'strategy-wide':['activity_plan','semester_plan','student_message'].includes(field.key)}">
    <label :for="'strategy-'+field.key">{{field.label}}<span v-if="phase==='final'&&field.key==='student_message'" class="field-required">필수</span></label>
    <p v-if="field.key==='activity_plan'" :id="'strategy-'+field.key+'-hint'" class="help">{{field.hint}}</p>
    <textarea :id="'strategy-'+field.key" v-model="strategy[field.key]" :aria-label="field.label" :aria-describedby="field.key==='activity_plan'?'strategy-'+field.key+'-hint':undefined" :rows="field.key==='activity_plan'?9:['target_major','target_path'].includes(field.key)?2:4" maxlength="12000" :placeholder="'예: '+strategyExamples[field.key]"></textarea>
    <FieldExample :text="strategyExamples[field.key]!"/>
   </div>
  </fieldset>
 </section>
</template>
