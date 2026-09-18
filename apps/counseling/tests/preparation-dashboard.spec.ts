import {test,expect,type Page} from '@playwright/test'
import {intuitiveApi,syntheticCase} from './fixtures/intuitive'
import {stageSections,type Report} from '../src/lib/preparationReports'
import type {AdmissionTarget} from '../src/lib/types'

const targets:AdmissionTarget[]=[
 {id:'4c51fd43-45b4-434e-bf4e-59f7845fc441',university:'합성대학교',major:'생명과학과',admission_type:'학생부종합',admission_name:'',admission_year:2028},
 {id:'4c51fd43-45b4-434e-bf4e-59f7845fc442',university:'합성과학대학교',major:'환경공학과',admission_type:'학생부종합',admission_name:'',admission_year:2028},
]
function report(kind:Report['kind'],targetId=targets[0]!.id,sourceHash='synthetic-source-current'):Report{return {
 id:kind+'-'+targetId,kind,target_id:targetId,title:kind==='admissions'?'자료 비교 경험에서 출발하는 학종 준비':'관찰 자료의 차이는 무엇을 설명하는가?',summary:'학생부에서 확인한 자료 비교 경험을 학습 개념과 탐구 질문으로 연결합니다.',created_at:'2026-09-17T03:00:00Z',source_hash:sourceHash,model:'synthetic-private-proxy',
 sources:[{id:'official-synthetic',title:'합성대학교 공개자료',url:'https://admissions.example.test/2028',year:2028}],
 evidence_map:{'strength:compare':{label:'학생부 분석 · 비교 기준',details:['합성 학생부에서 확인한 자료 비교 경험입니다.']}},
 school_connections:[{subject:'합성 심화 과목',task:'자료의 조건 비교',reason:'앞으로 관련 과목을 선택할 때 참고하는 학교 계획입니다.',academic_year:2026,grade:3,semester:2,status:'원문 계획 · 현재 운영 확인 필요',conditions:['AI 활용 금지'],steps:['비교할 두 자료의 조건을 표로 정리합니다.','차이가 생기는 조건과 해석의 한계를 설명합니다.'],learning_topics:['자료의 대표성'],source:'합성 평가계획'}],
 sections:stageSections[kind].map((section,index)=>({id:section.id,title:section.title,overview:'공식 자료에서 확인한 조건과 현재 학생의 학습 경험을 구분하여 검토합니다. 확인하지 못한 조건을 입학 요건으로 단정하지 않고 필요한 자료를 더 확인합니다.',items:[0,1,2].map(itemIndex=>({title:section.title+' 준비 '+(itemIndex+1),detail:`${index+1}영역 ${itemIndex+1}번째 합성 준비입니다. 수업에서 다룬 개념을 직접 설명하고, 두 자료의 설명이 달라지는 지점을 찾아 비교 기준을 세웁니다. 자료의 작성 목적과 비교 범위를 함께 기록하여 같은 조건에서 판단할 수 있는지 확인합니다. 확인하지 못한 조건은 결론에 섞지 않고 추가로 읽어야 할 자료와 필요한 개념으로 구분합니다.`,reason:'현재 확인된 자료 비교 경험을 발전시키고, 근거의 차이를 이해하여 자신의 설명을 수정하는 학습으로 연결하기 위한 제안입니다.',steps:['수업에서 사용한 개념과 자료의 비교 기준을 자신의 말로 설명합니다.','두 자료에서 같은 기준으로 비교할 수 있는 부분과 추가 확인할 부분을 구분합니다.'],evidence_refs:['strength:compare','public:official-synthetic']}))})),
}}

