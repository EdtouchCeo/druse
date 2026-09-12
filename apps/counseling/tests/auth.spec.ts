import {test,expect} from '@playwright/test'

test('local login opens fixed teacher site and receives credentials only after explicit teacher confirmation',async({page,context})=>{
 let authenticated=false
 const authBodies:unknown[]=[],urls:string[]=[]
 context.on('request',req=>urls.push(req.url()))
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  const json=(data:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
  if(path==='/api/auth'){authBodies.push(route.request().postDataJSON());authenticated=true;return json({ok:true})}
  if(path==='/api/health')return json({mode:'local',demo:false,csrf_token:'synthetic-csrf',teacher:authenticated?{id:'teacher',display_name:'합성교사',role:'teacher',approved:true}:null,ollama:{available:false,models:[]}})
  if(path==='/api/cases')return json({cases:[]})
  if(path==='/api/fixtures')return json({fixtures:[]})
  return json({})
 })
 await context.addInitScript(()=>{if(location.origin==='https://daeryun.life')localStorage.setItem('dr_sess_v1',JSON.stringify({token:'synthetic-bridge-token'}))})
 await context.route('https://daeryun.life/**',async route=>{
  const url=new URL(route.request().url())
  if(url.pathname.endsWith('/counseling-session'))return route.fulfill({contentType:'application/json',body:JSON.stringify({user:{id:'teacher',display_name:'합성교사',role:'teacher',approved:true},students:[],ai:{server:false}})})
  if(url.pathname.endsWith('/counseling-cases'))return route.fulfill({contentType:'application/json',body:'{"cases":[]}'})
  url.protocol='http:';url.hostname='127.0.0.1';url.port='5178'
  return route.fulfill({response:await route.fetch({url:url.toString()})})
 })
 await page.goto('/counseling/')
 await expect(page.getByRole('button',{name:'대륜고 계정으로 연결',exact:true})).toBeVisible()
 await page.screenshot({path:'test-results/local-teacher-login.png',fullPage:true})
 const popupPromise=page.waitForEvent('popup')
 await page.getByRole('button',{name:'대륜고 계정으로 연결',exact:true}).click()
 const popup=await popupPromise
 await expect(popup.getByRole('button',{name:'이 PC 연결',exact:true})).toBeVisible()
 await popup.screenshot({path:'test-results/teacher-connect-popup.png',fullPage:true})
 expect(authBodies).toEqual([])
 expect(new URL(popup.url()).searchParams.get('connect_local')).toBe('http://127.0.0.1:5178')
 await popup.getByRole('button',{name:'이 PC 연결',exact:true}).click()
 await expect(page.getByRole('button',{name:'새 전략',exact:true})).toBeVisible()
 expect(authBodies).toEqual([{access_token:'synthetic-bridge-token'}])
 expect(urls.some(url=>url.includes('synthetic-bridge-token'))).toBe(false)
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
 await expect(page.locator('.profile-summary')).toContainText('교사A에게만 보일 합성 자료')
 await page.getByRole('button',{name:'Ollama 근거 분석',exact:true}).click()
 await page.getByRole('button',{name:'연결 다시 확인',exact:true}).click()
 await expect(page.getByRole('button',{name:'대륜고 계정으로 연결',exact:true})).toBeVisible()
 await page.getByText('고급 연결 · 인증 토큰 직접 입력',{exact:true}).click()
 await page.getByLabel('교사 인증 토큰',{exact:true}).fill('synthetic-teacher-b-token')
 await page.getByRole('button',{name:'교사 계정 확인',exact:true}).click()
 await expect(page.locator('.actor')).toContainText('합성교사B')
 await expect(page.getByRole('heading',{name:'학생 자료를 입력하고 전략 준비를 시작하세요.'})).toBeVisible()
 await expect(page.getByText('합성이전학생',{exact:false})).toHaveCount(0)
 await expect(page.getByText('교사A에게만 보일 합성 자료',{exact:false})).toHaveCount(0)
 await expect(page.locator('.document-heading,.case-item,.ai-output')).toHaveCount(0)
})


test('online login returns in the same tab while the original PC-connection window is preserved',async({page})=>{
 await page.route('https://counseling.test:5178/**',async route=>{
  const url=new URL(route.request().url());url.hostname='127.0.0.1';url.protocol='http:'
  return route.fulfill({response:await route.fetch({url:url.toString()})})
 })
 await page.goto('https://counseling.test:5178/counseling/')
 const login=page.getByRole('link',{name:'로그인하고 전략실로 이동',exact:true})
 await expect(login).toHaveAttribute('href','/?login_return=%2Fcounseling%2F#login')
 await expect(login).not.toHaveAttribute('target')
 const origin='http://127.0.0.1:8768'
 await page.goto('https://counseling.test:5178/counseling/?connect_local='+encodeURIComponent(origin))
 const connectionLogin=page.getByRole('link',{name:'로그인하고 전략실로 이동',exact:true})
 await expect(connectionLogin).toHaveAttribute('href','/?login_return=%2Fcounseling%2F#login')
 await expect(connectionLogin).toHaveAttribute('target','_blank')
 await expect(connectionLogin).toHaveAttribute('rel','noopener noreferrer')
 await expect(page.getByText('로그인은 새 탭에서 진행합니다.',{exact:false})).toBeVisible()
 await expect(page.getByRole('button',{name:'로그인 상태 다시 확인',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'이 PC 연결',exact:true})).toHaveCount(0)
})
