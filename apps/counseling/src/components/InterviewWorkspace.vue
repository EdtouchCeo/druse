<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import type {CounselingCase,Health,Job} from '../lib/types'
import {download,readableError} from '../lib/model'
import {interviewRequest,interviewDownload,interviewTopics,transcriptBase64,type InterviewWorkspace,type InterviewReport} from '../lib/interview'

const props=defineProps<{value:CounselingCase;sessionId:string;health:Health;active:boolean;parentDirty:boolean}>()
const emit=defineEmits<{dirty:[value:boolean];busy:[value:string];record:[]}>()
const workspace=ref<InterviewWorkspace|null>(null),step=ref<'questions'|'transcript'|'report'>('questions')
const busy=ref(''),error=ref(''),notice=ref(''),job=ref<Job|null>(null),dirty=ref(false),editScope=ref('')
const model=ref(props.health.ollama.models[0]?.name||''),notes=ref(''),selected=ref<string[]>([]),sourceChecked=ref(false)
const paste=ref(''),selectedReportId=ref(''),acknowledged=ref(false),transcriptFile=ref<HTMLInputElement|null>(null),backupFile=ref<HTMLInputElement|null>(null)
const selectedReport=computed(()=>workspace.value?.reports.find(r=>r.id===selectedReportId.value)||null)
const session=computed(()=>props.value.sessions.find(s=>s.id===props.sessionId))
const records=computed(()=>session.value?.record?.sections.filter(r=>r.status==='present'&&r.text)||[])
const base=computed(()=>'/cases/'+encodeURIComponent(props.value.id)+'/interview')
const query=computed(()=>'?session_id='+encodeURIComponent(props.sessionId))
const csrf=computed(()=>props.health.csrf_token||'')
const canGenerate=computed(()=>!busy.value&&!dirty.value&&!props.parentDirty&&Boolean(model.value)&&props.health.ollama.available)
const reviewReady=computed(()=>workspace.value?.precheck_current&&workspace.value.transcript?.utterances.some(u=>u.speaker==='student'&&u.status==='confirmed'))
let alive=true
const controller=new AbortController()
watch([dirty,paste],()=>emit('dirty',dirty.value||Boolean(paste.value.trim())))
watch(busy,v=>emit('busy',v))
function changed(scope:string){dirty.value=true;editScope.value=scope;acknowledged.value=false}
function textChanged(event:Event,scope:string){const input=event.target as HTMLInputElement;if(input.type!=='checkbox'&&input.tagName!=='SELECT')changed(scope)}
function otherEdit(scope:string){return dirty.value&&editScope.value!==scope}
function adopt(value:InterviewWorkspace){workspace.value=value;notes.value=value.notes;selected.value=[...value.selected_records];sourceChecked.value=value.record_current;dirty.value=false;editScope.value='';acknowledged.value=false;if(!value.reports.some(r=>r.id===selectedReportId.value))selectedReportId.value=value.reports.at(-1)?.id||''}
async function request<T>(path:string,body?:unknown){return interviewRequest<T>(path,csrf.value,body,controller.signal)}
async function refresh(){const result=await request<{workspace:InterviewWorkspace;job:Job|null}>(base.value+query.value);if(alive)adopt(result.workspace);return result.job}
async function perform(label:string,fn:()=>Promise<void>){if(busy.value)return;busy.value=label;error.value='';notice.value='';try{await fn()}catch(e){if(alive)error.value=readableError(e)}finally{if(alive)busy.value=''}}
async function load(){await perform('면접 자료를 불러오고 있습니다.',async()=>{const active=await refresh();if(active)await poll(active)})}
watch(()=>[props.active,props.value.revision],()=>{if(props.active&&!busy.value&&!dirty.value)void load()},{immediate:true})
onBeforeUnmount(()=>{alive=false;controller.abort();emit('dirty',false);emit('busy','')})
async function post(operation:string,payload:Record<string,unknown>={}){
 if(props.parentDirty)throw new Error('학생 기본자료의 변경을 먼저 저장해 주세요.')
 return request<{workspace?:InterviewWorkspace;job?:Job}>(base.value,{operation,session_id:props.sessionId,case_revision:props.value.revision,revision:workspace.value?.revision||0,...payload})
}
async function save(operation:string,payload:Record<string,unknown>){await perform('교사 검토 내용을 저장하고 있습니다.',async()=>{const result=await post(operation,payload);if(result.workspace)adopt(result.workspace);notice.value='저장했습니다.'})}
async function poll(initial:Job){
 job.value=initial
 try{
  while(alive&&job.value&&['queued','running'].includes(job.value.state)){
   await new Promise(resolve=>setTimeout(resolve,700))
   if(!alive)return
   const result=await request<{job:Job}>('/jobs/'+encodeURIComponent(initial.id));job.value=result.job
   busy.value=result.job.message||'로컬 분석을 진행하고 있습니다.'
  }
  const result=job.value
  await refresh()
  if(result?.state!=='succeeded'&&result?.state!=='cancelled')throw new Error(result?.message||'분석을 완료하지 못했습니다.')
  notice.value=result?.message||'완료했습니다.'
 }finally{job.value=null}
}
async function generate(operation:string){await perform('로컬 AI 작업을 준비하고 있습니다.',async()=>{const result=await post(operation,{model:model.value});if(result.job)await poll(result.job);if(operation==='generate-report')selectedReportId.value=workspace.value?.reports.at(-1)?.id||''})}
async function cancel(){if(job.value)await request('/jobs/'+encodeURIComponent(job.value.id)+'/cancel',{})}
async function upload(file:File){await perform('전사본을 읽고 있습니다.',async()=>{if(file.size>2*1024*1024)throw new Error('전사본은 2MB 이하로 올려 주세요.');const result=await post('transcript',{filename:file.name,file_base64:await transcriptBase64(file)});if(result.workspace)adopt(result.workspace);paste.value='';step.value='transcript';notice.value='전사본을 등록했습니다. AI 사전 검토를 실행해 주세요.'})}
function fileSelected(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];if(file)void upload(file);input.value=''}
async function uploadPaste(){await upload(new File([paste.value],'전사본.txt',{type:'text/plain'}))}
function saveConfiguration(){void save('configure',{selected_records:selected.value,notes:notes.value,source_checked:sourceChecked.value})}
function saveQuestions(){void save('questions',{questions:workspace.value?.questions.map(q=>({id:q.id,question:q.question,status:q.status}))})}
function saveReview(){void save('review',{utterances:workspace.value?.transcript?.utterances.map(u=>({id:u.id,text:u.text,speaker:u.speaker,status:u.status,reason:u.reason}))})}
function saveReport(){const report=selectedReport.value;if(report)void save('report-edit',{report_id:report.id,sections:report.edited_sections,teacher_opinion:report.teacher_opinion})}
function confirmReport(){if(selectedReport.value)void save('report-confirm',{report_id:selectedReport.value.id,acknowledged:acknowledged.value})}
async function copyReport(){if(selectedReport.value){await save('report-copy',{report_id:selectedReport.value.id});selectedReportId.value=workspace.value?.reports.at(-1)?.id||''}}
async function exportFile(kind:'pdf'|'docx'|'backup'|'questions'|'fixture'){
 await perform('면접 자료를 파일로 정리하고 있습니다.',async()=>{const report=selectedReport.value;if(['pdf','docx'].includes(kind)&&!report)return;const blob=await interviewDownload(base.value+query.value+'&format='+kind+(report?'&report_id='+encodeURIComponent(report.id):''));const suffix=kind==='backup'?'_면접_백업.json':kind==='questions'?'_면접질문지.pdf':kind==='fixture'?'_합성전사본.txt':'_종합면접보고서.'+kind;download(blob,(props.value.student.name||props.value.student.student_number||'학생')+suffix)})
}
async function restoreBackup(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file)return;await perform('면접 백업을 확인하고 있습니다.',async()=>{if(file.size>20*1024*1024)throw new Error('면접 백업은 20MB 이하로 선택해 주세요.');const bundle=JSON.parse(await file.text());if(!window.confirm('선택한 학생의 면접 백업을 복원할까요? 현재 전사본을 바꾸고 보고서는 미검증 사본으로 추가합니다. 기재·전사 검토를 다시 진행해야 합니다.'))return;const result=await post('restore',{bundle,acknowledged:true});if(result.workspace)adopt(result.workspace);notice.value='교사 편집 내용은 복원했습니다. 학생부 근거와 전사본을 다시 검토해 주세요.'})}
function evidenceLabel(id:string){const index=records.value.findIndex(r=>r.id===id);return index<0?id:'R'+String(index+1).padStart(2,'0')}
function chooseReport(event:Event){if(dirty.value){(event.target as HTMLSelectElement).value=selectedReportId.value;error.value='현재 편집 내용을 먼저 저장해 주세요.';return}selectedReportId.value=(event.target as HTMLSelectElement).value;acknowledged.value=false}
function reportRefs(report:InterviewReport,key:string){return report.statements.filter(s=>s.section===key).flatMap(s=>s.refs)}
async function discard(){if(window.confirm('저장하지 않은 면접 변경을 버리고 다시 불러올까요?')){dirty.value=false;paste.value='';await load()}}
</script>

