<script setup lang="ts">
import {computed} from 'vue'
import type {Analysis,SchoolRecord,Student} from '../lib/types'
import ResultText from './ResultText.vue'

const props=defineProps<{analysis:Analysis;record:SchoolRecord;student:Student;date:string;synthetic?:boolean;imported?:boolean}>()
const findings=computed(()=>[
 ...props.analysis.strengths.map((item,index)=>({...item,key:'strength-'+index,label:'강점 '+(index+1)})),
 ...props.analysis.improvements.map((item,index)=>({...item,key:'improvement-'+index,label:'보완점 '+(index+1)})),
])
const limitations=computed(()=>Array.from(new Set([...props.record.warnings,...props.analysis.limitations])))
function location(ids:string[]):string {
 return ids.map(id=>{const source=props.record.sections.find(item=>item.id===id);return source?source.label+(source.pages.length?' · '+source.pages.join(', ')+'쪽':''):'원문 위치 확인 필요'}).join(' / ')
}
</script>

<template>
 <article class="analysis-report" aria-label="학생부 분석 보고서 미리보기" tabindex="-1">
  <header class="analysis-report-heading">
   <p class="eyebrow">학생부 분석 기반 · 상담 미반영</p>
   <h2>학생부 분석 보고서</h2>
   <p>{{student.academic_year}}학년도 · {{student.school_stage==='middle'?'중학교':'고등학교'}} {{student.grade}}학년 · {{student.student_number}} {{student.name}}</p>
   <small>분석일 {{analysis.created_at.slice(0,10)||date}} · 교사 검토용</small>
   <p v-if="synthetic" class="report-note">합성자료 시연입니다. 실제 학생 기록이나 교사의 확인 결과가 아닙니다.</p>
   <p v-if="imported" class="report-note">가져온 미검증 참고 자료입니다. 원본 학생부와 대조해 주세요.</p>
  </header>
  <section class="analysis-report-summary"><h3>종합 분석</h3><ResultText :text="analysis.summary"/></section>
  <section v-if="analysis.strengths.length"><h3>핵심 강점과 활용 방향</h3><div v-for="(finding,index) in analysis.strengths" :key="index" class="analysis-report-finding"><h4>{{index+1}}. {{finding.text}}</h4><ResultText v-if="finding.guidance" :text="finding.guidance"/><small v-if="finding.evidence_ids.length">{{location(finding.evidence_ids)}}</small></div></section>
  <section v-if="analysis.improvements.length"><h3>보완할 점과 필요한 도움</h3><div v-for="(finding,index) in analysis.improvements" :key="index" class="analysis-report-finding"><h4>{{finding.text}}</h4><ResultText v-if="finding.guidance" :text="finding.guidance"/><small v-if="finding.evidence_ids.length">{{location(finding.evidence_ids)}}</small></div></section>
  <section v-if="analysis.actions.length"><h3>{{analysis.actions.length===1?'우선 검토할 활동':'검토할 활동 후보'}}</h3><p class="report-note">학생의 관심·수업 범위·가용 시간을 확인한 뒤 적용할 제안입니다.</p><div v-for="(action,index) in analysis.actions" :key="index" class="analysis-report-finding"><ResultText :text="action.text"/><p v-if="action.reason" class="report-reason">{{action.reason}}</p><small v-if="action.evidence_ids.length">{{location(action.evidence_ids)}}</small></div></section>
  <section v-if="analysis.questions.length"><h3>함께 확인할 질문</h3><ol><li v-for="(question,index) in analysis.questions" :key="index"><ResultText :text="question"/></li></ol></section>
  <details v-if="findings.length" class="analysis-report-evidence"><summary>판단의 근거와 원문 인용</summary><div v-for="finding in findings" :key="finding.key" class="analysis-report-finding"><h4>{{finding.label}} · {{finding.text}}</h4><blockquote v-if="finding.quote"><ResultText :text="finding.quote"/></blockquote><small>{{location(finding.evidence_ids)||'원문 대조 필요'}}</small></div></details>
  <section v-if="limitations.length" class="analysis-report-scope"><h3>자료 범위와 확인할 점</h3><p class="report-note">학생부 {{record.page_count}}쪽 중 {{record.readable_pages.length}}쪽 판독 · {{analysis.model}}</p><ul><li v-for="(limitation,index) in limitations" :key="index">{{limitation}}</li></ul></section>
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