function dashboardCase(withReports=false){
 const value=syntheticCase(),session=value.sessions[0]!
 session.profile!.interests='자료를 비교하여 생명 현상의 차이를 설명하기'
 session.profile!.admission_targets=structuredClone(targets)
 session.record={id:'synthetic-record',filename:'개인원본표식.pdf',sha256:'record-source',page_count:2,school_stage:'high',sections:[{id:'synthetic-evidence',category:'subject_detail',label:'생명과학 세부능력',school_stage:'high',academic_year:2026,grade:2,semester:1,pages:[1],text:'개인원문표식: 서로 다른 자료를 비교하여 판단 기준을 설명함.',status:'present'}],warnings:[],readable_pages:[1,2],unreadable_pages:[]}
 session.analysis={summary:'자료 비교 경험을 바탕으로 설명과 질문을 발전시킬 수 있습니다.',strengths:[{area:'학업',text:'자료의 차이를 찾고 비교 기준을 설명함',guidance:'비교 기준의 적용 범위를 확인합니다.',evidence_ids:['synthetic-evidence']}],improvements:[],questions:['두 자료를 같은 기준으로 비교할 수 있나요?'],actions:[],limitations:['제공되지 않은 활동의 성취를 단정하지 않습니다.'],created_at:'2026-09-17T00:00:00Z',model:'synthetic-local-model',record_sha256:'record-source'}
 session.preparation_reports={version:1,reports:withReports?[report('admissions'),report('inquiry')]:[]}
 return value
}

async function setup(page:Page,withReports=false,singleTarget=false){
 const value=dashboardCase(withReports)
 if(singleTarget)value.sessions[0]!.profile!.admission_targets=targets.slice(0,1)
 const api=await intuitiveApi(page,{value})
 const generated:{path:string;body:any}[]=[],pdfs:URL[]=[],statusReads:URL[]=[]
 let hash='synthetic-source-current',job:{id:string;stage:Report['kind'];targetId:string;polls:number;completed:boolean}|undefined
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname
  const json=(data:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
  if(path.endsWith('/preparation-status')){statusReads.push(url);return json({source_hash:hash})}
  if(path.endsWith('/preparation-strategy')){
   const body=request.postDataJSON();generated.push({path,body})
   job={id:'synthetic-preparation-'+generated.length,stage:body.stage,targetId:body.target_id,polls:0,completed:false}
   return json({job:{id:job.id,state:'queued',case_id:api.value!.id}})
  }
  if(job&&path==='/api/jobs/'+job.id){
   job.polls++
   if(job.polls===1)return json({job:{id:job.id,state:'running',stage:'내용 구성',message:'공식 자료와 학습 요약을 연결하고 있습니다.'}})
   if(!job.completed){api.session!.preparation_reports!.reports.push(report(job.stage,job.targetId,hash));api.value!.revision++;job.completed=true}
   return json({job:{id:job.id,state:'succeeded',message:'다섯 영역의 상세 전략을 확인해 주세요.'}})
  }
  if(path.endsWith('/preparation.pdf')||path.endsWith('/report.pdf')){pdfs.push(url);return route.fulfill({contentType:'application/pdf',body:'%PDF-1.7 synthetic dashboard report'})}
  return route.fallback()
 })
 await page.goto('/counseling/')
 await expect(page.getByRole('button',{name:'결과 대시보드',exact:true})).toBeVisible()
 return {api,generated,pdfs,statusReads,setSourceHash(value:string){hash=value}}
}

test('consultation generation starts a real job for a single target',async({page})=>{
 const mock=await setup(page,false,true)
 await page.getByRole('button',{name:'교사 관찰·상담 선택',exact:true}).click()
 await page.locator('.strategy-generate .primary').click()
 const dashboard=page.locator('.preparation-dashboard')
 await expect(dashboard.getByRole('tab',{name:/대학·학과 준비/})).toHaveAttribute('aria-selected','true')
 await expect(dashboard.locator('.result-summary')).toBeVisible()
 expect(mock.generated).toHaveLength(1)
 expect(mock.generated[0]!.body.stage).toBe('admissions')
})

test('generation failures remain visible next to the button and allow retry',async({page})=>{
 await setup(page)
 await page.route('**/api/cases/*/preparation-strategy',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'unavailable',message:'전략 서버 연결을 확인해 주세요.'}})}))
 await page.getByRole('button',{name:'결과 대시보드',exact:true}).click()
 const dashboard=page.locator('.preparation-dashboard')
 await dashboard.getByRole('tab',{name:/대학·학과 준비/}).click()
 await dashboard.getByRole('button',{name:'전략 생성',exact:true}).click()
 await expect(dashboard.getByRole('alert')).toContainText('전략 서버 연결을 확인해 주세요.')
 await expect(dashboard.getByRole('button',{name:'전략 생성',exact:true})).toBeEnabled()
})

