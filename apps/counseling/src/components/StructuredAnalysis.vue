<script setup lang="ts">
import {computed} from 'vue'
import type {Analysis,SchoolRecord} from '../lib/types'
import {groupedFindings,evidenceLocation,findingArea} from '../lib/analysisPresentation'
import ResultText from './ResultText.vue'
const props=defineProps<{analysis:Analysis;record?:SchoolRecord|null;interactive?:boolean;locked?:boolean}>()
const emit=defineEmits<{evidence:[id:string];adopt:[text:string]}>()
const groups=computed(()=>groupedFindings(props.analysis,props.record))
</script>
<template>
 <div class="structured-analysis">
  <section class="analysis-synthesis"><h3>종합 분석</h3><ResultText :text="analysis.summary"/></section>
  <section v-if="groups.length" class="analysis-domains"><h3>영역별 강점과 지원 방향</h3>
   <article v-for="group in groups" :key="group.area" class="analysis-domain">
    <h4>{{group.area}} 영역</h4>
    <div class="analysis-domain-columns" :class="{'single-column':!group.strengths.length||!group.improvements.length}">
     <section v-for="kind in (['strengths','improvements'] as const).filter(key=>group[key].length)" :key="kind">
      <h5>{{kind==='strengths'?'강점과 이어 갈 방향':'보완을 위해 필요한 도움'}}</h5>
      <div v-for="(finding,index) in group[kind]" :key="index" class="analysis-finding">
       <strong><ResultText :text="finding.text"/></strong>
       <dl><template v-if="interactive"><dt>원문 근거</dt><dd><blockquote v-if="finding.quote">{{finding.quote}}</blockquote><p v-else class="analysis-note">저장된 인용이 없습니다. 연결된 원문을 확인해 주세요.</p>
        <template v-for="id in finding.evidence_ids" :key="id"><button v-if="interactive" class="text-button evidence-location" @click="emit('evidence',id)">{{evidenceLocation(id,record)}}</button><small v-else class="evidence-location">{{evidenceLocation(id,record)}}</small></template>
        <small v-if="!finding.evidence_ids.length">원문 위치 확인 필요</small>
       </dd></template><dt>{{kind==='strengths'?'앞으로 이어 갈 방향':'필요한 도움'}}</dt><dd><ResultText :text="finding.guidance||'구체적인 지도 방향은 학생과 확인해 정합니다.'"/></dd></dl>
      </div>
     </section>
    </div>
   </article>
  </section>
  <section v-if="analysis.actions.length" class="analysis-action-section"><h3>추천 탐구·준비 방향</h3>
   <div v-if="analysis.actions.length" class="analysis-table-wrap" tabindex="0" role="region" aria-label="추천 탐구·준비 방향 표">
    <table class="analysis-action-table"><caption class="sr-only">영역별 준비 방향과 근거, 필요한 자료와 기대하는 배움</caption><thead><tr><th scope="col">영역·준비 방향</th><th scope="col">제안 이유·근거</th><th scope="col">준비할 자료·발전 방향</th><th scope="col">필요한 도움</th></tr></thead><tbody>
     <tr v-for="(action,index) in analysis.actions" :key="index"><th scope="row"><span class="analysis-area-label">{{findingArea(action,record)}}</span><ResultText :text="action.text"/><button v-if="interactive" class="secondary compact" :disabled="locked" @click="emit('adopt',[action.text,action.expected_output?'산출물: '+action.expected_output:'',action.review_criteria?'발전시킬 관점: '+action.review_criteria:'',action.teacher_support?'교사 도움: '+action.teacher_support:''].filter(Boolean).join('\n'))">탐구·준비 방향에 담기</button></th>
      <td><ResultText :text="action.reason"/><template v-if="interactive"><button v-for="id in action.evidence_ids" :key="id" class="text-button evidence-location" @click="emit('evidence',id)">{{evidenceLocation(id,record)}}</button></template></td>
      <td><strong>산출물</strong><ResultText :text="action.expected_output||'학생과 함께 정할 항목'"/><strong>발전시킬 관점</strong><ResultText :text="action.review_criteria||'학생과 함께 정할 항목'"/></td><td><ResultText :text="action.teacher_support||'필요한 도움을 학생과 확인합니다.'"/></td></tr>
    </tbody></table>
   </div><p v-else class="analysis-note">제공된 근거에서 추가로 제안할 준비 방향이 없습니다.</p>
  </section>
  <section v-if="interactive&&analysis.questions.length"><h3>함께 확인할 질문</h3><ol><li v-for="(question,index) in analysis.questions" :key="index"><ResultText :text="question"/></li></ol></section>
 </div>
