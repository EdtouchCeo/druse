import {test,expect,type Page} from '@playwright/test'
import type {AdminData} from '../src/lib/admin'
const teacherId='11111111-1111-4111-8111-111111111111',studentId='22222222-2222-4222-8222-222222222222',fixedStudentId='33333333-3333-4333-8333-333333333333',pendingId='44444444-4444-4444-8444-444444444444'
async function adminApi(page:Page,role:'manager'|'teacher'|'student'='manager',canManage=true){
 const data:AdminData={users:[{id:teacherId,name:'합성교사',role:'교사',approved:true},{id:studentId,name:'합성학생',role:'학생',approved:true},{id:pendingId,name:'승인대기교사',role:'교사',approved:false}],roles:[],students:[],numbers:[],assignments:[]},calls:{path:string;method:string;body:any}[]=[]
 await page.addInitScript(()=>localStorage.setItem('dr_sess_v1',JSON.stringify({token:'synthetic-admin-token',user:{role:'manager'}})))
 await page.route('https://counseling.test:5178/**',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(!url.pathname.startsWith('/.netlify/functions/')){url.protocol='http:';url.hostname='127.0.0.1';return route.fulfill({response:await route.fetch({url:url.toString()})})}
  const body=req.postDataJSON();calls.push({path:url.pathname,method:req.method(),body})
  const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)})
  if(url.pathname.endsWith('counseling-session'))return json({user:{id:'55555555-5555-4555-8555-555555555555',role,can_manage:canManage,approved:true,display_name:'합성운영자'},students:[],ai:{server:false}})
  if(url.pathname.endsWith('counseling-cases'))return json({cases:[]})
  if(url.pathname.endsWith('counseling-admin')){
   if(!canManage)return json({error:{code:'ACCESS_DENIED',message:'관리 권한이 없습니다.'}},403)
   if(req.method()==='GET')return json(data)
   if(body.action==='role'){data.roles=data.roles.filter(item=>item.user_id!==body.user_id||item.role!==body.role);data.roles.push(body)}
   if(body.action==='student'){data.students=[{id:fixedStudentId,user_id:body.user_id,name:body.name,active:true}];data.numbers=[{...body,student_id:fixedStudentId}];return json({student_id:fixedStudentId})}
   if(body.action==='assign'){data.assignments=[body]}
   return json({ok:true})
  }
  return json({},404)
 })
 return {calls,data}
}
async function confirm(page:Page){await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'확인하고 저장',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByText('운영 정보를 저장했습니다.',{exact:true})).toBeVisible()}

test('manager-only registers role, student and assignment with explicit previews, without accessing counseling records',async({page})=>{
 const api=await adminApi(page)
 await page.goto('https://counseling.test:5178/counseling/?admin=1')
 await expect(page.getByRole('heading',{name:'학생과 상담 교사를 연결합니다.'})).toBeVisible()
 expect(api.calls.some(item=>item.path.endsWith('counseling-cases'))).toBe(false)
 await page.getByLabel('권한을 확인할 학교 계정').selectOption(teacherId)
 await page.getByLabel('상담 참여 허용',{exact:true}).check()
 await page.getByRole('button',{name:'권한 변경 확인'}).click()
 expect(api.calls.filter(item=>item.method==='POST')).toHaveLength(0)
 await confirm(page)
 await page.getByLabel('학생 학교 계정').selectOption(studentId)
 await page.getByLabel('학번',{exact:true}).fill('10101')
 await page.getByRole('button',{name:'학생 등록 확인'}).click();await confirm(page)
 await page.getByLabel('배정할 등록 학생').selectOption(fixedStudentId)
 await page.getByLabel('담당 교사 계정').selectOption(teacherId)
 await page.getByRole('button',{name:'배정 변경 확인'}).click();await confirm(page)
 await expect(page.getByRole('cell',{name:'현재 담당',exact:true})).toBeVisible()
 const writes=api.calls.filter(item=>item.method==='POST')
 expect(writes.map(item=>item.body.action)).toEqual(['role','student','assign'])
 expect(writes[0]!.body).toEqual({action:'role',user_id:teacherId,role:'teacher',approved:true})
 expect(writes[2]!.body).toEqual({action:'assign',student_id:fixedStudentId,teacher_user_id:teacherId,active:true})
 await expect(page.getByRole('button',{name:/삭제|관리자 승격/})).toHaveCount(0)
 await expect(page.getByRole('link',{name:'로컬 실행기 다운로드',exact:true})).toHaveAttribute('href','/counseling/downloads/daeryun-counseling-local.zip')
 await expect(page.getByRole('link',{name:'사용안내',exact:true})).toHaveAttribute('href','/counseling/guide.html')
 await page.screenshot({path:'test-results/manager-register.png',fullPage:true})
})

test('school approval and invalid student inputs prevent sending management writes',async({page})=>{
 const api=await adminApi(page)
 await page.goto('https://counseling.test:5178/counseling/')
 await page.getByLabel('권한을 확인할 학교 계정').selectOption(pendingId)
 await expect(page.getByLabel('상담 참여 허용',{exact:true})).toBeDisabled()
 await page.getByLabel('학생 학교 계정').selectOption(studentId)
 await page.getByLabel('학번',{exact:true}).fill('abc')
 await page.getByRole('button',{name:'학생 등록 확인'}).click()
 await expect(page.getByRole('alert')).toContainText('학번')
 expect(api.calls.filter(item=>item.method==='POST')).toHaveLength(0)
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await page.screenshot({path:'test-results/manager-mobile.png',fullPage:true})
})

test('student cannot open management even with a manager value in browser storage or URL',async({page})=>{
 const api=await adminApi(page,'student',false)
 await page.goto('https://counseling.test:5178/counseling/?admin=1')
 await expect(page.getByRole('heading',{name:'아직 안내된 전략이 없습니다.'})).toBeVisible()
 await expect(page.getByRole('button',{name:'학생·담당 관리',exact:true})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'상담 참여 권한',exact:true})).toHaveCount(0)
 expect(api.calls.some(item=>item.path.endsWith('counseling-admin'))).toBe(false)
})

test('teacher-manager can open management and return to counseling',async({page})=>{
 await adminApi(page,'teacher',true)
 await page.goto('https://counseling.test:5178/counseling/')
 await page.getByRole('button',{name:'학생·담당 관리',exact:true}).click()
 await expect(page.getByRole('heading',{name:'학생과 상담 교사를 연결합니다.'})).toBeVisible()
 await page.getByRole('button',{name:'상담으로 돌아가기',exact:true}).click()
 await expect(page.getByRole('heading',{name:'학생 자료를 입력하고 전략 준비를 시작하세요.'})).toBeVisible()
})
