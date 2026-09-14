import {test,expect,type Page} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import path from 'node:path'
import type {CounselingCase,Session} from '../src/lib/types'
import {intuitiveApi,onlineOrigin,syntheticCase,type UiCall} from './fixtures/intuitive'

const acknowledgement='이 전략의 모든 회차와 상담·분석 기록을 삭제하겠습니다.'
const unsavedPlan='다른 학생의 작업 중인 교과 계획은 그대로 보존해야 합니다.'

function recordAnalysis(session:Session){
 session.record={id:'record-'+session.id,filename:'합성 학생부.pdf',sha256:'source-'+session.id,page_count:1,school_stage:'high',readable_pages:[1],unreadable_pages:[],warnings:[],sections:[]}
 session.analysis={summary:'합성 자료에서 비교한 근거를 확인합니다.',strengths:[],improvements:[],questions:[],actions:[],limitations:[],record_sha256:session.record.sha256,model:'synthetic-only',created_at:'2026-09-14T00:00:00Z'}
}

function casesForActions():CounselingCase[]{
 const current=syntheticCase()
 current.id='case-current';current.student.student_number='10101';current.student.name='합성작성학생'
 current.sessions[0]!.id='current-session';current.current_session_id='current-session'
 const other=syntheticCase()
 other.id='case-other';other.revision=3;other.student.student_number='20202';other.student.name='합성대상학생'
 const older=other.sessions[0]!
 older.id='other-first';older.topic='이전 회차';recordAnalysis(older)
 const latest=structuredClone(older)
 latest.id='other-latest';latest.date='2026-09-15';latest.topic='최신 회차';recordAnalysis(latest)
 latest.strategy!.subject_plan='저장된 수업 자료로 근거를 확인합니다.'
 latest.strategy!.student_message='수업 자료의 근거를 설명해 주세요.'
 latest.actions=[{id:'saved-action',text:'기존 자료의 출처를 설명하기',due_date:'',status:'planned'}]
 latest.preparation={prepared_at:'2026-09-14',prepared_by:'synthetic',topic:latest.topic,strategy:structuredClone(latest.strategy!),actions:structuredClone(latest.actions)}
 latest.consultation={status:'completed',date:'2026-09-15',student_response:'자료로 설명할 수 있다고 응답함',agreed_direction:'기존 자료의 출처를 함께 확인하기',adjustments:'',summary:''}
 latest.confirmed={synthetic:true}
 other.sessions.push(latest);other.current_session_id=latest.id
 return [current,other]
}

/** Override case endpoints only; the shared fixture blocks all real external APIs. */
async function actionApi(page:Page,options:{mode?:'local'|'online';role?:'teacher'|'student';values?:CounselingCase[]}={}){
 const mode=options.mode||'local',values=structuredClone(options.values||casesForActions())
 if(mode==='online')values.forEach(value=>{value.privacy='standard';value.sessions.forEach(session=>{session.record=null;session.analysis=null})})
 const api=await intuitiveApi(page,{mode,role:options.role,value:values[0]}),calls:UiCall[]=[]
 const state={values,deleteStatus:0}
 await page.route(/\/(?:api\/cases(?:\/|$)|\.netlify\/functions\/counseling-cases(?:\?|$))/,async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method(),body=request.postDataJSON()
  calls.push({path:url.pathname+url.search,method,body})
  const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)})
  const id=mode==='local'?decodeURIComponent(url.pathname.match(/^\/api\/cases\/([^/]+)/)?.[1]||''):url.searchParams.get('id')||''
  const value=state.values.find(item=>item.id===id),action=url.searchParams.get('action')
  if(method==='GET'&&!id)return json({cases:state.values})
  if(!value)return json({error:{code:'not_found',message:'합성 전략을 찾을 수 없습니다.'}},404)
  if(method==='DELETE'){
   if(state.deleteStatus)return json({error:{code:state.deleteStatus===409?'revision_conflict':'unavailable',message:'합성 서버 연결 오류'}},state.deleteStatus)
   if(body?.revision!==value.revision)return json({error:{code:'revision_conflict',message:'합성 버전 불일치'}},409)
   state.values=state.values.filter(item=>item.id!==id)
   return json({deleted:true,id})
  }
  if(method!=='GET')return json({error:{code:'unexpected_write',message:'저장 없이 대상을 처리해야 합니다.'}},400)
  if(url.pathname.endsWith('/export')||action==='export')return json({format:'daeryun-counseling',version:1,case:value})
  if(url.pathname.endsWith('/report.pdf')||action==='report')return route.fulfill({contentType:mode==='local'?'application/pdf':'text/html',body:mode==='local'?'%PDF-1.7 synthetic report':'<!doctype html><html lang="ko"><title>합성 보고서</title><h1>저장된 대상 보고서</h1></html>'})
  return json({case:value})
 })
 await page.goto((mode==='online'?onlineOrigin:'')+'/counseling/')
 await expect(page.locator('.case-card')).toHaveCount(values.length)
 return {api,calls,state}
}

