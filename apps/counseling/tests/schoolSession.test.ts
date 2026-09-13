import test from 'node:test'
import assert from 'node:assert/strict'
import {SchoolSessionAuth} from '../src/lib/schoolSession'
import {CloudTransport} from '../src/lib/cloudTransport'

const now=1800000000000
const stored=()=>({token:'synthetic-old',refresh_token:'synthetic-refresh',expires_at:now-1,user:{google_id:'synthetic-teacher',role:'교사',approved:true}})
const fresh=()=>({access_token:'synthetic-new',refresh_token:'synthetic-rotated',expires_in:3600})
function storage(value:unknown=stored()){
 let raw=value===null?null:JSON.stringify(value)
 return {getItem:(_key:string)=>raw,setItem:(_key:string,v:string)=>{raw=v},removeItem:(_key:string)=>{raw=null},read:()=>raw===null?null:JSON.parse(raw)}
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})

test('manual session is reused without login and refresh rotates credentials while preserving its profile',async()=>{
 const s=storage(),calls:{url:string;options:RequestInit}[]=[]
 const auth=new SchoolSessionAuth(s,async(url,options)=>{calls.push({url:String(url),options:options!});return json(fresh())},()=>now)
 assert.equal(await auth.token(),'synthetic-new')
 assert.equal(await auth.token(),'synthetic-new')
 assert.equal(calls.length,1)
 assert.equal(calls[0]!.url,'/.netlify/functions/counseling-refresh')
 assert.deepEqual(JSON.parse(calls[0]!.options.body as string),{refresh_token:'synthetic-refresh'})
 assert.equal(calls[0]!.options.cache,'no-store')
 assert.deepEqual(s.read(),{...stored(),token:'synthetic-new',refresh_token:'synthetic-rotated',expires_at:now+3600000})
})

test('valid or legacy tokens are reused and JWT expiry also triggers refresh',async()=>{
 let calls=0
 const request:typeof fetch=async()=>{calls++;return json(fresh())}
 for(const value of [{...stored(),expires_at:now+120000},{token:'legacy-without-refresh'}]){
  const auth=new SchoolSessionAuth(storage(value),request,()=>now)
  assert.equal(await auth.token(),value.token)
 }
 assert.equal(calls,0)
 const jwt='header.'+btoa(JSON.stringify({exp:now/1000-1}))+'.signature'
 const auth=new SchoolSessionAuth(storage({token:jwt,refresh_token:'synthetic-refresh'}),request,()=>now)
 assert.equal(await auth.token(),'synthetic-new');assert.equal(calls,1)
})

test('concurrent requests share one token rotation including late 401 responses',async()=>{
 let resolve!:(response:Response)=>void,calls=0
 const auth=new SchoolSessionAuth(storage(),async()=>{calls++;return new Promise<Response>(r=>{resolve=r})},()=>now)
 const first=auth.token(),second=auth.token(true,'synthetic-old')
 assert.equal(calls,1)
 resolve(json(fresh()))
 assert.deepEqual(await Promise.all([first,second]),['synthetic-new','synthetic-new'])
 assert.equal(await auth.token(true,'synthetic-old'),'synthetic-new');assert.equal(calls,1)
})

test('a completed refresh never resurrects a logged-out account or replaces a newer account',async()=>{
 for(const replacement of [null,{...stored(),token:'teacher-b',refresh_token:'refresh-b',user:{google_id:'teacher-b'}}]){
  const s=storage();let resolve!:(response:Response)=>void
  const auth=new SchoolSessionAuth(s,()=>new Promise<Response>(r=>{resolve=r}),()=>now)
  const result=auth.token()
  if(replacement===null)s.removeItem('dr_sess_v1');else s.setItem('dr_sess_v1',JSON.stringify(replacement))
  resolve(json(fresh()))
  await assert.rejects(result,{code:'SESSION_CHANGED'})
  assert.deepEqual(s.read(),replacement)
 }
})

test('invalid refresh removes only the same session; transient failure preserves login',async()=>{
 for(const status of [401,503]){
  const s=storage(),auth=new SchoolSessionAuth(s,async()=>json({error:{code:'AUTH_UNAVAILABLE',message:'잠시 후 다시 시도해 주세요.'}},status),()=>now)
  await assert.rejects(auth.token(),{status})
  assert.deepEqual(s.read(),status===401?null:stored())
 }
 const s=storage();let resolve!:(r:Response)=>void
 const auth=new SchoolSessionAuth(s,()=>new Promise<Response>(r=>{resolve=r}),()=>now),pending=auth.token()
 s.setItem('dr_sess_v1',JSON.stringify({token:'teacher-b'}));resolve(json({},401))
 await assert.rejects(pending,{code:'SESSION_CHANGED'});assert.deepEqual(s.read(),{token:'teacher-b'})
})

test('cloud requests retry an expired bearer once and refresh authenticated downloads too',async t=>{
 const s=storage({...stored(),expires_at:Date.now()+3600000}),calls:{url:string;authorization:string|null}[]=[]
 const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldFetch=globalThis.fetch
 Object.defineProperty(globalThis,'localStorage',{value:s,configurable:true})
 t.after(()=>{globalThis.fetch=oldFetch;if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else Reflect.deleteProperty(globalThis,'localStorage')})
 globalThis.fetch=async(url,options)=>{
  const path=String(url),authorization=new Headers(options?.headers).get('Authorization');calls.push({url:path,authorization})
  if(path.endsWith('counseling-refresh'))return json(fresh())
  if(authorization==='Bearer synthetic-old')return json({error:{code:'AUTH_REQUIRED'}},401)
  if(path.endsWith('counseling-session'))return json({user:{id:'teacher',role:'teacher',approved:true},students:[],ai:{server:false}})
  return new Response('synthetic report')
 }
 const api=new CloudTransport()
 assert.equal((await api.health()).teacher?.id,'teacher')
 assert.equal(await (await api.report('case','session')).text(),'synthetic report')
 assert.deepEqual(calls.map(c=>c.authorization),['Bearer synthetic-old',null,'Bearer synthetic-new','Bearer synthetic-new'])
 assert.equal(calls.filter(c=>c.url.endsWith('counseling-refresh')).length,1)
})

test('cloud authorization denials never refresh or retry requests',async t=>{
 const s=storage({...stored(),expires_at:Date.now()+3600000}),oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldFetch=globalThis.fetch
 Object.defineProperty(globalThis,'localStorage',{value:s,configurable:true})
 t.after(()=>{globalThis.fetch=oldFetch;if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else Reflect.deleteProperty(globalThis,'localStorage')})
 let calls=0;globalThis.fetch=async()=>{calls++;return json({error:{code:'NOT_APPROVED',message:'학교 회원 승인이 필요합니다.'}},403)}
 await assert.rejects(new CloudTransport().health(),{status:403});assert.equal(calls,1)
})
