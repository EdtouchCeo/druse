import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const base=process.env.QA_BASE || 'http://127.0.0.1:5188'
const out=path.resolve('../../../../_workspace/student-assessment-build-plan-20260910/verification')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true})
const page=await context.newPage(),errors=[],requests=[],results=[]
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')requests.push({method:r.method(),url:r.url()})})
const mark=(name)=>{results.push({name,result:'PASS'});console.log('PASS '+name)}
const button=(name)=>page.getByRole('button',{name,exact:true})
async function settle(){await page.getByText('이 기기에 저장됨',{exact:true}).first().waitFor();await page.waitForTimeout(800)}
async function navigate(kind){await page.locator('.tool-switch button').nth(kind==='business'?1:0).click();await page.waitForURL('**/assessment/'+(kind==='business'?'business-model':'social-plan')+'/**');await page.locator('#editor-heading').filter({hasText:kind==='business'?'문제':'문제 상황'}).waitFor()}
async function step(index){await page.locator('nav[aria-label="작성 단계"] button').nth(index).click()}
try{
  await page.goto(`${base}/assessment/social-plan/`);await page.locator('#draft-text').waitFor()
  await button('연습 문제 고르기').click();await page.locator('.practice-grid button').first().click();await button('이 문제로 새 원고 만들기').click()
  await page.locator('#project-title').fill('QA 독립 수행평가 준비');await page.locator('#draft-text').fill('도서관 참가자가 혼잡한 복도에서 이동 경로를 찾지 못한다.');await settle();mark('연습 문제에서 새 원고 생성 및 자동 저장')
  await button('지금 쓴 글 점검').click();await page.locator('#draft-text').fill('도서관 참가자가 혼잡한 복도에서 이동 경로를 찾지 못한다. 폐쇄된 통로는 제외한다.')
  await page.getByText('다시 다듬기 · 수정 전후 비교',{exact:true}).click()
  assert.ok(await page.locator('.comparison').innerText().then(t=>t.includes('폐쇄된 통로')))
  await page.getByLabel('수정한 이유 또는 다음에 보완할 점').fill('필수 제외 조건을 추가했다.');mark('점검 원문과 수정문 비교 및 수정 이유 작성')
  await button('혼자 써 보기').click();assert.equal(await page.locator('.writing-help .help-body').count(),0)
  await button('예제로 익히기').click();assert.ok(await page.locator('.example-document').isVisible())
  await button('내 글로 돌아가기').click();assert.ok((await page.locator('#draft-text').inputValue()).includes('폐쇄된 통로'));mark('작성 방식 전환 시 원고 보존 및 혼자 쓰기 도움 접힘')
  for(const [i,text] of [[1,'처음 방문한 참가자는 계단을 이용할 수 없어 불안하다.'],[2,'참가자가 이동 제한을 지키며 체험실로 가도록 돕는다.'],[4,'출발점과 목적지를 입력하면 경로와 변경 이유를 보여 준다.'],[5,'모의 환경에서 이동시간과 안내 이해도를 이전 방식과 비교한다.']]){await step(i);await page.locator('#draft-text').fill(text)}
  await step(3);await page.locator('#draft-text').fill('현재 안내 데스크를 출발점으로, 배정된 체험실을 목표로 정한다.')
  await button('다음 질문').click();await page.locator('#draft-text').fill('체험실과 교차점을 노드로, 이동 가능한 통로를 연결선으로 둔다.')
  await page.locator('.technique-grid button').nth(3).click();await page.locator('#draft-text').fill('규칙 추론 연습의 입력 사실이다.')
  await page.locator('.technique-grid button').first().click();assert.ok((await page.locator('#draft-text').inputValue()).includes('안내 데스크'));mark('사회 과제 6단계 및 기법별 질문 답변 독립 보존')
  await settle();await page.reload();await page.locator('#draft-text').waitFor();assert.ok((await page.locator('#draft-text').inputValue()).includes('폐쇄된 통로'));mark('새로고침 후 원고 복구')
  await page.screenshot({path:path.join(out,'desktop-social.png'),fullPage:true})
  await step(4);await page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]').setInputFiles(path.join(out,'desktop-social.png'));await page.locator('.sketch-panel img').waitFor();mark('프로토타입 PNG 이미지 첨부')
  await navigate('business');await page.locator('#draft-text').fill('기존에 직접 작성한 사업 문제.');await button('계획 가져오기').click()
  assert.equal(await page.locator('.transfer-list input[type="checkbox"]').first().isDisabled(),true)
  await button('선택 항목 가져오고 현재 계획 연결').click();assert.equal(await page.locator('#draft-text').inputValue(),'기존에 직접 작성한 사업 문제.')
  await step(1);assert.ok((await page.locator('#draft-text').inputValue()).includes('처음 방문한 참가자'));mark('빈 캔버스 항목만 가져오고 기존 글 보존')
  for(let i=0;i<9;i++){await step(i);if(!(await page.locator('#draft-text').inputValue()).trim())await page.locator('#draft-text').fill(`비즈니스 항목 ${i+1}: 고객과 문제 해결에 연결된 운영 계획.`)}
  await navigate('social');await step(2);await page.locator('#draft-text').fill('변경한 사회 문제: 승강기 중단 조건을 추가한다.')
  await navigate('business');assert.ok(await page.getByText('연결한 계획서가 수정되었습니다',{exact:true}).isVisible());mark('연결 원본 수정 시 변경 안내')
  await button('연결 내용 확인').click();const oldIdeas=page.locator('.linked-compare details').nth(3);await oldIdeas.locator('summary').click();assert.ok((await oldIdeas.locator('.comparison section').first().innerText()).includes('안내 데스크'));await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();mark('연결 당시 아이디어 질문 답변까지 과거 원고 비교에 표시')
  await settle()
  const dlPromise=page.waitForEvent('download');await button('원고 백업').click();const dl=await dlPromise;const backupPath=path.join(out,'qa-backup.json');await dl.saveAs(backupPath)
  const raw=JSON.parse(await readFile(backupPath,'utf8'));assert.ok(raw.project.linkedPlan);assert.ok(raw.project.reviews['social:situation']);assert.ok(raw.project.sketch.startsWith('data:image/png;base64,'));assert.equal(raw.project.canvas.problem,'기존에 직접 작성한 사업 문제.');mark('실제 JSON 다운로드의 원고·이미지·연결·점검 보존')
  for(const kind of ['business','social']){
    await navigate(kind)
    const popupPromise=page.waitForEvent('popup');await button('인쇄 / PDF 저장').click();const popup=await popupPromise;await popup.waitForLoadState()
    assert.equal(await popup.locator('body > section').count(),kind==='business'?10:8)
    await popup.pdf({path:path.join(out,`${kind}.pdf`),format:'A4',printBackground:true});await popup.screenshot({path:path.join(out,`${kind}-print.png`),fullPage:true});await popup.close()
  }mark('두 출력 문서 실제 필드 및 A4 PDF 생성')
  await button('내 원고').click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'닫기',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert.ok(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')));await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);mark('대화상자 키보드 초점 순환과 Escape 닫기')
  const titleBefore=await page.locator('#project-title').inputValue();await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{')})
  await page.getByRole('alert').waitFor();assert.equal(await page.locator('#project-title').inputValue(),titleBefore);await button('오류 안내 닫기').click();mark('손상 백업 거절 시 현재 원고 유지')
  const beforeImportUrl=page.url();await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(backupPath)
  await page.waitForFunction(()=>document.querySelector('#project-title')?.value.includes('불러온 계획'));assert.notEqual(page.url(),beforeImportUrl);await step(4);await page.locator('.sketch-panel img').waitFor();mark('다운로드한 백업을 새 원고로 복원하고 스케치 보존')
  await button('조건 바꾸어 연습').click();await button('사본에서 연습 시작').click();assert.ok((await page.locator('#project-title').inputValue()).includes('조건 바꾸기'));assert.ok(await page.locator('.variation-banner').isVisible());mark('조건 변화 연습 사본 생성')
  await page.setViewportSize({width:360,height:900});await page.locator('.mobile-step-toggle').click();await step(3)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:path.join(out,'mobile-social.png'),fullPage:true});mark('360px 모바일 가로 넘침 없음')
  const blockedContext=await browser.newContext({viewport:{width:1280,height:900}})
  await blockedContext.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true}))
  const blocked=await blockedContext.newPage();await blocked.goto(`${base}/assessment/social-plan/`);await blocked.locator('#draft-text').waitFor()
  await blocked.locator('#project-title').fill('저장 불가 원고 보존');await blocked.locator('#draft-text').fill('저장소를 사용할 수 없어도 이 글은 잃지 않아야 한다.')
  await blocked.getByRole('button',{name:'내 원고',exact:true}).click();await blocked.getByRole('button',{name:'빈 원고 만들기',exact:true}).click()
  assert.equal(await blocked.locator('#project-title').inputValue(),'저장 불가 원고 보존');assert.ok((await blocked.locator('#draft-text').inputValue()).includes('잃지 않아야'))
  await blocked.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click()
  await blocked.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(backupPath);await blocked.waitForTimeout(400)
  assert.equal(await blocked.locator('#project-title').inputValue(),'저장 불가 원고 보존');await blockedContext.close();mark('저장 실패 상태의 새 원고와 백업 불러오기에서 기존 미저장 글 보존')
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);mark('브라우저 예외 및 원고 외부 전송 없음')
}catch(error){results.push({name:'browser execution',result:'FAIL',error:String(error)});await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await writeFile(path.join(out,'browser-results.json'),JSON.stringify({base,results,errors,requests},null,2));await browser.close()}
