<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref,shallowRef,nextTick,watch,defineAsyncComponent} from 'vue'
import {BookOpen,Search,Plus,FileText,Download,Upload,Save,ChevronRight,ArrowLeft,CalendarDays,ShieldCheck,Monitor,Cloud,LoaderCircle,RefreshCw,Settings,MessageSquare,Check,Trash2,X,ExternalLink,ClipboardCheck,Sparkles,AlertCircle,FolderOpen} from 'lucide-vue-next'
import {createTransport,isRevisionConflict,ApiError} from './lib/transport'
import {connectionUrl,schoolLoginUrl,validatedLocalOrigin,receivedTeacherToken,approvedTeacherToken,AUTH_MESSAGE} from './lib/authBridge'
import {clone,stamp,sessionOf,parseBackup,draftBackup,download,readableError,reportFilename,normalizeCase,studentView,applyAnalysis} from './lib/model'
import type {Transport,Health,CounselingCase,Student,Backup,Job,Fixture,AiSettings,RecordMetadata} from './lib/types'
import schoolLogo from './assets/school-logo.png'
import StrategyEditor from './components/StrategyEditor.vue'
import StudentResult from './components/StudentResult.vue'
import RecordEvidence from './components/RecordEvidence.vue'
import StudentUnderstanding from './components/StudentUnderstanding.vue'
import ConsultationEditor from './components/ConsultationEditor.vue'
import FieldExample from './components/FieldExample.vue'
import {actionExample} from './lib/inputExamples'
import {preparationIssues,finalizationIssues,normalizeConsultation,guidanceIssues} from './lib/workflow'
import type {StrategyPreparationCard} from './lib/strategyPreparation'
import SchoolContextCards from './components/SchoolContextCards.vue'
import schoolContextData from './data/school-context.json'
import {adoptSchoolTask,taskReference,adoptSchoolActivity,activityReference,schoolActivityAction,type SchoolContext,type SchoolAssessment,type SchoolActivity} from './lib/schoolContext'
const schoolContext=schoolContextData as unknown as SchoolContext
import {adoptProfile,normalizeProfile} from './lib/profile'
import {validateNewStudent} from './lib/students'
const AdminPanel=defineAsyncComponent(()=>import('./components/AdminPanel.vue'))
const adminOpen=ref(new URLSearchParams(location.search).get('admin')==='1'),adminBusy=ref(false)
const transport=shallowRef<Transport|null>(null),health=ref<Health|null>(null),cases=ref<CounselingCase[]>([])
const draft=ref<CounselingCase|null>(null),savedStamp=ref(''),selectedSessionId=ref(''),search=ref(''),tab=ref<'understanding'|'counseling'|'consultation'|'record'|'analysis'|'review'>('understanding')
const requestCancellable=ref(false),busy=ref(''),error=ref(''),notice=ref(''),conflict=ref(false),activeJob=ref<Job|null>(null),sidebarOpen=ref(false),authToken=ref('')
const studentPreview=ref(false)
const newOpen=ref(false),importBundle=ref<Backup|null>(null),importAcknowledged=ref(false),reviewAcknowledged=ref(false)
const model=ref(''),pdfPassword=ref(''),selectedPdf=shallowRef<File|null>(null),fixtures=ref<Fixture[]>([]),evidenceId=ref(''),budget=ref(90)
const settingsOpen=ref(false),aiDraft=ref(''),externalConsent=ref(false),settings=ref<AiSettings>({provider:'server',model:'',apiKey:'',ollamaUrl:'http://127.0.0.1:11434'})
const pdfInput=ref<HTMLInputElement|null>(null),jsonInput=ref<HTMLInputElement|null>(null)
const pdfDragDepth=ref(0)
let pdfSelectionSequence=0
const newStudent=ref<Student>({student_id:'',student_number:'',academic_year:new Date().getFullYear(),school_stage:'high',grade:1,name:''})
const onlineStudentId=ref(''),newTeacher=ref(''),localMode=computed(()=>transport.value?.mode==='local')
const newStudentMode=ref<'assigned'|'manual'>('assigned'),addedStudentId=ref('')
const canAddStudent=computed(()=>!localMode.value&&health.value?.teacher?.approved===true&&Boolean(transport.value?.addStudent))
const manualHref=computed(()=>localMode.value?'https://daeryun.life/':'/')
const strategyHubHref=computed(()=>manualHref.value+'#strategy')
const guideHref=computed(()=>(localMode.value?'https://daeryun.life':'')+'/counseling/guide.html')
const ready=computed(()=>Boolean(health.value&&(health.value.demo||health.value.teacher||health.value.user)))
const teacher=computed(()=>Boolean(health.value?.demo||health.value?.teacher))
const canManage=computed(()=>!localMode.value&&health.value?.user?.can_manage===true)
const session=computed(()=>draft.value?.sessions.find(s=>s.id===selectedSessionId.value)||null)
const dirty=computed(()=>Boolean(draft.value&&stamp(draft.value)!==savedStamp.value))
const locked=computed(()=>!teacher.value||Boolean(session.value?.confirmed||session.value?.guidance)||Boolean(busy.value))
const strategy=computed(()=>session.value?.strategy)
const dataTab=computed(()=>['understanding','record','analysis'].includes(tab.value))
const preparation=computed(()=>session.value?.preparation)
const prepareIssues=computed(()=>session.value?preparationIssues(session.value):[])
const finalIssues=computed(()=>session.value?finalizationIssues(session.value):[])
const finalReady=computed(()=>finalIssues.value.length===0)
const contentIssues=computed(()=>session.value&&!session.value.confirmed?guidanceIssues(session.value):[])
const planLocked=computed(()=>locked.value||Boolean(preparation.value&&!finalReady.value))
const importedPreparation=computed(()=>Boolean(session.value?.imported_history?.preparation_imported))
const displayedStrategy=computed(()=>tab.value==='counseling'&&preparation.value?preparation.value.strategy:strategy.value)
const displayedTopic=computed(()=>tab.value==='counseling'&&preparation.value?preparation.value.topic:session.value?.topic||'')
const displayedActions=computed(()=>tab.value==='counseling'&&preparation.value?preparation.value.actions:session.value?.actions||[])
const studentPdfReady=computed(()=>!teacher.value||finalReady.value&&((!localMode.value&&session.value?.workflow_version!==2)||Boolean(session.value?.confirmed&&!dirty.value)))
watch(()=>[draft.value?.id,selectedSessionId.value,tab.value],()=>{studentPreview.value=false})
watch([()=>draft.value?.id,()=>selectedSessionId.value],()=>{pdfSelectionSequence++;selectedPdf.value=null;pdfPassword.value='';pdfDragDepth.value=0})
const showStudentResult=computed(()=>!teacher.value||tab.value==='review'&&finalReady.value&&(studentPreview.value||Boolean(session.value?.confirmed)))
const strategyReadOnly=computed(()=>!teacher.value||Boolean(session.value?.confirmed||session.value?.guidance)||Boolean(tab.value==='counseling'&&preparation.value))
const published=computed(()=>Boolean(session.value?.guidance))
const visibleCases=computed(()=>cases.value.filter(c=>[c.student.student_number,c.student.name,...c.sessions.flatMap(s=>[s.topic,s.strategy?.target_major,s.strategy?.target_path])].join(' ').includes(search.value.trim())))
const availableStudents=computed(()=>health.value?.students||[])
const studentAccountLinked=computed(()=>(availableStudents.value.find(student=>student.student_id===draft.value?.student.student_id)?.account_linked??draft.value?.student.account_linked)!==false)
const record=computed(()=>session.value?.record),analysis=computed(()=>session.value?.analysis)
const review=computed(()=>dirty.value?null:session.value?.review)
const reviewConfirmable=computed(()=>Boolean(review.value&&['passed','pending'].includes(review.value.state)&&!dirty.value&&finalReady.value&&!contentIssues.value.length))
const currentSessionIndex=computed(()=>draft.value?.sessions.findIndex(s=>s.id===selectedSessionId.value)??-1)
const validImportStudent=computed(()=>localMode.value||availableStudents.value.some(s=>s.student_id===importBundle.value?.case.student.student_id))
const jobStage=computed(()=>({queued:'분석 준비',loading:'모델 불러오기',reading_image:'PDF 이미지 판독',analyzing:'근거 분석',validating_evidence:'원문 대조',checking_evidence:'근거 다시 확인',style_review:'문체 검토',completed:'완료',cancelled:'취소',failed:'분석 중단'} as Record<string,string>)[activeJob.value?.stage||'']||'')
const connectTarget=validatedLocalOrigin(new URLSearchParams(location.search).get('connect_local'))
const connectionSent=ref(false)
let connectionPopup:Window|null=null
let controller:AbortController|null=null
let returnFocus:HTMLElement|null=null
watch(()=>[newOpen.value,Boolean(importBundle.value),settingsOpen.value].some(Boolean),async(open)=>{if(open){returnFocus=document.activeElement as HTMLElement;await nextTick();document.querySelector<HTMLElement>('.modal input:not(:disabled),.modal select:not(:disabled),.modal button')?.focus()}else returnFocus?.focus()})
async function focusStudentResult(){await nextTick();const element=document.querySelector<HTMLElement>('.student-result');element?.focus({preventScroll:true});(document.querySelector<HTMLElement>('.result-preview-bar')||element)?.scrollIntoView({block:'start',behavior:'auto'})}
async function toggleStudentPreview(){studentPreview.value=!studentPreview.value;if(studentPreview.value)await focusStudentResult()}
watch(()=>session.value?.confirmed,async(value,previous)=>{if(value&&!previous&&teacher.value&&tab.value==='review')await focusStudentResult()})
function modalKeyboard(event:KeyboardEvent){const modal=document.querySelector<HTMLElement>('.modal');if(!modal)return;if(event.key==='Escape'&&!busy.value){newOpen.value=false;importBundle.value=null;settingsOpen.value=false;return}if(event.key!=='Tab')return;const elements=Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea:not(:disabled)'));const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
function healthIdentity(value:Health|null):string{return value?.demo?'demo':value?.teacher?.id||value?.user?.id||''}
function clearStudentState(){budget.value=90;model.value='';cases.value=[];draft.value=null;savedStamp.value='';selectedSessionId.value='';search.value='';aiDraft.value='';reviewAcknowledged.value=false;selectedPdf.value=null;pdfPassword.value='';fixtures.value=[];evidenceId.value='';importBundle.value=null;importAcknowledged.value=false;newOpen.value=false;settingsOpen.value=false;sidebarOpen.value=false;activeJob.value=null;conflict.value=false;externalConsent.value=false;newTeacher.value='';onlineStudentId.value='';newStudentMode.value='assigned';addedStudentId.value='';newStudent.value={student_id:'',student_number:'',academic_year:new Date().getFullYear(),school_stage:'high',grade:1,name:''};tab.value='understanding'}
async function refreshConnection(){await execute('로컬 연결을 다시 확인하고 있습니다.',async()=>{const nextHealth=await transport.value!.health();if(healthIdentity(nextHealth)!==healthIdentity(health.value))clearStudentState();health.value=nextHealth;if(!health.value.ollama.models.some(item=>item.name===model.value))model.value=health.value.ollama.models[0]?.name||'';notice.value='현재 모델 연결 상태를 확인했습니다.'})}
function setCase(input:CounselingCase,sessionId?:string){const value=teacher.value?normalizeCase(input):studentView(input);if(!value){draft.value=null;savedStamp.value='';return}draft.value=clone(value);savedStamp.value=stamp(value);selectedSessionId.value=sessionId&&value.sessions.some(s=>s.id===sessionId)?sessionId:value.current_session_id;reviewAcknowledged.value=false;conflict.value=false;selectedPdf.value=null;if(!teacher.value)tab.value='counseling';const index=cases.value.findIndex(c=>c.id===value.id);if(index>=0)cases.value[index]=clone(value);else cases.value.unshift(clone(value))}
async function execute(label:string,fn:()=>Promise<void>,canCancel=false){if(busy.value)return;busy.value=label;requestCancellable.value=canCancel;error.value='';notice.value='';controller=new AbortController();try{await fn()}catch(e){error.value=readableError(e);conflict.value=isRevisionConflict(e)}finally{busy.value='';requestCancellable.value=false;controller=null;activeJob.value=null}}
async function initialize(){if(busy.value)return;clearStudentState();health.value=null;await execute('전략실 연결을 확인하고 있습니다.',async()=>{transport.value=await createTransport();try{health.value=await transport.value.health()}catch(e){if(e instanceof ApiError&&e.status===401&&e.code!=='SESSION_CHANGED')return;throw e}if(ready.value){if(health.value.user?.role==='manager'){cases.value=[];draft.value=null;adminOpen.value=true}else{cases.value=(await transport.value.list()).map(c=>teacher.value?normalizeCase(c):studentView(c)).filter((c):c is CounselingCase=>Boolean(c));if(!cases.value.length){draft.value=null;savedStamp.value=''}}if(!canManage.value)adminOpen.value=false;newTeacher.value=health.value.teacher?.display_name||'';if(cases.value.length)setCase(cases.value[0]!);if(localMode.value){fixtures.value=await transport.value.fixtures();model.value=health.value.ollama.models[0]?.name||''}else{const module=await import('./lib/cloudTransport');settings.value=module.loadAiSettings()}}})}
function openAdmin(){if(!canManage.value||busy.value||!mayLeave())return;if(dirty.value&&draft.value){const original=cases.value.find(item=>item.id===draft.value!.id);if(original)setCase(original)}adminOpen.value=true}
async function closeAdmin(){if(adminBusy.value)return;adminOpen.value=false;await initialize()}
async function authenticate(){await completeAuthentication(authToken.value)}
async function completeAuthentication(token:string){if(busy.value)return;clearStudentState();health.value=null;await execute('교사 계정을 확인하고 있습니다.',async()=>{health.value=await transport.value!.authenticate(token);authToken.value='';cases.value=await transport.value!.list();newTeacher.value=health.value.teacher?.display_name||'';fixtures.value=await transport.value!.fixtures();model.value=health.value.ollama.models[0]?.name||'';if(cases.value.length)setCase(cases.value[0]!);notice.value='교사 계정을 확인했습니다. 이 PC의 전략실을 사용할 수 있습니다.'})}
function openTeacherConnection(){try{if(!localMode.value||ready.value)return;connectionPopup=window.open(connectionUrl(location.origin),'daeryun-counseling-auth','popup,width=620,height=780');if(!connectionPopup)throw new Error('로그인 창을 열지 못했습니다. 팝업 허용 후 다시 연결해 주세요.');notice.value='대륜고 로그인 창에서 교사 계정으로 이 PC 연결을 확인해 주세요.'}catch(e){error.value=readableError(e)}}
async function receiveTeacherConnection(event:MessageEvent){const token=receivedTeacherToken(event,connectionPopup);if(!token||!localMode.value||ready.value||busy.value)return;connectionPopup=null;await completeAuthentication(token)}
function sendTeacherConnection(){try{if(localMode.value||!connectTarget||!window.opener||connectionSent.value)return;const token=approvedTeacherToken(health.value,localStorage);if(!token)throw new Error('승인된 교사 계정으로 로그인한 뒤 연결해 주세요.');window.opener.postMessage({type:AUTH_MESSAGE,token},connectTarget);connectionSent.value=true;notice.value='교사 연결 요청을 보냈습니다. 로컬 전략실에서 연결 결과를 확인해 주세요.'}catch(e){error.value=readableError(e)}}
async function persist(){if(!draft.value)throw new Error('상담을 먼저 선택해 주세요.');if(dirty.value){for(const item of draft.value.sessions){normalizeProfile(item.profile);normalizeConsultation(item.consultation)};if(session.value?.confirmed||session.value?.guidance)throw new Error('확정한 상담은 다음 회차에 이어서 작성해 주세요.');const id=selectedSessionId.value;setCase(await transport.value!.save(clone(draft.value)),id)}return draft.value!}
function mayLeave(){return !dirty.value||window.confirm('저장하지 않은 작성 내용이 있습니다. 이 화면의 변경을 버리고 이동할까요?')}
async function openCase(value:CounselingCase){if(busy.value||!mayLeave())return;await execute('상담을 불러오고 있습니다.',async()=>{setCase(await transport.value!.get(value.id));tab.value=teacher.value?'understanding':'counseling';sidebarOpen.value=false;aiDraft.value=''})}
function selectSession(id:string){if(busy.value||!mayLeave())return;if(dirty.value&&draft.value){const original=cases.value.find(c=>c.id===draft.value!.id);if(original)setCase(original,id)}selectedSessionId.value=id;reviewAcknowledged.value=false;aiDraft.value='';tab.value=teacher.value?'understanding':'counseling'}
async function save(){await execute('상담을 저장하고 있습니다.',async()=>{await persist();notice.value='작성한 전략을 저장했습니다.'})}
async function reload(){if(!draft.value||!mayLeave())return;await execute('최신 상담을 불러오고 있습니다.',async()=>{setCase(await transport.value!.get(draft.value!.id),selectedSessionId.value);notice.value='최신 저장 내용을 불러왔습니다.'})}
function openNew(){if(!teacher.value||busy.value||!mayLeave())return;newStudent.value={student_id:crypto.randomUUID(),student_number:'',academic_year:new Date().getFullYear(),school_stage:'high',grade:1,name:''};onlineStudentId.value=availableStudents.value[0]?.student_id||'';newStudentMode.value=canAddStudent.value&&!availableStudents.value.length?'manual':'assigned';addedStudentId.value='';error.value='';newOpen.value=true}
function selectNewStudentMode(mode:'assigned'|'manual'){if(busy.value||mode==='manual'&&!canAddStudent.value)return;newStudentMode.value=mode;error.value=''}
async function createCase(){
 if(!teacher.value||!transport.value||busy.value)return
 await execute(newStudentMode.value==='manual'&&!localMode.value?'학생을 추가하고 첫 전략을 만들고 있습니다.':'새 상담을 만들고 있습니다.',async()=>{
  let student=newStudent.value
  if(!localMode.value){
   if(newStudentMode.value==='manual'){
    if(!canAddStudent.value)throw new Error('승인된 교사 계정으로 학생을 추가해 주세요.')
    student=await transport.value!.addStudent!(validateNewStudent({...newStudent.value,name:newStudent.value.name||''}))
    health.value!.students=[...availableStudents.value.filter(item=>item.student_id!==student.student_id),student]
    onlineStudentId.value=student.student_id;addedStudentId.value=student.student_id;newStudentMode.value='assigned'
   }else{
    const found=availableStudents.value.find(s=>s.student_id===onlineStudentId.value)
    if(!found)throw new Error('배정된 학생을 선택해 주세요.')
    student=found
   }
  }else if(!/^\d{4,8}$/.test(student.student_number))throw new Error('학번은 숫자 4~8자리로 입력해 주세요.')
  setCase(await transport.value!.create(student,newTeacher.value));newOpen.value=false;tab.value='understanding';sidebarOpen.value=false;notice.value='첫 전략 회차를 만들었습니다.'
 })
}
async function nextSession(){if(!teacher.value)return;await execute('다음 전략 회차를 만들고 있습니다.',async()=>{const value=await persist();setCase(await transport.value!.next(value));tab.value='understanding';notice.value='이전 전략을 보존하고 새 회차를 만들었습니다.'})}
function addAction(){session.value?.actions.push({id:crypto.randomUUID(),text:'',due_date:'',status:'planned'})}
function removeAction(id:string){if(session.value)session.value.actions=session.value.actions.filter(a=>a.id!==id)}
async function exportJson(){if(!draft.value||!teacher.value)return;await execute('상담 백업을 준비하고 있습니다.',async()=>{if(dirty.value){const bundle=draftBackup(draft.value!,selectedSessionId.value);const value=bundle.case;download(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json;charset=utf-8'}),'상담_'+value.student.student_number+'_작성중.json');notice.value='작성 내용을 백업했습니다. 필수값을 편집 중인 상담은 사본에서 진행 중으로 보관합니다. 불러오면 새 사본으로 검토합니다.'}else{download(await transport.value!.exportBackup(draft.value!.id),'상담_'+draft.value!.student.student_number+'_백업.json');notice.value='상담 백업을 내려받았습니다.'}})}
async function exportPdf(audience:'student'|'teacher'='student'){if(!draft.value)return;if(audience==='student'&&!studentPdfReady.value){error.value=finalIssues.value[0]||'최종 전략을 현재 버전으로 검토·확정한 뒤 학생 안내 PDF를 저장해 주세요.';return}const popup=!localMode.value?window.open('','_blank'):null;if(popup)popup.opener=null;await execute('상담 보고서를 준비하고 있습니다.',async()=>{try{const value=teacher.value?await persist():draft.value!;const blob=await transport.value!.report(value.id,selectedSessionId.value,audience);if(localMode.value)download(blob,reportFilename(value.student.student_number,session.value?.date||'',audience));else{if(!popup)throw new Error('인쇄 창을 열지 못했습니다. 팝업을 허용한 뒤 다시 눌러 주세요.');const url=URL.createObjectURL(blob);popup.location.replace(url);setTimeout(()=>URL.revokeObjectURL(url),60000)}notice.value=localMode.value?'PDF를 내려받았습니다.':'인쇄 창에서 PDF로 저장을 선택하세요.'}catch(e){popup?.close();throw e}})}
async function readImport(event:Event){if(!teacher.value)return;const file=(event.target as HTMLInputElement).files?.[0];(event.target as HTMLInputElement).value='';if(!file)return;try{if(file.size>30_000_000)throw new Error('백업 파일은 30MB 이내로 선택해 주세요.');importBundle.value=parseBackup(await file.text(),transport.value!.mode);importAcknowledged.value=false;error.value=''}catch(e){error.value=readableError(e)}}
async function importCase(){if(!importBundle.value||!importAcknowledged.value||!validImportStudent.value||!mayLeave())return;await execute('상담 백업을 가져오고 있습니다.',async()=>{setCase(await transport.value!.importBackup(importBundle.value!));importBundle.value=null;tab.value='understanding';notice.value='새 사본으로 가져왔습니다. 학생과 이전 상담 내용을 다시 확인해 주세요.'})}
async function selectPdf(file:File){
 if(locked.value||!localMode.value)return
 const sequence=++pdfSelectionSequence;selectedPdf.value=null;pdfPassword.value='';error.value=''
 try{
  if(file.size>20*1024*1024)throw new Error('PDF는 20MB 이내로 선택해 주세요.')
  if(!/\.pdf$/i.test(file.name))throw new Error('학생부 PDF 파일을 선택해 주세요.')
  if(new TextDecoder('ascii').decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('PDF 형식을 확인할 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.')
  if(sequence===pdfSelectionSequence&&!locked.value&&localMode.value)selectedPdf.value=file
 }catch(e){if(sequence===pdfSelectionSequence)error.value=readableError(e)}
}
function choosePdf(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(file)void selectPdf(file)}
function dragPdf(event:DragEvent){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=locked.value?'none':'copy'}
function enterPdf(event:DragEvent){event.preventDefault();if(!locked.value&&event.dataTransfer?.types.includes('Files'))pdfDragDepth.value++}
function leavePdf(event:DragEvent){event.preventDefault();pdfDragDepth.value=Math.max(0,pdfDragDepth.value-1)}
function dropPdf(event:DragEvent){
 event.preventDefault();event.stopPropagation();pdfDragDepth.value=0
 if(locked.value||!localMode.value)return
 const files=event.dataTransfer?.files
 if(!files?.length)return
 if(files.length!==1){pdfSelectionSequence++;selectedPdf.value=null;pdfPassword.value='';error.value='학생부 PDF를 한 번에 한 개씩 첨부해 주세요.';return}
 void selectPdf(files[0]!)
}
function preventPdfNavigation(event:DragEvent){if(localMode.value&&teacher.value&&tab.value==='record'&&event.dataTransfer?.types.includes('Files'))event.preventDefault()}
onMounted(()=>{window.addEventListener('dragover',preventPdfNavigation);window.addEventListener('drop',preventPdfNavigation)})
onBeforeUnmount(()=>{window.removeEventListener('dragover',preventPdfNavigation);window.removeEventListener('drop',preventPdfNavigation)})
async function saveRecordMetadata(sectionId:string,metadata:RecordMetadata):Promise<boolean>{
 if(locked.value||!localMode.value||!record.value)return false
 const recordId=record.value.id,id=selectedSessionId.value;let saved=false
 await execute('항목의 학년도·학년을 저장하고 있습니다.',async()=>{const value=await persist();setCase(await transport.value!.updateRecordMetadata(value,id,recordId,sectionId,metadata),id);reviewAcknowledged.value=false;notice.value='학년도·학년을 저장했습니다. 변경한 근거로 다시 분석해 주세요.';saved=true})
 return saved
}
async function upload(){if(!selectedPdf.value)return;const file=selectedPdf.value;await execute('학생부 PDF에서 항목과 근거를 읽고 있습니다.',async()=>{const value=await persist();const id=selectedSessionId.value;setCase(await transport.value!.upload(value,id,file,pdfPassword.value,controller?.signal),id);pdfPassword.value='';tab.value='record';notice.value='추출 항목과 판독 상태를 확인해 주세요.'},true)}
async function waitJob(job:Job){activeJob.value=job;while(['queued','running'].includes(activeJob.value.state)){await new Promise<void>((resolve,reject)=>{const signal=controller?.signal;if(signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return}const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},900);const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'))};signal?.addEventListener('abort',abort,{once:true})});activeJob.value=await transport.value!.job(job.id,controller?.signal)}const outcome=activeJob.value;setCase(await transport.value!.get(draft.value!.id),selectedSessionId.value);if(outcome.state==='failed'||outcome.state==='needs_revision')throw new Error(outcome.message||'작업을 완료하지 못했습니다. 모델 상태와 입력을 확인해 주세요.');notice.value=outcome.message||(outcome.state==='cancelled'?'작업을 취소했습니다.':'작업 결과를 확인해 주세요.')}
async function analyze(){await execute('Ollama 분석을 준비하고 있습니다.',async()=>{if(!model.value)throw new Error('설치된 로컬 모델을 선택해 주세요.');if(!Number.isInteger(budget.value)||budget.value<5||budget.value>600)throw new Error('제안 시간 상한은 5~600분 사이의 정수로 입력하세요.');const value=await persist();await waitJob(await transport.value!.analyze(value,selectedSessionId.value,model.value,session.value!.topic,budget.value));tab.value='analysis'})}
async function prepareStrategy(){if(!session.value||prepareIssues.value.length||locked.value)return;await execute('상담 전 교사 전략을 보존하고 있습니다.',async()=>{const value=await persist();const id=selectedSessionId.value;setCase(await transport.value!.prepare(value,id),id);tab.value='consultation';notice.value='상담 전 전략을 보존했습니다. 학생의 실제 반응과 합의 내용을 기록하세요.'})}
async function completeConsultation(){if(!session.value?.preparation||locked.value)return;await execute('상담 반영 기록을 저장하고 있습니다.',async()=>{const current=session.value!;const completed=normalizeConsultation({...current.consultation,status:'completed'});current.consultation=completed;await persist();tab.value='review';notice.value='상담 반영 기록을 저장했습니다. 최종 전략과 실행과제를 수정한 뒤 검토·확정하세요.'})}
function adoptPreparationCard(card:StrategyPreparationCard){
 if(!teacher.value||planLocked.value||!session.value||!strategy.value)return
 let changed=false
 if(!strategy.value.target_major.trim()&&session.value.profile?.target_major.trim()){strategy.value.target_major=session.value.profile.target_major.trim();changed=true}
 for(const [key,value] of Object.entries(card.strategyPatch||{})){
  const field=key as keyof typeof strategy.value
  if(typeof value==='string'&&value.trim()&&!strategy.value[field]?.trim()){strategy.value[field]=value;changed=true}
 }
 for(const text of card.actions||[])if(text.trim()&&!session.value.actions.some(a=>a.text.trim()===text.trim())){session.value.actions.push({id:crypto.randomUUID(),text,due_date:'',status:'planned'});changed=true}
 if(changed&&!session.value.topic.trim())session.value.topic='학생 자료를 바탕으로 한 학기 전략'
 tab.value=preparation.value?'review':'counseling'
 notice.value=changed?'선택한 제안을 빈 계획 항목과 실행과제에 반영했습니다. 교사 판단에 맞게 편집하고 저장하세요.':'이미 작성한 계획이 있습니다. 전략 화면에서 직접 수정하세요.'
}
async function reviewCase(useModel:boolean){if(!finalReady.value){error.value=finalIssues.value[0]||'';return}await execute('전략 내용과 문체를 점검하고 있습니다.',async()=>{const value=await persist();const result=await transport.value!.review(value,selectedSessionId.value,useModel?model.value:undefined);if('sessions'in result)setCase(result,selectedSessionId.value);else await waitJob(result);tab.value='review';reviewAcknowledged.value=false})}
async function publishStrategy(){if(!teacher.value||localMode.value||!studentAccountLinked.value||!transport.value?.publish||!draft.value||!session.value?.confirmed||published.value||dirty.value||!finalReady.value)return;if(!window.confirm('학생 안내 전략과 실행과제를 이 학생의 계정에 공개합니다. 교사 참고 메모는 공개하지 않습니다. 공개한 내용은 보존되며 변경은 새 회차에서 진행합니다. 학생에게 안내할까요?'))return;await execute('학생에게 전략을 안내하고 있습니다.',async()=>{setCase(await transport.value!.publish!(draft.value!,selectedSessionId.value),selectedSessionId.value);notice.value='학생에게 전략을 안내했습니다. 학생 계정에서 전략과 실행과제를 확인할 수 있습니다.'})}
async function confirmCase(){if(!reviewAcknowledged.value||!reviewConfirmable.value||!finalReady.value)return;await execute('확인한 상담 버전을 확정하고 있습니다.',async()=>{setCase(await transport.value!.confirm(draft.value!,selectedSessionId.value),selectedSessionId.value);notice.value=health.value?.demo?'합성 시연 회차를 확정했습니다. 실제 교사의 검토 기록이 아닙니다.':'확인한 전략 회차를 확정했습니다. 다음 전략은 새 회차에서 개정합니다.'})}
async function cancel(){if(activeJob.value){try{activeJob.value=await transport.value!.cancel(activeJob.value.id);notice.value='취소 요청을 보냈습니다. 작업 종료 상태를 확인합니다.'}catch(e){error.value=readableError(e)}}else controller?.abort()}
async function showEvidence(id:string){evidenceId.value=id;tab.value='record';await nextTick();const element=document.getElementById('evidence-'+id);if(element){(element as HTMLDetailsElement).open=true;element.scrollIntoView({behavior:'smooth',block:'center'})}}
async function fixturePdf(id:string){await execute('합성 PDF를 준비하고 있습니다.',async()=>{download(await transport.value!.fixture(id),'합성학생부_'+id+'.pdf')})}
async function clearApiKey(){settings.value.apiKey='';await saveSettings()}
async function saveSettings(){try{const module=await import('./lib/cloudTransport');module.saveAiSettings(settings.value);settingsOpen.value=false;notice.value='이 도메인의 이 브라우저에 AI 설정을 저장했습니다.'}catch{error.value='브라우저가 설정 저장을 허용하지 않습니다. 현재 화면에서는 입력한 설정을 사용할 수 있습니다.'}}
async function generalAi(){await execute('일반 전략의 AI 초안을 준비하고 있습니다.',async()=>{if(!externalConsent.value&&settings.value.provider!=='ollama')throw new Error('일반 전략의 외부 AI 전송 안내를 확인해 주세요.');const value=await persist();aiDraft.value=await transport.value!.generalAi!(value,selectedSessionId.value,settings.value,controller?.signal)},true)}
function referenceSchoolTask(task:SchoolAssessment){
 if(!teacher.value||planLocked.value||!session.value||!strategy.value)return
 try{
  const next=adoptSchoolTask(task,strategy.value)
  const reference=taskReference(task)
  const notes=session.value.evidence_notes.includes(task.source_ref.source_id+' · '+task.source_ref.json_pointer)?session.value.evidence_notes:[session.value.evidence_notes,reference].filter(Boolean).join('\n\n')
  if(notes.length>12000)throw new Error('교사 근거 메모가 길어 자료를 추가할 수 없습니다. 메모를 정리한 뒤 다시 선택해 주세요.')
  session.value.strategy=next;session.value.evidence_notes=notes
  tab.value=preparation.value?'review':'counseling';notice.value='학교 과제와 핵심 조건을 반영했습니다. 계획을 확인하고 저장하세요.'
 }catch(e){error.value=readableError(e)}
}
function referenceSchoolActivity(activity:SchoolActivity,semester:number|null){
 if(!teacher.value||planLocked.value||!session.value||!strategy.value||!draft.value)return
 try{
  const weekly_minutes=session.value.profile?.weekly_minutes??null
  const next=adoptSchoolActivity(activity,strategy.value,{student:draft.value.student,semester,weekly_minutes})
  const text=schoolActivityAction(activity,{weekly_minutes})
  const add=!session.value.actions.some(action=>action.text===text)
  if(add&&session.value.actions.length>=30)throw new Error('실행과제는 30개까지 추가할 수 있습니다.')
  const reference=activityReference(activity)
  const notes=session.value.evidence_notes.includes(activity.source_ref.source_id+' · '+activity.source_ref.json_pointer)?session.value.evidence_notes:[session.value.evidence_notes,reference].filter(Boolean).join('\n\n')
  if(notes.length>12000)throw new Error('교사 근거 메모가 길어 자료를 추가할 수 없습니다. 메모를 정리한 뒤 다시 선택해 주세요.')
  session.value.strategy=next;session.value.evidence_notes=notes
  if(add)session.value.actions.push({id:crypto.randomUUID(),text,due_date:'',status:'planned'})
  tab.value=preparation.value?'review':'counseling';notice.value='프로그램을 활동 계획과 실행과제 초안에 추가했습니다. 참여 조건을 확인하고 저장하세요.'
 }catch(e){error.value=readableError(e)}
}
function prepareFromProfile(){if(!teacher.value||planLocked.value||!session.value?.profile||!strategy.value)return;try{const profile=normalizeProfile(session.value.profile);session.value.strategy=adoptProfile(profile,strategy.value);if(!session.value.topic.trim())session.value.topic='학생 자료를 바탕으로 한 학기 전략';tab.value=preparation.value?'review':'counseling';notice.value='입력 자료에서 교사가 검토할 계획을 준비했습니다. 사전 전략을 작성한 뒤 학생 상담으로 이어가세요.'}catch(e){error.value=readableError(e)}}
function adoptFindings(){if(!localMode.value||planLocked.value||!strategy.value||!analysis.value||!session.value)return;session.value.strategy=applyAnalysis(strategy.value,analysis.value);tab.value=preparation.value?'review':'counseling';notice.value='빈 강점·보완점 항목에 분석 초안을 반영했습니다. 교사가 근거를 확인하고 편집한 뒤 저장해 주세요.'}
function addAnalysisAction(text:string){if(!planLocked.value&&session.value){session.value.actions.push({id:crypto.randomUUID(),text,due_date:'',status:'planned'});tab.value=preparation.value?'review':'counseling';notice.value='실행과제 초안에 추가했습니다. 내용과 기한을 확인한 뒤 저장해 주세요.'}}
function beforeUnload(event:BeforeUnloadEvent){if(dirty.value||busy.value||adminBusy.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>{document.title='학종 전략실';void initialize();window.addEventListener('beforeunload',beforeUnload);window.addEventListener('keydown',modalKeyboard);window.addEventListener('message',receiveTeacherConnection)})
onBeforeUnmount(()=>{controller?.abort();window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('keydown',modalKeyboard);window.removeEventListener('message',receiveTeacherConnection)})
</script>

<template>
<a class="skip" href="#main">학종 전략으로 이동</a>
<div class="app">
<header class="school-header" :class="{'student-service':ready&&!teacher}">
 <div class="topbar">
  <a class="brand" :href="manualHref" :target="localMode?'_blank':undefined" rel="noopener noreferrer" aria-label="사용 설명서 홈">
   <img class="school-logo" :src="schoolLogo" alt="대륜고등학교 교표" width="96" height="64">
   <span class="brand-copy"><strong>학종 전략실</strong></span>
  </a>

 </div>
 <div class="workspace-bar">
  <nav class="service-nav" aria-label="서비스 경로"><a :href="manualHref" :target="localMode?'_blank':undefined" rel="noopener noreferrer"><BookOpen :size="15"/>사용 설명서</a><ChevronRight :size="14" aria-hidden="true"/><a :href="strategyHubHref" :target="localMode?'_blank':undefined" rel="noopener noreferrer">학종 전략</a><ChevronRight :size="14" aria-hidden="true"/><span aria-current="page">학종 전략실</span></nav>
  <div class="top-actions"><span class="mode-chip"><Monitor v-if="localMode" :size="15"/><Cloud v-else :size="15"/>{{localMode?'이 PC에서 처리':'학생 전략 안내'}}</span><span v-if="health?.demo" class="badge warning">합성자료 시연</span><span v-else-if="ready" class="actor">{{health?.teacher?.display_name||health?.user?.display_name}} {{teacher?'교사':''}}</span><button v-if="canManage&&!adminOpen" class="text-button" :disabled="!!busy||adminBusy" @click="openAdmin"><ShieldCheck :size="17"/>학생·담당 관리</button><button v-if="ready&&!localMode&&teacher" class="icon-button" aria-label="일반 AI 설정" @click="settingsOpen=true"><Settings :size="20"/></button></div>
  <nav class="online-resources" aria-label="전략실 설치와 안내"><a v-if="transport?.mode==='online'&&(teacher||canManage)" href="/counseling/downloads/daeryun-counseling-local.zip" download><Download :size="15"/>로컬 앱 내려받기</a><a :href="guideHref" target="_blank" rel="noopener noreferrer">사용 안내</a></nav>
 </div>
</header>

<div v-if="error&&!newOpen" class="message error" role="alert"><AlertCircle :size="20"/><span>{{error}}</span><div class="button-row"><button v-if="conflict&&draft" @click="exportJson">작성 내용 백업</button><button v-if="conflict" @click="reload">최신 기록 불러오기</button><button class="icon-button" aria-label="오류 안내 닫기" @click="error=''"><X :size="17"/></button></div></div>
<div v-if="notice" class="message success" role="status"><Check :size="18"/><span>{{notice}}</span><button class="icon-button" aria-label="알림 닫기" @click="notice=''"><X :size="16"/></button></div>
<div v-if="busy" class="jobbar" role="status" aria-live="polite"><LoaderCircle class="spin" :size="19"/><span>{{activeJob?.message||busy}}<small v-if="jobStage">{{jobStage}}</small></span><button v-if="activeJob||requestCancellable" class="secondary compact" @click="cancel">{{activeJob?'분석 취소':'요청 취소'}}</button></div>

<section v-if="!localMode&&connectTarget" class="card connect-panel"><div><span class="eyebrow">교사 PC 연결</span><h2>이 PC의 전략실과 교사 계정을 연결합니다.</h2><p>연결할 주소: <code>{{connectTarget}}</code></p><p>교사 인증만 전달합니다. 학생부와 교사 기록은 이 창으로 보내지 않습니다.</p><p v-if="ready&&!teacher" class="help">승인된 교사 계정에서만 PC를 연결할 수 있습니다.</p></div><button v-if="ready&&teacher" class="primary" :disabled="connectionSent||!health?.teacher?.approved" @click="sendTeacherConnection">{{connectionSent?'연결 요청 전달됨':'이 PC 연결'}} <Monitor :size="17"/></button><p v-else-if="!ready" class="help">아래에서 대륜고 로그인을 먼저 확인해 주세요.</p></section>
<main v-if="!ready" id="main" class="welcome">
 <section class="card auth-card"><h2>{{localMode?'교사 계정 연결':'학종 전략실 로그인'}}</h2><template v-if="localMode"><p>교사 계정으로 이 PC의 전략실을 엽니다.</p><button class="primary wide" :disabled="busy!==''" @click="openTeacherConnection">대륜고 계정으로 연결 <ExternalLink :size="17"/></button><details class="advanced-auth"><summary>고급 연결 · 인증 토큰 직접 입력</summary><label>교사 인증 토큰<input v-model="authToken" type="password" autocomplete="off" placeholder="대륜고 로그인 연결 토큰"></label><button class="primary wide" :disabled="busy!==''||!authToken.trim()" @click="authenticate">교사 계정 확인</button></details></template><template v-else><p>학교 계정으로 시작합니다.</p><a :href="schoolLoginUrl()" :target="connectTarget?'_blank':undefined" rel="noopener noreferrer" class="primary wide">로그인하고 전략실로 이동 <ChevronRight :size="16"/></a><button class="secondary wide" :disabled="busy!==''" @click="initialize">로그인 상태 다시 확인</button><small v-if="connectTarget">로그인은 새 탭에서 진행합니다. 로그인 후 이 연결 창에서 ‘로그인 상태 다시 확인’을 누른 뒤 ‘이 PC 연결’을 확인해 주세요.</small></template></section>
</main>

<AdminPanel v-else-if="canManage&&adminOpen&&transport" :api="transport" :can-return="health?.user?.role!=='manager'" @busy="adminBusy=$event" @close="closeAdmin"/>
<div v-else class="layout" :class="{'student-workspace':!teacher}">
 <button class="mobile-list secondary" @click="sidebarOpen=!sidebarOpen"><FolderOpen :size="17"/>{{teacher?'학생별 전략 목록':'나의 전략 목록'}}</button>
 <aside class="sidebar" :class="{open:sidebarOpen}"><div class="sidebar-head"><h2>{{teacher?'학생별 전략':'나의 전략'}}</h2><span>{{cases.length}}건</span><button class="icon-button mobile-sidebar-close" aria-label="학생 목록 닫기" @click="sidebarOpen=false"><X :size="19"/></button></div><button v-if="teacher" class="primary wide" :disabled="!!busy" @click="openNew"><Plus :size="18"/>새 전략</button><label class="search-box"><Search :size="17"/><input v-model="search" aria-label="학번 이름 전공 검색" placeholder="학번, 이름, 목표 전공"></label><div class="case-list"><button v-for="item in visibleCases" :key="item.id" class="case-item" :class="{active:draft?.id===item.id}" @click="openCase(item)"><span class="student-avatar">{{item.student.student_number.slice(-2)}}</span><span><strong>{{item.student.student_number}} <span>{{item.student.name}}</span></strong><small>{{item.sessions.at(-1)?.strategy?.target_major||item.sessions.at(-1)?.topic||'진로 방향 탐색 중'}}</small><span class="case-meta">{{item.sessions.length}}차 전략 · {{item.updated_at.slice(0,10)}}</span></span><ChevronRight :size="16"/></button><div v-if="!visibleCases.length" class="sidebar-empty">{{search?'검색한 전략이 없습니다.':'첫 학생 전략을 만들어 보세요.'}}</div></div><div class="sidebar-bottom"><button v-if="teacher" class="text-button" :disabled="!!busy" @click="jsonInput?.click()"><Upload :size="16"/>전략 백업 가져오기</button><p v-if="localMode"><ShieldCheck :size="15"/>학생부와 분석은 이 PC에서 처리합니다.</p><p v-else>현재 담당 학생의 전략을 확인합니다.</p></div></aside>

<main id="main" class="main">
 <div v-if="!draft" class="empty-main card"><MessageSquare :size="40"/><h1>{{teacher?'첫 학생 전략을 시작하세요.':'아직 안내된 전략이 없습니다.'}}</h1><p>{{teacher?'학생을 추가하거나 담당 학생을 선택하세요.':'선생님이 안내한 전략이 여기에 표시됩니다.'}}</p><button v-if="teacher" class="primary" @click="openNew"><Plus :size="18"/>학생 선택·자료 입력</button></div>
 <template v-else-if="session">
  <div class="document-heading"><div><span class="eyebrow">{{draft.student.academic_year}}학년도 · {{draft.student.school_stage==='middle'?'중학교':'고등학교'}} {{draft.student.grade}}학년</span><h1>{{draft.student.student_number}} <span>{{draft.student.name||'학생 전략'}}</span></h1><p>{{draft.teacher.display_name||'담당 교사'}}<template v-if="teacher"> · 전략 {{draft.sessions.length}}회차</template><template v-else-if="session.guidance"> · 안내 {{session.guidance.published_at.slice(0,10)}}</template></p></div><div class="document-actions"><span v-if="teacher" class="save-state" :class="{pending:dirty}">{{dirty?'저장 전 변경 있음':'저장된 기록'}}</span><button v-if="teacher" class="secondary" :disabled="!!busy" @click="exportJson"><Download :size="17"/>전략 백업 저장</button><button class="secondary" :disabled="!!busy||!studentPdfReady" @click="exportPdf('student')"><FileText :size="17"/>학생 안내 PDF 저장</button><button v-if="teacher" class="text-button" :disabled="!!busy" @click="exportPdf('teacher')">교사 검토용 PDF</button><button v-if="teacher&&!session.confirmed" class="primary" :disabled="!!busy||!dirty" @click="save"><Save :size="17"/>저장</button></div></div>
  <div class="session-bar"><div class="session-list" aria-label="전략 회차"><button v-for="(item,index) in draft.sessions" :key="item.id" :class="{active:item.id===selectedSessionId}" @click="selectSession(item.id)"><span>{{index+1}}회</span>{{item.date}}<Check v-if="item.confirmed" :size="14"/></button></div><button v-if="teacher" class="text-button" :disabled="!!busy" @click="nextSession"><Plus :size="16"/>회차 추가</button></div>
  <div v-if="teacher" class="context-strip"><span><CalendarDays :size="16"/>{{currentSessionIndex+1}}차 전략</span><span v-if="published" class="badge success">학생 안내 완료</span><span v-else-if="session.confirmed" class="badge success">{{health?.demo?'합성 시연 확정':'교사 확인 완료'}}</span><span v-else class="badge">전략 초안</span></div>
  <div v-if="teacher&&session.confirmed" class="inline-note"><ShieldCheck :size="18"/><span>확정한 전략입니다. 수정은 새 회차에서 진행하세요.</span><button v-if="teacher" class="text-button" :disabled="!!busy" @click="nextSession">다음 회차 만들기</button></div>
  <nav v-if="teacher" class="tabs workflow-tabs" aria-label="전략 작업"><template v-if="teacher"><button :class="{active:dataTab}" @click="tab='understanding'"><span aria-hidden="true">01</span>자료·분석</button><button :class="{active:tab==='counseling'}" @click="tab='counseling'"><span aria-hidden="true">02</span>교사 전략 수립<Check v-if="preparation" :size="14"/></button><button :class="{active:tab==='consultation'}" @click="tab='consultation'"><span aria-hidden="true">03</span>학생 상담·반영<Check v-if="session.consultation?.status==='completed'" :size="14"/></button><button :class="{active:tab==='review'}" @click="tab='review'"><span aria-hidden="true">04</span>최종 결과물<Check v-if="session.confirmed" :size="14"/></button></template></nav>
  <nav v-if="teacher&&dataTab" class="data-tools" aria-label="자료 분석 도구"><button :class="{active:tab==='understanding'}" @click="tab='understanding'"><BookOpen :size="16"/>학생 기본자료</button><button :class="{active:tab==='record'}" @click="tab='record'"><FileText :size="16"/>학생부 PDF 근거</button><button v-if="localMode" :class="{active:tab==='analysis'}" @click="tab='analysis'"><Sparkles :size="16"/>Ollama 근거 분석</button></nav>

  <StudentUnderstanding v-if="teacher&&tab==='understanding'&&session.profile" :session="session" :student="draft.student" :locked="locked" :plan-locked="planLocked" :local-mode="localMode" :school-context="schoolContext" @adopt="prepareFromProfile" @select-plan="adoptPreparationCard" @strategy="tab='counseling'" @record="tab='record'" @analysis="tab='analysis'" @evidence="showEvidence"><template #school-context><SchoolContextCards :data="schoolContext" :student="draft.student" :subjects="session.profile.selected_subjects" :locked="planLocked" @adopt="referenceSchoolTask" @adopt-activity="referenceSchoolActivity"/></template></StudentUnderstanding>
  <ConsultationEditor v-if="teacher&&tab==='consultation'&&session.consultation" :session="session" :locked="locked" :imported-reference="importedPreparation" @prepare="tab='counseling'" @complete="completeConsultation" @final="tab='review'"/>
  <section v-if="teacher&&tab==='counseling'" class="preparation-stage"><div><small>{{preparation?(importedPreparation?'가져온 사전 전략 · 원본 작성자·시각 미검증':'상담 전 전략 · 읽기 전용'):'교사 작성 초안'}}</small></div><div class="preparation-stage-action"><button v-if="!preparation" class="primary" :disabled="locked||prepareIssues.length>0" @click="prepareStrategy">전략 준비 완료·상담으로 <ChevronRight :size="17"/></button><button v-else class="secondary" @click="tab='consultation'">학생 상담·반영으로 <ChevronRight :size="17"/></button><small v-if="!preparation&&prepareIssues.length">{{prepareIssues[0]}}</small></div></section>
  <section v-if="teacher&&tab==='review'" class="card final-overview"><div class="profile-section-title"><h2>최종 결과물</h2></div><div v-if="!finalReady" class="workflow-gate"><p>{{finalIssues[0]}}</p><button class="primary" @click="tab=preparation?'consultation':'counseling'">{{preparation?'학생 상담·반영으로':'교사 전략 수립으로'}}</button></div><div v-else-if="session.consultation?.status==='completed'" class="consultation-reflection"><div><h3>상담에서 합의한 방향</h3><p>{{session.consultation.agreed_direction}}</p></div><div><h3>최종 전략에 반영할 점</h3><p>{{session.consultation.adjustments||'수정 사항 없음'}}</p></div><button class="text-button" @click="tab='consultation'">사전 전략·상담 기록 대조</button></div><p v-else class="help">기존 방식으로 작성한 회차입니다. 이전 기록을 보존하며, 새 회차부터 사전 전략·상담 반영 흐름을 사용합니다.</p></section>
  <div v-if="teacher&&tab==='review'&&finalReady" class="result-preview-bar"><span>{{session.confirmed?'학생에게 전달할 결과물':studentPreview?'현재 작성 내용 · 확정 전':'상담을 반영한 최종 내용'}}</span><button v-if="!session.confirmed" class="secondary" :aria-pressed="studentPreview" @click="toggleStudentPreview">{{studentPreview?'내용 수정':'학생 결과물 미리보기'}}</button></div>
  <StudentResult v-if="showStudentResult&&strategy" :topic="session.topic" :strategy="strategy" :actions="session.actions" :next-date="session.next_date" :preview="teacher"/>
  <section v-if="teacher&&!showStudentResult&&(tab==='counseling'||tab==='review'&&finalReady)&&displayedStrategy" class="editor-grid strategy-layout" :class="{'final-strategy':tab==='review'}">
   <div class="strategy-main"><StrategyEditor :topic="displayedTopic" :strategy="displayedStrategy" :read-only="strategyReadOnly" :locked="locked" :phase="!teacher?'published':tab==='review'?'final':'preparation'" @update:topic="session.topic=$event"/>
    <details v-if="teacher" class="card teacher-notes"><summary><ShieldCheck :size="18"/><strong>교사 참고 메모</strong><span>비공개</span></summary><fieldset :disabled="locked"><label>학생의 질문<textarea v-model="session.student_question" rows="3" placeholder="예: 관심 전공을 정하지 못했는데 어떤 수업부터 살펴보면 좋을까요?"></textarea></label><label>이전 상담과 현재 상황<textarea v-model="session.context" rows="3" placeholder="예: 이전 회차에서 자료 비교를 계획했고, 이번에 작성한 비교표를 확인함"></textarea></label><label>확인한 근거<textarea v-model="session.evidence_notes" rows="3" placeholder="예: 이번 학기 평가계획과 학생 활동지를 대조함. 시행 조건은 담당 교사 확인 예정"></textarea></label><label>교사의 의견<textarea v-model="session.teacher_opinion" rows="4" placeholder="예: 비교표의 근거 제시는 확인함. 자료 선택 이유를 설명할 수 있는지는 다음 점검에서 확인"></textarea></label></fieldset></details>
   </div>
   <aside class="side-panel"><section class="card"><div class="section-heading compact-heading"><CalendarDays :size="21"/><h2>실행과제</h2></div>
    <template v-if="strategyReadOnly"><div v-for="(action,index) in displayedActions" :key="action.id" class="student-action"><span class="eyebrow">과제 {{index+1}}</span><h3>{{action.text}}</h3><p>{{action.due_date?'점검일 '+action.due_date:'점검일을 함께 정합니다.'}}</p><span class="badge">{{{planned:'계획',in_progress:'진행 중',done:'수행 확인',deferred:'보류'}[action.status]}}</span></div><p v-if="!displayedActions.length" class="help">{{teacher?'사전 전략에 포함된 실행과제가 없습니다.':'다음 점검에서 실행과제를 함께 정합니다.'}}</p></template>
    <fieldset v-else :disabled="locked"><div v-for="(action,index) in session.actions" :key="action.id" class="action-card"><div class="action-heading"><span>실행과제 {{index+1}}</span><button class="icon-button" :aria-label="'실행과제 '+(index+1)+' 삭제'" @click="removeAction(action.id)"><Trash2 :size="16"/></button></div><label class="sr-only" :for="'action-'+action.id">실행과제 {{index+1}}</label><textarea :id="'action-'+action.id" v-model="action.text" rows="3"  :placeholder="'예: '+actionExample"></textarea><FieldExample :text="actionExample"/><div class="field-grid"><label>점검일<input v-model="action.due_date" type="date"></label><label>진행 상태<select v-model="action.status"><option value="planned">계획</option><option value="in_progress">진행 중</option><option value="done">수행 확인</option><option value="deferred">보류</option></select></label></div></div><button class="secondary wide" @click="addAction"><Plus :size="16"/>실행과제 추가</button><div class="field-grid result-schedule"><label>작성일<input v-model="session.date" type="date"></label><label>다음 점검일<input v-model="session.next_date" type="date"></label></div></fieldset>
   </section>

   <section v-if="!localMode&&teacher&&!strategyReadOnly" class="card ai-card"><div class="section-heading compact-heading"><Sparkles :size="21"/><h2>AI 전략 초안</h2></div><p>학생부 원문·로컬 분석은 붙여 넣지 마세요.</p><button class="text-button" @click="settingsOpen=true">연결 설정 · {{settings.provider==='server'?'서버 AI':settings.provider==='gemini'?'개인 Gemini':'이 PC의 Ollama'}}</button><label v-if="settings.provider!=='ollama'" class="check-label"><input v-model="externalConsent" type="checkbox">학생 기본자료·전략·교사 메모·상담 반영 기록이 선택한 외부 AI로 전송됨을 확인했습니다.</label><button class="secondary wide" :disabled="locked||(!externalConsent&&settings.provider!=='ollama')||(settings.provider==='server'&&!health?.ai?.server)" @click="generalAi"><Sparkles :size="16"/>전략 초안 요청</button><p v-if="settings.provider==='server'&&!health?.ai?.server" class="help">현재 학교 서버 AI를 사용할 수 없습니다. 직접 전략을 작성할 수 있습니다.</p><div v-if="aiDraft" class="ai-output"><span class="badge">교사 검토 전 AI 초안</span><p>{{aiDraft}}</p><p class="help">필요한 내용을 전략 항목에 옮겨 적은 뒤 저장하세요.</p></div></section>
   </aside>
  </section>

  <section v-if="teacher&&tab==='record'" class="card">
   <template v-if="!localMode"><div class="local-only"><Monitor :size="40"/><h2>학생부는 교사 PC에서 살펴봅니다.</h2><p>교사용 · Ollama 모델 필요</p><div class="button-row local-resource-buttons"><a class="secondary" href="/counseling/downloads/daeryun-counseling-local.zip" download><Download :size="16"/>로컬 실행기 다운로드</a><a class="secondary" href="/counseling/guide.html#local-analysis" target="_blank" rel="noopener noreferrer">설치 및 분석 안내 <ExternalLink :size="15"/></a></div><a class="primary" href="http://127.0.0.1:8765/counseling/" target="_blank" rel="noopener noreferrer">로컬 전략실 열기 <ExternalLink :size="16"/></a><small>먼저 로컬 실행기를 시작해 주세요. 로컬 학생부와 분석·파생 전략은 온라인 보관함으로 옮기지 않습니다.</small></div></template>
   <template v-else><div class="section-heading"><span class="step">02</span><div><h2>학생부 PDF 확인</h2><p>내용이 없거나 읽히지 않은 항목을 학생의 약점으로 판단하지 않습니다.</p></div></div><div v-if="health?.demo" class="inline-note warning"><AlertCircle :size="18"/><div><strong>제공된 합성 PDF만 사용할 수 있습니다.</strong><p>실제 학생부를 업로드하지 마세요. 이 모드는 교사 인증과 실제 상담 검토를 대신하지 않습니다.</p><div class="button-row"><button v-for="fixture in fixtures" :key="fixture.id" class="text-button" :disabled="!!busy" @click="fixturePdf(fixture.id)"><Download :size="15"/>{{fixture.title}}</button></div></div></div>
   <fieldset :disabled="locked"><div class="upload-area" :class="{'drag-active':pdfDragDepth>0&&!locked}" @dragenter="enterPdf" @dragover="dragPdf" @dragleave="leavePdf" @drop="dropPdf"><Upload :size="28"/><h3>{{pdfDragDepth&&!locked?'여기에 PDF를 놓으세요':record?'다른 PDF를 끌어 놓거나 선택':'학생부 PDF를 끌어 놓거나 선택'}}</h3><p>20MB, 80페이지 이내 · 원본과 추출 내용은 이 PC에 보관합니다.</p><button class="secondary" @click="pdfInput?.click()">PDF 파일 선택</button><span v-if="selectedPdf" class="selected-file" role="status">{{selectedPdf.name}}</span></div><div v-if="selectedPdf" class="upload-controls"><label>PDF 암호 <small>암호가 있는 파일만 입력</small><input v-model="pdfPassword" type="password" autocomplete="off"></label><button class="primary" @click="upload">항목 추출하기</button></div></fieldset>
   <template v-if="record"><div class="record-summary"><div><strong>{{record.filename}}</strong><p>{{record.page_count}}페이지 · 읽은 페이지 {{record.readable_pages.length}} · 확인이 필요한 페이지 {{record.unreadable_pages.length}}</p></div><span class="badge">{{record.sections.length}}개 추출 항목</span></div><div v-if="record.warnings.length" class="inline-note warning"><AlertCircle :size="19"/><ul><li v-for="warning in record.warnings" :key="warning">{{warning}}</li></ul></div><RecordEvidence v-for="section in record.sections" :key="draft.id+session.id+record.id+section.id" :section="section" :locked="locked" :highlight="evidenceId===section.id" :save="metadata=>saveRecordMetadata(section.id,metadata)"/><button class="primary next-button" :disabled="locked" @click="tab='analysis'">근거를 확인하고 분석 준비 <ChevronRight :size="17"/></button></template></template>
  </section>

  <section v-if="teacher&&tab==='analysis'&&localMode" class="analysis-layout"><div class="card"><div class="section-heading"><span class="step">03</span><div><h2>근거에서 다음 전략으로</h2><p>설치된 Ollama 모델로 분석합니다. 결과는 교사가 원문과 대조할 초안입니다.</p></div></div><div v-if="!record" class="empty-section"><FileText :size="32"/><h3>학생부의 판독 상태를 먼저 확인해 주세요.</h3><button class="secondary" @click="tab='record'">학생부 근거로 이동</button></div><template v-else><div class="model-controls"><label>이 PC의 Ollama 모델<select v-model="model" :disabled="locked"><option value="" disabled>모델 선택</option><option v-for="item in health?.ollama.models" :key="item.name" :value="item.name">{{item.name}}{{item.vision?' · 이미지 지원':''}}</option></select></label><label>제안 시간 상한<input v-model.number="budget" type="number" min="5" max="600" :disabled="locked"><small>{{session.profile?.weekly_minutes===0?'추가 시간 없음 · 기존 수업 안에서 제안':session.profile?.weekly_minutes==null?'학생 가용 시간 미확인 · 추가 배정 보류':'분 단위 · 확인된 가용 시간 '+session.profile.weekly_minutes+'분 이내 적용'}}</small></label><button class="primary" :disabled="locked||!model||!health?.ollama.available" @click="analyze"><Sparkles :size="17"/>{{analysis?'다시 분석':'분석 시작'}}</button></div><p v-if="!health?.ollama.available" class="inline-note warning">{{health?.ollama.message||'Ollama 연결과 설치된 모델을 확인해 주세요.'}} <button class="text-button" :disabled="!!busy" @click="refreshConnection">연결 다시 확인</button></p><p class="help">전략 제목: {{session.topic||'학종 전략에서 제목과 진로 방향을 먼저 적어 주세요.'}}</p></template></div>
   <template v-if="analysis"><section class="card guidance-card"><h2>분석에서 학생 전략으로</h2><p>선택한 분석을 빈 강점·보완점에 추가합니다.</p><button class="primary" :disabled="planLocked||(!analysis.strengths.length||!!strategy?.strengths.trim())&&(!analysis.improvements.length||!!strategy?.gaps.trim())" @click="adoptFindings">강점·보완점을 전략에 반영</button><small v-if="strategy?.strengths.trim()&&strategy?.gaps.trim()">이미 작성한 강점과 보완점은 학종 전략에서 직접 편집하세요.</small></section><section class="card summary-card"><span class="eyebrow">분석 초안</span><h2>현재의 배움</h2><p class="analysis-summary">{{analysis.summary}}</p><small>{{analysis.model}} · {{analysis.created_at.slice(0,16).replace('T',' ')}}</small></section><div class="findings-grid"><section class="card"><h2>강점과 이어 갈 방향</h2><article v-for="(finding,index) in analysis.strengths" :key="index" class="finding"><h3>{{finding.text}}</h3><p>{{finding.guidance}}</p><div class="evidence-links"><button v-for="id in finding.evidence_ids" :key="id" @click="showEvidence(id)"><FileText :size="14"/>{{record?.sections.find(s=>s.id===id)?.label||'근거 확인'}}</button></div></article><p v-if="!analysis.strengths.length" class="muted">제공된 범위에서 확인한 강점 항목이 없습니다.</p></section><section class="card"><h2>보완을 위해 필요한 도움</h2><article v-for="(finding,index) in analysis.improvements" :key="index" class="finding"><h3>{{finding.text}}</h3><p>{{finding.guidance}}</p><div class="evidence-links"><button v-for="id in finding.evidence_ids" :key="id" @click="showEvidence(id)"><FileText :size="14"/>{{record?.sections.find(s=>s.id===id)?.label||'근거 확인'}}</button></div></article><p v-if="!analysis.improvements.length" class="muted">제공된 근거에서 보완 항목을 확정하지 않았습니다.</p></section></div><section class="card"><h2>상담에서 함께 확인할 질문</h2><ol class="question-list"><li v-for="question in analysis.questions" :key="question">{{question}}</li></ol><h3>제안된 실행과제</h3><article v-for="(action,index) in analysis.actions" :key="index" class="suggested-action"><div><h4>{{action.text}}</h4><p>{{action.reason}}</p><div class="evidence-links"><button v-for="id in action.evidence_ids" :key="id" @click="showEvidence(id)">근거 확인</button></div></div><button class="secondary compact" :disabled="planLocked" @click="addAnalysisAction(action.text)"><Plus :size="15"/>실행과제 초안에 추가</button></article><div v-if="analysis.limitations.length" class="inline-note warning"><AlertCircle :size="18"/><ul><li v-for="limitation in analysis.limitations" :key="limitation">{{limitation}}</li></ul></div></section></template>
  </section>

  <section v-if="teacher&&tab==='review'&&finalReady" class="card review-panel"><div class="section-heading"><h2>최종 확인</h2></div><div v-if="contentIssues.length&&!session.confirmed" class="inline-note warning" role="status"><ul><li v-for="issue in contentIssues" :key="issue">{{issue}}</li></ul></div><details class="review-criteria"><summary>최종 확인 항목</summary><p>학생 근거 → 이번 할 일 → 산출물·점검일·확인 기준을 대조하세요. 학교 과제의 조건과 상담에서 합의한 내용도 확인하세요.</p></details><div v-if="teacher&&!session.confirmed" class="button-row"><button class="secondary" :disabled="!!busy" @click="reviewCase(false)"><ClipboardCheck :size="17"/>자동 점검 후 직접 검토</button><button v-if="localMode" class="secondary" :disabled="!!busy||!model||!health?.ollama.available" @click="reviewCase(true)"><Sparkles :size="17"/>선택한 Ollama로 문체 검토</button></div><p v-if="dirty" class="inline-note warning">내용이 변경됐습니다. 다시 점검해 주세요.</p><div v-if="review" class="review-result"><span class="badge" :class="{success:review.state==='passed',warning:review.state!=='passed'}">{{review.state==='passed'?'점검 결과 확인 가능':review.state==='needs_revision'?'수정 후 다시 검토':'교사 직접 확인 필요'}}</span><p>{{review.method==='ollama'?'Ollama 문체 검토':'자동 점검 및 교사 직접 검토'}} · {{review.created_at.slice(0,16).replace('T',' ')}}</p><ul><li v-for="note in review.notes" :key="note">{{note}}</li></ul><p v-if="!review.notes.length">점검 의견이 없습니다. 아래 확인 항목을 교사가 직접 검토해 주세요.</p></div><div v-else class="empty-section compact-empty"><ClipboardCheck :size="28"/><p>현재 저장 내용에 대한 검토 결과가 없습니다.</p></div><div v-if="teacher&&!session.confirmed" class="confirm-area"><label class="check-label"><input v-model="reviewAcknowledged" type="checkbox" :disabled="!reviewConfirmable||!!busy">학생 근거·학교 조건·실행과제와 문체 의견을 확인했습니다.</label><button class="primary" :disabled="!reviewAcknowledged||!reviewConfirmable||!!busy" @click="confirmCase"><ShieldCheck :size="18"/>{{health?.demo?'합성 시연 회차 확정':'교사 확인 후 확정'}}</button><small v-if="health?.demo">합성자료 시연의 확정은 실제 교사가 학생 전략을 승인했다는 뜻이 아닙니다.</small></div><div v-if="session.confirmed" class="inline-note success"><ShieldCheck :size="20"/><p>{{health?.demo?'합성 시연으로 확정한 회차입니다.':'교사가 확인한 전략 회차입니다.'}} 변경할 내용은 다음 회차에 이어서 기록합니다.</p></div><div class="guidance-card final-delivery"><h2>학생에게 전달</h2><template v-if="localMode"><p>학생용 PDF에는 최종 전략·실행과제만 담깁니다. 원문과 교사 기록은 이 PC에 보관합니다.</p><button class="primary" :disabled="!!busy||!session.confirmed||dirty||!finalReady" @click="exportPdf('student')">학생 안내 PDF 저장</button><small v-if="!session.confirmed">최종 검토와 교사 확정을 먼저 완료하세요.</small></template><template v-else><template v-if="!studentAccountLinked"><p>학생 계정 없이 추가한 학생입니다. 최종 확정 후 학생 안내 PDF로 전달해 주세요.</p><small>인쇄 창에서 PDF로 저장을 선택하세요.</small><button class="primary" :disabled="!studentPdfReady||!!busy" @click="exportPdf('student')">학생 안내 PDF 저장</button></template><p v-else-if="published">{{session.guidance?.published_at.slice(0,10)}} 학생에게 안내했습니다. 개정은 새 회차에서 진행합니다.</p><template v-else><p>최종 전략·실행과제를 학생 계정에 공개합니다. 교사 메모·사전 전략·상담 기록은 제외합니다.</p><button class="primary" :disabled="!!busy||!session.confirmed||dirty||!finalReady" @click="publishStrategy">학생에게 전략 안내</button><small v-if="!session.confirmed">최종 검토와 교사 확정을 먼저 완료하세요.</small></template></template></div></section>
 </template><footer class="footer">학종 전략실 · {{localMode?'학생부와 파생 자료는 교사 PC에서 보관합니다.':'학생과 담당 교사가 전략과 실행을 함께 점검합니다.'}}</footer>
</main></div>

<input v-if="teacher" ref="jsonInput" class="hidden" type="file" accept=".json,application/json" @change="readImport">
<input v-if="teacher&&localMode" ref="pdfInput" class="hidden" type="file" accept=".pdf,application/pdf" @change="choosePdf">

<div v-if="newOpen" class="modal-backdrop" @click.self="!busy&&(newOpen=false)"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="new-title">
 <header><div><span class="eyebrow">새 전략</span><h2 id="new-title">학생 선택</h2></div><button class="icon-button" aria-label="닫기" :disabled="!!busy" @click="newOpen=false"><X :size="20"/></button></header>
 <form @submit.prevent="createCase">
  <fieldset :disabled="!!busy">
   <template v-if="localMode">
    <div class="field-grid"><label>학번<input v-model="newStudent.student_number" inputmode="numeric" required pattern="[0-9]{4,8}" placeholder="예: 10101"></label><label>학생 이름 <small>선택</small><input v-model="newStudent.name" autocomplete="off"></label></div>
    <div class="field-grid three"><label>학년도<input v-model.number="newStudent.academic_year" type="number" min="2000" max="2100" required></label><label>학교급<select v-model="newStudent.school_stage" aria-label="학교급"><option value="high">고등학교</option><option value="middle">중학교</option></select></label><label>학년<select v-model.number="newStudent.grade" aria-label="학년"><option :value="1">1학년</option><option :value="2">2학년</option><option :value="3">3학년</option></select></label></div>
    <label>상담 교사<input v-model="newTeacher" :disabled="!health?.demo" placeholder="상담 교사 표시 이름"></label><p v-if="health?.demo" class="inline-note warning">합성 학번과 이름으로 시연해 주세요. 실제 학생 정보는 입력하지 않습니다.</p>
   </template>
   <template v-else>
    <div v-if="canAddStudent" class="button-row new-student-mode" role="group" aria-label="학생 등록 방법">
     <button type="button" :class="newStudentMode==='assigned'?'primary':'secondary'" :aria-pressed="newStudentMode==='assigned'" @click="selectNewStudentMode('assigned')">배정된 학생 선택</button>
     <button type="button" :class="newStudentMode==='manual'?'primary':'secondary'" :aria-pressed="newStudentMode==='manual'" @click="selectNewStudentMode('manual')"><Plus :size="16"/>학생 직접 추가</button>
    </div>
    <template v-if="newStudentMode==='manual'&&canAddStudent">
     <p class="inline-note">추가한 학생은 내 담당 학생으로 등록됩니다.</p>
     <div class="field-grid"><label>학생 이름<input v-model="newStudent.name" required maxlength="80" autocomplete="off" placeholder="예: 홍길동"></label><label>학번<input v-model="newStudent.student_number" inputmode="numeric" required pattern="[0-9]{4,8}" maxlength="8" placeholder="예: 10101"></label></div>
     <div class="field-grid three"><label>학년도<input v-model.number="newStudent.academic_year" type="number" min="2020" max="2100" required></label><label>학교급<select v-model="newStudent.school_stage" aria-label="학교급"><option value="high">고등학교</option><option value="middle">중학교</option></select></label><label>학년<select v-model.number="newStudent.grade" aria-label="학년"><option :value="1">1학년</option><option :value="2">2학년</option><option :value="3">3학년</option></select></label></div>
    </template>
    <template v-else>
     <label>배정된 학생<select v-model="onlineStudentId" aria-label="배정된 학생" required :disabled="!availableStudents.length"><option v-for="student in availableStudents" :key="student.student_id" :value="student.student_id">{{student.academic_year}} · {{student.student_number}} {{student.name}}</option></select></label>
     <p v-if="!availableStudents.length" class="inline-note">배정된 학생이 없습니다. {{canAddStudent?'학생 직접 추가를 선택해 첫 전략을 시작하세요.':'학생 배정을 관리자에게 확인해 주세요.'}}</p>
     <p v-else-if="addedStudentId&&onlineStudentId===addedStudentId" class="inline-note success">학생을 내 담당 학생으로 등록했습니다. 첫 전략 만들기를 누르면 이 학생으로 이어서 시작합니다.</p>
     <p v-else class="help"></p>
    </template>
   </template>
  </fieldset>
  <p v-if="error" class="inline-note warning" role="alert">{{error}}</p>
  <p v-if="busy" class="help" role="status">{{busy}}</p>
  <div class="modal-actions"><button type="button" class="secondary" :disabled="!!busy" @click="newOpen=false">취소</button><button class="primary" :disabled="!!busy||(!localMode&&newStudentMode==='assigned'&&!onlineStudentId)">{{!localMode&&newStudentMode==='manual'?'학생 추가하고 전략 시작':'첫 전략 만들기'}}</button></div>
 </form>
</section></div>

<div v-if="importBundle" class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><header><h2 id="import-title">가져올 전략의 학생 확인</h2><button class="icon-button" aria-label="닫기" @click="importBundle=null"><X :size="20"/></button></header><div class="import-summary"><span class="eyebrow">{{importBundle.case.student.academic_year}}학년도</span><h3>{{importBundle.case.student.student_number}} {{importBundle.case.student.name}}</h3><p>{{importBundle.case.sessions.length}}차 전략 · {{importBundle.case.teacher.display_name}}</p><p>{{importBundle.case.privacy==='local_only'?'이 PC에 보관하는 전략':'온라인 일반 전략'}}</p></div><p>기존 기록을 덮어쓰지 않고 새 사본으로 가져옵니다. 이전 검토와 확정 표시는 현재 교사의 확인으로 승계하지 않습니다.</p><div v-if="dirty" class="inline-note warning import-draft-warning"><p>현재 화면에 저장하지 않은 전략·상담 기록이 있습니다. 먼저 백업하거나 가져오기를 취소하고 저장할 수 있습니다.</p><button class="secondary compact" :disabled="!!busy" @click="exportJson"><Download :size="16"/>현재 작성 내용 먼저 백업</button></div><p v-if="!validImportStudent" class="inline-note warning">현재 교사에게 배정된 학생의 백업이 아닙니다. 학생과 담당 관계를 확인해 주세요.</p><label class="check-label"><input v-model="importAcknowledged" type="checkbox">학년도, 학번과 상담 학생이 맞는지 확인했습니다.</label><div class="modal-actions"><button class="secondary" @click="importBundle=null">취소</button><button class="primary" :disabled="!importAcknowledged||!validImportStudent||!!busy" @click="importCase">새 사본으로 가져오기</button></div></section></div>

<div v-if="settingsOpen&&teacher&&!localMode" class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><h2 id="settings-title">AI 전략 초안 설정</h2><button class="icon-button" aria-label="닫기" @click="settingsOpen=false"><X :size="20"/></button></header><p>온라인 전략용 AI 설정</p><label>연결 방식<select v-model="settings.provider"><option value="server">대륜고 서버 AI</option><option value="gemini">개인 Gemini API</option><option value="ollama">이 PC의 Ollama</option></select></label><p v-if="settings.provider==='server'" class="help">{{health?.ai?.server?'서버가 관리하는 모델을 사용합니다. 개인 키를 입력하지 않습니다.':'서버 AI의 운영 설정을 아직 확인할 수 없습니다. 요청 시 서버의 안내를 확인해 주세요.'}}</p><template v-else><label>모델 이름<input v-model="settings.model" autocomplete="off" placeholder="사용 권한이 있거나 설치된 모델 이름"></label><label v-if="settings.provider==='gemini'">개인 API 키<input v-model="settings.apiKey" type="password" autocomplete="off" placeholder="이 브라우저에만 저장"></label><label v-if="settings.provider==='ollama'">Ollama 주소<input v-model="settings.ollamaUrl" placeholder="http://127.0.0.1:11434"><small>브라우저에서 로컬 Ollama 연결이 허용되어야 합니다.</small></label></template><p class="help">개인 설정은 이 도메인의 이 브라우저에 저장합니다. API 키를 상담 본문, 백업, URL에 넣지 않습니다. 공용 기기에서는 사용 후 키를 지워 주세요.</p><div class="modal-actions"><button class="secondary" @click="clearApiKey">개인 키 지우기</button><button class="primary" @click="saveSettings">설정 저장</button></div></section></div>
</div>
</template>
