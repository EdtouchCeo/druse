import {test,expect,type Page} from '@playwright/test'
import {intuitiveApi,onlineOrigin} from './fixtures/intuitive'
import {finalCase} from './fixtures/studentResult'
import {activityStrategyAreas} from '../src/lib/activityStrategy'
import {strategyExamples,strategyTitleExample} from '../src/lib/inputExamples'
import {newAdmissionTarget} from '../src/lib/profile'

function detailedCase(){
 const value=finalCase(true),strategy=value.sessions[0]!.strategy!
 strategy.student_message='### 먼저 준비할 자료\n- 기존 수업에서 허용한 자료와 찬반 근거 비교표를 모읍니다.\n- 각 자료의 선택 이유와 설명하기 어려운 부분을 구분합니다.\n- 관심 전공 두 분야의 연구 질문을 비교합니다.'
 strategy.semester_plan='| 시기 | 학습·탐구 방향 | 준비 자료 |\n| --- | --- | --- |\n| 1학년 | 기존 활동의 근거와 질문 정리 | 근거 비교표 |\n| 2학년 | 교과 개념으로 설명 확장 | 개념도와 연구 설계 |\n| 3학년 | 모델의 한계를 새로운 사례에 적용 | 설명 보고서와 진로 선택 이유 |'
 strategy.inquiry_plan='주제: 같은 환경 문제를 다르게 설명하는 이유\n핵심 질문: 자료의 조건이 달라지면 주장의 근거는 어떻게 달라지는가?\n기록 연결: 기존 찬반 자료 비교 경험\n탐구 방법: 출처 두 개의 조건과 근거를 비교합니다.\n준비 자료: 수업 자료와 기존 활동지\n예상 산출물: 비교표와 한계를 포함한 설명문'
 return value
}

async function assertNoTaskTracker(page:Page){
 await expect(page.getByLabel('다음 점검일',{exact:true})).toHaveCount(0)
 await expect(page.getByLabel('진행 상태',{exact:true})).toHaveCount(0)
 await expect(page.getByLabel(/^실행과제 \d+$/)).toHaveCount(0)
}

