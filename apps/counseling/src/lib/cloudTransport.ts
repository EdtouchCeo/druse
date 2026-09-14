import type {AdminAction,AdminData} from './admin'
import {checked} from './transport'
import {assertStandard,sessionOf,isLoopback} from './model'
import {SchoolSessionAuth} from './schoolSession'
import type {Transport,Health,Student,NewStudentInput,CounselingCase,Backup,Job,AiSettings,Actor} from './types'
import {validateNewStudent} from './students'
const base='/.netlify/functions/'
export class CloudTransport implements Transport {
 readonly mode='online' as const
 private auth:SchoolSessionAuth|undefined
 async admin(){return this.request<AdminData>('counseling-admin')}
 async administer(input:AdminAction){if(input.action==='role'&&input.role!=='student')throw new Error('학생의 상담 참여 권한만 변경할 수 있습니다. 교직원은 학교 회원 승인으로 자동 이용합니다.');return this.request<{ok?:boolean;student_id?:string}>('counseling-admin','POST',input)}
 private async authenticatedFetch(path:string,options:RequestInit={}):Promise<Response>{
  const auth=this.auth??=new SchoolSessionAuth(localStorage)
  let token=await auth.token()
  const send=()=>fetch(base+path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},cache:'no-store',credentials:'same-origin'})
  let response=await send()
  if(response.status===401){token=await auth.token(true,token);response=await send()}
  return checked(response)
 }
 private async request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{const r=await this.authenticatedFetch(path,{method,...(body!==undefined?{body:JSON.stringify(body)}:{}),signal});return r.json() as Promise<T>}
 private path(id?:string,action?:string){const q=new URLSearchParams();if(id)q.set('id',id);if(action)q.set('action',action);return 'counseling-cases'+(q.size?'?'+q:'')}
 async health(signal?:AbortSignal):Promise<Health>{const data=await this.request<{user:Actor;ai:{server:boolean};students:Student[]}>('counseling-session','GET',undefined,signal);return {mode:'online',demo:false,teacher:data.user.role==='teacher'?data.user:null,user:data.user,students:data.students,ai:data.ai,ollama:{available:false,models:[]}}}
 authenticate(_token:string){return this.health()}
 async list(signal?:AbortSignal){return(await this.request<{cases:CounselingCase[]}>(this.path(), 'GET',undefined,signal)).cases}
 async get(id:string){return(await this.request<{case:CounselingCase}>(this.path(id))).case}
 async addStudent(input:NewStudentInput){return(await this.request<{student:Student}>('counseling-students','POST',validateNewStudent(input))).student}
 async create(student:Student,teacher:string){return(await this.request<{case:CounselingCase}>(this.path(),'POST',{student:{student_id:student.student_id},teacher:{display_name:teacher}})).case}
 async save(value:CounselingCase){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id),'PUT',{case:value})).case}
 async deleteCase(value:CounselingCase){assertStandard(value);await this.request(this.path(value.id),'DELETE',{revision:value.revision})}
 async next(value:CounselingCase){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id,'next'),'POST',{revision:value.revision})).case}
 async importBackup(bundle:Backup){assertStandard(bundle.case);return(await this.request<{case:CounselingCase}>(this.path(undefined,'import'),'POST',{bundle,student_id:bundle.case.student.student_id,student_confirmed:true})).case}
 private async blob(path:string){return(await this.authenticatedFetch(path)).blob()}
 exportBackup(id:string){return this.blob(this.path(id,'export'))}
 report(id:string,sessionId:string,audience:'student'|'teacher'|'analysis'='teacher'){if(audience==='analysis')return Promise.reject(new Error('학생부 분석 보고서는 이 PC의 로컬 전략실에서 저장해 주세요.'));return this.blob(this.path(id,'report')+'&session_id='+encodeURIComponent(sessionId)+'&audience='+audience)}
 private restricted():never {throw new Error('학생부 분석은 교사 PC의 로컬 상담실에서만 사용할 수 있습니다.')}
 async upload():Promise<CounselingCase>{return this.restricted()}
 async updateRecordMetadata():Promise<CounselingCase>{return this.restricted()}
 async analyze():Promise<Job>{return this.restricted()}
 async review(value:CounselingCase,sessionId:string){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id,'review'),'POST',{revision:value.revision,session_id:sessionId})).case}
 async prepare(value:CounselingCase,sessionId:string){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id,'prepare'),'POST',{revision:value.revision,session_id:sessionId})).case}
  async confirm(value:CounselingCase,sessionId:string){assertStandard(value);return(await this.request<{case:CounselingCase}>(this.path(value.id,'confirm'),'POST',{revision:value.revision,session_id:sessionId,review_acknowledged:true})).case}
  async publish(value:CounselingCase,sessionId:string){assertStandard(value);const session=sessionOf(value,sessionId);if(!session.confirmed)throw new Error('전략을 검토하고 교사 확정을 먼저 완료해 주세요.');if(session.guidance)throw new Error('이미 학생에게 안내한 전략입니다. 개정은 새 회차에서 진행해 주세요.');return(await this.request<{case:CounselingCase}>(this.path(value.id,'publish'),'POST',{revision:value.revision,session_id:sessionId})).case}
 async job():Promise<Job>{return this.restricted()}
 async cancel():Promise<Job>{return this.restricted()}
 async fixtures(){return []}
 async fixture():Promise<Blob>{return this.restricted()}
 async generalAi(value:CounselingCase,sessionId:string,settings:AiSettings,signal?:AbortSignal):Promise<string>{
  assertStandard(value)
  if(settings.provider==='server')return(await this.request<{text:string}>('counseling-ai','POST',{case_id:value.id,session_id:sessionId,revision:value.revision,privacy:'standard',purpose:'counseling'},signal)).text
  if(!settings.model.trim())throw new Error('사용할 모델 이름을 입력해 주세요.')
  const session=sessionOf(value,sessionId)
  const prompt='다음 일반 상담과 학종 전략을 바탕으로 교사가 검토할 교과·탐구·활동·학기별 계획, 학생 안내와 실행과제를 제안하라. 목표 전공이 미정이면 탐색 대안을 제안하라. 학생이 실제로 하지 않은 일과 학생부 내용을 만들거나 합격을 보장하지 마라. 교사가 상담 전에 선택할 전략 판단 자료를 만들어라. 관찰 근거 → 교과·탐구·활동 계획 대안과 실행과제 → 확인할 자료 → 상담에서 점검할 질문 순서로 제안하라. 사전 전략과 상담 기록이 있으면 상담 전 계획과 학생 반응을 구분하고 최종 수정 제안을 제시하라. 상담하지 않은 학생의 반응이나 합의 내용을 만들지 마라. 미입력 자료는 학생의 약점으로 판단하지 마라. student의 현재 학교급·학년도·학년과 과거 성적의 학년도를 구분하라. 미입력 학년·입학 연도를 과거 성적에서 역산하지 마라. 미정 전공을 확정하지 마라. 5등급제와 9등급제를 혼합·환산하거나 평균 등급과 합격 가능성을 계산하지 마라. 관찰값, 해석, 앞으로의 계획을 구분하고 간결한 한국어로 작성하라.\n'+JSON.stringify({student:{academic_year:value.student.academic_year??null,school_stage:value.student.school_stage??null,grade:value.student.grade??null},goal:session.topic,profile:session.profile,strategy:session.strategy,preparation:session.preparation,consultation:session.consultation,question:session.student_question,context:session.context,evidence_notes:session.evidence_notes,teacher_opinion:session.teacher_opinion,actions:session.actions.map(a=>({text:a.text,status:a.status}))})
  if(settings.provider==='gemini'){
   if(!settings.apiKey.trim())throw new Error('이 기기에서 사용할 개인 API 키를 입력해 주세요.')
   const r=await checked(await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(settings.model)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':settings.apiKey},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:8192}}),signal,referrerPolicy:'no-referrer'}))
   const data=await r.json();const text=data.candidates?.[0]?.content?.parts?.filter((p:{thought?:boolean})=>!p.thought).map((p:{text?:string})=>p.text||'').join('\n')
   if(!text)throw new Error('AI가 초안을 반환하지 않았습니다. 모델 설정을 확인해 주세요.');return text
  }
  const url=new URL(settings.ollamaUrl)
  if(!isLoopback(url.hostname)||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Ollama 주소는 이 PC의 localhost 또는 127.0.0.1만 사용할 수 있습니다.')
  if(/cloud/i.test(settings.model))throw new Error('Ollama에서는 설치된 로컬 모델을 선택해 주세요.')
  const r=await checked(await fetch(url.origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:settings.model,stream:false,messages:[{role:'user',content:prompt}]}),signal}))
  const data=await r.json();if(!data.message?.content)throw new Error('Ollama 응답을 읽지 못했습니다.');return data.message.content
 }
}
export const AI_SETTINGS_KEY='daeryun-counseling:ai:v1'
export function loadAiSettings():AiSettings{try{return {...defaultSettings(),...JSON.parse(localStorage.getItem(AI_SETTINGS_KEY)||'{}')}}catch{return defaultSettings()}}
export function defaultSettings():AiSettings{return {provider:'server',model:'',apiKey:'',ollamaUrl:'http://127.0.0.1:11434'}}
export function saveAiSettings(settings:AiSettings):void{localStorage.setItem(AI_SETTINGS_KEY,JSON.stringify(settings))}
