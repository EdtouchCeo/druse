import {test,expect,type Page} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import path from 'node:path'
import {intuitiveApi,onlineOrigin,syntheticCase} from './fixtures/intuitive'

type AccessCode='COUNSELING_NOT_APPROVED'|'NOT_APPROVED'|'PROFILE_REQUIRED'|'AUTH_REQUIRED'|'AUTH_UNAVAILABLE'
type AccessCall={path:string;method:string;authorization:string|undefined}
const loginName='로그인하고 전략실로 이동'
const retryName='이용 상태 다시 확인'

async function accessApi(page:Page,options:{status:number|'network';code:AccessCode;hasSession?:boolean;pending?:boolean;published?:boolean;caseStatus?:number;realTime?:boolean}){
 if(!options.realTime)await page.clock.install()
 const blocked=await intuitiveApi(page,{mode:'online',authenticated:false,value:null})
 const credentials=options.hasSession===false?null:JSON.stringify({token:'synthetic-access-token',refresh_token:'synthetic-access-refresh',expires_at:Date.now()+7_200_000,user:{name:'합성접속학생',role:'학생'}})
 if(credentials)await page.addInitScript(({origin,value})=>{if(location.origin===origin)localStorage.setItem('dr_sess_v1',value)},{origin:onlineOrigin,value:credentials})
 const calls:AccessCall[]=[],state={status:options.status,code:options.code,caseStatus:options.caseStatus||200}
 let nextGate:Promise<void>|undefined
 function holdNextHealth(){let release=()=>{};nextGate=new Promise<void>(resolve=>{release=resolve});return release}
 const releaseInitial=options.pending?holdNextHealth():()=>{}
 const published=syntheticCase()
 published.privacy='standard';published.student.name='합성접속학생'
 published.sessions[0]!.strategy!.student_message='승인 후 전달된 합성 학생 안내입니다.'
 published.sessions[0]!.guidance={published_at:'2026-09-14',published_by:'synthetic'}
 await page.route('**/.netlify/functions/**',async route=>{
  const request=route.request(),url=new URL(request.url())
  calls.push({path:url.pathname,method:request.method(),authorization:request.headers().authorization})
  const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)})
  if(url.pathname.endsWith('/counseling-refresh'))return json({error:{code:'AUTH_REQUIRED',message:'합성 로그인 만료'}},401)
  if(url.pathname.endsWith('/counseling-session')){
   const gate=nextGate;nextGate=undefined
   if(gate)await gate
   if(state.status==='network')return route.abort('failed')
   if(state.status!==200)return json({error:{code:state.code,message:'합성 이용 상태 응답'}},state.status)
   return json({user:{id:'synthetic-access-student',role:'student',display_name:'합성접속학생',approved:true},students:[],ai:{server:false}})
  }
  if(url.pathname.endsWith('/counseling-cases'))return state.caseStatus===200?json({cases:options.published?[published]:[]}):json({error:{code:'SERVICE_UNAVAILABLE',message:'합성 전략 목록 연결 오류'}},state.caseStatus)
  return json({error:{code:'UNEXPECTED_TEST_REQUEST',message:'합성 검사에 정의하지 않은 요청'}},400)
 })
 await page.goto(onlineOrigin+'/counseling/')
 return {blocked,calls,state,credentials,releaseInitial,holdNextHealth}
}

async function noLoginLoop(page:Page){
 await expect(page.getByRole('link',{name:loginName,exact:true})).toHaveCount(0)
 await expect(page.locator('a[href*="login_return"]')).toHaveCount(0)
 expect(page.url()).toBe(onlineOrigin+'/counseling/')
}

async function screenshot(page:Page,name:string){
 const directory=path.resolve('../../_workspace/student-access-check')
 await mkdir(directory,{recursive:true})
 await page.screenshot({path:path.join(directory,name+'.png'),fullPage:true})
}