test('full local app moves from source analysis through target preparation and inquiry with scoped jobs and PDFs',async({page},testInfo)=>{
 const mock=await setup(page)
 await page.getByRole('button',{name:'기본자료 입력·수정',exact:true}).click()
 await expect(page.getByLabel('희망 1 대학',{exact:true})).toHaveValue('합성대학교')
 await expect(page.getByLabel(/전형 유형|전형명/)).toHaveCount(0)
 await page.getByRole('button',{name:'결과 대시보드',exact:true}).click()
 const dashboard=page.locator('.preparation-dashboard')
 await expect(dashboard.getByRole('tab')).toHaveCount(3)
 await expect(dashboard.getByRole('tab',{name:/학생부 분석/})).toHaveAttribute('aria-selected','true')
 await expect(dashboard.locator('.report-section')).toHaveCount(5)
 await expect(dashboard.locator('.result-state')).toHaveText('부분 분석 · 상세 근거 추가 필요')
 await expect(dashboard.getByRole('button',{name:'이 결과 PDF 저장',exact:true})).toBeEnabled()
 await expect(dashboard.locator('.source-chain')).toContainText('학생부 원문')
 await dashboard.locator('.item-sources summary').first().click()
 await expect(dashboard.locator('.source-detail').first()).toContainText('2026학년도 · 2학년 · 1학기 · 1쪽')
 const analysisDownload=page.waitForEvent('download');await dashboard.getByRole('button',{name:'이 결과 PDF 저장',exact:true}).click();await analysisDownload
 expect(mock.pdfs[0]!.pathname).toBe('/api/cases/intuitive-case/report.pdf')
 expect(mock.pdfs[0]!.searchParams.get('audience')).toBe('analysis')

 await dashboard.getByRole('tab',{name:/대학·학과 준비/}).click()
 await expect(dashboard.locator('.target-card')).toHaveCount(2)
 await expect(dashboard.locator('input,textarea,select')).toHaveCount(0)
 await expect(dashboard.getByLabel(/제공자|API 키|전략 모델/)).toHaveCount(0)
 await dashboard.getByRole('button',{name:/합성과학대학교/}).click()
 await expect(dashboard.getByRole('button',{name:/합성과학대학교/})).toHaveAttribute('aria-pressed','true')
 const startingRevision=mock.api.value!.revision
 await dashboard.getByRole('button',{name:'전략 생성',exact:true}).click()
 await expect(dashboard.locator('.result-summary')).toContainText('자료 비교 경험에서 출발하는 학종 준비')
 await expect(dashboard.getByRole('button',{name:'이 결과 PDF 저장',exact:true})).toBeEnabled()
 expect(mock.generated[0]).toEqual({path:'/api/cases/intuitive-case/preparation-strategy',body:{revision:startingRevision,session_id:'intuitive-session',stage:'admissions',target_id:targets[1]!.id}})
 await expect(dashboard.locator('.report-section')).toHaveCount(5)
 await dashboard.locator('.item-sources summary').first().click()
 await expect(dashboard.locator('.source-detail').first()).toContainText('학생부 분석 · 비교 기준')
 await expect(dashboard.getByRole('link',{name:'공식 자료 열기',exact:true}).first()).toHaveAttribute('href','https://admissions.example.test/2028')
 await expect(dashboard.locator('.school-connections')).toContainText('2026학년도 · 3학년 · 2학기')
 await expect(dashboard.locator('.school-connections')).toContainText('이후 학년의 선택 후보')
 await expect(dashboard.locator('.school-connections')).toContainText('현재 과제나 향후 이수를 확정하지 않습니다.')
 await expect(dashboard.locator('.school-connections')).toContainText('원문 계획 · 현재 운영 확인 필요')
 await expect(dashboard.locator('.school-steps')).toContainText('비교할 두 자료의 조건을 표로 정리합니다.')
 await expect(dashboard.locator('.school-connections')).toContainText('AI 활용 금지')

 const nextRevision=mock.api.value!.revision
 await dashboard.getByRole('tab',{name:/대학·학과 준비/}).focus();await page.keyboard.press('ArrowRight')
 await expect(dashboard.getByRole('tab',{name:/질문 중심 학습/})).toHaveAttribute('aria-selected','true')
 await dashboard.getByRole('button',{name:'전략 생성',exact:true}).click()
 await expect(dashboard.locator('.result-summary')).toContainText('관찰 자료의 차이는 무엇을 설명하는가?')
 await expect(dashboard.getByRole('button',{name:'이 결과 PDF 저장',exact:true})).toBeEnabled()
 expect(mock.generated[1]).toEqual({path:'/api/cases/intuitive-case/preparation-strategy',body:{revision:nextRevision,session_id:'intuitive-session',stage:'inquiry',target_id:targets[1]!.id}})
 const inquiryDownload=page.waitForEvent('download');await dashboard.getByRole('button',{name:'이 결과 PDF 저장',exact:true}).click();await inquiryDownload
 expect(mock.pdfs[1]!.pathname).toBe('/api/cases/intuitive-case/preparation.pdf')
 expect(Object.fromEntries(mock.pdfs[1]!.searchParams)).toEqual({session_id:'intuitive-session',kind:'inquiry',target_id:targets[1]!.id})
 for(const generated of mock.generated)for(const sentinel of ['개인원문표식','개인원본표식','비공개','synthetic-local-model','apiKey','provider','profile','analysis'])expect(JSON.stringify(generated.body)).not.toContain(sentinel)
 await page.setViewportSize({width:320,height:850})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
 await page.screenshot({path:testInfo.outputPath('full-app-inquiry-dashboard-320.png'),fullPage:true})
 expect(mock.api.outside).toEqual([]);expect(mock.api.pageErrors).toEqual([])
})

