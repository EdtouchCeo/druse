<script setup lang="ts">
import {computed} from 'vue'
import type {Analysis,SchoolRecord,Student} from '../lib/types'
import StructuredAnalysis from './StructuredAnalysis.vue'

const props=defineProps<{analysis:Analysis;record:SchoolRecord;student:Student;date:string;synthetic?:boolean;imported?:boolean}>()
const limitations=computed(()=>Array.from(new Set([...props.record.warnings,...props.analysis.limitations])))
</script>

<template>
 <article class="analysis-report" aria-label="학생부 분석 보고서 미리보기" tabindex="-1">
  <header class="analysis-report-heading">
   <h2>{{student.name||student.student_number}} 학생부 분석 자료</h2>
   <p>{{student.academic_year}}학년도 · {{student.school_stage==='middle'?'중학교':'고등학교'}} {{student.grade}}학년 · {{student.student_number}} {{student.name}}</p>
   <small>분석일 {{analysis.created_at.slice(0,10)||date}} · 교사 검토용</small>
   <p v-if="synthetic" class="report-note">합성자료 시연입니다. 실제 학생 기록이나 교사의 확인 결과가 아닙니다.</p>
   <p v-if="imported" class="report-note">가져온 미검증 참고 자료입니다. 원본 학생부와 대조해 주세요.</p>
  </header>
  <StructuredAnalysis :analysis="analysis" :record="record"/>
  <section v-if="limitations.length" class="analysis-report-scope"><h3>자료 범위와 확인할 점</h3><ul><li v-for="(limitation,index) in limitations" :key="index">{{limitation}}</li></ul></section>
 </article>
</template>

<style scoped>
.analysis-report{width:100%;max-width:900px;margin:12px auto 28px;color:#17212e;background:#fff;overflow-wrap:anywhere;outline-offset:5px}
.analysis-report-heading{padding:22px 0;border-bottom:2px solid #2a5298}
.analysis-report-heading h2{font-size:28px;line-height:1.45;margin:8px 0 14px;color:#18375f}
.analysis-report-heading>p:not(.eyebrow){font-size:14px;line-height:1.8;margin:5px 0}
.analysis-report small{display:block;font-size:13px;line-height:1.7;color:#596579;margin-top:7px}
.analysis-report>section{padding:23px 0;border-bottom:1px solid #d8dee8}
.analysis-report h3{font-size:20px;line-height:1.5;color:#244b81;margin:0 0 13px}
.analysis-report h4{font-size:16px;line-height:1.7;margin:0 0 8px}
.analysis-report-summary{background:#f6f9fd;padding:22px!important;margin-top:22px;border-left:3px solid #2a5298;border-bottom:0!important}
.analysis-report-finding+.analysis-report-finding{margin-top:20px;padding-top:18px;border-top:1px solid #e2e8f0}
.analysis-report :deep(.result-prose p){font-size:16px;line-height:1.85;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;margin:0 0 8px}
.analysis-report .report-note,.analysis-report .report-reason{font-size:14px;line-height:1.8;color:#526175;white-space:pre-wrap;margin:8px 0 14px}
.analysis-report ol,.analysis-report ul{padding-left:23px;margin:0}
.analysis-report li{padding:4px 0;font-size:14px;line-height:1.8}
.analysis-report-evidence{padding:20px 0;border-bottom:1px solid #d8dee8}
.analysis-report-evidence>summary{font-size:16px;color:#244b81;font-weight:600;cursor:pointer;min-height:36px;line-height:1.6}
.analysis-report-evidence .analysis-report-finding{margin-top:18px}
.analysis-report blockquote{margin:12px 0;padding:12px 16px;border-left:3px solid #b8cce9;background:#f8fafc}
.analysis-report blockquote :deep(.result-prose p){font-size:14px;line-height:1.8}
@media(max-width:760px){.analysis-report-heading h2{font-size:24px}.analysis-report-summary{padding:16px!important}.analysis-report>section{padding:20px 0}.analysis-report h3{font-size:19px}}
</style>
