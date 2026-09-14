import {test,expect,type Page} from '@playwright/test'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {intuitiveApi,syntheticCase} from './fixtures/intuitive'
import type {SchoolRecord} from '../src/lib/types'

const folder=new URL('../../../_workspace/record-fixes-20260914/screenshots/',import.meta.url)
const pdfInput='input[type=file][accept=".pdf,application/pdf"]'
const pdf=(name='합성 학생부.pdf',text='%PDF-1.7 synthetic only')=>({name,mimeType:'application/pdf',buffer:Buffer.from(text)})
const record=():SchoolRecord=>({id:'record-synthetic',filename:'합성 학생부.pdf',sha256:'synthetic-only',page_count:2,school_stage:'high',readable_pages:[1,2],unreadable_pages:[],warnings:[],sections:[{id:'section-synthetic',category:'subject',label:'교과 학습',school_stage:'high',academic_year:2026,grade:3,semester:1,pages:[1],text:'합성 원문: 2025학년도 고등학교 2학년 2학기. 관찰 자료를 비교하고 설명을 수정함.',status:'present'}]})
async function setup(page:Page,{confirmed=false,failOnce=false}={}){
 const value=syntheticCase();value.student.grade=3
 const session=value.sessions[0]!;session.record=record();session.analysis={summary:'이전 분석 합성 표식',strengths:[],improvements:[],questions:[],actions:[],limitations:[],model:'synthetic',created_at:'2026-09-14'};session.review={state:'passed',method:'manual',content_hash:'synthetic',notes:[],created_at:'2026-09-14'}
 if(confirmed)session.confirmed={synthetic:true}
 const api=await intuitiveApi(page,{value}),extra:{path:string;body:any}[]=[],other=syntheticCase();other.id='second-synthetic';other.student.student_number='00001';other.student.name='다른 합성학생';other.sessions[0]!.id='second-session';other.current_session_id='second-session'
 let failures=failOnce?1:0
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname
  const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)})
  if(path==='/api/cases'&&request.method()==='GET')return json({cases:[api.value,other]})
  if(path==='/api/cases/'+other.id&&request.method()==='GET')return json({case:other})
  if(path.endsWith('/record-metadata')){
   const body=request.postDataJSON();extra.push({path,body})
   if(failures-->0)return json({error:{code:'metadata_source_mismatch',message:'합성 저장 실패: 원문을 다시 확인해 주세요.'}},422)
   const section=api.session!.record!.sections[0]!,original={school_stage:section.school_stage,academic_year:section.academic_year,grade:section.grade,semester:section.semester}
   Object.assign(section,body.metadata,{metadata_confirmation:{source:'teacher_checked',confirmed_at:'2026-09-14T03:00:00Z',confirmed_by:'synthetic',original}})
   api.session!.analysis=null;api.session!.review=null;api.value!.revision++
   return json({case:api.value})
  }
  if(path.endsWith('/record')){extra.push({path,body:request.postData()});api.session!.record=record();api.session!.analysis=null;api.session!.review=null;api.value!.revision++;return json({case:api.value})}
  return route.fallback()
 })
 await page.goto('/counseling/');await page.getByRole('button',{name:'학생부 PDF 근거',exact:true}).click()
 return {...api,extra}
}
async function drop(page:Page,files:{name:string;content?:string;size?:number}[]){
 await page.locator('.upload-area').evaluate((element,files)=>{const transfer=new DataTransfer();for(const file of files){const content=file.size?new Uint8Array(file.size):file.content??'%PDF-1.7 synthetic only';transfer.items.add(new File([content],file.name,{type:'application/pdf'}))}element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))},files)
}
async function backup(page:Page){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'전략 백업 저장',exact:true}).click();const file=await pending;return JSON.parse(await readFile((await file.path())!,'utf8')).case}
async function invariant(page:Page,api:Awaited<ReturnType<typeof setup>>){expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([]);expect(page.url()).toContain('/counseling/')}

