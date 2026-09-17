import {test,expect,type BrowserContext,type Page} from '@playwright/test'

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}}

async function mockTeacherBridge(page:Page,context:BrowserContext,options:{holdAuthentication?:boolean;holdCases?:boolean;signedIn?:boolean}={}){
 const state={authenticated:false,authFailure:false,onlineCaseReads:0,localCaseReads:0}
 const authentication=deferred(),cases=deferred()
 if(!options.holdAuthentication)authentication.resolve()
 if(!options.holdCases)cases.resolve()
 const authBodies:unknown[]=[],urls:string[]=[]
 context.on('request',req=>urls.push(req.url()))
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(path==='/api/auth'){
   authBodies.push(route.request().postDataJSON());await authentication.promise
   if(state.authFailure)return json({error:{code:'AUTH_FAILED',message:'합성 연결 실패'}},503)
   state.authenticated=true;return json({ok:true})
  }
  if(path==='/api/health')return json({mode:'local',demo:false,csrf_token:'synthetic-csrf',teacher:state.authenticated?{id:'teacher',display_name:'합성교사',role:'teacher',approved:true}:null,ollama:{available:false,models:[]}})
  if(path==='/api/cases'){state.localCaseReads++;await cases.promise;return json({cases:[]})}
  if(path==='/api/fixtures')return json({fixtures:[]})
  return json({})
 })
 if(options.signedIn!==false)await context.addInitScript(()=>{if(location.origin==='https://daeryun.life')localStorage.setItem('dr_sess_v1',JSON.stringify({token:'synthetic-bridge-token'}))})
 await context.route('https://daeryun.life/**',async route=>{
  const url=new URL(route.request().url())
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><title>합성 학교 로그인</title><script>localStorage.setItem("dr_sess_v1",JSON.stringify({token:"synthetic-bridge-token"}))</script><a href="/counseling/">로그인 완료</a></html>'})
  if(url.pathname.endsWith('/counseling-session'))return route.fulfill({contentType:'application/json',body:JSON.stringify({user:{id:'teacher',display_name:'합성교사',role:'teacher',approved:true},students:[],ai:{server:false}})})
  if(url.pathname.endsWith('/counseling-cases')){state.onlineCaseReads++;return route.fulfill({contentType:'application/json',body:'{"cases":[]}'})}
  url.protocol='http:';url.hostname='127.0.0.1';url.port='5178'
  return route.fulfill({response:await route.fetch({url:url.toString()})})
 })
 return {state,authBodies,urls,releaseAuthentication:authentication.resolve,releaseCases:cases.resolve}
}

async function openTeacherPopup(page:Page){
 await page.goto('/counseling/')
 await expect(page.getByRole('button',{name:'대륜고 계정으로 연결',exact:true})).toBeVisible()
 const popupPromise=page.waitForEvent('popup')
 await page.getByRole('button',{name:'대륜고 계정으로 연결',exact:true}).click()
 return popupPromise
}

async function expectAuthenticationOnly(popup:Page){
 await expect(popup.locator('.layout,.document-heading,.case-item')).toHaveCount(0)
 await expect(popup.getByRole('button',{name:'학생·담당 관리',exact:true})).toHaveCount(0)
 await expect(popup.getByRole('button',{name:'일반 AI 설정',exact:true})).toHaveCount(0)
 await expect(popup.getByRole('button',{name:'새 전략',exact:true})).toHaveCount(0)
}

test('teacher popup contains only authentication and closes after local credentials and cases finish loading',async({page,context})=>{
 const mock=await mockTeacherBridge(page,context,{holdCases:true})
 const popup=await openTeacherPopup(page)
 await expect(popup.getByRole('button',{name:'이 PC 연결',exact:true})).toBeVisible()
 await expectAuthenticationOnly(popup)
 await page.screenshot({path:'test-results/local-teacher-login.png',fullPage:true})
 await popup.screenshot({path:'test-results/teacher-connect-popup.png',fullPage:true})
 expect(mock.authBodies).toEqual([])
 expect(mock.state.onlineCaseReads).toBe(0)
 expect(new URL(popup.url()).searchParams.get('connect_local')).toBe('http://127.0.0.1:5178')
 await popup.getByRole('button',{name:'이 PC 연결',exact:true}).click()
 await expect.poll(()=>mock.state.localCaseReads).toBe(1)
 await expect(popup.getByRole('button',{name:'연결 확인 중',exact:true})).toBeDisabled()
 expect(popup.isClosed()).toBe(false)
 const closed=popup.waitForEvent('close')
 mock.releaseCases()
 await closed
 await expect(page.getByRole('button',{name:'새 전략',exact:true})).toBeVisible()
 expect(context.pages()).toEqual([page])
 expect(mock.authBodies).toEqual([{access_token:'synthetic-bridge-token'}])
 expect(mock.state.onlineCaseReads).toBe(0)
 expect(mock.urls.some(url=>url.includes('synthetic-bridge-token'))).toBe(false)
})

