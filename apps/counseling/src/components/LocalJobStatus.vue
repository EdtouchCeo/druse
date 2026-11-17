<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref} from 'vue'
import type {Job} from '../lib/types'
import {interviewRequest} from '../lib/interview'
import {readableError} from '../lib/model'

type SavedStep={kind:string;session_id:string;model:string;completed:number;compatible:boolean;updated_at:string}
const props=defineProps<{caseId:string;sessionId:string;token:string;busy:boolean;dirty:boolean;tracking:string}>()
const emit=defineEmits<{recover:[job:Job];resume:[value:SavedStep]}>()
const jobs=ref<Job[]>([]),saved=ref<SavedStep[]>([]),error=ref(''),checking=ref(false)
const active=computed(()=>jobs.value.find(j=>['queued','running'].includes(j.state)))
const remaining=computed(()=>saved.value.filter(s=>s.session_id===props.sessionId&&s.completed>0))
const labels:Record<string,string>={analyze:'학생부 분석','refine-record':'학생부 항목 검토','interview-questions':'면접 질문 생성','interview-precheck':'전사본 사전 검토','interview-report':'종합 면접 보고서'}
const controller=new AbortController();let timer:ReturnType<typeof setTimeout>,attempted=''
async function refresh(){
 if(checking.value||controller.signal.aborted)return
 checking.value=true
 try{const value=await interviewRequest<{jobs:Job[];checkpoints:SavedStep[]}>('/cases/'+encodeURIComponent(props.caseId)+'/jobs',props.token,undefined,AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]));jobs.value=value.jobs;saved.value=value.checkpoints;error.value='';const job=active.value;if(job&&!props.busy&&!props.dirty&&props.tracking!==job.id&&attempted!==job.id)recover(job)}
 catch(e){if(!controller.signal.aborted)error.value=readableError(e)}
 finally{checking.value=false}
}
async function tick(){await refresh();if(!controller.signal.aborted)timer=setTimeout(tick,2000)}
function recover(job:Job){attempted=job.id;emit('recover',job)}
async function cancel(){if(!active.value)return;try{await interviewRequest('/jobs/'+encodeURIComponent(active.value.id)+'/cancel',props.token,{});await refresh()}catch(e){error.value=readableError(e)}}
onMounted(tick)
onBeforeUnmount(()=>{controller.abort();clearTimeout(timer)})
</script>

<template>
 <section class="local-job-status" aria-label="분석 작업 상태">
  <div class="status-heading"><strong>분석 작업 상태</strong><button class="text-button" :disabled="checking" @click="refresh">진행 상태 확인</button></div>
  <p v-if="error" role="alert">작업 상태를 확인하지 못했습니다. {{error}} 실행기를 확인한 뒤 ‘진행 상태 확인’을 눌러 주세요.</p>
  <div v-if="active" role="status" aria-live="polite">
   <p><strong>{{labels[active.kind||'']||'AI 작업'}} 진행 중</strong> · {{active.message}}</p>
   <p v-if="active.checkpoint?.completed">검증 완료 {{active.checkpoint.completed}}구간 저장<span v-if="active.checkpoint.reused"> · {{active.checkpoint.reused}}구간 재사용</span></p>
   <p v-if="active.checkpoint?.checkpoint_available===false">모델 파일 정보를 확인하지 못해 이번 작업의 중간 저장은 사용할 수 없습니다.</p>
   <p class="status-note" v-if="active.updated_at">최근 단계 갱신 {{new Date(active.updated_at).toLocaleTimeString('ko-KR')}} · 모델 응답 중에는 같은 단계가 오래 표시될 수 있습니다.</p>
   <button v-if="tracking!==active.id" class="secondary compact" :disabled="busy||dirty" @click="recover(active)">진행 상태 다시 연결</button>
   <button class="secondary compact" @click="cancel">진행 중인 분석 취소</button>
  </div>
  <template v-else>
   <p v-if="!error&&!remaining.length" class="status-note">이 학생의 진행 중인 분석이 없습니다.</p>
   <div v-for="item in remaining" :key="item.kind" class="checkpoint-row">
    <p><strong>{{labels[item.kind]||item.kind}}</strong> · 검증 완료 {{item.completed}}구간 저장 · {{item.model}}</p>
    <template v-if="item.compatible"><p class="status-note">같은 자료·모델이면 저장한 구간을 재사용합니다. 생성 중이던 구간은 다시 처리합니다.</p><button class="primary compact" :disabled="busy||dirty" @click="emit('resume',item)">저장 구간부터 이어서 분석</button></template>
    <p v-else class="status-note">자료나 분석 기준이 바뀌어 이전 중간 결과를 재사용하지 않습니다. 현재 자료로 분석을 실행하세요.</p>
   </div>
   <p v-if="dirty&&remaining.length" class="status-note">편집 내용을 먼저 저장해 주세요.</p>
  </template>
 </section>
</template>

<style scoped>
.local-job-status{margin:12px 24px;padding:12px 18px;border:1px solid #cbd9ed;border-radius:10px;background:#f5f8fd;color:#263f68;font-size:14px;overflow-wrap:anywhere}
.status-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.local-job-status p{margin:8px 0}.local-job-status button{margin:4px 8px 4px 0}.status-note{font-size:12px;color:#53637a}.checkpoint-row+.checkpoint-row{border-top:1px solid #cbd9ed;margin-top:12px;padding-top:8px}
@media(max-width:600px){.local-job-status{margin:10px;padding:12px}.status-heading{flex-wrap:wrap}}
</style>