<template>
 <section class="interview-workspace" aria-label="학생부 모의면접">
  <header class="card interview-heading"><div><span class="eyebrow">교사 전용 · 한 학생씩 분석</span><h2>학생부 모의면접</h2><p>질문 준비부터 전사본 검토, 학생 종합 보고서까지 이어서 작성합니다.</p></div><label>로컬 모델<select aria-label="로컬 모델" v-model="model" :disabled="!!busy"><option value="">모델 선택</option><option v-for="m in health.ollama.models" :key="m.name" :value="m.name">{{m.name}}</option></select></label></header>
  <p v-if="parentDirty" class="inline-note warning">학생 기본자료에 저장하지 않은 변경이 있습니다. 상단의 저장을 먼저 진행하세요.</p>
  <p v-if="error" class="inline-note warning" role="alert">{{error}}</p><p v-if="notice" class="inline-note success" role="status">{{notice}}</p>
  <div v-if="busy" class="inline-note" role="status"><span>{{busy}}</span><button v-if="job" class="secondary" @click="cancel">면접 분석 취소</button></div>
  <nav class="interview-steps" aria-label="모의면접 단계"><button :class="step==='questions'?'primary':'secondary'" :disabled="dirty||!!busy" @click="step='questions'">① 학생부·질문</button><button :class="step==='transcript'?'primary':'secondary'" :disabled="dirty||!!busy" @click="step='transcript'">② 전사본 검토</button><button :class="step==='report'?'primary':'secondary'" :disabled="dirty||!!busy" @click="step='report'">③ 종합 보고서</button></nav>
  <div class="interview-save-state"><span>{{dirty?'저장 전 변경 있음':'저장된 자료 기준'}}</span><button class="text-button" :disabled="!!busy" @click="dirty?discard():load()">{{dirty?'변경 버리고 다시 불러오기':'다시 불러오기'}}</button><button class="secondary" :disabled="!!busy||dirty||!workspace" @click="exportFile('backup')">면접 자료 백업</button><input ref="backupFile" class="visually-hidden" type="file" accept=".json" aria-label="면접 백업 파일" @change="restoreBackup"><button v-if="!health.demo" class="secondary" :disabled="!!busy||dirty||parentDirty" @click="backupFile?.click()">면접 백업 복원</button></div>
  <template v-if="workspace">
   <div v-show="step==='questions'">
    <section class="card"><h3>1. 학생부 근거와 학생의 설명</h3><p>원본을 대조한 기재를 선택하세요. 학생이 작성한 역할·개념·방법·성찰은 보충 설명에 옮깁니다.</p>
     <p v-if="!records.length" class="inline-note">학생부 PDF가 필요합니다. <button class="secondary" @click="emit('record')">학생부 PDF 등록으로 이동</button></p>
     <fieldset :disabled="!!busy||parentDirty||otherEdit('configure')" @input="textChanged($event,'configure')" @change="changed('configure')"><div class="record-selection"><details v-for="(r,index) in records" :key="r.id"><summary><label @click.stop><input v-model="selected" type="checkbox" :value="r.id">R{{String(index+1).padStart(2,'0')}} · {{r.label}} · {{r.pages.join(', ')}}쪽</label></summary><p class="original-text">{{r.text}}</p></details></div>
      <label>학생 보충 설명<textarea v-model="notes" rows="4" maxlength="6000" placeholder="학생이 직접 작성해 제출한 활동의 역할·개념·방법·성찰"></textarea></label><label class="check-label"><input v-model="sourceChecked" type="checkbox">선택한 기재를 학생부 원본과 대조했습니다.</label>
     </fieldset><button class="primary" :disabled="!!busy||parentDirty||!sourceChecked||!selected.length||otherEdit('configure')" @click="saveConfiguration">근거·보충 설명 저장</button>
    </section>
    <section class="card"><h3>2. 분석과 맞춤 질문</h3><div class="button-row"><button class="primary" :disabled="!canGenerate||!workspace.record_current" @click="generate('generate-questions')">AI 분석·질문 생성</button><button class="secondary" :disabled="!!busy||parentDirty||!workspace.questions_current||otherEdit('questions')" @click="saveQuestions">질문 검토 저장</button></div>
     <p v-if="workspace.questions.length&&!workspace.questions_current" class="inline-note warning">입력 자료가 바뀌었습니다. 현재 자료로 질문을 다시 생성하세요.</p>
     <details v-if="workspace.findings.length"><summary>학생부 분석 초안과 근거</summary><div v-for="(f,i) in workspace.findings" :key="i"><p>{{f.text}}</p><blockquote v-for="r in f.refs" :key="r.id+r.quote">{{evidenceLabel(r.id)}} · {{r.quote}}</blockquote></div></details>
     <fieldset :disabled="!!busy||parentDirty||!workspace.questions_current||otherEdit('questions')" @input="textChanged($event,'questions')" @change="changed('questions')"><article v-for="q in workspace.questions" :key="q.id" class="interview-item"><label>{{q.id}} 질문<textarea v-model="q.question" rows="2" maxlength="1500"></textarea></label><p>확인 목적: {{q.purpose}}</p><blockquote v-for="r in q.refs" :key="r.id+r.quote">{{evidenceLabel(r.id)}} · {{r.quote}}</blockquote><label>{{q.id}} 검토 상태<select v-model="q.status" :aria-label="q.id+' 검토 상태'"><option value="proposed">검토 대기</option><option value="accepted">면접에 사용</option><option value="excluded">보류</option></select></label></article></fieldset>
     <p v-if="!workspace.questions.length" class="help">질문마다 학생부 기재 근거를 붙입니다. 실제 기출 문항으로 표시하지 않습니다.</p><button class="secondary" :disabled="!!busy||dirty||!workspace.questions_current||!workspace.questions.some(q=>q.status==='accepted')" @click="exportFile('questions')">채택 질문지 PDF 저장</button>
    </section>
   </div>
   <div v-show="step==='transcript'">
    <section class="card"><h3>1. 면접 전사본 업로드</h3><p>별도 도구로 녹음·녹화하고 전사한 파일을 올립니다. 학생·회차가 맞는지 확인하세요.</p><p><strong>{{value.student.name||value.student.student_number}}</strong> · {{session?.date}} 회차</p>
     <input ref="transcriptFile" class="visually-hidden" type="file" accept=".txt,.docx,.srt,.vtt" aria-label="전사본 파일" @change="fileSelected"><button class="primary" :disabled="!!busy||dirty||parentDirty||!workspace.record_current" @click="transcriptFile?.click()">전사본 파일 선택</button><span class="help"> TXT·DOCX·SRT·VTT · 2MB 이하</span>
     <details><summary>전사 텍스트 붙여넣기</summary><label>전사본 내용<textarea v-model="paste" :disabled="!!busy" rows="5" placeholder="면접관: 어떤 역할을 맡았나요?&#10;학생: 측정표를 정리했습니다."></textarea></label><button class="secondary" :disabled="!!busy||dirty||parentDirty||!paste.trim()||!workspace.record_current" @click="uploadPaste">붙여넣은 전사본 등록</button></details>
     <button v-if="health.demo" class="secondary" :disabled="!!busy" @click="exportFile('fixture')">시연용 합성 전사본 받기</button><p v-if="workspace.transcript" class="help">현재 전사본: {{workspace.transcript.filename}}. 새 파일을 올리면 새 검토를 시작합니다. 이전 판본은 저장 이력에 보존됩니다.</p>
    </section>
    <section v-if="workspace.transcript" class="card"><h3>2. AI 사전 검토</h3><button class="primary" :disabled="!canGenerate||!workspace.record_current" @click="generate('precheck')">AI 전사본 사전 검토</button>
     <p v-if="workspace.precheck&&!workspace.precheck_current" class="inline-note warning">기재·질문·전사본이 바뀌었습니다. AI 사전 검토를 다시 실행해 주세요.</p>
     <template v-if="workspace.precheck_current&&workspace.precheck"><p v-if="!workspace.precheck.issues.length">AI가 별도 의심 사항을 제시하지 않았습니다. 교사가 화자·문답·내용을 확인하세요.</p><article v-for="(issue,i) in workspace.precheck.issues" :key="i" class="interview-item"><strong>{{issue.kind}}</strong><p>{{issue.message}}</p><blockquote v-for="r in issue.refs" :key="r.id+r.quote">{{r.id}} · {{r.quote}}</blockquote></article></template>
    </section>
    <section v-if="workspace.transcript" class="card"><h3>3. 교사의 전사본 검토</h3><p>전사 원본을 보존합니다. 확인하지 못한 발화는 검토 대기로 남기거나 이유를 적어 제외하세요.</p><fieldset :disabled="!!busy||parentDirty||!workspace.precheck_current||otherEdit('review')" @input="textChanged($event,'review')" @change="changed('review')">
     <article v-for="u in workspace.transcript.utterances" :key="u.id" class="interview-item"><div class="utterance-heading"><strong>{{u.id}} <small>{{u.timecode}}</small></strong><label>{{u.id}} 화자<select v-model="u.speaker" :aria-label="u.id+' 화자'"><option value="unknown">화자 미정</option><option value="interviewer">면접관</option><option value="student">학생</option><option value="other">기타</option></select></label><label>{{u.id}} 확인 상태<select v-model="u.status" :aria-label="u.id+' 확인 상태'"><option value="pending">검토 대기</option><option value="confirmed">확인</option><option value="excluded">분석 제외</option></select></label></div><details><summary>업로드 원문</summary><p class="original-text">{{u.original_text}}</p></details><label>{{u.id}} 검토 내용<textarea v-model="u.text" rows="2" maxlength="12000"></textarea></label><label v-if="u.status==='excluded'">{{u.id}} 제외 이유<input v-model="u.reason" maxlength="1000"></label></article>
     </fieldset><button class="primary" :disabled="!!busy||parentDirty||!workspace.precheck_current||otherEdit('review')" @click="saveReview">전사본 교사 검토 저장</button>
    </section>
   </div>
   <div v-show="step==='report'">
    <section class="card"><h3>학생 종합 보고서</h3><p>확인한 학생 답변을 근거로 AI가 초안을 작성합니다. 새로 생성해도 기존 교사 편집본과 확정본을 보존합니다.</p><button class="primary" :disabled="!canGenerate||!workspace.record_current||!reviewReady" @click="generate('generate-report')">AI 종합 보고서 초안 작성</button><p v-if="!reviewReady" class="help">AI 사전 검토와 교사의 학생 발화 확인·저장을 먼저 완료하세요.</p>
     <label v-if="workspace.reports.length">보고서 판본<select aria-label="보고서 판본" :value="selectedReportId" :disabled="!!busy||dirty" @change="chooseReport"><option v-for="(r,i) in workspace.reports" :key="r.id" :value="r.id">{{i+1}}판 · {{r.created_at.slice(0,16).replace('T',' ')}} · {{r.confirmed?'교사 확정':'초안'}}{{r.current?'':' · 이전 자료 기준'}}</option></select></label>
    </section>
    <article v-if="selectedReport" class="card" aria-label="종합 보고서 편집"><p class="badge">{{selectedReport.confirmed?'교사 확정본':'교사 편집용 초안'}}</p><p v-if="!selectedReport.current" class="inline-note warning">이전 자료 기준 보고서입니다. 현재 자료로 새 초안을 생성해 검토하세요.</p>
     <p>자료: {{selectedReport.source_snapshot.transcript_filename}} · 확인 {{selectedReport.source_snapshot.utterances.filter(u=>u.status==='confirmed').length}}개 / 보류·제외 {{selectedReport.source_snapshot.utterances.filter(u=>u.status!=='confirmed').length}}개</p>
     <fieldset :disabled="!!busy||parentDirty||!!selectedReport.confirmed||otherEdit('report')" @input="textChanged($event,'report')"><section v-for="(title,key) in interviewTopics" :key="key" class="report-section"><label>{{title}}<textarea v-model="selectedReport.edited_sections[key]" rows="5" maxlength="20000"></textarea></label><details><summary>AI 초안과 인용 근거</summary><p class="original-text">{{selectedReport.draft_sections[key]}}</p><blockquote v-for="(r,i) in reportRefs(selectedReport,key)" :key="i">{{evidenceLabel(r.id)}} · {{r.quote}}</blockquote></details></section><label>교사 최종 의견<textarea v-model="selectedReport.teacher_opinion" rows="5" maxlength="12000" placeholder="직접 관찰한 내용과 최종 지도 의견을 추가하세요."></textarea></label></fieldset>
     <div class="button-row"><button v-if="!selectedReport.confirmed" class="primary" :disabled="!!busy||parentDirty||otherEdit('report')" @click="saveReport">교사 추가·보완 저장</button><button v-else class="secondary" :disabled="!!busy||dirty||parentDirty" @click="copyReport">편집 사본 만들기</button><button class="secondary" :disabled="!!busy||dirty" @click="exportFile('docx')">Word 저장</button><button class="secondary" :disabled="!!busy||dirty" @click="exportFile('pdf')">PDF 저장</button></div>
     <div v-if="!selectedReport.confirmed" class="report-confirm"><label class="check-label"><input v-model="acknowledged" type="checkbox" :disabled="!!busy||dirty||!selectedReport.current">학생·전사 근거와 교사 보완 내용을 확인했습니다.</label><button class="primary" :disabled="!!busy||dirty||parentDirty||!acknowledged||!selectedReport.current" @click="confirmReport">교사 확인 후 보고서 확정</button></div><p v-else class="help">확정일 {{selectedReport.confirmed.at.slice(0,10)}} · 확정본은 보존됩니다.</p>
    </article>
   </div>
  </template>
 </section>
