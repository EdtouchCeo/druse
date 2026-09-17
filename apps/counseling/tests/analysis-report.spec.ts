import {test,expect,type Page} from '@playwright/test'
import {intuitiveApi,syntheticCase} from './fixtures/intuitive'

function analysisCase(){
 const value=syntheticCase(),session=value.sessions[0]!
 value.student.student_number='10101';session.topic=''
 session.record={id:'analysis-record',filename:'합성 학생부.pdf',sha256:'synthetic-analysis-source',page_count:2,school_stage:'high',readable_pages:[1],unreadable_pages:[2],warnings:['2쪽은 판독을 확인하지 못했습니다.'],sections:[{id:'analysis-evidence',category:'subject',label:'교과 학습',school_stage:'high',academic_year:2026,grade:2,semester:1,pages:[1],text:'관찰 자료를 비교하여 설명의 근거를 확인하고 피드백을 반영하여 설명을 수정함.',status:'present'}]}
 session.analysis={summary:'자료 비교와 피드백 반영이 제공된 학생부에서 확인됩니다.',strengths:[{text:'관찰 자료의 차이를 근거로 설명함',guidance:'자료 선택의 이유를 함께 설명합니다.',evidence_ids:['analysis-evidence']}],improvements:[{text:'다른 자료에도 설명이 적용되는지 확인이 필요함',guidance:'학생이 비교 기준을 어떻게 정했는지 질문합니다.',evidence_ids:['analysis-evidence']}],questions:['피드백으로 설명의 어떤 부분을 바꾸었나요?'],actions:[{text:'기존 수업 활동지에서 비교 기준을 설명하기',reason:'확인된 자료 비교 경험을 점검하기 위해',evidence_ids:['analysis-evidence']}],limitations:['판독하지 못한 2쪽은 분석의 근거로 사용하지 않았습니다.'],model:'synthetic-model',created_at:'2026-09-14T00:00:00Z',record_sha256:session.record.sha256}
 return value
}

async function setup(page:Page,value=analysisCase()){
 const api=await intuitiveApi(page,{value}),reports:URL[]=[]
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url())
  if(!url.pathname.endsWith('/report.pdf'))return route.fallback()
  reports.push(url)
  return route.fulfill({contentType:'application/pdf',body:'%PDF-1.7 synthetic analysis report'})
 })
 await page.goto('/counseling/')
 return {api,reports}
}

