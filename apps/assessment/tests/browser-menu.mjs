import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base=process.env.QA_BASE||'http://127.0.0.1:5188'
const out=path.resolve('../../../../_workspace/student-assessment-build-plan-20260910/verification-assessment-menu')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true})
const page=await context.newPage(),results=[],errors=[],metrics=[]
page.on('pageerror',e=>errors.push(e.message))
const mark=name=>{results.push({name,result:'PASS'});console.log('PASS '+name)}
async function visibleTab(tab){await page.locator(`#assessment-help-${tab}`).waitFor();assert.ok(await page.locator(`#assessment-help-${tab}`).isVisible());assert.equal(await page.locator(`#assessment-help-${tab==='subject'?'activity':'subject'}`).isVisible(),false);assert.equal(await page.locator(`#assessment-help-tab-${tab}`).getAttribute('aria-selected'),'true')}
try{
  await page.goto(`${base}/#student/life`);await page.locator('#sub-life.active').waitFor()
  assert.equal(await page.locator('#sub-life #assessment-preparation, #sub-life #career-plan-download').count(),0)
  await page.locator('#tab-student>.sub-nav .sub-nav-btn').filter({hasText:'평가과제 도움 자료'}).click();await visibleTab('subject')
  assert.equal((await page.locator('#assessment-preparation-title').innerText()).trim(),'AI 기반 사회 문제 비즈니스 모델 수립하기')
  assert.equal(await page.locator('#assessment-preparation .prep-card').count(),2);assert.equal(await page.locator('#assessment-preparation').count(),1);assert.equal(await page.locator('#career-plan-download').count(),1);mark('학교생활에서 새 메뉴로 이동·교과 기본 및 정확한 제목·중복 없음')
  await page.locator('#assessment-help-tab-subject').focus();await page.keyboard.press('ArrowRight');await visibleTab('activity');await page.keyboard.press('ArrowLeft');await visibleTab('subject');mark('교과·창체 탭의 방향키 이동과 선택 상태')
  await page.locator('#assessment-help-tab-activity').click();await visibleTab('activity');assert.ok(page.url().endsWith('#student/assessment-help/activity'))
  assert.ok(!(await page.locator('#assessment-help-activity').innerText()).includes('2학기'))
  const link=page.locator('#career-plan-download a.download-plan'),href=await link.getAttribute('href'),filename=await link.getAttribute('download');assert.ok(filename&&!filename.includes('2학기'))
  const downloadPromise=page.waitForEvent('download');await link.click();const download=await downloadPromise;assert.ok(!download.suggestedFilename().includes('2학기'));await download.saveAs(path.join(out,'downloaded-plan.docx'))
  const response=await context.request.get(new URL(href,base).href);assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/application\/vnd.openxmlformats-officedocument.wordprocessingml.document/)
  const body=await response.body();assert.equal(body.subarray(0,2).toString(),'PK');const local=await readFile(path.resolve('../../output/web',href.replace(/^\//,'')));assert.equal(createHash('sha256').update(body).digest('hex'),createHash('sha256').update(local).digest('hex'));mark('창체 탭의 학기표시 없는 공개 다운로드·MIME·원본 바이트 일치')
  await page.locator('#assessment-help-tab-subject').click();await visibleTab('subject');assert.ok(page.url().endsWith('#student/assessment-help/subject'));await page.goBack();await visibleTab('activity');await page.goForward();await visibleTab('subject');mark('교과·창체 탭 선택 후 브라우저 뒤로·앞으로 이동')
  for(const [hash,tab] of [['#student/assessment-help','subject'],['#student/assessment-help/subject','subject'],['#student/assessment-help/activity','activity']]){await page.goto(base+'/'+hash);await visibleTab(tab);await page.reload();await visibleTab(tab)}mark('기본·교과·창체 직접 주소 및 새로고침')
  for(const width of [1440,375,360]){await page.setViewportSize({width,height:1000});for(const tab of ['subject','activity']){await page.locator(`#assessment-help-tab-${tab}`).click();await visibleTab(tab);const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(size.scrollWidth<=size.width,JSON.stringify(size));metrics.push({width,tab,...size});await page.locator('#sub-assessment-help').screenshot({path:path.join(out,`${tab}-${width}.png`)})}}mark('교과·창체 1440·375·360px 가로 넘침 없음')
  await page.setViewportSize({width:1440,height:1000});await page.locator('#assessment-help-tab-subject').click();await visibleTab('subject')
  for(const [i,appPath] of [[0,'social-plan'],[1,'business-model']]){await page.locator('#assessment-preparation .prep-card').nth(i).click();await page.waitForURL(`**/assessment/${appPath}/**`);await page.locator('.brand').waitFor();assert.equal(await page.locator('.brand').getAttribute('href'),'/#student/assessment-help/subject');assert.equal(await page.locator('.sidebar-bottom a').getAttribute('href'),'/#student/assessment-help/subject');await page.locator(i===0?'.brand':'.sidebar-bottom a').click();await visibleTab('subject')}mark('두 작성 도구로 진입한 뒤 브랜드·하단 링크로 교과 메뉴 복귀')
  for(const id of ['rules','subject','life','univ','special','counsel','club-stats']){await page.locator(`#tab-student>.sub-nav button[onclick*="sub-${id}'"]`).click();await page.locator(`#sub-${id}.active`).waitFor();assert.ok(await page.locator(`#sub-${id}`).isVisible());assert.equal(await page.locator('#sub-assessment-help').isVisible(),false)}mark('기존 학생·학부모 하위 메뉴 7개 전환 유지')
  assert.deepEqual(errors,[]);mark('메뉴·탭·도구 왕복에서 런타임 예외 없음')
}catch(error){results.push({name:'menu regression',result:'FAIL',error:String(error)});await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(out,'menu-results.json'),JSON.stringify({base,results,errors,metrics},null,2));await browser.close()}
