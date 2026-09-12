import {test,expect,type Page} from '@playwright/test'
import type {CounselingCase,Session} from '../src/lib/types'
const freshSession=(id='session-1'):Session=>({id,date:'2026-09-11',topic:'',student_question:'',context:'',evidence_notes:'',teacher_opinion:'',actions:[],next_date:'',record:null,analysis:null,review:null,confirmed:null})
const freshCase=():CounselingCase=>({schema_version:1,id:'case-1',revision:1,privacy:'local_only',created_at:'2026-09-11T00:00:00',updated_at:'2026-09-11T00:00:00',origin:'synthetic',student:{student_id:'student-1',student_number:'10101',academic_year:2026,school_stage:'high',grade:1,name:'합성학생'},teacher:{display_name:'합성교사'},current_session_id:'session-1',sessions:[freshSession()]})
async function mockApi(page:Page,existing=false){
 let value=freshCase(),exists=existing,jobType='analyze',cancelled=false,hold=false,conflict=false,jobFailure=false
 const requests:{path:string;method:string;body:any}[]=[]
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),body=req.postDataJSON()
  requests.push({path,method,body})
  const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
  if(path==='/api/health')return json({version:'test',mode:'local',demo:true,csrf_token:'csrf',teacher:null,ollama:{available:true,models:[{name:'synthetic-local-model',vision:false}]}})
  if(path==='/api/fixtures')return json({fixtures:[{id:'synthetic',title:'합성 고등학교 학생부',description:'시험용'}]})
  if(path==='/api/cases'&&method==='GET')return json({cases:exists?[value]:[]})
  if(path==='/api/cases'&&method==='POST'){exists=true;value.student={...body.student};return json({case:value})}
  if(path==='/api/cases/case-1'&&method==='GET')return json({case:value})
  if(path==='/api/cases/case-1'&&method==='PUT'){if(conflict)return json({error:{code:'revision_conflict',message:'conflict'}},409);value=body.case;value.revision++;value.sessions.find(s=>s.id===value.current_session_id)!.review=null;return json({case:value})}
  if(path.endsWith('/record')){value.revision++;value.sessions[0]!.record={id:'record-1',filename:'synthetic.pdf',sha256:'test',page_count:2,school_stage:'high',sections:[{id:'ev-1',category:'subject',label:'교과 학습',school_stage:'high',academic_year:2026,grade:1,semester:1,pages:[1],text:'합성 자료에서 관찰과 해석을 구분해 설명함.',status:'present'},{id:'ev-2',category:'behavior',label:'행동특성',school_stage:'high',academic_year:2026,grade:1,semester:1,pages:[2],text:'',status:'uncertain'}],warnings:['2쪽의 판독 결과를 확인해 주세요.'],readable_pages:[1],unreadable_pages:[2]};return json({case:value})}
  if(path.endsWith('/analyze')||path.endsWith('/review')){jobType=path.endsWith('/review')?'review':'analyze';cancelled=false;return json({job:{id:'job-1',state:'queued'}})}
  if(path==='/api/jobs/job-1/cancel'){cancelled=true;return json({job:{id:'job-1',state:'cancelled',case_id:value.id}})}
  if(path==='/api/jobs/job-1'){if(cancelled)return json({job:{id:'job-1',state:'cancelled',message:'작업을 취소했습니다.'}});if(jobFailure)return json({job:{id:'job-1',state:'needs_revision',message:'원문에서 확인할 수 없는 근거가 있어 분석을 보류했습니다.'}});if(hold)return json({job:{id:'job-1',state:'running',stage:'분석',message:'근거를 확인하고 있습니다.'}});if(jobType==='review')value.sessions[0]!.review={state:'pending',method:'manual',content_hash:'hash',notes:['근거와 다음 행동을 직접 확인해 주세요.'],created_at:'2026-09-11T00:00:00'};else value.sessions[0]!.analysis={summary:'합성 기록의 확인 가능한 범위를 요약한 초안입니다.',strengths:[{text:'관찰과 해석을 구분함',guidance:'설명의 근거를 이어서 점검합니다.',evidence_ids:['ev-1']}],improvements:[],questions:['어떤 근거가 판단을 바꾸었나요?'],actions:[{text:'비교 기준을 설명하기',reason:'질문을 좁히기 위해',evidence_ids:['ev-1']}],limitations:['판독이 불확실한 항목은 분석에 쓰지 않았습니다.'],model:'synthetic-local-model',created_at:'2026-09-11T00:00:00'};value.revision++;return json({job:{id:'job-1',state:'succeeded',message:'결과를 확인해 주세요.'}})}
  if(path.endsWith('/confirm')){value.sessions[0]!.confirmed={synthetic:true};value.revision++;return json({case:value})}
  if(path.endsWith('/sessions')){const next=freshSession('session-2');value.sessions.push(next);value.current_session_id=next.id;value.revision++;return json({case:value})}
  if(path.endsWith('/export'))return json({format:'daeryun-counseling',version:1,case:value})
  if(path.endsWith('/report.pdf'))return route.fulfill({contentType:'application/pdf',body:'%PDF-1.7 synthetic'})
  if(path==='/api/import'){value=body.bundle.case;value.id='case-1';value.sessions.forEach(s=>{s.review=null;s.confirmed=null});exists=true;return json({case:value})}
  return json({error:{code:'not_found',message:path}},404)
 })
 return {requests,failJob:()=>{jobFailure=true},hold:()=>{hold=true},conflict:()=>{conflict=true}}
}
test('desktop counseling, evidence, analysis, review, confirmation and next session',async({page})=>{
 const mock=await mockApi(page)
 const outside:string[]=[];page.on('request',req=>{if(!new URL(req.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))outside.push(req.url())})
 await page.goto('/counseling/')
 await page.getByRole('button',{name:'새 상담',exact:true}).click()
 await page.getByLabel('학번',{exact:true}).fill('10101')
 await page.getByLabel('학생 이름').fill('합성학생')
 await page.getByRole('button',{name:'첫 상담 만들기'}).click()
 await page.getByLabel('상담 목표',{exact:true}).fill('탐구 질문을 좁히기')
 await page.getByLabel('학생의 질문',{exact:true}).fill('비교 기준을 어떻게 정할까요?')
 await page.getByLabel('교사의 의견',{exact:true}).fill('확인한 근거를 바탕으로 질문을 좁힙니다.')
 await page.getByRole('button',{name:'행동 추가',exact:true}).click()
 await page.getByLabel('다음 행동 1',{exact:true}).fill('비교 기준 하나를 말해 보기')
 await page.getByRole('button',{name:'저장',exact:true}).click()
 await expect(page.getByText('작성한 상담을 저장했습니다.')).toBeVisible()
 await page.screenshot({path:'test-results/desktop-counseling.png',fullPage:true})
 await page.getByRole('button',{name:'학생부 근거',exact:true}).click()
 await page.locator('input[type=file][accept=".pdf,application/pdf"]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 synthetic')})
 await page.getByRole('button',{name:'항목 추출하기'}).click()
 await expect(page.getByText('판독 확인 필요',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'분석과 전략',exact:true}).click()
 await page.getByRole('button',{name:'분석 시작',exact:true}).click()
 await expect(page.getByRole('heading',{name:'현재의 배움'})).toBeVisible()
 await page.getByRole('button',{name:'교과 학습',exact:true}).click()
 await expect(page.locator('#evidence-ev-1')).toHaveAttribute('open','')
 await page.getByRole('button',{name:'검토와 확정',exact:true}).click()
 await page.getByRole('button',{name:'자동 점검 후 직접 검토'}).click()
 await expect(page.getByText('교사 직접 확인 필요')).toBeVisible()
 await page.getByLabel('원문 근거와 상담 내용, 문체 검토 의견을 확인했습니다.').check()
 await page.getByRole('button',{name:'합성 시연 회차 확정'}).click()
 await expect(page.getByText('합성 시연으로 확정한 회차입니다.')).toBeVisible()
 await page.getByRole('button',{name:'상담 기록',exact:true}).click()
 await expect(page.getByLabel('교사의 의견',{exact:true})).toBeDisabled()
 await page.getByRole('button',{name:'회차 추가',exact:true}).click()
 await expect(page.getByText('2회 상담',{exact:true})).toBeVisible()
 expect(mock.requests.find(r=>r.path.endsWith('/analyze'))?.body.session_id).toBe('session-1')
 expect(outside).toEqual([])
})
test('conflict preserves draft and offers backup; cancellation reaches job endpoint',async({page})=>{
 const mock=await mockApi(page,true);await page.goto('/counseling/')
 await page.getByLabel('상담 목표',{exact:true}).fill('충돌해도 보존할 초안')
 mock.conflict();await page.getByRole('button',{name:'저장',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('다른 창에서')
 await expect(page.getByLabel('상담 목표',{exact:true})).toHaveValue('충돌해도 보존할 초안')
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'작성 내용 백업',exact:true}).click();expect((await download).suggestedFilename()).toContain('작성중.json')
})
test('mobile layout and keyboard-accessible import confirmation',async({page})=>{
 await page.setViewportSize({width:390,height:844});await mockApi(page,true);await page.goto('/counseling/')
 await expect(page.getByLabel('상담 목표',{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await page.screenshot({path:'test-results/mobile-counseling.png',fullPage:true})
 await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'daeryun-counseling',version:1,case:freshCase()}))})
 await expect(page.getByRole('dialog')).toBeVisible()
 await expect(page.getByRole('button',{name:'새 사본으로 가져오기'})).toBeDisabled()
 await page.getByLabel('학년도, 학번과 상담 학생이 맞는지 확인했습니다.').check()
 await expect(page.getByRole('button',{name:'새 사본으로 가져오기'})).toBeEnabled()
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('running analysis can be cancelled',async({page})=>{
 const mock=await mockApi(page,true);await page.goto('/counseling/')
 await page.getByRole('button',{name:'학생부 근거',exact:true}).click()
 await page.locator('input[type=file][accept=".pdf,application/pdf"]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 synthetic')})
 await page.getByRole('button',{name:'항목 추출하기'}).click()
 await page.getByRole('button',{name:'분석과 전략',exact:true}).click();mock.hold()
 await page.getByRole('button',{name:'분석 시작',exact:true}).click()
 await expect(page.getByRole('button',{name:'분석 취소',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'분석 취소',exact:true}).click()
 await expect(page.getByText('작업을 취소했습니다.',{exact:true})).toBeVisible()
 expect(mock.requests.some(r=>r.path==='/api/jobs/job-1/cancel')).toBe(true)
})

test('analysis that needs corrected evidence shows an error and no invented result',async({page})=>{
 const mock=await mockApi(page,true);await page.goto('/counseling/')
 await page.getByRole('button',{name:'학생부 근거',exact:true}).click()
 await page.locator('input[type=file][accept=".pdf,application/pdf"]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 synthetic')})
 await page.getByRole('button',{name:'항목 추출하기'}).click()
 await page.getByRole('button',{name:'분석과 전략',exact:true}).click();mock.failJob()
 await page.getByRole('button',{name:'분석 시작',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('원문에서 확인할 수 없는 근거')
 await expect(page.getByRole('heading',{name:'현재의 배움'})).toHaveCount(0)
})