for(const [code,heading] of [
 ['COUNSELING_NOT_APPROVED','학종 전략실 참여 확인이 필요합니다'],
 ['NOT_APPROVED','학교 회원 승인 대기'],
 ['PROFILE_REQUIRED','학교 회원 등록 확인이 필요합니다'],
] as const)test(`authenticated ${code} retains school login and retries access without refreshing credentials`,async({page})=>{
 const participation=code==='COUNSELING_NOT_APPROVED'
 if(participation)await page.setViewportSize({width:390,height:844})
 const api=await accessApi(page,{status:403,code,pending:participation,published:participation})
 if(participation){
  await expect(page.getByRole('heading',{name:'전략실 연결 확인 중',exact:true})).toBeVisible()
  await noLoginLoop(page)
  await expect.poll(()=>api.calls.length).toBe(1)
  api.releaseInitial()
 }
 await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible()
 await noLoginLoop(page)
 const retry=page.getByRole('button',{name:retryName,exact:true})
 await expect(retry).toBeEnabled()
 if(participation){
  const card=page.locator('.auth-card')
  await expect(card).toContainText(/학교.*로그인.*확인/)
  await expect(card).toContainText(/선생님|담당 교사/)
  await expect(card).toContainText(/참여|승인/)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(retry).toBeInViewport({ratio:1})
  await screenshot(page,'participation-required-390')
 }
 await page.clock.fastForward(120_000)
 expect(api.calls).toEqual([{path:'/.netlify/functions/counseling-session',method:'GET',authorization:'Bearer synthetic-access-token'}])
 expect(await page.evaluate(()=>localStorage.getItem('dr_sess_v1'))).toBe(api.credentials)
 api.state.status=200
 const releaseRetry=api.holdNextHealth()
 await retry.click()
 await expect(page.getByRole('heading',{name:'전략실 연결 확인 중',exact:true})).toBeVisible()
 await noLoginLoop(page)
 await expect(retry.and(page.locator(':enabled'))).toHaveCount(0)
 await expect.poll(()=>api.calls.filter(call=>call.path.endsWith('/counseling-session')).length).toBe(2)
 expect(api.calls.some(call=>call.path.endsWith('/counseling-cases'))).toBe(false)
 releaseRetry()
 if(participation){
  await expect(page.getByRole('article',{name:'학생 최종 결과물'})).toContainText('승인 후 전달된 합성 학생 안내입니다.')
  await expect(page.locator('.case-card')).toHaveCount(1)
 }else await expect(page.getByRole('heading',{name:'아직 안내된 전략이 없습니다.',exact:true})).toBeVisible()
 await noLoginLoop(page)
 expect(api.calls.map(call=>call.path)).toEqual(['/.netlify/functions/counseling-session','/.netlify/functions/counseling-session','/.netlify/functions/counseling-cases'])
 expect(api.calls.every(call=>call.authorization==='Bearer synthetic-access-token'&&call.method==='GET')).toBe(true)
 expect(await page.evaluate(()=>localStorage.getItem('dr_sess_v1'))).toBe(api.credentials)
 expect(api.blocked.outside).toEqual([]);expect(api.blocked.pageErrors).toEqual([])
})

for(const status of [503,'network'] as const)test(`${status} keeps authenticated users out of the login loop and waits for an explicit retry`,async({page})=>{
 const api=await accessApi(page,{status,code:'AUTH_UNAVAILABLE'})
 await expect(page.getByRole('heading',{name:'전략실에 연결하지 못했습니다',exact:true})).toBeVisible()
 await noLoginLoop(page)
 await expect(page.getByRole('button',{name:retryName,exact:true})).toBeEnabled()
 await page.clock.fastForward(120_000)
 expect(api.calls).toEqual([{path:'/.netlify/functions/counseling-session',method:'GET',authorization:'Bearer synthetic-access-token'}])
 expect(await page.evaluate(()=>localStorage.getItem('dr_sess_v1'))).toBe(api.credentials)
 api.state.status=200
 await page.getByRole('button',{name:retryName,exact:true}).click()
 await expect(page.getByRole('heading',{name:'아직 안내된 전략이 없습니다.',exact:true})).toBeVisible()
 expect(api.calls.map(call=>call.path)).toEqual(['/.netlify/functions/counseling-session','/.netlify/functions/counseling-session','/.netlify/functions/counseling-cases'])
 expect(api.calls.every(call=>call.authorization==='Bearer synthetic-access-token'&&call.method==='GET')).toBe(true)
 expect(await page.evaluate(()=>localStorage.getItem('dr_sess_v1'))).toBe(api.credentials)
 expect(api.blocked.outside).toEqual([]);expect(api.blocked.pageErrors).toEqual([])
})

