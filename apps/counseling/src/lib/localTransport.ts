import { checked } from './transport'
import { pdfBase64 } from './model'
import type { Transport,Health,CounselingCase,Student,Backup,Job,Fixture } from './types'
export class LocalTransport implements Transport {
 readonly mode='local' as const
 private token=''
 private async request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await checked(await fetch('/api'+path,{method,headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-Counseling-Token':this.token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal,credentials:'same-origin',cache:'no-store'}))
  return response.json() as Promise<T>
 }
 async health(signal?:AbortSignal){const h=await this.request<Health>('/health','GET',undefined,signal);this.token=h.csrf_token||'';return h}
 async authenticate(token:string){await this.request('/auth','POST',{access_token:token});return this.health()}
 async list(signal?:AbortSignal){return(await this.request<{cases:CounselingCase[]}>('/cases','GET',undefined,signal)).cases}
 async get(id:string){return(await this.request<{case:CounselingCase}>('/cases/'+encodeURIComponent(id))).case}
 async create(student:Student,teacher:string){return(await this.request<{case:CounselingCase}>('/cases','POST',{student,teacher:{display_name:teacher}})).case}
 async save(value:CounselingCase){return(await this.request<{case:CounselingCase}>('/cases/'+encodeURIComponent(value.id),'PUT',{case:value})).case}
 async next(value:CounselingCase){return(await this.request<{case:CounselingCase}>('/cases/'+encodeURIComponent(value.id)+'/sessions','POST',{revision:value.revision})).case}
 async importBackup(bundle:Backup){return(await this.request<{case:CounselingCase}>('/import','POST',{bundle})).case}
 private async blob(path:string){return(await checked(await fetch('/api'+path,{credentials:'same-origin',cache:'no-store'}))).blob()}
 exportBackup(id:string){return this.blob('/cases/'+encodeURIComponent(id)+'/export')}
 report(id:string,sessionId:string){return this.blob('/cases/'+encodeURIComponent(id)+'/report.pdf?session_id='+encodeURIComponent(sessionId))}
 async upload(value:CounselingCase,sessionId:string,file:File,password:string,signal?:AbortSignal){return(await this.request<{case:CounselingCase}>('/cases/'+encodeURIComponent(value.id)+'/record','POST',{revision:value.revision,session_id:sessionId,filename:file.name,pdf_base64:await pdfBase64(file),...(password?{password}:{})},signal)).case}
 async analyze(value:CounselingCase,sessionId:string,model:string,goal:string,budget:number){return(await this.request<{job:Job}>('/cases/'+encodeURIComponent(value.id)+'/analyze','POST',{revision:value.revision,session_id:sessionId,model,goal,time_budget_minutes:budget})).job}
 async review(value:CounselingCase,sessionId:string,model?:string){return(await this.request<{job:Job}>('/cases/'+encodeURIComponent(value.id)+'/review','POST',{revision:value.revision,session_id:sessionId,...(model?{model}:{})})).job}
 async confirm(value:CounselingCase,sessionId:string){return(await this.request<{case:CounselingCase}>('/cases/'+encodeURIComponent(value.id)+'/confirm','POST',{revision:value.revision,session_id:sessionId,review_acknowledged:true})).case}
 async job(id:string,signal?:AbortSignal){return(await this.request<{job:Job}>('/jobs/'+encodeURIComponent(id),'GET',undefined,signal)).job}
 async cancel(id:string){return(await this.request<{job:Job}>('/jobs/'+encodeURIComponent(id)+'/cancel','POST',{})).job}
 async fixtures(){return(await this.request<{fixtures:Fixture[]}>('/fixtures')).fixtures}
 fixture(id:string){return this.blob('/fixtures/'+encodeURIComponent(id)+'.pdf')}
}