</template>
<style scoped>
.structured-analysis{min-width:0;color:#17212e;overflow-wrap:anywhere}.structured-analysis>section{margin:0 0 28px}.structured-analysis h3{font-size:21px;line-height:1.5;color:#18375f;margin:0 0 12px}.analysis-synthesis{padding:22px;background:#f2f6fc;border-left:4px solid #2a5298}.analysis-note{font-size:14px;color:#526175;line-height:1.8;margin:8px 0 16px}.analysis-domain{border:1px solid #d8e2ef;border-radius:12px;overflow:hidden;margin:18px 0}.analysis-domain h4{font-size:18px;margin:0;padding:14px 20px;background:#eaf1fb;color:#244b81}.analysis-domain-columns{display:grid;grid-template-columns:1fr 1fr}.analysis-domain-columns>section{min-width:0;padding:20px}.analysis-domain-columns>section+section{border-left:1px solid #d8e2ef}.analysis-domain h5{font-size:16px;margin:0 0 18px;color:#244b81}.analysis-finding+.analysis-finding{margin-top:22px;padding-top:20px;border-top:1px solid #e2e8f0}.analysis-finding>strong{display:block;font-size:16px;line-height:1.8}.analysis-finding dl{margin:16px 0 0}.analysis-finding dt{font-size:13px;font-weight:700;color:#526175;margin-top:14px}.analysis-finding dd{margin:6px 0 0}.analysis-finding blockquote{margin:0 0 8px;padding:12px;background:#f8fafc;border-left:3px solid #b5c9e3;font-size:14px;line-height:1.8;white-space:pre-wrap}.evidence-location{display:block!important;white-space:normal!important;text-align:left;line-height:1.7;font-size:12px;color:#365b88;margin:5px 0}.analysis-table-wrap{max-width:100%;overflow-x:auto;border:1px solid #d8e2ef;border-radius:10px}.analysis-action-table{width:100%;min-width:650px;border-collapse:collapse;table-layout:fixed}.analysis-action-table th,.analysis-action-table td{padding:16px;text-align:left;vertical-align:top;border-bottom:1px solid #d8e2ef;border-right:1px solid #d8e2ef;font-size:14px;font-weight:400;line-height:1.8}.analysis-action-table thead th{background:#eaf1fb;color:#244b81;font-weight:700}.analysis-action-table th:first-child{width:29%}.analysis-action-table td>strong{font-size:12px;color:#526175}.analysis-area-label{display:block;color:#2a5298;font-weight:700;margin-bottom:8px}.analysis-action-table button.secondary{margin-top:12px}.structured-analysis :deep(.result-prose p){font-size:15px;line-height:1.85;margin:0 0 8px;word-break:keep-all;overflow-wrap:anywhere}.structured-analysis ol{padding-left:24px}.structured-analysis li{padding:5px 0}@media(max-width:760px){.analysis-domain-columns{grid-template-columns:1fr}.analysis-domain-columns>section+section{border-left:0;border-top:1px solid #d8e2ef}.analysis-domain-columns>section{padding:16px}.analysis-synthesis{padding:16px}}
</style>