for(const hasSession of [false,true])test(`genuine ${hasSession?'expired':'missing'} school login still offers the same-tab login action`,async({page})=>{
 const api=await accessApi(page,{status:401,code:'AUTH_REQUIRED',hasSession})
 await expect(page.getByRole('heading',{name:'학종 전략실 로그인',exact:true})).toBeVisible()
 const login=page.getByRole('link',{name:loginName,exact:true})
 await expect(login).toHaveAttribute('href','/?login_return=%2Fcounseling%2F#login')
 await expect(login).not.toHaveAttribute('target')
 await expect(page.getByRole('button',{name:retryName,exact:true})).toHaveCount(0)
 expect(api.calls.some(call=>call.path.endsWith('/counseling-cases'))).toBe(false)
 expect(api.calls.map(call=>call.path)).toEqual(hasSession?['/.netlify/functions/counseling-session','/.netlify/functions/counseling-refresh']:[])
 expect(await page.evaluate(()=>localStorage.getItem('dr_sess_v1'))).toBeNull()
 expect(api.blocked.outside).toEqual([]);expect(api.blocked.pageErrors).toEqual([])
})

test('an unavailable case list after successful login shows a recoverable service state rather than an empty student workspace',async({page})=>{
 const api=await accessApi(page,{status:200,code:'AUTH_UNAVAILABLE',caseStatus:503})
 await expect(page.getByRole('heading',{name:'전략실에 연결하지 못했습니다',exact:true})).toBeVisible()
 await noLoginLoop(page)
 await expect(page.getByRole('heading',{name:'아직 안내된 전략이 없습니다.',exact:true})).toHaveCount(0)
 await expect(page.locator('.student-workspace,.case-card')).toHaveCount(0)
 await page.clock.fastForward(120_000)
 expect(api.calls.map(call=>call.path)).toEqual(['/.netlify/functions/counseling-session','/.netlify/functions/counseling-cases'])
 expect(await page.evaluate(()=>localStorage.getItem('dr_sess_v1'))).toBe(api.credentials)
 api.state.caseStatus=200
 await page.getByRole('button',{name:retryName,exact:true}).click()
 await expect(page.getByRole('heading',{name:'아직 안내된 전략이 없습니다.',exact:true})).toBeVisible()
 expect(api.calls.map(call=>call.path)).toEqual(['/.netlify/functions/counseling-session','/.netlify/functions/counseling-cases','/.netlify/functions/counseling-session','/.netlify/functions/counseling-cases'])
 expect(api.calls.every(call=>call.authorization==='Bearer synthetic-access-token'&&call.method==='GET')).toBe(true)
 expect(await page.evaluate(()=>localStorage.getItem('dr_sess_v1'))).toBe(api.credentials)
 expect(api.blocked.outside).toEqual([]);expect(api.blocked.pageErrors).toEqual([])
})

test('a stalled health response times out to a retryable service state without replacing school credentials or starting login',async({page})=>{
 // Keep native browser time: AbortSignal.timeout must expire while the network
 // response remains held, independently of the fake clock used above.
 const api=await accessApi(page,{status:200,code:'AUTH_UNAVAILABLE',pending:true,realTime:true})
 try{
  await expect(page.getByRole('heading',{name:'전략실 연결 확인 중',exact:true})).toBeVisible()
  await noLoginLoop(page)
  await expect(page.getByRole('heading',{name:'전략실에 연결하지 못했습니다',exact:true})).toBeVisible({timeout:20_000})
  await expect(page.getByRole('heading',{name:'전략실 연결 확인 중',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:retryName,exact:true})).toBeEnabled()
  await noLoginLoop(page)
  expect(api.calls).toEqual([{path:'/.netlify/functions/counseling-session',method:'GET',authorization:'Bearer synthetic-access-token'}])
  expect(await page.evaluate(()=>localStorage.getItem('dr_sess_v1'))).toBe(api.credentials)
  expect(api.blocked.outside).toEqual([]);expect(api.blocked.pageErrors).toEqual([])
 }finally{
  api.releaseInitial()
  await page.unrouteAll({behavior:'wait'})
 }
})