test('unsaved optional observations clear current-source status and saving refreshes the changed-source check',async({page})=>{
 const mock=await setup(page,true)
 await page.getByRole('button',{name:'결과 대시보드',exact:true}).click()
 let dashboard=page.locator('.preparation-dashboard')
 await dashboard.getByRole('tab',{name:/대학·학과 준비/}).click()
 await expect(dashboard.getByRole('button',{name:'이 결과 PDF 저장',exact:true})).toBeEnabled()
 expect(mock.statusReads.every(url=>url.searchParams.get('session_id')==='intuitive-session')).toBe(true)
 await page.getByRole('button',{name:'학생 자료·로컬 분석',exact:true}).click()
 await page.getByRole('button',{name:'기본자료 입력·수정',exact:true}).click()
 const initialReads=mock.statusReads.length
 await page.getByLabel('교사 관찰',{exact:true}).fill('합성 추가 관찰: 두 자료를 비교할 때 적용한 기준을 직접 설명함.')
 await expect(page.locator('.save-state')).toHaveText('저장 전 변경 있음')
 await page.getByRole('button',{name:'결과 대시보드',exact:true}).click()
 dashboard=page.locator('.preparation-dashboard')
 await dashboard.getByRole('tab',{name:/대학·학과 준비/}).click()
 await expect(dashboard.locator('.result-state')).toHaveText('최신 여부 확인 필요')
 await expect(dashboard.getByRole('button',{name:'이 결과 PDF 저장',exact:true})).toBeDisabled()
 expect(mock.statusReads).toHaveLength(initialReads)
 mock.setSourceHash('synthetic-source-changed')
 await page.getByRole('button',{name:'저장',exact:true}).click()
 await expect(page.locator('.save-state')).toHaveText('저장된 기록')
 await expect.poll(()=>mock.statusReads.length).toBeGreaterThan(initialReads)
 await expect(dashboard.locator('.result-state')).toHaveText('입력 변경 · 다시 생성')
 await expect(dashboard.getByRole('button',{name:'이 결과 PDF 저장',exact:true})).toBeDisabled()
 await dashboard.getByRole('tab',{name:/질문 중심 학습/}).click()
 await expect(dashboard.getByRole('button',{name:'전략 다시 생성',exact:true})).toBeDisabled()
 await expect(dashboard.getByRole('status')).toContainText('학종 준비 전략을 먼저 다시 생성')
 expect(mock.api.session!.profile!.teacher_observations).toContain('합성 추가 관찰')
 expect(mock.generated).toEqual([]);expect(mock.pdfs).toEqual([])
 expect(mock.api.outside).toEqual([]);expect(mock.api.pageErrors).toEqual([])
})
