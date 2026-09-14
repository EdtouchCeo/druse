import type {Page} from '@playwright/test'
import type {CounselingCase,Session} from '../../src/lib/types'
import {emptyStrategy} from '../../src/lib/model'
import {emptyProfile} from '../../src/lib/profile'
import {emptyConsultation} from '../../src/lib/workflow'

export const onlineOrigin='https://counseling.test:5178'
export const syntheticCase=():CounselingCase=>({schema_version:1,id:'intuitive-case',revision:1,privacy:'local_only',origin:'synthetic',created_at:'2026-09-14',updated_at:'2026-09-14',student:{student_id:'synthetic-only',student_number:'00000',name:'합성검사학생',academic_year:2026,school_stage:'high',grade:2},teacher:{display_name:'합성검사교사'},current_session_id:'intuitive-session',sessions:[{id:'intuitive-session',date:'2026-09-14',topic:'합성 전략 검증',student_question:'',context:'비공개 맥락 합성표식',evidence_notes:'비공개 근거 합성표식',teacher_opinion:'비공개 의견 합성표식',profile:emptyProfile(),strategy:emptyStrategy(),workflow_version:2,preparation:null,consultation:emptyConsultation(),actions:[],next_date:'',record:null,analysis:null,review:null,confirmed:null}]})
export type UiCall={path:string;method:string;body:any}

/** Fresh mocks only. Unrecognized external requests are blocked, including production APIs. */
export async function intuitiveApi(page:Page,options:{mode?:'local'|'online';role?:'teacher'|'student';value?:CounselingCase|null;authenticated?:boolean;status?:401|503}={}){
 const mode=options.mode||'local',role=options.role||'teacher'
 let value=options.value===null?null:structuredClone(options.value||syntheticCase())
 const calls:UiCall[]=[],outside:string[]=[],pageErrors:string[]=[]
 page.on('pageerror',error=>pageErrors.push(error.message))
 if(mode==='online'&&options.authenticated!==false)await page.addInitScript(()=>localStorage.setItem('dr_sess_v1',JSON.stringify({token:'synthetic-intuitive-token'})))
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  if(!['127.0.0.1','localhost','counseling.test'].includes(url.hostname)){outside.push(request.url());return route.abort('blockedbyclient')}
  const isApi=url.pathname.startsWith('/api/')||url.pathname.startsWith('/.netlify/functions/')
  if(!isApi){
   if(url.hostname==='counseling.test'){url.protocol='http:';url.hostname='127.0.0.1';return route.fulfill({response:await route.fetch({url:url.toString()})})}
   return route.continue()
  }
  const path=url.pathname,method=request.method(),body=request.postDataJSON()
  calls.push({path:path+url.search,method,body})
  const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(path.endsWith('/health')||path.endsWith('/counseling-session')){
   if(options.status)return json({error:{code:options.status===401?'AUTH_REQUIRED':'AUTH_UNAVAILABLE',message:options.status===401?'합성 로그인 만료':'합성 서버 연결을 잠시 후 다시 확인해 주세요.'}},options.status)
   const actor={id:'synthetic-teacher',role,display_name:role==='teacher'?'합성검사교사':'합성검사학생',approved:true}
   return json(mode==='local'?{mode,demo:options.authenticated!==false,csrf_token:'synthetic-csrf',teacher:options.authenticated===false?null:actor,ollama:{available:false,models:[]}}:{user:actor,students:value?[value.student]:[],ai:{server:false}})
  }
  if(path.endsWith('/fixtures'))return json({fixtures:[]})
  if(path.endsWith('/counseling-refresh'))return json({error:{code:'AUTH_REQUIRED',message:'합성 로그인 만료'}},401)
  if(path.endsWith('/export')||url.searchParams.get('action')==='export')return json({format:'daeryun-counseling',version:1,case:value})
  if(path.endsWith('/jobs/intuitive-review'))return json({job:{id:'intuitive-review',case_id:value!.id,state:'succeeded',message:'합성 점검 완료'}})
  if(path.endsWith('/prepare')){
   const session=value!.sessions.find(s=>s.id===body.session_id)!
   session.preparation=structuredClone({prepared_at:'2026-09-14T00:00:00Z',prepared_by:'synthetic',topic:session.topic,strategy:session.strategy!,actions:session.actions})
   session.consultation={...emptyConsultation(),status:'in_progress'};value!.revision++
   return json({case:value})
  }
  if(path.endsWith('/review')){value!.sessions[0]!.review={state:'pending',method:'manual',content_hash:'synthetic-hash',notes:[],created_at:'2026-09-14'};value!.revision++;return json({job:{id:'intuitive-review',state:'queued'}})}
  if(path.endsWith('/confirm')){value!.sessions[0]!.confirmed={synthetic:true};value!.revision++;return json({case:value})}
  if(method==='PUT'){value=structuredClone(body.case);value!.revision++;value!.sessions.forEach(s=>s.review=null);return json({case:value})}
  if(method==='GET'&&(path==='/api/cases'||path.endsWith('/counseling-cases')&&!url.searchParams.get('id')))return json({cases:value?[value]:[]})
  if(method==='GET'&&(path==='/api/cases/'+value?.id||path.endsWith('/counseling-cases')&&url.searchParams.get('id')===value?.id))return json({case:value})
  return json({error:{code:'UNEXPECTED_TEST_REQUEST',message:'합성 검사에 정의하지 않은 요청'}},400)
 })
 return {calls,outside,pageErrors,get value(){return value},get session(){return value?.sessions[0] as Session|undefined}}
}
