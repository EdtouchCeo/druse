import {test,expect,type Page} from '@playwright/test'
import {emptyStrategy} from '../src/lib/model'
import {emptyConsultation} from '../src/lib/workflow'
import type {CounselingCase} from '../src/lib/types'
const freshCase=():CounselingCase=>({schema_version:1,id:'cloud-case',revision:1,privacy:'standard',created_at:'2026-09-11',updated_at:'2026-09-11',origin:'teacher',student:{student_id:'assigned-student',student_number:'10101',academic_year:2026,school_stage:'high',grade:1,name:'합성학생'},teacher:{display_name:'합성교사'},current_session_id:'cloud-session',sessions:[{id:'cloud-session',date:'2026-09-11',topic:'질문 정하기',student_question:'무엇을 먼저 비교할까요?',context:'합성 상담',evidence_notes:'자료의 관찰 내용을 확인함',teacher_opinion:'비교 기준 하나를 정합니다.',actions:[],next_date:'',record:null,analysis:null,review:null,confirmed:null}]})
async function cloudApi(page:Page,role:'teacher'|'student',published=true){
 let value=freshCase();value.sessions[0]!.workflow_version=2;value.sessions[0]!.profile={target_major:'비공개 전공 입력',interests:'비공개 관심 입력',learning_concerns:'학생에게 노출하지 않을 학습 고민',study_habits:'',activities:'',reading:'',attendance_notes:'',teacher_observations:'',selected_subjects:[],weekly_minutes:null,grades:[]};value.sessions[0]!.strategy={...emptyStrategy(),target_major:'환경공학과 탐색',target_path:'환경 문제를 자료로 설명하기',student_message:'비교 기준을 정하고 자료 두 개를 확인해 봅시다. '.repeat(12)};value.sessions[0]!.actions=[{id:'action-1',text:'비교 자료 두 개를 찾아 관찰 기준을 적기',due_date:'2026-09-20',status:'planned'}];if(role==='student'){value.sessions[0]!.preparation={prepared_at:'2026-09-12',prepared_by:'teacher',topic:'교사 전용 사전 전략',strategy:{...emptyStrategy(),subject_plan:'학생에게 숨겨야 하는 사전 판단'},actions:[]};value.sessions[0]!.consultation={...emptyConsultation(),status:'in_progress',student_response:'학생에게 숨겨야 하는 내부 반응 기록'}};if(role==='student'&&published)value.sessions[0]!.guidance={published_at:'2026-09-12',published_by:'teacher'};const calls:{path:string;method:string;body:any;authorization:string|undefined}[]=[],assets:string[]=[]
 await page.addInitScript(()=>localStorage.setItem('dr_sess_v1',JSON.stringify({token:'synthetic-session-token',user:{role:'not-authoritative'}})))
 await page.route('https://counseling.test:5178/**',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(!url.pathname.startsWith('/.netlify/functions/')){assets.push(url.pathname);url.hostname='127.0.0.1';url.protocol='http:';return route.fulfill({response:await route.fetch({url:url.toString()})})}
  const body=req.postDataJSON();calls.push({path:url.pathname+url.search,method:req.method(),body,authorization:req.headers().authorization})
  const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(url.pathname.endsWith('counseling-session'))return json({user:{id:'synthetic-user',role,approved:true,display_name:role==='teacher'?'합성교사':'합성학생',student_id:role==='student'?'assigned-student':undefined},students:[value.student],ai:{server:true}})
  if(url.pathname.endsWith('counseling-ai'))return json({text:'자료 두 개의 관찰 결과를 한 문장씩 적어 봅니다.'})
  const action=url.searchParams.get('action')
  if(action==='prepare'){const current=value.sessions[0]!;current.preparation=structuredClone({prepared_at:'2026-09-12T00:00:00Z',prepared_by:'synthetic-user',topic:current.topic,strategy:current.strategy!,actions:current.actions});current.consultation={...emptyConsultation(),status:'in_progress'};value.revision++;return json({case:value})}
  if(action==='review'){value.revision++;value.sessions[0]!.review={state:'pending',method:'manual',content_hash:'synthetic',notes:['사실과 계획을 구분해 확인해 주세요.'],created_at:'2026-09-11'};return json({case:value,review:value.sessions[0]!.review})}
  if(action==='confirm'){value.revision++;value.sessions[0]!.confirmed={by:'synthetic-user'};value.sessions[0]!.review!.state='passed';return json({case:value})}
  if(action==='publish'){value.revision++;value.sessions[0]!.guidance={published_at:'2026-09-12T01:00:00Z',published_by:'synthetic-user'};return json({case:value})}
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
 await expect(page.getByRole('navigation',{name:'서비스 경로'}).getByRole('link',{name:'학습전략',exact:true})).toHaveAttribute('href','/#strategy')
 await expect(page.getByRole('heading',{name:'교사 전략의 근거와 선택지를 검토합니다.'})).toBeVisible()
 await page.getByRole('button',{name:'교사 전략 수립',exact:true}).click()
 await expect(page.getByLabel('목표 전공',{exact:true})).toBeEnabled()
 await expect(page.getByRole('button',{name:'학생 안내 PDF 저장',exact:true})).toBeDisabled()
 for(const label of ['진로 방향','강점','보완점','교과 계획','탐구 계획','활동 계획','학기별 계획','학생 안내 메시지']) await expect(page.getByLabel(label,{exact:true})).toBeVisible()
 await page.screenshot({path:'test-results/strategy-teacher-desktop.png',fullPage:true})
 await page.getByRole('button',{name:'새 전략',exact:true}).click()
 await expect(page.getByLabel('배정된 학생')).toContainText('10101 합성학생')
 await expect(page.getByLabel('학번',{exact:true})).toHaveCount(0)
 await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'자료·분석',exact:true}).click()
 await page.getByRole('button',{name:'학생부 PDF 근거',exact:true}).click()
 await expect(page.getByRole('heading',{name:'학생부는 교사 PC에서 살펴봅니다.'})).toBeVisible()
 await expect(page.getByRole('button',{name:'PDF 파일 선택'})).toHaveCount(0)
 await page.getByRole('button',{name:'교사 전략 수립',exact:true}).click()
 await page.getByLabel('탐구 계획',{exact:true}).fill('질문을 정하고 자료 두 개를 비교한 뒤 기준에 대한 피드백 받기')
 await page.getByLabel('학생 기본자료·전략·교사 메모·상담 반영 기록이 선택한 외부 AI로 전송됨을 확인했습니다.').check()
 await page.getByRole('button',{name:'전략 초안 요청',exact:true}).click()
 await expect(page.getByText('자료 두 개의 관찰 결과를 한 문장씩 적어 봅니다.',{exact:true})).toBeVisible()
 const ai=api.calls.find(c=>c.path.endsWith('counseling-ai'))!
 expect(ai.body).toEqual({case_id:'cloud-case',session_id:'cloud-session',revision:2,privacy:'standard',purpose:'counseling'})
 await page.getByRole('button',{name:'전략 준비 완료·상담으로',exact:true}).click()
 await expect(page.locator('.preparation-snapshot')).toContainText('질문을 정하고 자료 두 개를 비교')
 await page.getByLabel('상담일',{exact:true}).fill('2026-09-12')
 await page.getByLabel('학생 반응',{exact:true}).fill('수업 자료 두 개를 비교할 수 있다고 설명함')
 await page.getByLabel('합의한 방향',{exact:true}).fill('수업의 같은 기준으로 두 자료를 비교하기로 정함')
 await page.getByRole('button',{name:'상담 반영 완료',exact:true}).click()
 await expect(page.getByRole('button',{name:'학생 안내 PDF 저장',exact:true})).toBeDisabled()
 await expect(page.getByRole('button',{name:'교사 검토용 PDF',exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'자동 점검 후 직접 검토'}).click()
 await expect(page.getByText('교사 직접 확인 필요')).toBeVisible()
 await page.getByLabel('원문 근거와 전략 내용, 문체 검토 의견을 확인했습니다.').check()
 await page.getByRole('button',{name:'교사 확인 후 확정'}).click()
 await expect(page.getByText('교사가 확인한 전략 회차입니다.',{exact:false})).toBeVisible()
 await expect(page.getByRole('button',{name:'학생에게 전략 안내',exact:true})).toBeEnabled()
 page.once('dialog',dialog=>dialog.dismiss())
 await page.getByRole('button',{name:'학생에게 전략 안내',exact:true}).click()
 expect(api.calls.some(c=>c.path.includes('action=publish'))).toBe(false)
 page.once('dialog',dialog=>{expect(dialog.message()).toContain('교사 참고 메모는 공개하지 않습니다.');return dialog.accept()})
 await page.getByRole('button',{name:'학생에게 전략 안내',exact:true}).click()
 await expect(page.getByText('학생 안내 완료',{exact:true})).toBeVisible()
 await expect(page.getByLabel('목표 전공',{exact:true})).toBeDisabled()
 expect(api.calls.find(c=>c.path.includes('action=publish'))?.body).toEqual({revision:6,session_id:'cloud-session'})
 const popupPromise=page.waitForEvent('popup')
 await page.getByRole('button',{name:'학생 안내 PDF 저장',exact:true}).click()
 const popup=await popupPromise
 await expect(popup.getByRole('heading',{name:'합성 상담 보고서'})).toBeVisible()
 expect(api.calls.every(c=>c.authorization==='Bearer synthetic-session-token')).toBeTruthy()
 expect(api.assets.some(p=>p.includes('localTransport'))).toBe(false)
 await page.screenshot({path:'test-results/online-teacher.png',fullPage:true})
})

