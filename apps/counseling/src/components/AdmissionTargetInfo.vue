<script setup lang="ts">
import {computed} from 'vue'
import {getAdmissionContext,type AdmissionRoute,type TargetAdvice} from '../lib/admissions'
import type {StudentProfile} from '../lib/types'
const props=defineProps<{profile:StudentProfile}>()
const targets=computed(()=>getAdmissionContext({admission_targets:(props.profile.admission_targets||[]).map(row=>({...row,admission_type:'학생부종합',admission_name:''}))}).targets.filter(row=>row.requested.university.trim()))
const requestedLabel=(row:TargetAdvice)=>[row.requested.major,row.requested.admission_type,row.requested.admission_name,row.requested.admission_year?row.requested.admission_year+'학년도 대입':''].filter(Boolean).join(' · ')
function routeSections(route:AdmissionRoute){return [
 {label:'선발 방법',lines:route.selection},
 {label:'서류 평가',lines:route.assessment},
 {label:'면접',lines:route.interview},
 {label:'수능 반영·최저 기준',lines:route.csat},
 {label:'과목 선택·권장 과목',lines:route.courses},
 {label:'지원자격',lines:route.eligibility?[route.eligibility]:[]},
 {label:'모집단위별 조건·예외',lines:route.exceptions},
].map(section=>({...section,lines:section.lines.filter(line=>!/^확인\s*범위\s*[:：]\s*없음\s*$/.test(line.trim()))})).filter(section=>section.lines.length)}
function safeUrl(value:string){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:''}catch{return ''}}
</script>
<template>
 <section v-if="targets.length" class="admission-information" aria-label="희망 대학별 입학·전공 안내">
  <h3>희망 대학별 입학·전공 안내</h3>
  <p class="help">입력한 대학의 자료를 펼쳐 전형과 준비 방향을 확인하세요.</p>
  <details v-for="(target,index) in targets" :key="index" class="admission-info" :data-admission-info="target.requested.university">
   <summary><strong>{{target.university}}</strong><span v-if="requestedLabel(target)" class="requested-choice">{{requestedLabel(target)}}</span><span class="reference-status">{{target.reference_status}}</span></summary>
   <div class="admission-info-body">
    <p v-if="target.match_status==='overview'" class="help">대학이 공개한 학종 유형입니다. 모집단위에 적용되는 세부 조건은 공식 자료와 대조합니다.</p>
    <ul v-if="target.match_status==='overview'&&target.elements.length" class="route-options"><li v-for="route in target.elements" :key="route.id"><strong>{{route.name}}</strong><span>{{[route.round,route.type,route.groups].filter(Boolean).join(' · ')}}</span></li></ul>
    <section v-for="route in target.match_status==='overview'?[]:target.elements" :key="route.id" class="admission-route">
     <h4>{{route.name}}</h4><p class="route-scope">{{[route.round,route.type,route.groups].filter(Boolean).join(' · ')}}</p>
     <div v-for="section in routeSections(route)" :key="section.label" class="route-detail"><h5>{{section.label}}</h5><ul><li v-for="(line,i) in section.lines" :key="i">{{line}}</li></ul></div>
    </section>
    <section v-if="target.course_recommendations.length" class="admission-route"><h4>과목 선택 참고</h4><ul><li v-for="(line,i) in target.course_recommendations" :key="i">{{line}}</li></ul></section>
    <section v-if="target.preparation_focus.length" class="admission-route"><h4>학생이 준비할 방향</h4><ul><li v-for="(line,i) in target.preparation_focus" :key="i">{{line}}</li></ul></section>
    <ul v-if="target.notes.length" class="admission-notes"><li v-for="(line,i) in target.notes" :key="i">{{line}}</li></ul>
    <div class="admission-sources"><p v-if="target.source_title"><a v-if="safeUrl(target.source_url)" :href="safeUrl(target.source_url)" target="_blank" rel="noopener noreferrer">{{target.source_title}}</a><span v-else>{{target.source_title}}</span><small v-if="target.reviewed_on">자료 확인일 {{target.reviewed_on}}</small></p>
     <div v-for="link in target.links" :key="link.name" class="admission-links"><span>{{link.name}}</span><a v-if="safeUrl(link.admission_url)" :href="safeUrl(link.admission_url)" target="_blank" rel="noopener noreferrer">입학처</a><a v-if="safeUrl(link.major_url)" :href="safeUrl(link.major_url)" target="_blank" rel="noopener noreferrer">전공 안내 자료</a></div>
    </div>
   </div>
  </details>
 </section>
</template>
<style scoped>
.admission-information{margin:24px 0 8px;min-width:0}.admission-information>h3{font-size:17px;margin:0 0 8px}.admission-information>.help{margin:0 0 14px}.admission-info{min-width:0;border:1px solid var(--border);border-radius:10px;margin:12px 0;background:var(--card)}.admission-info>summary{cursor:pointer;padding:16px 18px;color:var(--foreground);line-height:1.8;overflow-wrap:anywhere}.admission-info>summary>strong{font-size:16px}.requested-choice,.reference-status{display:block;margin-left:18px;font-size:13px}.requested-choice{color:var(--muted)}.reference-status{color:#36577e;margin-top:3px}.admission-info-body{padding:0 18px 18px;font-size:14px;line-height:1.9;overflow-wrap:anywhere}.admission-info-body ul{margin:8px 0;padding-left:20px}.admission-info-body li{margin:5px 0;white-space:pre-wrap}.route-options span{display:block;color:var(--muted);font-size:13px}.admission-route{padding:16px 0;border-top:1px solid var(--border)}.admission-route h4{margin:0 0 8px;font-size:16px;color:#214574}.route-scope{color:var(--muted);font-size:13px;margin:0 0 12px}.route-detail h5{font-size:14px;margin:16px 0 5px}.admission-notes{color:var(--muted);font-size:13px}.admission-sources{padding-top:14px;border-top:1px solid var(--border);font-size:13px}.admission-sources p{margin:0 0 12px}.admission-sources small{display:block;color:var(--muted);margin-top:5px}.admission-links{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:10px}.admission-links span{flex-basis:100%;color:var(--muted)}.admission-sources a{color:var(--brand);text-underline-offset:3px}@media(max-width:760px){.admission-info>summary{padding:14px}.admission-info-body{padding:0 14px 14px}.requested-choice,.reference-status{margin-left:0}}
</style>
