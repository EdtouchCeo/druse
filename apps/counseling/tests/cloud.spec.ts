import {test,expect,type Page} from '@playwright/test'
import type {CounselingCase} from '../src/lib/types'
const freshCase=():CounselingCase=>({schema_version:1,id:'cloud-case',revision:1,privacy:'standard',created_at:'2026-09-11',updated_at:'2026-09-11',origin:'teacher',student:{student_id:'assigned-student',student_number:'10101',academic_year:2026,school_stage:'high',grade:1,name:'합성학생'},teacher:{display_name:'합성교사'},current_session_id:'cloud-session',sessions:[{id:'cloud-session',date:'2026-09-11',topic:'질문 정하기',student_question:'무엇을 먼저 비교할까요?',context:'합성 상담',evidence_notes:'자료의 관찰 내용을 확인함',teacher_opinion:'비교 기준 하나를 정합니다.',actions:[],next_date:'',record:null,analysis:null,review:null,confirmed:null}]})
async function cloudApi(page:Page,role:'teacher'|'student'){
 let value=freshCase();const calls:{path:string;method:string;body:any;authorization:string|undefined}[]=[],assets:string[]=[]
 await page.addInitScript(()=>localStorage.setItem('dr_sess_v1',JSON.stringify({token:'synthetic-session-token',user:{role:'not-authoritative'}})))
 await page.route('https://counseling.test:5178/**',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(!url.pathname.startsWith('/.netlify/functions/')){assets.push(url.pathname);url.hostname='127.0.0.1';url.protocol='http:';return route.fulfill({response:await route.fetch({url:url.toString()})})}
  const body=req.postDataJSON();calls.push({path:url.pathname,method:req.method(),body,authorization:req.headers().authorization})
  const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(url.pathname.endsWith('counseling-session'))return json({user:{id:'synthetic-user',role,approved:true,display_name:role==='teacher'?'합성교사':'합성학생',student_id:role==='student'?'assigned-student':undefined},students:[value.student],ai:{server:true}})
  if(url.pathname.endsWith('counseling-ai'))return json({text:'자료 두 개의 관찰 결과를 한 문장씩 적어 봅니다.'})
  const action=url.searchParams.get('action')
  if(action==='review'){value.revision++;value.sessions[0]!.review={state:'pending',method:'manual',content_hash:'synthetic',notes:['사실과 계획을 구분해 확인해 주세요.'],created_at:'2026-09-11'};return json({case:value,review:value.sessions[0]!.review})}
  if(action==='confirm'){value.revision++;value.sessions[0]!.confirmed={by:'synthetic-user'};value.sessions[0]!.review!.state='passed';return json({case:value})}
  if(action==='export')return json({format:'daeryun-counseling',version:1,case:value})
  if(action==='report')return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><title>합성 상담 인쇄</title><body><h1>합성 상담 보고서</h1><button onclick="window.print()">PDF로 저장</button></body></html>'})
  if(req.method()==='PUT'){value=body.case;value.revision++;return json({case:value})}
  return json(url.searchParams.get('id')?{case:value}:{cases:[value]})
 })
 return {calls,assets}
}

test('online teacher uses assigned identity, server AI and authenticated HTML export without local record calls',async({page})=>{
 const api=await cloudApi(page,'teacher')
 await page.goto('https://counseling.test:5178/counseling/')
 await expect(page.getByLabel('교사의 의견',{exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'새 상담',exact:true}).click()
 await expect(page.getByLabel('배정된 학생')).toContainText('10101 합성학생')
 await expect(page.getByLabel('학번',{exact:true})).toHaveCount(0)
 await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'학생부 근거',exact:true}).click()
 await expect(page.getByRole('heading',{name:'학생부는 교사 PC에서 살펴봅니다.'})).toBeVisible()
 await expect(page.getByRole('button',{name:'PDF 파일 선택'})).toHaveCount(0)
 await page.getByRole('button',{name:'상담 기록',exact:true}).click()
 await page.getByLabel('교사의 의견',{exact:true}).fill('관찰 결과를 적고 비교 기준 하나를 정합니다.')
 await page.getByLabel('일반 상담 본문이 선택한 외부 AI로 전송됨을 확인했습니다.').check()
 await page.getByRole('button',{name:'상담 초안 요청',exact:true}).click()
 await expect(page.getByText('자료 두 개의 관찰 결과를 한 문장씩 적어 봅니다.',{exact:true})).toBeVisible()
 const ai=api.calls.find(c=>c.path.endsWith('counseling-ai'))!
 expect(ai.body).toEqual({case_id:'cloud-case',session_id:'cloud-session',revision:2,privacy:'standard',purpose:'counseling'})
 await page.getByRole('button',{name:'검토와 확정',exact:true}).click()
 await page.getByRole('button',{name:'자동 점검 후 직접 검토'}).click()
 await expect(page.getByText('교사 직접 확인 필요')).toBeVisible()
 await page.getByLabel('원문 근거와 상담 내용, 문체 검토 의견을 확인했습니다.').check()
 await page.getByRole('button',{name:'교사 확인 후 확정'}).click()
 await expect(page.getByText('교사가 확인한 상담 회차입니다.',{exact:false})).toBeVisible()
 const popupPromise=page.waitForEvent('popup')
 await page.getByRole('button',{name:'PDF 내보내기',exact:true}).click()
 const popup=await popupPromise
 await expect(popup.getByRole('heading',{name:'합성 상담 보고서'})).toBeVisible()
 expect(api.calls.every(c=>c.authorization==='Bearer synthetic-session-token')).toBeTruthy()
 expect(api.assets.some(p=>p.includes('localTransport'))).toBe(false)
 await page.screenshot({path:'test-results/online-teacher.png',fullPage:true})
})

test('online student has read-only own counseling and private backups are rejected before import',async({page})=>{
 const api=await cloudApi(page,'student')
 await page.goto('https://counseling.test:5178/counseling/')
 await expect(page.getByLabel('교사의 의견',{exact:true})).toBeDisabled()
 await expect(page.getByRole('button',{name:'새 상담',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'회차 추가',exact:true})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'일반 상담 AI'})).toHaveCount(0)
 const download=page.waitForEvent('download')
 await page.getByRole('button',{name:'JSON 백업',exact:true}).click()
 expect((await download).suggestedFilename()).toContain('10101')
 const privateCase=freshCase();privateCase.privacy='local_only'
 await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'daeryun-counseling',version:1,case:privateCase}))})
 await expect(page.getByRole('alert')).toContainText('온라인')
 expect(api.calls.every(c=>c.method==='GET')).toBeTruthy()
})