</template>

<style scoped>
.interview-workspace{display:grid;gap:16px;min-width:0}.interview-heading{display:flex;justify-content:space-between;gap:20px;align-items:center}.interview-heading h2{margin:8px 0}.interview-steps,.interview-save-state,.utterance-heading{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.interview-save-state{font-size:.9rem}.interview-workspace .card{margin-bottom:16px}.interview-item{border-top:1px solid #dce5e8;padding:18px 0;display:grid;gap:8px}.interview-workspace fieldset{border:0;padding:0;margin:12px 0;min-width:0}.interview-workspace label{display:flex;flex-direction:column;gap:7px;margin:10px 0;font-weight:600}.interview-workspace .check-label,.record-selection label{flex-direction:row;align-items:center}.interview-workspace input[type=checkbox]{width:18px;height:18px;flex:none}.interview-workspace textarea,.interview-workspace select,.interview-workspace input:not([type=checkbox]){width:100%;max-width:100%;font:inherit;padding:10px;border:1px solid #b8cbd1;border-radius:8px;background:white;box-sizing:border-box}.interview-workspace textarea{resize:vertical;line-height:1.65}.interview-workspace details{margin:12px 0}.interview-workspace summary{cursor:pointer}.interview-workspace blockquote{margin:8px 0;padding:10px 14px;border-left:3px solid #428393;background:#f0f6f7;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.94rem}.original-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.record-selection{max-height:380px;overflow:auto;padding:8px}.report-section{padding:12px 0}.report-confirm{border-top:1px solid #dce5e8;padding-top:16px;margin-top:20px}.interview-workspace button:focus-visible,.interview-workspace input:focus-visible,.interview-workspace textarea:focus-visible,.interview-workspace select:focus-visible{outline:3px solid #36919e;outline-offset:3px}.visually-hidden{position:absolute;width:1px!important;height:1px;clip-path:inset(50%);overflow:hidden}.utterance-heading small{font-weight:400}.interview-workspace button{white-space:normal}@media(max-width:700px){.interview-heading{display:block}.interview-steps{display:grid;grid-template-columns:1fr}.utterance-heading{align-items:stretch}.utterance-heading label{flex:1;min-width:120px}.interview-workspace .card{padding:16px}.interview-save-state{align-items:stretch}}
</style>