function card(page:Page,identity:string){return page.locator('.case-card').filter({has:page.locator('button.case-item').filter({hasText:identity})})}
async function makeDirty(page:Page){
 await page.getByRole('button',{name:'교사 전략 수립',exact:true}).click()
 await page.getByLabel('교과 계획',{exact:true}).fill(unsavedPlan)
 await expect(page.locator('.save-state')).toHaveText('저장 전 변경 있음')
}
async function expectDirtyCurrent(page:Page){
 await expect(page.locator('.document-heading h1')).toContainText('10101')
 await expect(page.getByLabel('교과 계획',{exact:true})).toHaveValue(unsavedPlan)
 await expect(page.locator('.save-state')).toHaveText('저장 전 변경 있음')
}

test('nonselected saved-case downloads use the requested session and preserve the unrelated dirty editor',async({page})=>{
 const {api,calls,state}=await actionApi(page),before=JSON.stringify(state.values),unexpectedDialogs:string[]=[]
 page.on('dialog',async dialog=>{unexpectedDialogs.push(dialog.message());await dialog.dismiss()})
 await makeDirty(page)
 await card(page,'20202').getByRole('button',{name:'20202 합성대상학생 다운로드',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'전략 다운로드',exact:true})
 await expect(dialog).toBeVisible()
 await expect(dialog.getByRole('button',{name:'닫기',exact:true}).first()).toBeFocused()
 await expect(dialog.getByRole('combobox',{name:/^다운로드할 회차/})).toHaveValue('other-latest')
 await expect(dialog.getByRole('button',{name:'학생 안내 PDF',exact:true})).toBeEnabled()
 let pending=page.waitForEvent('download')
 await dialog.getByRole('button',{name:'학생 안내 PDF',exact:true}).click();await pending
 await dialog.getByRole('combobox',{name:/^다운로드할 회차/}).selectOption('other-first')
 await expect(dialog.getByRole('button',{name:'학생 안내 PDF',exact:true})).toBeDisabled()
 for(const label of ['학생부 분석 PDF','교사 검토용 PDF','전략 백업(JSON)']){
  pending=page.waitForEvent('download')
  await dialog.getByRole('button',{name:label,exact:true}).click();await pending
 }
 await expect(dialog.getByRole('button',{name:'닫기',exact:true}).last()).toBeEnabled()
 await page.keyboard.press('Escape')
 await expect(dialog).toHaveCount(0)
 await expect(card(page,'20202').getByRole('button',{name:'20202 합성대상학생 다운로드',exact:true})).toBeFocused()
 await expectDirtyCurrent(page)
 const reports=calls.filter(call=>call.path.includes('/report.pdf')).map(call=>new URL(call.path,'http://fixture.test'))
 expect(reports.map(url=>[url.pathname,url.searchParams.get('audience'),url.searchParams.get('session_id')])).toEqual([
  ['/api/cases/case-other/report.pdf','student','other-latest'],
  ['/api/cases/case-other/report.pdf','analysis','other-first'],
  ['/api/cases/case-other/report.pdf','teacher','other-first'],
 ])
 expect(calls.some(call=>call.path==='/api/cases/case-other'&&call.method==='GET')).toBe(true)
 expect(calls.some(call=>call.path==='/api/cases/case-other/export')).toBe(true)
 expect([...calls,...api.calls].every(call=>call.method==='GET')).toBe(true)
 expect(JSON.stringify(state.values)).toBe(before)
 expect(unexpectedDialogs).toEqual([]);expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

test('download readiness follows freshly loaded saved data and rejects a mismatched analysis source',async({page})=>{
 const {calls,state}=await actionApi(page)
 const latest=state.values[1]!.sessions[1]!
 latest.analysis!.record_sha256='changed-student-record';latest.confirmed=null
 await card(page,'20202').getByRole('button',{name:'20202 합성대상학생 다운로드',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'전략 다운로드',exact:true})
 await expect(dialog.getByRole('button',{name:'학생부 분석 PDF',exact:true})).toBeDisabled()
 await expect(dialog.getByRole('button',{name:'학생 안내 PDF',exact:true})).toBeDisabled()
 await expect(dialog.getByRole('button',{name:'교사 검토용 PDF',exact:true})).toBeEnabled()
 expect(calls.some(call=>call.path.includes('report.pdf'))).toBe(false)
})

for(const mode of ['local','online'] as const)test(`${mode}: deleting another case uses its latest revision, preserves dirty work, and retains failed targets`,async({page})=>{
 const {api,calls,state}=await actionApi(page,{mode}),unexpectedDialogs:string[]=[]
 page.on('dialog',async dialog=>{unexpectedDialogs.push(dialog.message());await dialog.dismiss()})
 await makeDirty(page)
 const target=card(page,'20202'),open=()=>target.getByRole('button',{name:'20202 합성대상학생 삭제',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'전략 삭제 확인',exact:true})
 const endpoint=mode==='local'?'/api/cases/case-other':'/.netlify/functions/counseling-cases?id=case-other'
 state.values[1]!.revision=7
 await open()
 await expect(dialog).toContainText('20202 합성대상학생')
 await expect(dialog).toContainText(/2\s*회차/)
 await expect(dialog.getByRole('button',{name:'전략 삭제',exact:true})).toBeDisabled()
 await dialog.getByRole('button',{name:'취소',exact:true}).click()
 expect(calls.filter(call=>call.method==='DELETE')).toHaveLength(0)
 await expectDirtyCurrent(page)
 for(const status of [409,503]){
  state.deleteStatus=status
  await open();await dialog.getByLabel(acknowledgement,{exact:true}).check()
  await dialog.getByRole('button',{name:'전략 삭제',exact:true}).click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(status===409?'다른 창에서 이 전략이 변경되었습니다.':'합성 서버 연결 오류')
  await expect(page.locator('.case-card')).toHaveCount(2)
  expect(state.values.map(value=>value.id)).toEqual(['case-current','case-other'])
  await dialog.getByRole('button',{name:'취소',exact:true}).click()
  await expectDirtyCurrent(page)
 }
 state.deleteStatus=0
 await open();await dialog.getByLabel(acknowledgement,{exact:true}).check()
 await dialog.getByRole('button',{name:'전략 삭제',exact:true}).click()
 await expect(dialog).toHaveCount(0)
 await expect(target).toHaveCount(0)
 await expectDirtyCurrent(page)
 expect(calls.filter(call=>call.method==='DELETE')).toEqual([409,503,200].map(()=>({path:endpoint,method:'DELETE',body:{revision:7}})))
 expect(calls.filter(call=>call.path===endpoint&&call.method==='GET')).toHaveLength(4)
 expect([...calls,...api.calls].some(call=>['POST','PUT','PATCH'].includes(call.method))).toBe(false)
 expect(state.values[0]!.sessions[0]!.strategy!.subject_plan).toBe('')
 expect(unexpectedDialogs).toEqual([]);expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

test('deleting the current dirty final case explicitly warns, supports cancellation, and clears the editor only after success',async({page})=>{
 const {api,calls}=await actionApi(page,{values:casesForActions().slice(0,1)})
 await makeDirty(page)
 const target=card(page,'10101'),dialog=page.getByRole('dialog',{name:'전략 삭제 확인',exact:true})
 await target.getByRole('button',{name:'10101 합성작성학생 삭제',exact:true}).click()
 await expect(dialog).toContainText(/저장하지 않은|저장 전/)
 await expect(dialog).toContainText('10101 합성작성학생')
 await expect(dialog).toContainText(/1\s*회차/)
 await dialog.getByRole('button',{name:'취소',exact:true}).click()
 await expectDirtyCurrent(page)
 expect(calls.filter(call=>call.method==='DELETE')).toHaveLength(0)
 await target.getByRole('button',{name:'10101 합성작성학생 삭제',exact:true}).click()
 await dialog.getByLabel(acknowledgement,{exact:true}).check()
 await dialog.getByRole('button',{name:'전략 삭제',exact:true}).click()
 await expect(dialog).toHaveCount(0)
 await expect(page.locator('.case-card')).toHaveCount(0)
 await expect(page.locator('.document-heading')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'새 전략',exact:true})).toBeEnabled()
 expect(calls.filter(call=>call.method==='DELETE')).toEqual([{path:'/api/cases/case-current',method:'DELETE',body:{revision:1}}])
 expect([...calls,...api.calls].some(call=>['POST','PUT','PATCH'].includes(call.method))).toBe(false)
 expect(api.pageErrors).toEqual([])
})

test('student cards expose neither teacher download choices nor deletion controls',async({page})=>{
 const value=casesForActions()[1]!
 value.sessions[1]!.guidance={published_at:'2026-09-15',published_by:'synthetic'}
 const {api,calls}=await actionApi(page,{mode:'online',role:'student',values:[value]})
 const target=card(page,'20202')
 await expect(target.locator('button.case-item')).toBeVisible()
 await expect(target.getByRole('button',{name:/다운로드|삭제/})).toHaveCount(0)
 await expect(page.getByRole('dialog',{name:/전략 다운로드|전략 삭제 확인/})).toHaveCount(0)
 expect([...calls,...api.calls].every(call=>call.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

test('mobile sidebar keeps each student action reachable and opens the matching download dialog',async({page})=>{
 await page.setViewportSize({width:390,height:844})
 const {api,calls}=await actionApi(page)
 await page.getByRole('button',{name:'학생별 전략 목록',exact:true}).click()
 const target=card(page,'20202'),download=target.getByRole('button',{name:'20202 합성대상학생 다운로드',exact:true})
 await expect(download).toBeInViewport({ratio:1})
 await expect(target.getByRole('button',{name:'20202 합성대상학생 삭제',exact:true})).toBeInViewport({ratio:1})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 const directory=path.resolve('../../_workspace/case-actions-check')
 await mkdir(directory,{recursive:true})
 await page.screenshot({path:path.join(directory,'sidebar-390.png'),fullPage:false})
 await download.focus();await page.keyboard.press('Enter')
 const dialog=page.getByRole('dialog',{name:'전략 다운로드',exact:true})
 await expect(dialog).toContainText('20202 합성대상학생')
 await expect(dialog.getByRole('button',{name:'학생부 분석 PDF',exact:true})).toBeInViewport({ratio:1})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await page.screenshot({path:path.join(directory,'download-dialog-390.png'),fullPage:false})
 expect([...calls,...api.calls].every(call=>call.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})
