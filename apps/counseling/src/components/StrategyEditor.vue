<script setup lang="ts">
import {strategyFields} from '../lib/model'
import type {Strategy} from '../lib/types'
defineProps<{strategy:Strategy;topic:string;readOnly:boolean;locked:boolean;phase?:'preparation'|'final'|'published'}>()
const emit=defineEmits<{'update:topic':[value:string]}>()
</script>
<template>
 <section class="card strategy-editor">
  <div class="section-heading"><span class="step">01</span><div><h2>{{phase==='published'?'나의 학종 전략':phase==='final'?'상담을 반영한 최종 전략':'상담 전 교사 전략'}}</h2><p>{{phase==='published'?'선생님이 안내한 방향과 계획을 읽고 아래 실행과제를 확인하세요.':phase==='final'?'학생과 합의한 방향에 맞춰 최종 계획과 안내 메시지를 수정합니다.':'교사가 판단한 방향과 교과·탐구·활동 계획을 먼저 세웁니다. 학생 안내 메시지는 상담 후 완성할 수 있습니다.'}}</p></div></div>
  <p v-if="!readOnly" class="inline-note">현재는 교사 작성 초안입니다. 최종 확정 후 별도로 안내한 전략과 실행과제만 학생에게 전달합니다. 사전 전략과 교사 참고 메모는 공개하지 않습니다.</p>
  <h3 v-if="readOnly" class="strategy-title">{{topic}}</h3><label v-else>전략 제목<input :value="topic" :disabled="locked" maxlength="200" placeholder="이번 학기에 함께 실천할 전략의 제목" @input="emit('update:topic',($event.target as HTMLInputElement).value)"></label>
  <div v-if="readOnly" class="strategy-read-grid"><section v-for="field in strategyFields" :key="field.key" :class="{'strategy-wide':['semester_plan','student_message'].includes(field.key)}"><h3>{{field.label}}</h3><p>{{strategy[field.key]||(phase==='preparation'?'사전 전략에서 작성하지 않은 항목입니다.':'다음 점검에서 선생님과 함께 정합니다.')}}</p></section></div>
  <fieldset v-else :disabled="locked" class="strategy-field-grid"><label v-for="field in strategyFields" :key="field.key" :class="{'strategy-wide':['semester_plan','student_message'].includes(field.key)}">{{field.label}}<textarea v-model="strategy[field.key]" :aria-label="field.label" :rows="['target_major','target_path'].includes(field.key)?2:4" :maxlength="12000" :placeholder="field.hint"></textarea><small>{{field.hint}}</small></label></fieldset>
 </section>
</template>