test('PDF chooser and drop only select a file; extraction requires its own action',async({page})=>{
 const api=await setup(page)
 await page.locator(pdfInput).setInputFiles(pdf('선택한 합성.pdf'));await expect(page.locator('.selected-file')).toHaveText('선택한 합성.pdf')
 await page.getByLabel('PDF 암호').fill('synthetic-secret')
 await drop(page,[{name:'끌어놓은 합성.PDF'}]);await expect(page.locator('.selected-file')).toHaveText('끌어놓은 합성.PDF');await expect(page.getByLabel('PDF 암호')).toHaveValue('')
 expect(api.extra).toHaveLength(0);expect(api.calls.every(call=>call.method==='GET')).toBe(true)
 await page.getByRole('button',{name:'항목 추출하기',exact:true}).click()
 await expect(page.getByText('추출 항목과 판독 상태를 확인해 주세요.',{exact:true})).toBeVisible()
 expect(api.extra).toHaveLength(1);expect(api.extra[0]!.path).toMatch(/\/record$/);expect(api.extra[0]!.body).toContain('끌어놓은 합성.PDF')
 await expect(page.locator('.selected-file')).toHaveCount(0);await invariant(page,api)
})

test('both selection paths reject extension, signature and oversized files; multiple drop is rejected',async({page})=>{
 const api=await setup(page)
 for(const method of ['chooser','drop'] as const){
  for(const input of [{name:'합성.txt',content:'%PDF-1.7',message:'학생부 PDF 파일을 선택'},{name:'합성.pdf',content:'not a PDF',message:'PDF 형식을 확인할 수 없습니다'},{name:'큰 합성.pdf',size:20*1024*1024+1,message:'PDF는 20MB 이내'}]){
   if(method==='drop')await drop(page,[input]);else await page.locator(pdfInput).setInputFiles({name:input.name,mimeType:'application/pdf',buffer:input.size?Buffer.alloc(input.size):Buffer.from(input.content!)})
   await expect(page.getByRole('alert').first()).toContainText(input.message);await expect(page.locator('.selected-file')).toHaveCount(0);await expect(page.getByRole('button',{name:'항목 추출하기',exact:true})).toHaveCount(0)
  }
 }
 await drop(page,[{name:'하나.pdf'},{name:'둘.pdf'}]);await expect(page.getByRole('alert').first()).toContainText('한 번에 한 개씩')
 expect(api.extra).toHaveLength(0);expect(api.calls.every(call=>call.method==='GET')).toBe(true);await invariant(page,api)
})

test('student changes clear selected PDF/password and confirmed sessions reject drop and metadata editing',async({page})=>{
 const api=await setup(page)
 await page.locator(pdfInput).setInputFiles(pdf());await expect(page.locator('.selected-file')).toBeVisible();await page.getByLabel('PDF 암호').fill('synthetic-private')
 await page.locator('.case-list button').filter({hasText:'00001'}).click();await expect(page.locator('.selected-file')).toHaveCount(0)
 await page.getByRole('button',{name:'학생부 PDF 근거',exact:true}).click();await drop(page,[{name:'다른 학생 합성.pdf'}]);await expect(page.getByLabel('PDF 암호')).toHaveValue('')
 expect(api.extra).toHaveLength(0);await invariant(page,api)
 await page.unrouteAll({behavior:'wait'})
 const locked=await setup(page,{confirmed:true});await expect(page.getByRole('button',{name:'PDF 파일 선택',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'교과 학습 학년도·학년 수정',exact:true})).toBeDisabled()
 await drop(page,[{name:'잠긴 회차.pdf'}]);await page.locator(pdfInput).setInputFiles(pdf('숨긴입력 합성.pdf'))
 await expect(page.locator('.selected-file')).toHaveCount(0);await expect(page.locator('.record-metadata')).toHaveCount(0);expect(locked.extra).toHaveLength(0);await invariant(page,locked)
})

