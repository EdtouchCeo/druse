import type { Analysis, Backup, CounselingCase, Mode, Session, Strategy } from './types'
import {normalizeProfile} from './profile'
import {normalizeWorkflow} from './workflow'
export function applyAnalysis(strategy:Strategy,analysis:Analysis):Strategy {const next={...strategy};if(!next.strengths.trim())next.strengths=analysis.strengths.map(f=>[f.text,f.guidance].filter(Boolean).join('\n')).join('\n\n');if(!next.gaps.trim())next.gaps=analysis.improvements.map(f=>[f.text,f.guidance].filter(Boolean).join('\n')).join('\n\n');return next}
export const strategyFields = [
 {key:'target_major',label:'목표 전공',hint:'관심 전공이나 아직 탐색 중인 계열을 적습니다.'},
 {key:'target_path',label:'진로 방향',hint:'학생이 관심을 갖는 문제와 진로를 탐색할 방향을 적습니다.'},
 {key:'strengths',label:'강점',hint:'확인한 학습 행동과 근거를 중심으로 적습니다.'},
 {key:'gaps',label:'보완점',hint:'확인된 어려움과 필요한 도움을 구분하고, 불확실한 내용은 질문으로 남깁니다.'},
 {key:'subject_plan',label:'교과 계획',hint:'실제 이수 과목과 과제의 연도·학기·마감·허용 조건을 확인해 학습과 점검 기준을 적습니다.'},
 {key:'inquiry_plan',label:'탐구 계획',hint:'질문 → 방법 → 산출물 → 피드백 순서로 수업 범위에 맞는 탐구를 계획합니다.'},
 {key:'activity_plan',label:'활동 계획',hint:'학교에서 실제 참여할 수 있는 활동과 학생의 역할을 확인해 적습니다.'},
 {key:'semester_plan',label:'학기별 계획',hint:'학기별 목표와 점검 시점, 다음 단계로 넘어갈 조건을 적습니다.'},
 {key:'student_message',label:'학생 안내 메시지',hint:'학생이 지금 할 일과 함께 점검할 내용을 직접 안내합니다.'},
] as const satisfies readonly {key:keyof Strategy;label:string;hint:string}[]
export function emptyStrategy():Strategy{return {target_major:'',target_path:'',strengths:'',gaps:'',subject_plan:'',inquiry_plan:'',activity_plan:'',semester_plan:'',student_message:''}}
export function normalizeCase(value:CounselingCase):CounselingCase {const copy=clone(value);for(const session of copy.sessions){session.profile=normalizeProfile(session.profile);const input=session.strategy;session.strategy=emptyStrategy();for(const {key} of strategyFields)if(typeof input?.[key]==='string')session.strategy[key]=input[key];session.guidance=session.guidance||null;normalizeWorkflow(session)}return copy}
export function studentView(value:CounselingCase):CounselingCase|null {const copy=clone(value);for(const s of copy.sessions){delete s.profile;delete s.preparation;delete s.consultation;delete s.workflow_version;delete s.imported_history}const normalized=normalizeCase(copy);delete normalized.imported_from;normalized.sessions=normalized.sessions.filter(s=>Boolean(s.guidance?.published_at&&s.guidance?.published_by));if(!normalized.sessions.length)return null;for(const s of normalized.sessions){delete s.profile;delete s.preparation;delete s.consultation;delete s.workflow_version;delete s.imported_history;s.student_question='';s.context='';s.evidence_notes='';s.teacher_opinion='';s.record=null;s.analysis=null;s.review=null;s.confirmed=null}normalized.current_session_id=normalized.sessions.some(s=>s.id===normalized.current_session_id)?normalized.current_session_id:normalized.sessions.at(-1)!.id;return normalized}
export function draftBackup(value:CounselingCase,sessionId:string):Backup {
 const copy=clone(value),current=sessionOf(copy,sessionId)
 current.review=null;current.confirmed=null;current.guidance=null
 const consultation=current.consultation
 if(consultation?.status==='completed'&&(!consultation.date||!consultation.student_response.trim()||!consultation.agreed_direction.trim()))consultation.status='in_progress'
 return {format:'daeryun-counseling',version:1,case:copy}
}
export function isLoopback(host:string):boolean { return ['localhost','127.0.0.1','::1','[::1]'].includes(host.toLowerCase()) }
export function modeForHost(host:string):Mode { return isLoopback(host) ? 'local' : 'online' }
export const clone = <T>(value:T):T => JSON.parse(JSON.stringify(value)) as T
export const stamp = (value:unknown):string => JSON.stringify(value)
export function sessionOf(value:CounselingCase,id:string):Session { const found=value.sessions.find(s=>s.id===id);if(!found)throw new Error('상담 회차를 찾을 수 없습니다. 목록을 다시 불러와 주세요.');return found }
export function hasPrivateMaterial(value:CounselingCase):boolean { return value.privacy==='local_only'||value.sessions.some(s=>Boolean(s.record||s.analysis)) }
export function assertStandard(value:CounselingCase):void { if(hasPrivateMaterial(value))throw new Error('학생부를 사용한 로컬 상담은 온라인으로 전송할 수 없습니다. 로컬 상담실에서 열어 주세요.') }
export function parseBackup(text:string,mode:Mode):Backup {
 if(new TextEncoder().encode(text).length>30_000_000)throw new Error('백업 파일은 30MB 이내로 선택해 주세요.')
 let value:unknown;try{value=JSON.parse(text)}catch{throw new Error('JSON 파일을 읽지 못했습니다. 상담실에서 내려받은 백업을 선택해 주세요.')}
 if(!value||typeof value!=='object')throw new Error('상담 백업 형식이 아닙니다.')
 const b=value as Partial<Backup>,c=b.case
 if(b.format!=='daeryun-counseling'||b.version!==1||!c||c.schema_version!==1||!c.student||!c.teacher||typeof c.teacher.display_name!=='string'||!Array.isArray(c.sessions)||!c.sessions.length||typeof c.student.student_number!=='string'||typeof c.student.student_id!=='string'||typeof c.revision!=='number')throw new Error('학생 정보나 상담 회차를 확인할 수 없습니다. 원래 백업 파일을 다시 선택해 주세요.')
 if(!['local_only','standard'].includes(c.privacy)||c.sessions.some(s=>!s||typeof s.id!=='string'||typeof s.topic!=='string'||!Array.isArray(s.actions)))throw new Error('상담 기록의 필수 항목이 누락되었습니다.')
 if(mode==='online')assertStandard(c)
 if(c.sessions.some(s=>s.strategy!==undefined&&(!s.strategy||typeof s.strategy!=='object'||strategyFields.some(({key})=>s.strategy?.[key]!==undefined&&typeof s.strategy[key]!=='string'))))throw new Error('전략 항목은 글로 작성된 백업을 선택해 주세요.')
 return {...b,case:normalizeCase(c)} as Backup
}
export async function pdfBase64(file:File):Promise<string> {
 if(file.size>20*1024*1024)throw new Error('PDF는 20MB 이내로 선택해 주세요.')
 if(!/\.pdf$/i.test(file.name))throw new Error('학생부 PDF 파일을 선택해 주세요.')
 const bytes=new Uint8Array(await file.arrayBuffer())
 if(new TextDecoder('ascii').decode(bytes.slice(0,5))!=='%PDF-')throw new Error('PDF 형식을 확인할 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.')
 let binary='';for(let start=0;start<bytes.length;start+=16384)binary+=String.fromCharCode(...bytes.subarray(start,start+16384))
 return btoa(binary)
}
export function safeFilename(name:string):string {return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,80)||'상담기록'}
export function reportFilename(studentNumber:string,date:string,audience:'student'|'teacher'):string{return safeFilename('학종전략_'+studentNumber+'_'+date+'_'+(audience==='student'?'학생안내':'교사검토')+'.pdf')}
export function download(blob:Blob,filename:string):void {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=safeFilename(filename);a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
export function readSessionToken(storage:Pick<Storage,'getItem'>):string|null {try{const s=JSON.parse(storage.getItem('dr_sess_v1')||'null');return s&&typeof s.token==='string'&&s.token?s.token:null}catch{return null}}
export function readableError(error:unknown):string {if(error instanceof DOMException&&error.name==='AbortError')return '요청을 취소했습니다.';return error instanceof Error?error.message:'요청을 처리하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'}
