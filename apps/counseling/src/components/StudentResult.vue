<script setup lang="ts">
import {computed} from 'vue'
import type {Action,Strategy} from '../lib/types'
import ResultText from './ResultText.vue'

// Deliberately accept only student-facing values, never a whole session/profile.
const props=defineProps<{topic:string;strategy:Strategy;actions:Action[];nextDate:string;preview?:boolean}>()
const directionFields=[{key:'target_major',label:'목표 전공·관심 분야'},{key:'target_path',label:'진로 방향'},{key:'strengths',label:'강점과 활용 방향'},{key:'gaps',label:'보완점과 필요한 도움'}] as const
const planFields=[{key:'subject_plan',label:'교과 계획'},{key:'inquiry_plan',label:'탐구 계획'},{key:'activity_plan',label:'활동 계획'},{key:'semester_plan',label:'학기별 계획'}] as const
const directions=computed(()=>directionFields.filter(field=>props.strategy[field.key]?.trim()))
const plans=computed(()=>planFields.filter(field=>props.strategy[field.key]?.trim()))
const actions=computed(()=>props.actions.filter(action=>action.text.trim()))
const statusLabels={planned:'계획',in_progress:'진행 중',done:'수행 확인',deferred:'보류'}
</script>
<template>
 <article class="student-result" aria-label="학생 최종 결과물" tabindex="-1">
  <header class="result-heading"><h2>{{preview?'학생 결과물 미리보기':'나의 학종 전략'}}</h2><p v-if="topic" class="result-title">{{topic}}</p></header>
  <div class="strategy-read-grid result-sections">
   <section v-if="strategy.student_message.trim()" class="result-message" data-result-section="message"><h3>이번 전략의 핵심</h3><ResultText :text="strategy.student_message"/></section>
   <section class="result-actions" data-result-section="actions"><h3>이번 실행과제</h3><ol v-if="actions.length"><li v-for="action in actions" :key="action.id"><ResultText :text="action.text"/><p class="result-action-meta"><span>점검일: {{action.due_date||'미정'}}</span><span>{{statusLabels[action.status]}}</span></p></li></ol><p v-else>등록된 실행과제 없음</p><p class="result-next-date">다음 점검일: {{nextDate||'미정'}}</p></section>
   <section v-if="directions.length" class="result-direction" data-result-section="direction"><h3>방향과 선택 근거</h3><div v-for="field in directions" :key="field.key" class="result-field"><h4>{{field.label}}</h4><ResultText :text="strategy[field.key]"/></div></section>
   <section v-for="field in plans" :key="field.key" class="result-plan" :data-result-section="field.key"><h3>{{field.label}}</h3><ResultText :text="strategy[field.key]"/></section>
  </div>
 </article>
</template>