test('stored student-record analysis produces a report without a strategy, consultation or confirmation',async({page},testInfo)=>{
 const {api,reports}=await setup(page),before=JSON.stringify(api.value)
 const reportTab=page.getByRole('button',{name:'분석·전략 보고서',exact:true})
 await reportTab.focus();await page.keyboard.press('Enter')
 const report=page.getByRole('article',{name:'학생부 분석 보고서 미리보기',exact:true})
 await expect(report).toBeVisible()
 for(const text of ['자료 비교와 피드백 반영이 제공된 학생부에서 확인됩니다.','관찰 자료의 차이를 근거로 설명함','다른 자료에도 설명이 적용되는지 확인이 필요함','기존 수업 활동지에서 비교 기준을 설명하기','판독하지 못한 2쪽은 분석의 근거로 사용하지 않았습니다.'])await expect(report).toContainText(text)
 for(const text of ['원문 근거','확인 위치','교과 학습','피드백으로 설명의 어떤 부분을 바꾸었나요?'])await expect(report).not.toContainText(text)
 await expect(report).not.toContainText('비공개')
 await expect(report.locator('textarea,input')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'학생 안내 PDF 저장',exact:true})).toBeDisabled()
 await expect(page.getByRole('button',{name:'자동 점검 후 직접 검토',exact:true})).toHaveCount(0)
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await page.screenshot({path:testInfo.outputPath('analysis-only-report-390.png'),fullPage:true})
 const exportButton=page.getByRole('button',{name:'학생부 분석 PDF 저장',exact:true})
 await exportButton.focus();await expect(exportButton).toBeFocused()
 const pending=page.waitForEvent('download');await page.keyboard.press('Enter')
 expect((await pending).suggestedFilename()).toBe('학생부_분석_자료_10101_2026-09-14.pdf')
 expect(reports).toHaveLength(1)
 expect(reports[0]!.searchParams.get('audience')).toBe('analysis')
 expect(reports[0]!.searchParams.get('session_id')).toBe('intuitive-session')
 expect(JSON.stringify(api.value)).toBe(before)
 expect(api.session!.preparation).toBeNull()
 expect(api.session!.consultation!.status).toBe('not_started')
 expect(api.session!.confirmed).toBeNull()
 expect(api.calls.every(call=>call.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

test('analysis report export preserves an incomplete, unsaved consultation edit',async({page})=>{
 const value=analysisCase(),session=value.sessions[0]!
 session.strategy!.subject_plan='비공개 전략 초안'
 session.preparation={prepared_at:'2026-09-14T00:00:00Z',prepared_by:'synthetic',topic:'비공개 사전 전략',strategy:{...session.strategy!},actions:[]}
 session.consultation={status:'completed',date:'2026-09-14',student_response:'비공개 상담 반응',agreed_direction:'수업에서 확인할 기준을 함께 정함',adjustments:'',summary:''}
 const {api,reports}=await setup(page,value),before=JSON.stringify(api.value)
 await page.getByRole('button',{name:'상담·전략 수립',exact:true}).click()
 await page.locator('.consultation-input>summary').click()
 await page.getByLabel('학생 반응',{exact:true}).fill('')
 await expect(page.locator('.save-state')).toHaveText('저장 전 변경 있음')
 await page.getByRole('button',{name:'분석·전략 보고서',exact:true}).click()
 await page.getByRole('button',{name:'학생부 분석 보고서',exact:true}).click()
 await expect(page.getByRole('article',{name:'학생부 분석 보고서 미리보기',exact:true})).not.toContainText('비공개')
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'학생부 분석 PDF 저장',exact:true}).click();await pending
 expect(reports).toHaveLength(1)
 expect(reports[0]!.searchParams.get('audience')).toBe('analysis')
 await page.getByRole('button',{name:'상담·전략 수립',exact:true}).click()
 await page.locator('.consultation-input>summary').click()
 await expect(page.getByLabel('학생 반응',{exact:true})).toHaveValue('')
 await expect(page.locator('.save-state')).toHaveText('저장 전 변경 있음')
 expect(JSON.stringify(api.value)).toBe(before)
 expect(api.calls.every(call=>call.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

for(const hasRecord of [false,true])test(`missing analysis directs the teacher to ${hasRecord?'analysis':'PDF upload'} without exporting`,async({page})=>{
 const value=analysisCase();value.sessions[0]!.analysis=null
 if(!hasRecord)value.sessions[0]!.record=null
 const {api,reports}=await setup(page,value)
 await page.getByRole('button',{name:'분석·전략 보고서',exact:true}).click()
 await expect(page.getByRole('article',{name:'학생부 분석 보고서 미리보기',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'학생부 분석 PDF 저장',exact:true}).and(page.locator(':enabled'))).toHaveCount(0)
 const action=page.getByRole('button',{name:hasRecord?'학생부 분석으로 이동':'학생부 PDF 불러오기',exact:true})
 await action.focus();await page.keyboard.press('Enter')
 await expect(page.getByRole('heading',{name:hasRecord?'학생부 상세 분석':'학생부 PDF 확인',exact:true})).toBeVisible()
 expect(reports).toHaveLength(0)
 expect(api.calls.every(call=>call.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

for(const sourceHash of [undefined,'another-record'])test(`analysis with ${sourceHash?'a mismatched':'no'} source hash requires fresh analysis`,async({page})=>{
 const value=analysisCase();value.sessions[0]!.analysis!.record_sha256=sourceHash
 const {api,reports}=await setup(page,value)
 await page.getByRole('button',{name:'분석·전략 보고서',exact:true}).click()
 await expect(page.getByRole('article',{name:'학생부 분석 보고서 미리보기',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'학생부 분석 PDF 저장',exact:true}).and(page.locator(':enabled'))).toHaveCount(0)
 await expect(page.getByText(sourceHash?'현재 학생부와 분석 자료가 다릅니다. 학생부를 다시 분석해 주세요.':'분석의 원본 연결 정보가 없습니다. 학생부를 다시 분석해 주세요.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'학생부 분석으로 이동',exact:true}).click()
 await expect(page.getByRole('heading',{name:'학생부 상세 분석',exact:true})).toBeVisible()
 expect(reports).toHaveLength(0)
 expect(api.calls.every(call=>call.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

test('area findings keep quotations visible and task details in a table on desktop and narrow screens',async({page},testInfo)=>{
 const value=analysisCase(),analysis=value.sessions[0]!.analysis!
 analysis.strengths[0]!.area='탐구';analysis.strengths[0]!.quote='관찰 자료를 비교하여 설명의 근거를 확인하고 피드백을 반영하여 설명을 수정함.'
 Object.assign(analysis.actions[0]!,{area:'탐구',expected_output:'비교 기준을 표시한 활동지',review_criteria:'근거와 설명의 연결 확인',teacher_support:'서로 다른 설명에 피드백 제공'})
 const {api}=await setup(page,value)
 await page.getByRole('button',{name:'학생부 상세 분석',exact:true}).click()
 await expect(page.getByLabel('제안 시간 상한',{exact:false})).toHaveCount(0)
 const domain=page.locator('.analysis-domain').filter({has:page.getByRole('heading',{name:'탐구 영역',exact:true})})
 await expect(domain.locator('.analysis-domain-columns > section')).toHaveCount(1)
 await expect(domain).not.toContainText('보완이 필요하다고 판단한 내용이 없습니다')
 await expect(domain.locator('blockquote')).toHaveText(analysis.strengths[0]!.quote!)
 await expect(domain).toContainText('2026학년도 · 2학년 · 1학기 · 1쪽')
 const table=page.getByRole('region',{name:'추천 탐구·준비 방향 표'})
 for(const text of ['비교 기준을 표시한 활동지','근거와 설명의 연결 확인','서로 다른 설명에 피드백 제공'])await expect(table).toContainText(text)
 await table.getByRole('button',{name:'탐구·준비 방향에 담기',exact:true}).click()
 await expect(page.getByLabel('탐구 계획',{exact:true})).toHaveValue(/산출물: 비교 기준을 표시한 활동지/)
 await page.getByRole('button',{name:'자료·분석',exact:true}).click()
 await page.getByRole('button',{name:'학생부 상세 분석',exact:true}).click()
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await page.screenshot({path:testInfo.outputPath('structured-analysis-'+width+'.png'),fullPage:true})
 }
 await domain.getByRole('button',{name:/교과 학습.*1쪽/}).click()
 await expect(page.locator('#evidence-analysis-evidence')).toHaveAttribute('open','')
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

for(const material of ['profile','strategy','record'] as const)test(`a ${material}-only session exports teacher material without completing the workflow`,async({page})=>{
 const value=syntheticCase(),session=value.sessions[0]!
 session.topic='';session.context='';session.evidence_notes='';session.teacher_opinion=''
 if(material==='profile')session.profile!.interests='합성 관심 자료'
 if(material==='strategy')session.strategy!.subject_plan='합성 교과 지도 방향'
 if(material==='record')session.record=analysisCase().sessions[0]!.record
 const {api,reports}=await setup(page,value),before=JSON.stringify(api.value)
 await page.getByRole('button',{name:'현재 자료로 보고서 보기',exact:true}).click()
 await expect(page.getByRole('button',{name:'분석·전략 보고서',exact:true})).toBeVisible()
 const button=page.getByRole('region',{name:'보고서 PDF 다운로드'}).getByRole('button',{name:'현재 자료·전략 PDF 다운로드',exact:true})
 await expect(button).toBeEnabled()
 const pending=page.waitForEvent('download');await button.click()
 expect((await pending).suggestedFilename()).toBe('학생부_분석_자료_00000_2026-09-14.pdf')
 expect(reports[0]!.searchParams.get('audience')).toBe('teacher')
 expect(JSON.stringify(api.value)).toBe(before)
 expect(api.calls.every(call=>call.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})
