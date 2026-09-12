import type { Backup, CounselingCase, Mode, Session } from './types'
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
 return b as Backup
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
export function download(blob:Blob,filename:string):void {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=safeFilename(filename);a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
export function readSessionToken(storage:Pick<Storage,'getItem'>):string|null {try{const s=JSON.parse(storage.getItem('dr_sess_v1')||'null');return s&&typeof s.token==='string'&&s.token?s.token:null}catch{return null}}
export function readableError(error:unknown):string {if(error instanceof DOMException&&error.name==='AbortError')return '요청을 취소했습니다.';return error instanceof Error?error.message:'요청을 처리하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'}