test('failed local authentication keeps the authentication popup open and permits another attempt',async({page,context})=>{
 const mock=await mockTeacherBridge(page,context)
 mock.state.authFailure=true
 const popup=await openTeacherPopup(page)
 await popup.getByRole('button',{name:'이 PC 연결',exact:true}).click()
 await expect(popup.getByRole('alert')).toBeVisible()
 await expect(popup.getByRole('button',{name:'이 PC 연결',exact:true})).toBeEnabled()
 expect(popup.isClosed()).toBe(false)
 expect(mock.authBodies).toHaveLength(1)
 await expectAuthenticationOnly(popup)
 mock.state.authFailure=false
 const closed=popup.waitForEvent('close')
 await popup.getByRole('button',{name:'이 PC 연결',exact:true}).click()
 await closed
 await expect(page.getByRole('button',{name:'새 전략',exact:true})).toBeVisible()
 expect(mock.authBodies).toHaveLength(2)
 expect(mock.state.onlineCaseReads).toBe(0)
})

test('pending connection ignores result messages with a different sender or origin',async({page,context})=>{
 const mock=await mockTeacherBridge(page,context,{holdAuthentication:true})
 const popup=await openTeacherPopup(page)
 await popup.getByRole('button',{name:'이 PC 연결',exact:true}).click()
 await expect(popup.getByRole('button',{name:'연결 확인 중',exact:true})).toBeDisabled()
 await popup.evaluate(()=>{
  for(const status of ['connected','failed']){
   const data={type:'daeryun-counseling-auth-result',status}
   window.dispatchEvent(new MessageEvent('message',{data,origin:'http://127.0.0.1:5178',source:window}))
   window.dispatchEvent(new MessageEvent('message',{data,origin:'https://unrelated.test',source:window.opener}))
  }
 })
 await expect(popup.getByRole('button',{name:'연결 확인 중',exact:true})).toBeDisabled()
 await expect(popup.getByRole('alert')).toHaveCount(0)
 expect(popup.isClosed()).toBe(false)
 const closed=popup.waitForEvent('close')
 mock.releaseAuthentication()
 await closed
 await expect(page.getByRole('button',{name:'새 전략',exact:true})).toBeVisible()
})

test('connection timeout restores the retry button and explains that confirmation is missing',async({page,context})=>{
 const mock=await mockTeacherBridge(page,context,{holdAuthentication:true})
 const popup=await openTeacherPopup(page)
 await expect(popup.getByRole('button',{name:'이 PC 연결',exact:true})).toBeEnabled()
 await popup.clock.install()
 await popup.getByRole('button',{name:'이 PC 연결',exact:true}).click()
 await expect(popup.getByRole('button',{name:'연결 확인 중',exact:true})).toBeDisabled()
 await popup.clock.fastForward(20001)
 await expect(popup.getByRole('alert')).toContainText('연결 결과를 확인하지 못했습니다')
 await expect(popup.getByRole('button',{name:'이 PC 연결',exact:true})).toBeEnabled()
 expect(popup.isClosed()).toBe(false)
 mock.releaseAuthentication()
})

