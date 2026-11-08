// 구현 프롬프트 연습(/assessment/implementation-prompt/) 화면 시험.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.QA_BASE || 'http://127.0.0.1:5188'
const out = path.resolve(process.env.QA_OUT || '../../../verification-prompt')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' })
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
const page = await context.newPage(), results = [], errors = [], appErrors = [], writes = [], metrics = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && page.url().includes('/assessment/') && !/Failed to load resource/.test(m.text())) appErrors.push(m.text()) })
page.on('response', r => { if (r.status() >= 400 && /\/(assessment|img\/daeryuni)\//.test(r.url())) appErrors.push(`${r.status()} ${r.url()}`) })
page.on('request', r => { if (r.method() !== 'GET') writes.push(r.url()) })
const mark = name => { results.push({ name, result: 'PASS' }); console.log('PASS ' + name) }
const URL_PROMPT = `${base}/assessment/implementation-prompt/`
async function step(index) { const nav = page.locator('nav[aria-label="작성 단계"] button'); if (!await nav.nth(index).isVisible()) await page.locator('.mobile-step-toggle').click(); await nav.nth(index).click(); await page.locator('#editor-heading').waitFor() }
async function settled() { await page.waitForTimeout(900); await page.getByText('이 기기에 저장됨', { exact: true }).first().waitFor() }
const field = name => page.locator(`[data-field="${name}"]`)

try {
  // 첫 화면과 사전 읽기
  await page.goto(URL_PROMPT); await page.locator('#editor-heading').waitFor()
  assert.equal(await page.title(), '구현 프롬프트 연습 | 대륜고등학교')
  assert.equal(await page.locator('.practice-notice').count(), 0, '연습용 문구는 삭제됐다')
  assert.equal(await page.locator('#editor-heading').innerText(), '사전 읽기')
  assert.equal(await page.locator('nav[aria-label="작성 단계"] button').count(), 6)
  assert.equal(await page.locator('.tool-switch button.active').innerText(), '구현 프롬프트')
  assert.match(await page.locator('.reading').innerText(), /\[역할\] → \[만들 형태\]/)
  mark('첫 렌더: 연습용 문구 없음, 사전 읽기, 여섯 단계')

  // 생각을 이어 가는 도움: 접고 펼치며 상태를 기억한다
  await page.locator('.help-collapse').click()
  assert.equal(await page.locator('#context-help').count(), 0)
  await page.reload(); await page.locator('#editor-heading').waitFor()
  assert.equal(await page.locator('#context-help').count(), 0, '접은 상태가 새로고침 뒤에도 남는다')
  await page.locator('.help-reopen').click()
  assert.equal(await page.locator('#context-help').count(), 1)
  assert.equal(await page.locator('.help-reopen').count(), 0)
  mark('도움 패널 접기·펼치기와 상태 기억')

  // 예제로 익히기: 원고와 분리된 읽기 전용
  await step(3); await page.locator('.mode-tabs button').nth(0).click()
  assert.match(await page.locator('.dameok').innerText(), /안내자료의 예시입니다\. 그대로 제출하면 안 됩니다\.[\s\S]*1\) 잔반 인식/)
  assert.equal(await page.locator('.prompt-practice textarea, .prompt-practice input').count(), 0)
  await page.locator('.mode-tabs button').nth(1).click()
  assert.equal(await page.locator('.feature-card textarea').first().inputValue(), '')
  mark('예제로 익히기는 다먹 AI를 읽기만 하고 내 원고 칸을 채우지 않음')

  // 예제 진입 전 대기 저장을 끝내고, 예제를 보는 동안에는 저장하지 않는다
  const stored = () => page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('daeryun-assessment:v1', 1)
    open.onsuccess = () => { const q = open.result.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => { open.result.close(); const id = new URLSearchParams(location.search).get('project'); const p = q.result.find(x => x.id === id); resolve({ role: p?.implementation?.role, title: p?.title, revision: p?.revision }) } }
  }))
  await step(1); await field('role').fill('임시 역할'); await page.locator('.mode-tabs button').nth(0).click(); await page.locator('.dameok').waitFor()
  const flushed = await stored(); assert.equal(flushed.role, '임시 역할')
  await page.locator('#project-title').fill('예제를 보며 바꾼 제목'); await page.waitForTimeout(1200)
  assert.equal((await stored()).revision, flushed.revision)
  assert.match(await page.locator('.save-status').innerText(), /예제를 읽는 동안 저장하지 않음/)
  await page.locator('.mode-tabs button').nth(1).click(); await settled()
  assert.equal((await stored()).title, '예제를 보며 바꾼 제목')
  await field('role').fill('')
  mark('예제 진입 전 대기 저장 완료, 예제를 보는 동안 저장 없음, 나오면 저장')

  // 도움받아 써 보기: 용어 버튼(키보드)과 칸 입력
  await step(1)
  await field('role').fill('너는 AI 프로덕트 엔지니어야.')
  await page.locator('.prompt-practice input').nth(0).fill('급식 도우미')
  await field('buildMethod').focus()
  const single = page.locator('.term-item', { hasText: '단일 HTML 파일' }).locator('.term-insert')
  await single.focus(); await page.keyboard.press('Enter')
  assert.equal(await field('buildMethod').inputValue(), '단일 HTML 파일로 만들어 줘.')
  assert.match(await page.locator('.term-example').innerText(), /예시 문장: 단일 HTML 파일로 Tailwind CSS와/)
  const toastless = page.locator('.term-item', { hasText: 'Tailwind CSS' }).locator('.term-insert'); await toastless.click()
  assert.equal(await field('buildMethod').inputValue(), '단일 HTML 파일로 만들어 줘. Tailwind CSS로 [  ] 버튼을 [  ] 배경, [  ] 글자, 둥근 모서리로 꾸며 줘.')
  await field('buildMethod').fill('Tailwind CSS로 저장 버튼을 남색 배경, 흰 글자, 둥근 모서리로 꾸민 단일 HTML 파일로 만들어 줘.')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-field')), 'buildMethod')
  assert.equal(await page.locator('.term-item', { hasText: '단일 HTML 파일' }).locator('.term-meaning').getAttribute('href'), '/assessment/terms/#single-html')
  assert.match(await page.locator('.section-preview pre').innerText(), /\[역할\] 너는 AI 프로덕트 엔지니어야\.\n\[만들 형태\] '급식 도우미'를 만들어 줘\. Tailwind CSS로 저장 버튼을/)
  mark('키보드로 용어 버튼 실행, 마지막 칸에 빈칸 문장 틀 삽입·예시 문장 표시·초점 이동, 뜻 보기 링크, 묶음 미리보기')

  await step(2)
  await field('home').fill('오늘 잔반량 요약 카드')
  await page.locator('.prompt-practice input').nth(1).fill('오늘 잔반 기록하기'); await page.locator('.prompt-practice input').nth(2).fill('잔반 인식 탭')
  await step(3)
  const card = page.locator('.feature-card').first()
  await card.locator('input').first().fill('잔반 인식')
  const areas = card.locator('textarea')
  await areas.nth(0).fill("남긴 정도(0, 25, 50, 75, 100%)를 고르고 '분석하기'를 누르면,")
  await areas.nth(1).fill('배식량 × 남긴 정도로 잔반량(g)을 계산하는 AI 알고리즘을 만들고,')
  await areas.nth(2).fill('계산 과정을 실시간 로그로 한 줄씩 보여 줘.')
  await areas.nth(3).fill("남긴 정도를 고르지 않으면 '남긴 정도를 골라 주세요'라고 안내해 줘.")
  await card.locator('input[type=checkbox]').check(); await card.locator('input').last().fill('잔반 인식')
  assert.match(await card.locator('.feature-preview').innerText(), /\(개선: 잔반 인식\)$/)
  await step(4)
  await page.locator('.common-template', { hasText: '저장 안내' }).locator('input[type=checkbox]').check()
  const toastFields = page.locator('.common-template', { hasText: '저장 안내' }).locator('.common-fields input')
  await toastFields.nth(0).fill('저장하기'); await toastFields.nth(1).fill('저장되었습니다'); await toastFields.nth(2).fill('2')
  assert.equal(await page.locator('.common-sentence').innerText(), "'저장하기'를 누르면 '저장되었습니다' 토스트 알림을 2초 동안 보여 줘.")
  await step(5)
  assert.equal((await page.locator('.ready').innerText()).trim(), '제출 조건을 갖췄습니다.')
  const assembled = await page.locator('.assembled pre').innerText()
  assert.match(assembled, /^\[역할\][\s\S]*\[공통 조건\][\s\S]*\n사용한 용어: ① .+ ② .+ ③ /)
  await page.locator('.assembled .secondary', { hasText: '프롬프트 복사' }).click()
  await page.locator('.assembled .secondary', { hasText: '복사했습니다' }).waitFor()
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), assembled)
  mark('다섯 단계를 써서 필수 조건 통과, 조립 결과·사용한 용어 줄·복사')

  // 추가 용어
  await page.locator('.extra-form input').fill('프론트엔드'); await page.locator('.extra-form select').selectOption('①'); await page.locator('.extra-form .secondary').click()
  assert.equal(await page.locator('.extra-list li').count(), 1)
  await page.locator('.extra-form .secondary').click(); assert.match(await page.locator('.field-error').innerText(), /용어 이름/)
  mark('스스로 공부한 용어를 범주와 함께 추가, 빈 이름 안내')

  // 제시 용어의 별칭으로 범주를 바꾸어 넣을 수 없다
  for (const alias of ['반응형', 'spa', 'Tailwind']) {
    await page.locator('.extra-form input').fill(alias); await page.locator('.extra-form select').selectOption('③'); await page.locator('.extra-form .secondary').click()
    assert.match(await page.locator('.field-error').innerText(), /제시 용어 .+으로 이미 셉니다/)
  }
  assert.equal(await page.locator('.extra-list li').count(), 1)
  mark('제시 용어의 이름·별칭은 추가 용어로 다시 넣지 못하고 제시 용어로 안내')

  // 빈칸이 남아 있으면 제출 조건을 갖췄다고 하지 않는다
  await step(4); await page.locator('.common-template', { hasText: '저장 안내' }).locator('.common-fields input').nth(2).fill('')
  await step(5)
  assert.equal(await page.locator('.ready').count(), 0)
  assert.match((await page.locator('.not-ready').innerText()).trim(), /^빈칸 \[\s+\] 1곳을 채우면 제출 조건을 갖춥니다\.$/)
  assert.match(await page.locator('.scope-note').innerText(), /개선 보고서\(문제·원인·개선 방안\)와 1쪽 분량은 이 도구에서 점검하지 않습니다/)
  await step(4); await page.locator('.common-template', { hasText: '저장 안내' }).locator('.common-fields input').nth(2).fill('2'); await step(5)
  await page.locator('.ready').waitFor()
  mark('빈칸이 남으면 제출 조건 문구 대신 남은 빈칸 수, 개선 보고서·분량 범위 안내')

  // 저장 한도를 넘는 입력이 원고 전체를 지우지 않는다
  await step(1)
  const screens = page.getByLabel('화면(탭) 목록', { exact: false })
  const longScreen = '홈 화면에서는 오늘의 급식 메뉴와 잔반량 요약을 보여 주고 아래쪽에는 기록하기 버튼과 추천 버튼을 두며 사용자가 누르면 다음 화면으로 이동하는 구성으로 만든다 그리고 더 길게 쓴다 쉼표 없이 계속 이어 쓴다'
  assert.ok(longScreen.length > 100)
  await screens.fill(longScreen); await screens.blur()
  await field('buildMethod').fill('가'.repeat(3990)); await field('buildMethod').focus()
  await page.locator('.term-item', { hasText: 'SPA' }).locator('.term-insert').click()
  assert.match(await page.locator('.term-buttons .field-error').innerText(), /4,000자까지/)
  assert.equal((await field('buildMethod').inputValue()).length, 3990)
  await settled(); await page.reload(); await page.locator('#editor-heading').waitFor(); await step(1)
  assert.equal(await field('role').inputValue(), '너는 AI 프로덕트 엔지니어야.')
  assert.equal((await screens.inputValue()).length, 100)
  assert.equal((await field('buildMethod').inputValue()).length, 3990)
  assert.equal(await page.locator('.error-banner').count(), 0)
  await field('buildMethod').fill('Tailwind CSS로 저장 버튼을 남색 배경, 흰 글자, 둥근 모서리로 꾸민 단일 HTML 파일로 만들어 줘.')
  await screens.fill('홈, 잔반 인식, 기록'); await screens.blur(); await settled()
  mark('100자 넘는 화면 항목과 한도 근처 칸에 용어 삽입 → 새로고침 뒤 원고 유지')

  // 저장소에 한도를 넘는 값이 이미 있어도 잘라 살리고 알린다
  await page.evaluate(() => new Promise((resolve, reject) => {
    const id = new URLSearchParams(location.search).get('project')
    const open = indexedDB.open('daeryun-assessment:v1', 1)
    open.onsuccess = () => { const tx = open.result.transaction('projects', 'readwrite'), store = tx.objectStore('projects'), g = store.get(id)
      g.onsuccess = () => { const p = g.result; p.implementation.screens = ['가'.repeat(150), '기록']; p.implementation.commonFree = '나'.repeat(4100); store.put(p) }
      tx.oncomplete = () => { open.result.close(); resolve() }; tx.onerror = () => reject(tx.error) }
  }))
  await page.reload(); await page.locator('#editor-heading').waitFor()
  assert.match(await page.locator('.error-banner').innerText(), /저장 한도를 넘은 칸 2곳을 한도에 맞춰 잘랐습니다/)
  await step(1); assert.equal(await field('role').inputValue(), '너는 AI 프로덕트 엔지니어야.')
  assert.equal(await screens.inputValue(), `${'가'.repeat(100)}, 기록`)
  await step(4); assert.equal((await field('commonFree').inputValue()).length, 4000)
  await page.locator('.error-banner .icon-button').click()
  await field('commonFree').fill(''); await step(1); await screens.fill('홈, 잔반 인식, 기록'); await screens.blur(); await settled()
  mark('저장소에 한도를 넘은 값이 있어도 다른 칸을 지우지 않고 잘라 살린 뒤 안내')

  // 저장 유지와 내 글 점검
  await settled(); await page.reload(); await page.locator('#editor-heading').waitFor(); await step(1)
  assert.equal(await field('role').inputValue(), '너는 AI 프로덕트 엔지니어야.')
  await page.getByRole('button', { name: '지금 쓴 글 점검', exact: true }).click()
  assert.match(await page.locator('.quoted-draft').innerText(), /\[역할\] 너는 AI 프로덕트 엔지니어야\./)
  mark('새로고침 뒤 입력 유지, 내 글 점검에 단계 글 기록')

  // 인쇄 창
  await step(5)
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('.assembled .primary').click()])
  await popup.waitForLoadState(); const printed = await popup.locator('body').innerText()
  assert.match(printed, /인공지능 서비스 구현: 구현 프롬프트[\s\S]*\[역할\][\s\S]*\[기능별 동작 조건\][\s\S]*사용한 용어:/)
  for (const word of ['작성 도움', '참고 의견', '이 도구는 연습용', '나쁜 예', '수행평가 조건 점검']) assert.ok(!printed.includes(word), word)
  await popup.close()
  mark('인쇄 창 본문은 양식 순서의 프롬프트와 사용한 용어 줄만 담음')

  // 백업과 복원
  await page.locator('.document-actions .secondary').click(); await page.locator('.document-preview').waitFor()
  assert.match(await page.locator('.document-preview').innerText(), /사용한 용어:/)
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.preview-toolbar .secondary', { hasText: '원고 백업' }).click()])
  const backupPath = path.join(out, 'backup.json'); await download.saveAs(backupPath)
  const backup = JSON.parse(await readFile(backupPath, 'utf8'))
  assert.equal(backup.project.implementation.role, '너는 AI 프로덕트 엔지니어야.')
  await page.keyboard.press('Escape')
  await page.locator('.projects-trigger').click(); await page.locator('.modal').waitFor()
  await page.locator('input[type=file][accept*=json]').setInputFiles(backupPath)
  await page.getByText('백업을 새 원고로 불러왔습니다.').waitFor(); await step(1)
  assert.equal(await field('role').inputValue(), '너는 AI 프로덕트 엔지니어야.')
  assert.ok((await page.locator('.project-heading input').inputValue()).includes('불러온 계획'))
  mark('백업 파일에 구현 프롬프트 포함, 복원한 새 원고에 그대로 남음')

  // 예전 저장본
  await settled()
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('daeryun-assessment:v1', 1)
    open.onsuccess = () => {
      const tx = open.result.transaction('projects', 'readwrite'), store = tx.objectStore('projects'), all = store.getAll()
      all.onsuccess = () => { for (const p of all.result) { const legacy = { ...p, id: `legacy-${p.id}`, title: '예전 원고', revision: 1 }; delete legacy.implementation; store.put(legacy) } }
      tx.oncomplete = () => { open.result.close(); resolve() }; tx.onerror = () => reject(tx.error)
    }
  }))
  const legacyId = await page.evaluate(() => new Promise(resolve => { const open = indexedDB.open('daeryun-assessment:v1', 1); open.onsuccess = () => { const r = open.result.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => { resolve(r.result.find(p => p.id.startsWith('legacy-')).id); open.result.close() } } }))
  for (const slug of ['implementation-prompt', 'social-plan', 'business-model']) {
    await page.goto(`${base}/assessment/${slug}/?project=${legacyId}`); await page.locator('#editor-heading').waitFor()
    assert.equal(await page.locator('.project-heading input').inputValue(), '예전 원고')
  }
  await page.goto(`${URL_PROMPT}?project=${legacyId}`); await page.locator('#editor-heading').waitFor(); await step(1)
  assert.equal(await field('role').inputValue(), '')
  mark('구현 프롬프트 항목이 없는 예전 저장본이 세 도구에서 모두 열림')

  // ?term= 강조와 용어 화면 왕복
  await page.goto(`${base}/assessment/terms/#toast`); await page.locator('#toast').waitFor()
  const practice = page.locator('#toast a[href="/assessment/implementation-prompt/?term=toast"]')
  assert.equal(await page.locator('.term-card-foot a.primary').count(), 16)
  await practice.click(); await page.locator('.focus-term').waitFor()
  assert.match(await page.locator('.focus-term').innerText(), /토스트 알림/)
  const go = page.locator('.focus-term button')
  if (await go.count()) await go.click()
  await page.locator('.term-item.highlight').waitFor()
  assert.match(await page.locator('.term-item.highlight').innerText(), /토스트 알림/)
  assert.equal(await page.locator('#editor-heading').innerText(), '공통 조건')
  mark('용어 화면의 연습 링크 → ?term=toast 안내와 해당 단계 용어 버튼 강조')

  // 혼자 써 보기
  await page.locator('.mode-tabs button').nth(2).click()
  assert.equal(await page.locator('.term-buttons, .writing-help').count(), 0)
  assert.equal(await page.locator('[data-field="commonFree"]').getAttribute('placeholder'), null)
  await page.locator('.mode-tabs button').nth(1).click()
  mark('혼자 써 보기는 문장 틀·예시·용어 버튼을 숨김')

  // 폭별 넘침·조작 요소
  await page.goto(URL_PROMPT); await page.locator('#editor-heading').waitFor()
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const index of [1, 3, 4, 5]) {
      await step(index)
      const m = await page.evaluate(() => {
        const small = []
        for (const el of document.querySelectorAll('.topbar button, .editor-main button, .editor-main a, .editor-main input:not([type=checkbox]), .editor-main select, .editor-main textarea, .editor-main summary')) {
          const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).visibility === 'hidden') continue
          if (r.height < 44) small.push(`${el.tagName}.${el.className} ${el.textContent.trim().slice(0, 16)} ${Math.round(r.height)}`)
        }
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, small }
      })
      metrics.push({ step: index, ...m })
      assert.ok(m.scrollWidth <= width, JSON.stringify(m)); assert.deepEqual(m.small, [], JSON.stringify(m))
      if (index === 3 || index === 5) await page.screenshot({ path: path.join(out, `prompt-${index}-${width}.png`), fullPage: width !== 1440 })
    }
  }
  mark('320·375·768·1440px 가로 넘침 0, 조작 요소 높이 44px 이상')

  // 좁은 화면의 도구 전환과 연습 방식 탭: 글자 16px(탭 15px), 한 줄, 44px 이상
  for (const width of [320, 360, 375, 414, 480, 560, 768]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(URL_PROMPT); await page.locator('#editor-heading').waitFor()
    const rows = await page.evaluate(() => [...document.querySelectorAll('.tool-switch button, .mode-tabs button')].map(b => {
      const label = b.querySelector('span') ?? b, r = b.getBoundingClientRect(), s = getComputedStyle(label)
      const range = document.createRange(); range.selectNodeContents(label); const lines = new Set([...range.getClientRects()].map(x => Math.round(x.top))).size
      return { text: label.textContent.trim(), group: b.closest('.tool-switch') ? 'tool' : 'mode', fontSize: parseFloat(s.fontSize), height: Math.round(r.height), lines }
    }))
    metrics.push({ width, tabs: rows })
    for (const row of rows) {
      assert.equal(row.lines, 1, `${width}px ${row.text} ${JSON.stringify(row)}`)
      assert.ok(row.height >= 44, `${width}px ${row.text}`)
      assert.ok(row.fontSize >= (row.group === 'tool' && width <= 560 ? 16 : 14), `${width}px ${row.text} ${row.fontSize}`)
    }
    if ([320, 375, 414].includes(width)) await page.locator('.topbar').screenshot({ path: path.join(out, `toolswitch-${width}.png`) })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
  mark('320~768px 도구 전환 4개·연습 방식 탭 3개가 한 줄 글자, 좁은 화면 16px, 44px 이상')

  // 진입 경로
  const entry = await readFile(path.resolve('../../output/web/assessment/implementation-prompt/index.html'), 'utf8')
  assert.match(entry, /<title>구현 프롬프트 연습 \| 대륜고<\/title>/)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${base}/assessment/`); await page.locator('.landing-card.prompt-card').click(); await page.waitForURL('**/assessment/implementation-prompt/**'); await page.locator('#editor-heading').waitFor()
  await page.goto(`${base}/#student/assessment-help/subject`); await page.locator('#assessment-help-subject').waitFor()
  await page.locator('#assessment-preparation .prep-card[href="/assessment/implementation-prompt/"]').click(); await page.waitForURL('**/assessment/implementation-prompt/**'); await page.locator('#editor-heading').waitFor()
  mark('진입 페이지 메타, 첫 화면 카드와 평가과제 도움 자료 카드')

  assert.deepEqual(errors, []); assert.deepEqual(appErrors, []); assert.deepEqual(writes, [])
  mark('런타임 예외 0, 앱 콘솔 오류 0, 서버 쓰기 요청 0')
} catch (error) {
  results.push({ name: 'prompt', result: 'FAIL', error: String(error) })
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  await writeFile(path.join(out, 'prompt-results.json'), JSON.stringify({ base, results, errors, appErrors, writes, metrics }, null, 2))
  await browser.close()
}
