<script setup lang="ts">
import {computed} from 'vue'
import {Download,FileText,Trash2,X} from 'lucide-vue-next'
import type {CounselingCase,ReportAudience} from '../lib/types'
import {analysisReportIssue} from '../lib/reports'
import {finalizationIssues} from '../lib/workflow'
const props=defineProps<{kind:'download'|'delete';value:CounselingCase;sessionId:string;local:boolean;busy:boolean;loaded:boolean;error:string;conflict:boolean;hasDraft:boolean;acknowledged:boolean}>()
const emit=defineEmits<{close:[];reload:[];download:[kind:ReportAudience|'backup'];draftBackup:[];delete:[];'update:sessionId':[value:string];'update:acknowledged':[value:boolean]}>()
const session=computed(()=>props.value.sessions.find(item=>item.id===props.sessionId))
const analysisIssue=computed(()=>analysisReportIssue(session.value))
const studentIssue=computed(()=>!session.value?'회차를 선택해 주세요.':finalizationIssues(session.value)[0]||((props.local||session.value.workflow_version===2)&&!session.value.confirmed?'교사 확정 후 학생 안내 PDF를 저장할 수 있습니다.':''))
const unavailable=computed(()=>props.busy||!props.loaded)
</script>

<template>
<div class="modal-backdrop" @click.self="!busy&&emit('close')"><section class="modal case-actions-dialog" role="dialog" aria-modal="true" tabindex="-1" :aria-label="kind==='delete'?'전략 삭제 확인':'전략 다운로드'">
 <header><h2>{{kind==='delete'?'전략 삭제 확인':'전략 다운로드'}}</h2><button class="icon-button" aria-label="닫기" :disabled="busy" @click="emit('close')"><X :size="20"/></button></header>
 <div class="case-action-summary"><strong>{{value.student.student_number}} {{value.student.name}}</strong><span>{{value.student.academic_year}}학년도 · 총 {{value.sessions.length}}회차</span></div>
 <template v-if="kind==='download'">
  <p>저장된 기록을 내려받습니다. PDF는 선택한 회차를, 백업은 모든 회차를 포함합니다.</p>
  <label>다운로드할 회차<select aria-label="다운로드할 회차" :value="sessionId" :disabled="unavailable" @change="emit('update:sessionId',($event.target as HTMLSelectElement).value)"><option v-for="(item,index) in value.sessions" :key="item.id" :value="item.id">{{index+1}}회차 · {{item.date}}{{item.topic?' · '+item.topic:''}}</option></select></label>
  <div class="case-download-options">
   <div v-if="local"><button class="secondary" :disabled="unavailable||!!analysisIssue" @click="emit('download','analysis')"><FileText :size="18"/>학생부 분석 PDF</button><small>{{analysisIssue||'학생부 분석만으로 정리한 보고서'}}</small></div>
   <div><button class="secondary" :disabled="unavailable||!!studentIssue" @click="emit('download','student')"><FileText :size="18"/>학생 안내 PDF</button><small>{{studentIssue||'학생에게 전달할 학습·진로 전략'}}</small></div>
   <div><button class="secondary" :disabled="unavailable||!session" @click="emit('download','teacher')"><FileText :size="18"/>교사 검토용 PDF</button><small>교사 기록과 검토 내용을 포함한 보고서</small></div>
   <div><button class="secondary" :disabled="unavailable" @click="emit('download','backup')"><Download :size="18"/>전략 백업(JSON)</button><small>모든 회차의 저장 기록 · 전략 백업 가져오기로 복원</small></div>
  </div>
  <p v-if="!local" class="help">PDF 버튼을 누르면 새 창이 열립니다. 인쇄 화면에서 PDF로 저장하세요.</p>
 </template>
 <template v-else>
  <p>이 전략의 <strong>모든 회차와 상담·분석 기록</strong>, 수정 이력을 삭제합니다. 학생에게 안내한 전략도 함께 삭제됩니다.</p>
  <p class="inline-note warning">삭제한 기록은 되돌릴 수 없습니다. 필요하면 먼저 백업을 내려받으세요.</p>
  <button class="secondary" :disabled="unavailable" @click="emit('download','backup')"><Download :size="17"/>백업 다운로드</button>
  <p class="help">학생 계정과 담당 배정은 유지됩니다. {{local?'PC에 보관된 원본 PDF와 이미 내려받은 파일은 별도로 남습니다.':'이미 내려받은 파일은 남습니다.'}}</p>
 </template>
 <div v-if="hasDraft" class="inline-note warning case-action-draft"><p>{{kind==='delete'?'현재 이 전략에 저장하지 않은 내용이 있습니다. 삭제하면 작성 중인 내용도 사라집니다.':'현재 이 전략에 저장하지 않은 내용이 있습니다. 위 파일에는 마지막으로 저장한 내용이 담깁니다.'}}</p><button class="secondary compact" :disabled="busy" @click="emit('draftBackup')">작성 중 내용 백업</button></div>
 <label v-if="kind==='delete'" class="check-label"><input :checked="acknowledged" type="checkbox" :disabled="unavailable" @change="emit('update:acknowledged',($event.target as HTMLInputElement).checked)">이 전략의 모든 회차와 상담·분석 기록을 삭제하겠습니다.</label>
 <p v-if="error" class="inline-note warning" role="alert">{{conflict?'다른 창에서 이 전략이 변경되었습니다. 최신 기록을 다시 확인한 뒤 진행해 주세요.':error}}</p>
 <button v-if="!loaded&&!busy" class="secondary" @click="emit('reload')">최신 기록 다시 확인</button>
 <p v-if="busy" class="help" role="status">처리 중입니다.</p>
 <div class="modal-actions"><button class="secondary" :disabled="busy" @click="emit('close')">{{kind==='delete'?'취소':'닫기'}}</button><button v-if="kind==='delete'" class="danger-button" :disabled="unavailable||!acknowledged" @click="emit('delete')"><Trash2 :size="17"/>전략 삭제</button></div>
</section></div>
</template>
