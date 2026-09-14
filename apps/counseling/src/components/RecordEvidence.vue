<script setup lang="ts">
import {computed,nextTick,ref} from 'vue'
import type {RecordMetadata,RecordSection} from '../lib/types'
const props=defineProps<{section:RecordSection;locked:boolean;highlight:boolean;save:(metadata:RecordMetadata)=>Promise<boolean>}>()
const details=ref<HTMLDetailsElement|null>(null),periodButton=ref<HTMLButtonElement|null>(null),yearInput=ref<HTMLInputElement|null>(null)
const editing=ref(false),saving=ref(false)
const year=ref<number|''>(''),grade=ref<number|''>(''),semester=ref<number|''>(''),stage=ref<RecordMetadata['school_stage']>('unknown')
const grades=computed(()=>stage.value==='unknown'?[1,2,3,4,5,6]:[1,2,3])
const statuses={present:'내용 있음',empty:'빈칸 확인',not_applicable:'해당 없음',uncertain:'판독 확인 필요'}
async function edit(){
 if(props.locked)return
 year.value=props.section.academic_year??'';grade.value=props.section.grade??'';semester.value=props.section.semester??''
 stage.value=['middle','high'].includes(props.section.school_stage)?props.section.school_stage as 'middle'|'high':'unknown'
 editing.value=true;if(details.value)details.value.open=true
 await nextTick();yearInput.value?.focus()
}
function changeStage(){if(grade.value&&!grades.value.includes(grade.value))grade.value=''}
async function close(){editing.value=false;await nextTick();periodButton.value?.focus()}
async function submit(){
 if(props.locked||saving.value)return
 saving.value=true
 try{if(await props.save({academic_year:year.value===''?null:Number(year.value),grade:grade.value===''?null:Number(grade.value),semester:semester.value===''?null:Number(semester.value),school_stage:stage.value}))await close()}
 finally{saving.value=false}
}
</script>
<template>
 <details ref="details" :id="'evidence-'+section.id" class="evidence" :class="{highlight}">
  <summary><span class="evidence-summary-copy"><strong>{{section.label}}</strong><span class="record-period-row"><button ref="periodButton" type="button" class="record-period" :aria-label="section.label+' 학년도·학년 수정'" :disabled="locked" @click.stop.prevent="edit">{{section.academic_year?section.academic_year+'학년도':'학년도 확인 필요'}} · {{section.grade?section.grade+'학년':'학년 확인 필요'}}{{section.semester?' · '+section.semester+'학기':''}}</button><small> · {{section.pages.join(', ')}}쪽<span v-if="section.metadata_confirmation"> · 교사 확인값</span></small></span></span><span class="badge" :class="{warning:section.status==='uncertain',success:section.status==='present'}">{{statuses[section.status]}}</span></summary>
  <form v-if="editing" class="record-metadata" @submit.prevent="submit" @keydown.esc.stop.prevent="!saving&&!locked&&close()">
   <fieldset :disabled="locked||saving"><legend>이 항목의 학년도·학년</legend><div class="record-metadata-fields">
    <label>학년도<input ref="yearInput" v-model="year" type="number" min="1900" max="2100" step="1" placeholder="예: 2025"></label>
    <label>학교급<select v-model="stage" @change="changeStage"><option value="unknown">확인 필요</option><option value="middle">중학교</option><option value="high">고등학교</option></select></label>
    <label>학년<select v-model="grade"><option value="">확인 필요</option><option v-for="value in grades" :key="value" :value="value">{{value}}학년</option></select></label>
    <label>학기<select v-model="semester"><option value="">확인 필요</option><option :value="1">1학기</option><option :value="2">2학기</option></select></label>
   </div><p class="help">원래 PDF의 이 항목을 확인해 입력하세요. 수정하면 이전 분석·문체 검토를 다시 진행합니다.</p><div class="button-row"><button class="primary" type="submit">원문 확인 후 저장</button><button class="secondary" type="button" @click="close">취소</button></div></fieldset>
  </form>
  <div class="evidence-text"><p>{{section.text||'추출된 본문이 없습니다. 원래 PDF의 해당 페이지를 확인해 주세요.'}}</p><small>PDF에서 추출한 근거입니다. 판독이 불확실한 부분은 원래 파일과 대조해 주세요.</small></div>
 </details>
</template>
