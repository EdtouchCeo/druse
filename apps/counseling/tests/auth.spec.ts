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
