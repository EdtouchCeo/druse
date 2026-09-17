<script setup lang="ts">
import {computed,useId} from 'vue'
import type {Action,AdmissionTarget,Strategy} from '../lib/types'
import {hasAdmissionTarget} from '../lib/profile'
import ResultText from './ResultText.vue'
import ActivityStrategy from './ActivityStrategy.vue'
const props=defineProps<{topic:string;strategy:Strategy;admissionTargets?:AdmissionTarget[];actions?:Action[];nextDate?:string;preview?:boolean}>()
const id=useId()
const targets=computed(()=>(props.admissionTargets||[]).filter(hasAdmissionTarget))
const sections=computed(()=>[
 {key:'student_message',label:'학생이 준비할 사항'},
 {key:'target_major',label:'관심 전공과 탐색 범위'},
 {key:'target_path',label:'진로 방향과 선택 이유'},
 {key:'strengths',label:'현재 기반과 강점'},
 {key:'gaps',label:'보완 방향과 필요한 도움'},
 {key:'semester_plan',label:'학기별 학습·탐구 로드맵'},
 {key:'subject_plan',label:'교과별 학습 전략'},
 {key:'inquiry_plan',label:'추천 탐구 주제와 설계'},
 {key:'activity_plan',label:'창체·봉사·독서·행동특성 전략'},
].filter(field=>props.strategy[field.key as keyof Strategy]?.trim()))
</script>
<template>
 <article class="student-result" aria-label="학습·진로 전략 보고서 미리보기" tabindex="-1">
  <header class="result-heading"><p class="eyebrow">학습·진로 전략 보고서</p><h2 class="result-title">{{topic||'학생의 배움과 진로를 위한 전략'}}</h2></header>
  <nav v-if="sections.length||targets.length" class="report-contents" aria-label="전략 보고서 목차"><a v-if="targets.length" :href="'#'+id+'-admission-targets'">희망 대학·전공·전형</a><a v-for="section in sections" :key="section.key" :href="'#'+id+'-'+section.key">{{section.label}}</a></nav>
  <section v-if="targets.length" :id="id+'-admission-targets'" class="result-plan admission-targets-result" aria-label="희망 대학·전공·전형">
   <h3>희망 대학·전공·전형</h3>
   <table class="admission-targets-table"><caption class="visually-hidden">학생이 입력한 희망 대학·전공·전형</caption><thead><tr><th scope="col">대학</th><th scope="col">모집단위·전공</th><th scope="col">전형 유형</th><th scope="col">전형명</th><th scope="col">대입 학년도</th></tr></thead><tbody><tr v-for="target in targets" :key="target.id"><td data-label="대학">{{target.university||'미입력'}}</td><td data-label="모집단위·전공">{{target.major||'미입력'}}</td><td data-label="전형 유형">{{target.admission_type||'미입력'}}</td><td data-label="전형명">{{target.admission_name||'미입력'}}</td><td data-label="대입 학년도">{{target.admission_year?target.admission_year+'학년도':'미입력'}}</td></tr></tbody></table>
  </section>
  <div class="strategy-read-grid result-sections"><section v-for="section in sections" :id="id+'-'+section.key" :key="section.key" :data-result-section="section.key" class="result-plan"><h3>{{section.label}}</h3><ActivityStrategy v-if="section.key==='activity_plan'" :text="strategy.activity_plan"/><ResultText v-else :text="strategy[section.key as keyof Strategy]"/></section></div>
  <p v-if="!sections.length" class="help">학생 자료와 상담 내용을 입력한 뒤 전략을 생성하거나 직접 작성하세요.</p>
 </article>
</template>
<style scoped>
.report-contents{display:flex;flex-wrap:wrap;gap:9px;margin:22px 0 28px}.report-contents a{font-size:13px;text-decoration:none;color:#2a5298;padding:8px 12px;background:#eff4fb;border-radius:6px;line-height:1.5}.result-plan{scroll-margin-top:30px}.result-title{word-break:keep-all;overflow-wrap:anywhere}.result-plan :deep(.result-subheading){font-size:17px;border-left:3px solid #bbcde5;padding-left:12px}.result-plan :deep(.result-prose p){font-size:16px;line-height:1.95}.result-plan :deep(.result-list li){font-size:16px}
.admission-targets-result{margin:0 0 30px;min-width:0}.admission-targets-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px;line-height:1.8}.admission-targets-table th,.admission-targets-table td{padding:12px 10px;border:1px solid var(--border);text-align:left;vertical-align:top;overflow-wrap:anywhere}.admission-targets-table th{background:#eff4fb}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}@media(max-width:760px){.admission-targets-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.admission-targets-table,.admission-targets-table tbody,.admission-targets-table tr,.admission-targets-table td{display:block;width:auto}.admission-targets-table tr{border:1px solid var(--border);border-radius:7px;margin:12px 0;overflow:hidden}.admission-targets-table td{border:0;border-bottom:1px solid var(--border);padding:9px 12px}.admission-targets-table td:last-child{border-bottom:0}.admission-targets-table td:before{content:attr(data-label);display:block;font-size:12px;font-weight:700;color:#36577e}}
</style>