test('teacher preview presents the full strategy and keeps edits and private history separate',async({page},testInfo)=>{
 const value=detailedCase(),api=await intuitiveApi(page,{value}),before=JSON.stringify(api.value)
 await page.goto('/counseling/')
 await expect(page.getByRole('navigation',{name:'전략 작업'}).getByRole('button')).toHaveCount(3)
 await page.getByRole('button',{name:'분석·전략 보고서',exact:true}).click()
 await assertNoTaskTracker(page)
 const result=page.getByRole('article',{name:'학습·진로 전략 보고서 미리보기',exact:true})
 await expect(result).toBeVisible()
 await page.getByRole('button',{name:'내용 수정',exact:true}).click()
 await page.getByRole('button',{name:'보고서 미리보기',exact:true}).focus();await page.keyboard.press('Enter')
 await expect(result).toBeFocused()
 const modify=page.getByRole('button',{name:'내용 수정',exact:true})
 await expect(modify).toBeInViewport({ratio:1})
 for(const text of ['AI 활용 금지','성장 활동 일지','탐구 방법:','3학년','진로 선택 이유'])await expect(result).toContainText(text)
 for(const text of ['비공개표식','다음 점검일:','진행 상태','2026-09-21','2026-09-28'])await expect(result).not.toContainText(text)
 await expect(result.locator('textarea,input,button')).toHaveCount(0)
 const order=await result.locator('[data-result-section]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-result-section')))
 expect(order).toEqual(['student_message','target_major','target_path','strengths','gaps','semester_plan','subject_plan','inquiry_plan','activity_plan'])
 await expect(result.getByRole('navigation',{name:'전략 보고서 목차'}).getByRole('link')).toHaveCount(9)
 await expect(result.locator('[data-result-section=semester_plan]').getByRole('table')).toBeVisible()
 await page.screenshot({path:testInfo.outputPath('teacher-strategy-desktop.png'),fullPage:true})
 await modify.focus();await page.keyboard.press('Enter')
 await expect(page.getByRole('button',{name:'보고서 미리보기',exact:true})).toBeFocused()
 await expect(page.getByLabel('교과 계획',{exact:true})).toHaveValue(value.sessions[0]!.strategy!.subject_plan)
 await expect(page.getByLabel('전략 제목',{exact:true})).toHaveValue(value.sessions[0]!.topic)
 expect(JSON.stringify(api.value)).toBe(before)
 expect(api.calls.every(c=>c.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

test('strategy title guides one inquiry question and displays the entered question unchanged',async({page})=>{
 const value=detailedCase(),api=await intuitiveApi(page,{value}),originalTopic=value.sessions[0]!.topic
 await page.goto('/counseling/')
 await page.getByRole('button',{name:'상담·전략 수립',exact:true}).click()
 const topic=page.getByLabel('전략 제목',{exact:true})
 await expect(topic).toHaveValue(originalTopic)
 await expect(topic).toHaveAttribute('placeholder','예: '+strategyTitleExample)
 await expect(topic).toHaveAccessibleDescription('탐구질문 형식으로 적습니다. 무엇을·왜·어떻게·어떤 조건에서 탐구할지 드러나는 하나의 중심 질문으로 작성하세요.')
 const question='측정 위치가 다른 공기질 자료로 환기 효과를 어떤 조건에서 비교할 수 있을까?'
 await topic.fill(question)
 await page.getByRole('button',{name:'분석·전략 보고서',exact:true}).click()
 const result=page.getByRole('article',{name:'학습·진로 전략 보고서 미리보기',exact:true})
 await expect(result.getByRole('heading',{level:2})).toHaveText(question)
 await expect(result.locator('.eyebrow')).toHaveText('학습·진로 전략 보고서')
 await page.getByRole('button',{name:'내용 수정',exact:true}).click()
 await expect(topic).toHaveValue(question)
 expect(api.value!.sessions[0]!.topic).toBe(originalTopic)
 expect(api.calls.every(c=>c.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

test('published strategy has working contents and readable detailed plans at desktop and 320px',async({page},testInfo)=>{
 const value=detailedCase(),s=value.sessions[0]!
 s.profile!.admission_targets=[{...newAdmissionTarget(),university:'합성 희망 대학',major:'생명과학과',admission_type:'학생부종합',admission_name:'합성 면접형',admission_year:2029},{...newAdmissionTarget(),major:'다른 탐색 전공'},newAdmissionTarget()]
 s.profile!.teacher_observations='비공개 희망 관련 교사 관찰';s.profile!.learning_concerns='비공개 학습 고민'
 value.privacy='standard';s.guidance={published_at:'2026-09-14T00:00:00Z',published_by:'synthetic'}
 const api=await intuitiveApi(page,{mode:'online',role:'student',value})
 await page.setViewportSize({width:1280,height:900});await page.goto(onlineOrigin+'/counseling/')
 const result=page.getByRole('article',{name:'학습·진로 전략 보고서 미리보기',exact:true})
 await expect(result.getByRole('heading',{name:s.topic,exact:true})).toBeVisible()
 await expect(result).toContainText('AI 활용 금지');await expect(result).toContainText('성장 활동 일지')
 await expect(result).not.toContainText('비공개표식');await expect(page.locator('textarea,input[type=file],.teacher-notes')).toHaveCount(0)
 const targetTable=result.getByRole('table',{name:'학생이 입력한 희망 대학·전공·전형'})
 await expect(targetTable).toBeVisible();await expect(targetTable.locator('tbody tr')).toHaveCount(2)
 for(const text of ['합성 희망 대학','생명과학과','학생부종합','합성 면접형','2029학년도','다른 탐색 전공'])await expect(targetTable).toContainText(text)
 await expect(result).not.toContainText('비공개 희망 관련 교사 관찰');await expect(result).not.toContainText('비공개 학습 고민')
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await result.getByRole('link',{name:'희망 대학·전공·전형',exact:true}).click()
  await expect(targetTable.locator('tbody tr').first()).toBeInViewport()
  await page.screenshot({path:testInfo.outputPath('student-admission-targets-'+width+'.png')})
  await result.getByRole('link',{name:'추천 탐구 주제와 설계',exact:true}).click()
  await expect(result.locator('[data-result-section=inquiry_plan]').getByRole('heading',{name:'추천 탐구 주제와 설계',exact:true})).toBeInViewport()
  await page.screenshot({path:testInfo.outputPath('student-strategy-inquiry-'+width+'.png')})
  await result.getByRole('link',{name:'학생이 준비할 사항',exact:true}).click()
  await expect(result.locator('[data-result-section=student_message]').getByRole('listitem')).toHaveCount(3)
  await page.screenshot({path:testInfo.outputPath('student-strategy-'+width+'.png'),fullPage:true})
 }
 await assertNoTaskTracker(page)
 expect(api.calls.every(c=>c.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})

test('each activity domain has its own preparation, evidence and navigation on desktop and mobile',async({page},testInfo)=>{
 const value=detailedCase(),s=value.sessions[0]!
 s.strategy!.activity_plan='기존 교사가 적은 학교 참여 조건은 그대로 유지합니다.\n\n'+strategyExamples.activity_plan!
 const api=await intuitiveApi(page,{value}),before=JSON.stringify(api.value)
 await page.goto('/counseling/')
 await page.getByRole('button',{name:'분석·전략 보고서',exact:true}).click()
 const result=page.getByRole('article',{name:'학습·진로 전략 보고서 미리보기',exact:true})
 const activity=result.locator('[data-result-section=activity_plan]')
 await expect(activity.getByRole('heading',{level:3})).toHaveText('창체·봉사·독서·행동특성 전략')
 await expect(activity).toContainText('기존 교사가 적은 학교 참여 조건은 그대로 유지합니다.')
 const contents=activity.getByRole('navigation',{name:'창체·봉사·독서·행동특성 전략 목차'})
 await expect(contents.getByRole('link')).toHaveCount(6)
 for(const area of activityStrategyAreas){
  const section=activity.locator('[data-strategy-area="'+area+'"]')
  await expect(section.getByRole('heading',{name:area,exact:true})).toBeVisible()
  for(const label of ['현재 근거:','준비 방향:','준비할 자료·결과물:','필요한 도움:','연결할 교과·탐구:'])await expect(section.locator('.result-detail-label').filter({hasText:label})).toBeVisible()
 }
 await expect(activity.locator('[data-strategy-area="봉사활동"]')).toContainText('봉사활동의 대상과 역할은 확인되지 않았다.')
 await expect(activity.locator('[data-strategy-area="행동특성 및 종합의견"]')).toContainText('학생부 문구를 미리 만들거나 성격을 단정하지 않는다.')
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await contents.getByRole('link',{name:'독서활동',exact:true}).click()
  await expect(activity.getByRole('heading',{name:'독서활동',exact:true})).toBeInViewport()
  await page.screenshot({path:testInfo.outputPath('reading-area-'+width+'.png')})
  await contents.getByRole('link',{name:'행동특성 및 종합의견',exact:true}).click()
  await expect(activity.getByRole('heading',{name:'행동특성 및 종합의견',exact:true})).toBeInViewport()
 }
 await assertNoTaskTracker(page)
 expect(JSON.stringify(api.value)).toBe(before)
 expect(api.calls.every(c=>c.method==='GET')).toBe(true)
 expect(api.outside).toEqual([]);expect(api.pageErrors).toEqual([])
})
