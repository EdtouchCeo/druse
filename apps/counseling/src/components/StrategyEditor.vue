<script setup lang="ts">
import {strategyFields} from '../lib/model'
import type {Strategy} from '../lib/types'
defineProps<{strategy:Strategy;topic:string;readOnly:boolean;locked:boolean}>()
const emit=defineEmits<{'update:topic':[value:string]}>()
</script>
<template>
 <section class="card strategy-editor">
  <div class="section-heading"><span class="step">01</span><div><h2>{{readOnly?'나의 학종 전략':'학생에게 안내할 학종 전략'}}</h2><p>{{readOnly?'선생님이 안내한 방향과 계획을 읽고 아래 실행과제를 확인하세요.':'학생의 방향과 근거를 정리하고 교과·탐구·활동을 학기별 실행으로 연결합니다.'}}</p></div></div>
  <p v-if="!readOnly" class="inline-note">전략 제목, 아래 9개 전략 항목과 실행과제가 학생 안내 내용입니다. 교사 참고 메모는 별도 영역에 작성하세요.</p>
  <h3 v-if="readOnly" class="strategy-title">{{topic}}</h3><label v-else>전략 제목<input :value="topic" :disabled="locked" maxlength="200" placeholder="이번 학기에 함께 실천할 전략의 제목" @input="emit('update:topic',($event.target as HTMLInputElement).value)"></label>
  <div v-if="readOnly" class="strategy-read-grid"><section v-for="field in strategyFields" :key="field.key" :class="{'strategy-wide':['semester_plan','student_message'].includes(field.key)}"><h3>{{field.label}}</h3><p>{{strategy[field.key]||'다음 점검에서 선생님과 함께 정합니다.'}}</p></section></div>
  <fieldset v-else :disabled="locked" class="strategy-field-grid"><label v-for="field in strategyFields" :key="field.key" :class="{'strategy-wide':['semester_plan','student_message'].includes(field.key)}">{{field.label}}<textarea v-model="strategy[field.key]" :aria-label="field.label" :rows="['target_major','target_path'].includes(field.key)?2:4" :maxlength="12000" :placeholder="field.hint"></textarea><small>{{field.hint}}</small></label></fieldset>
 </section>
</template>