test('metadata save is explicit, preserves input after failure and replaces stale analysis/review after retry',async({page})=>{
 const api=await setup(page,{failOnce:true}),button=page.getByRole('button',{name:'교과 학습 학년도·학년 수정',exact:true})
 await button.focus();await page.keyboard.press('Enter');const form=page.locator('.record-metadata')
 await expect(form.getByLabel('학년도',{exact:true})).toBeFocused();await expect(page.locator('.evidence-text')).toContainText('2025학년도 고등학교 2학년 2학기')
 await form.getByLabel('학년도',{exact:true}).fill('2025');await form.getByRole('combobox',{name:'학교급',exact:true}).selectOption('high');await form.getByRole('combobox',{name:'학년',exact:true}).selectOption('2');await form.getByRole('combobox',{name:'학기',exact:true}).selectOption('2')
 expect(api.extra).toHaveLength(0)
 await form.getByRole('button',{name:'원문 확인 후 저장',exact:true}).click();await expect(page.getByRole('alert').first()).toContainText('합성 저장 실패')
 await expect(form.getByLabel('학년도',{exact:true})).toHaveValue('2025');await expect(form.getByRole('combobox',{name:'학년',exact:true})).toHaveValue('2');expect((await backup(page)).sessions[0].analysis.summary).toBe('이전 분석 합성 표식')
 await form.getByRole('button',{name:'원문 확인 후 저장',exact:true}).click();await expect(form).toHaveCount(0);await expect(button).toBeFocused();await expect(button).toContainText('2025학년도 · 2학년 · 2학기');await expect(page.locator('.evidence')).toContainText('교사 확인값')
 expect(api.extra).toHaveLength(2);expect(api.extra[1]!.body).toEqual({revision:1,session_id:'intuitive-session',record_id:'record-synthetic',section_id:'section-synthetic',metadata:{academic_year:2025,grade:2,semester:2,school_stage:'high'},source_checked:true})
 const saved=(await backup(page)).sessions[0];expect(saved.analysis).toBeNull();expect(saved.review).toBeNull();expect(saved.record.sections[0].text).toContain('합성 원문');expect(saved.record.sections[0].metadata_confirmation.original.grade).toBe(3)
 await page.getByRole('button',{name:'Ollama 근거 분석',exact:true}).click();await expect(page.getByText('이전 분석 합성 표식',{exact:true})).toHaveCount(0);await invariant(page,api)
})

test('PDF drop area and inline metadata stay readable at desktop, 390 and 320px with keyboard cancel',async({page})=>{
 const api=await setup(page);await mkdir(fileURLToPath(folder),{recursive:true});const measurements=[]
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:844});const area=page.locator('.upload-area');await area.scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('pdf-drop-'+width+'.png',folder))})
  const button=page.getByRole('button',{name:'교과 학습 학년도·학년 수정',exact:true});await button.focus();await page.keyboard.press('Enter');const form=page.locator('.record-metadata');await expect(form.getByLabel('학년도',{exact:true})).toBeFocused()
  await form.scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('record-metadata-'+width+'.png',folder))});await page.screenshot({path:fileURLToPath(new URL('record-metadata-'+width+'-full.png',folder)),fullPage:true})
  const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('.record-metadata input,.record-metadata select,.record-metadata button,.upload-area')].map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,left:r.left,right:r.right,width:r.width}})}));measurements.push(size)
  expect(size.scroll).toBeLessThanOrEqual(width);for(const control of size.controls){expect(control.left).toBeGreaterThanOrEqual(0);expect(control.right).toBeLessThanOrEqual(width+1);expect(control.width).toBeGreaterThan(40)}
  await page.keyboard.press('Escape');await expect(form).toHaveCount(0);await expect(button).toBeFocused()
 }
 await writeFile(new URL('layout.json',folder),JSON.stringify(measurements,null,2));expect(api.extra).toHaveLength(0);await invariant(page,api)
})