test('student sees only published strategy and tasks, no teacher notes or tools, with printable PDF',async({page})=>{
 const api=await cloudApi(page,'student')
 await page.setViewportSize({width:390,height:844})
 await page.goto('https://counseling.test:5178/counseling/')
 await expect(page.getByRole('heading',{name:'나의 학종 전략'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'실행과제',exact:true})).toBeVisible()
 await expect(page.getByText('비교 기준 하나를 정합니다.',{exact:true})).toHaveCount(0)
 await expect(page.getByText('학생에게 노출하지 않을 학습 고민',{exact:true})).toHaveCount(0)
 await expect(page.getByRole('heading',{name:'학생 기본자료',exact:true})).toHaveCount(0)
 await expect(page.getByText('학생에게 숨겨야 하는 내부 반응 기록',{exact:true})).toHaveCount(0)
 await expect(page.getByText('학생에게 숨겨야 하는 사전 판단',{exact:true})).toHaveCount(0)
 for(const label of ['교사의 의견','학생의 질문','일반 AI 설정']) await expect(page.getByLabel(label,{exact:true})).toHaveCount(0)
 for(const label of ['자료·분석','교사 전략 수립','학생 상담·반영','최종 결과물','새 전략','회차 추가','JSON 백업','학생부 PDF 근거','학생에게 전략 안내','교사 검토용 PDF']) await expect(page.getByRole('button',{name:label,exact:true})).toHaveCount(0)
 await expect(page.locator('input[type=file],textarea,fieldset')).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await page.screenshot({path:'test-results/strategy-student-mobile.png',fullPage:true})
 const popupPromise=page.waitForEvent('popup')
 await page.getByRole('button',{name:'학생 안내 PDF 저장',exact:true}).click()
 await expect((await popupPromise).getByRole('heading',{name:'합성 상담 보고서'})).toBeVisible()
 expect(api.calls.find(c=>c.path.includes('action=report'))?.path).toContain('audience=student')
 expect(api.calls.every(c=>c.method==='GET')).toBeTruthy()
})

test('student receives no unpublished draft even when an unexpected response includes it',async({page})=>{
 await cloudApi(page,'student',false)
 await page.goto('https://counseling.test:5178/counseling/')
 await expect(page.getByRole('heading',{name:'아직 안내된 전략이 없습니다.'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'나의 학종 전략'})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'학생 안내 PDF 저장'})).toHaveCount(0)
})