test('a directly opened connection page explains how to reopen it from the PC instead of silently disabling connection',async({page,context})=>{
 const mock=await mockTeacherBridge(page,context)
 await page.goto('https://daeryun.life/counseling/?connect_local='+encodeURIComponent('http://127.0.0.1:5178'))
 await expect(page.getByRole('button',{name:'이 PC 연결',exact:true})).toBeEnabled()
 await expectAuthenticationOnly(page)
 await page.getByRole('button',{name:'이 PC 연결',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText(/전략실|연결 창/)
 await expect(page.getByRole('button',{name:'이 PC 연결',exact:true})).toBeEnabled()
 expect(mock.authBodies).toEqual([])
 expect(mock.state.onlineCaseReads).toBe(0)
})


test('expired teacher A data is cleared before connecting teacher B with an empty case list',async({page})=>{
 let healthReads=0,connectedB=false
 const oldCase={schema_version:1,id:'case-a',revision:1,privacy:'local_only',created_at:'2026-09-12',updated_at:'2026-09-12',origin:'synthetic',student:{student_id:'student-a',student_number:'19991',academic_year:2026,school_stage:'high',grade:1,name:'합성이전학생'},teacher:{display_name:'합성교사A'},current_session_id:'session-a',sessions:[{id:'session-a',date:'2026-09-12',topic:'이전 교사 전략',student_question:'',context:'교사A 내부 맥락',evidence_notes:'',teacher_opinion:'',profile:{interests:'교사A에게만 보일 합성 자료'},actions:[],next_date:'',record:{id:'record-a',filename:'synthetic-a.pdf',sha256:'synthetic',page_count:1,school_stage:'high',sections:[],warnings:[],readable_pages:[1],unreadable_pages:[]},analysis:null,review:null,confirmed:null}]}
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  const json=(data:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
  if(path==='/api/auth'){connectedB=true;return json({ok:true})}
  if(path==='/api/health'){healthReads++;return json({mode:'local',demo:false,csrf_token:'synthetic-csrf',teacher:connectedB?{id:'teacher-b',display_name:'합성교사B',approved:true}:healthReads===1?{id:'teacher-a',display_name:'합성교사A',approved:true}:null,ollama:{available:false,models:[]}})}
  if(path==='/api/cases')return json({cases:connectedB?[]:[oldCase]})
  if(path==='/api/fixtures')return json({fixtures:[]})
  return json({})
 })
 await page.goto('/counseling/')
 await expect(page.locator('.document-heading')).toContainText('합성이전학생')
 await expect(page.locator('.profile-summary-grid')).toContainText('교사A에게만 보일 합성 자료')
 await page.getByRole('button',{name:'학생부 상세 분석',exact:true}).click()
 await page.getByRole('button',{name:'연결 다시 확인',exact:true}).click()
 await expect(page.getByRole('button',{name:'대륜고 계정으로 연결',exact:true})).toBeVisible()
 await page.getByText('고급 연결 · 인증 토큰 직접 입력',{exact:true}).click()
 await page.getByLabel('교사 인증 토큰',{exact:true}).fill('synthetic-teacher-b-token')
 await page.getByRole('button',{name:'교사 계정 확인',exact:true}).click()
 await expect(page.locator('.actor')).toContainText('합성교사B')
 await expect(page.getByRole('heading',{name:'첫 학생 전략을 시작하세요.'})).toBeVisible()
 await expect(page.getByText('합성이전학생',{exact:false})).toHaveCount(0)
 await expect(page.getByText('교사A에게만 보일 합성 자료',{exact:false})).toHaveCount(0)
 await expect(page.locator('.document-heading,.case-item,.ai-output')).toHaveCount(0)
})


test('normal online login returns in the same tab',async({page})=>{
 await page.route('https://counseling.test:5178/**',async route=>{
  const url=new URL(route.request().url());url.hostname='127.0.0.1';url.protocol='http:'
  return route.fulfill({response:await route.fetch({url:url.toString()})})
 })
 await page.goto('https://counseling.test:5178/counseling/')
 const login=page.getByRole('link',{name:'로그인하고 전략실로 이동',exact:true})
 await expect(login).toHaveAttribute('href','/?login_return=%2Fcounseling%2F#login')
 await expect(login).not.toHaveAttribute('target')
})

test('temporary school login closes after an opener-free return while the connection popup keeps its PC link',async({page,context})=>{
 const mock=await mockTeacherBridge(page,context,{signedIn:false})
 const popup=await openTeacherPopup(page)
 const connectionLogin=popup.getByRole('link',{name:'로그인하고 전략실로 이동',exact:true})
 await expect(connectionLogin).toHaveAttribute('href','/?login_return=%2Fcounseling%2F#login')
 await expectAuthenticationOnly(popup)
 const loginPopupPromise=popup.waitForEvent('popup')
 await connectionLogin.click()
 const loginPopup=await loginPopupPromise
 await expect(loginPopup).toHaveURL('https://daeryun.life/?login_return=%2Fcounseling%2F#login')
 expect(await loginPopup.evaluate(()=>window.opener===null)).toBe(true)
 expect(context.pages()).toHaveLength(3)
 const loginClosed=loginPopup.waitForEvent('close')
 await loginPopup.getByRole('link',{name:'로그인 완료',exact:true}).click()
 await loginClosed
 expect(context.pages()).toHaveLength(2)
 expect(popup.isClosed()).toBe(false)
 await expect(popup.getByRole('button',{name:'이 PC 연결',exact:true})).toBeEnabled()
 expect(new URL(popup.url()).searchParams.get('connect_local')).toBe('http://127.0.0.1:5178')
 expect(await popup.evaluate(()=>!!window.opener)).toBe(true)
 await expectAuthenticationOnly(popup)
 expect(mock.authBodies).toEqual([])
 const closed=popup.waitForEvent('close')
 await popup.getByRole('button',{name:'이 PC 연결',exact:true}).click()
 await closed
 await expect(page.getByRole('button',{name:'새 전략',exact:true})).toBeVisible()
 expect(context.pages()).toEqual([page])
 expect(mock.state.onlineCaseReads).toBe(0)
})

for(const state of ['valid','expired','server-expired'] as const)test('manual entry automatically signs in with a '+state+' school session',async({page})=>{
 const requests:{url:string;authorization:string|undefined}[]=[]
 let refreshes=0,healthRequests=0
 await page.addInitScript(state=>{
  if(location.origin==='https://counseling.test:5178'&&location.pathname==='/')localStorage.setItem('dr_sess_v1',JSON.stringify({token:'synthetic-manual-token',refresh_token:'synthetic-manual-refresh',expires_at:Date.now()+(state==='expired'?-1000:3600000),user:{google_id:'synthetic-school-member',role:'교사',approved:true,name:'합성교직원'}}))
 },state)
 await page.route('https://counseling.test:5178/**',async route=>{
  const req=route.request(),url=new URL(req.url()),authorization=req.headers().authorization
  requests.push({url:req.url(),authorization})
  const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><title>대륜고 사용설명서</title><a href="/counseling/">학종 전략실 열기</a></html>'})
  if(url.pathname.endsWith('/counseling-refresh')){
   refreshes++;expect(req.method()).toBe('POST');expect(req.postDataJSON()).toEqual({refresh_token:'synthetic-manual-refresh'})
   return json({access_token:'synthetic-refreshed-token',refresh_token:'synthetic-rotated-refresh',expires_in:3600})
  }
  if(url.pathname.endsWith('/counseling-session')){
   healthRequests++
   if(state==='server-expired'&&authorization==='Bearer synthetic-manual-token')return json({error:{code:'AUTH_REQUIRED'}},401)
   expect(authorization).toBe('Bearer '+(state==='valid'?'synthetic-manual-token':'synthetic-refreshed-token'))
   return json({user:{id:'synthetic-school-member',display_name:'합성교직원',role:'teacher',approved:true},students:[],ai:{server:false}})
  }
  if(url.pathname.endsWith('/counseling-cases'))return json({cases:[]})
  url.protocol='http:';url.hostname='127.0.0.1'
  return route.fulfill({response:await route.fetch({url:url.toString()})})
 })
 await page.goto('https://counseling.test:5178/')
 await page.getByRole('link',{name:'학종 전략실 열기',exact:true}).click()
 await expect(page.locator('.actor')).toContainText('합성교직원')
 await expect(page.getByRole('button',{name:'새 전략',exact:true})).toBeVisible()
 await expect(page.getByRole('link',{name:'로그인하고 전략실로 이동',exact:true})).toHaveCount(0)
 expect(refreshes).toBe(state==='valid'?0:1)
 expect(healthRequests).toBe(state==='server-expired'?2:1)
 expect(requests.some(r=>/synthetic-|authorize|login_return/.test(r.url))).toBe(false)
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dr_sess_v1')!))
 expect(saved.user.name).toBe('합성교직원')
 expect(saved.token).toBe(state==='valid'?'synthetic-manual-token':'synthetic-refreshed-token')
})
