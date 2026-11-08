// 앱 서비스 개발 용어 화면(/assessment/terms/) 회귀 시험.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.QA_BASE || 'http://127.0.0.1:5188'
const out = path.resolve(process.env.QA_OUT || '../../../verification-terms')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
const page = await context.newPage(), results = [], errors = [], consoleErrors = [], writes = [], metrics = []
page.on('pageerror', e => errors.push(e.message))
// 사용설명서 본문(index.html)의 다른 자원 404는 이 시험 대상이 아니다. 앱 화면의 오류와 앱 자원의 404만 센다.
page.on('console', m => { if (m.type() === 'error' && page.url().includes('/assessment/') && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()) })
page.on('response', r => { if (r.status() >= 400 && /\/(assessment|img\/daeryuni)\//.test(r.url())) consoleErrors.push(`${r.status()} ${r.url()}`) })
page.on('request', r => { if (r.method() !== 'GET') writes.push(r.url()) })
const mark = name => { results.push({ name, result: 'PASS' }); console.log('PASS ' + name) }
const inView = async id => page.locator(`[id="${id}"]`).evaluate(el => { const r = el.getBoundingClientRect(); return r.top > -4 && r.top < innerHeight * 0.5 })

try {
  // 첫 렌더
  await page.goto(`${base}/assessment/terms/`); await page.locator('.terms-page').waitFor()
  assert.equal(await page.title(), '앱 서비스 개발 용어 | 대륜고등학교')
  assert.equal(await page.locator('.term-category').count(), 3)
  assert.equal(await page.locator('article.term-card').count(), 16)
  for (const card of await page.locator('article.term-card').all()) {
    assert.equal(await card.locator('.term-row').count(), 5)
    for (const dd of await card.locator('.term-row dd').all()) assert.ok((await dd.innerText()).trim().length > 1)
  }
  assert.equal(await page.locator('.example-sentences li').count(), 3)
  assert.equal(await page.locator('.example-sentences .term-chip').count(), 14)
  assert.equal(await page.locator('.document-bar, #draft-text, .save-status').count(), 0)
  assert.equal(await page.locator('.term-card-foot a[href^="/assessment/implementation-prompt/?term="]').count(), 16)
  assert.equal(await page.locator('.tool-switch button.active').innerText(), '개발 용어')
  mark('첫 렌더: 범주 3·카드 16·카드마다 다섯 칸, 원고 편집 영역과 저장 상태 없음, 카드마다 연습 링크')

  // 폭별 가로 넘침·조작 요소 크기
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const m = await page.evaluate(() => {
      const small = []
      for (const el of document.querySelectorAll('.topbar button, .topbar a, .terms-page button, .terms-page a, .terms-page input')) {
        const r = el.getBoundingClientRect(); if (!r.width) continue
        if (r.height < 44 || r.width < 24) small.push(`${el.tagName} ${el.textContent.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
      const wide = [...document.querySelectorAll('.terms-page *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.className || el.tagName).slice(0, 5)
      const body = getComputedStyle(document.querySelector('.term-row dd')).fontSize
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, small, wide, body: parseFloat(body) }
    })
    metrics.push(m)
    await page.screenshot({ path: path.join(out, `terms-${width}.png`), fullPage: width !== 1440 })
    assert.ok(m.scrollWidth <= width, JSON.stringify(m))
    assert.deepEqual(m.wide, [], JSON.stringify(m))
    assert.deepEqual(m.small, [], JSON.stringify(m))
    assert.ok(m.body >= 16)
  }
  mark('320·375·768·1440px 가로 넘침 0, 조작 요소 높이 44px 이상, 본문 16px 이상')

  // 주소 #id로 진입
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto(`${base}/assessment/terms/#toast`); await page.locator('.terms-page').waitFor(); await page.waitForTimeout(300)
  assert.ok(await inView('toast')); assert.equal(await page.evaluate(() => document.activeElement?.id), 'toast-title')
  assert.ok(page.url().endsWith('/assessment/terms/#toast'))
  mark('주소 #toast로 들어오면 그 카드로 이동하고 제목에 초점')

  // 예시 프롬프트의 용어를 눌러 이동
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${base}/assessment/terms/`); await page.locator('.terms-page').waitFor()
  await page.locator('.example-sentences .term-chip', { hasText: 'QR 코드' }).click(); await page.waitForTimeout(300)
  assert.ok(page.url().endsWith('#qr')); assert.ok(await inView('qr'))
  await page.locator('#qr .term-card-foot .text-button').click(); await page.waitForTimeout(200)
  assert.ok(await page.evaluate(() => scrollY < 5)); assert.ok(!page.url().includes('#'))
  mark('예시 프롬프트의 용어를 누르면 카드로 이동, 맨 위로 버튼으로 복귀')

  // 키보드로 동작 예시 실행
  const toastButton = page.locator('#toast .toast-screen button').first()
  await toastButton.focus(); await page.keyboard.press('Enter')
  await page.locator('#toast .mini-toast').waitFor(); assert.equal(await page.locator('#toast .mini-toast').innerText(), '저장되었습니다')
  await page.waitForTimeout(2300); assert.equal(await page.locator('#toast .mini-toast').count(), 0)
  await page.locator('#spa .spa-tabs button').nth(1).focus(); await page.keyboard.press('Space')
  assert.match(await page.locator('#spa .spa-content').innerText(), /어제 공부 시간 120분/)
  await page.locator('#responsive .device-switch button').nth(2).focus(); await page.keyboard.press('Enter')
  assert.ok(await page.locator('#responsive .responsive-screen.phone').count())
  assert.equal(await page.locator('#responsive .responsive-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1)
  const math = page.locator('#interactive input').nth(1); await math.focus(); await page.keyboard.press('Control+A'); await page.keyboard.type('150')
  assert.match(await page.locator('#interactive .interactive-result strong').innerText(), /총 240분/)
  await page.locator('#dashboard .dash-screen .secondary').focus(); await page.keyboard.press('Enter')
  assert.match(await page.locator('#dashboard .dash-tiles').innerText(), /5개/)
  await page.locator('#cta .device-switch button').nth(1).focus(); await page.keyboard.press('Enter')
  await page.locator('#cta .cta-main').focus(); await page.keyboard.press('Enter')
  assert.equal(await page.locator('#cta .cta-main').innerText(), '과제 제출하기')
  assert.match(await page.locator('#cta .cta-feedback').innerText(), /누르면 일어날 일/)
  mark('키보드로 토스트·SPA·반응형·인터랙티브·대시보드·CTA 예시 실행')

  // 문장 복사
  await page.locator('#api .copy-line button').click()
  await page.locator('#api .copy-line button', { hasText: '복사했습니다' }).waitFor({ timeout: 1500 })
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^날씨 API로/)
  mark('프롬프트 문장 복사와 버튼 옆 결과 표시')

  // 첫 화면 카드와 도구 전환 왕복
  await page.goto(`${base}/assessment/`); await page.locator('.landing-cards').waitFor()
  assert.equal(await page.locator('.landing-card').count(), 4)
  await page.locator('.landing-card.terms-card').click(); await page.waitForURL('**/assessment/terms/'); await page.locator('#terms-heading').waitFor()
  await page.locator('.tool-switch button').nth(0).click(); await page.waitForURL('**/assessment/social-plan/**'); await page.locator('#editor-heading').waitFor()
  await page.locator('.tool-switch button').nth(3).click(); await page.waitForURL('**/assessment/terms/'); await page.locator('#terms-heading').waitFor()
  await page.goBack(); await page.locator('#editor-heading').waitFor(); assert.ok(page.url().includes('/assessment/social-plan/'))
  await page.goForward(); await page.locator('#terms-heading').waitFor()
  await page.locator('.tool-switch button').nth(1).click(); await page.waitForURL('**/assessment/business-model/**'); await page.locator('#editor-heading').waitFor()
  mark('첫 화면 용어 카드, 도구 전환 왕복, 뒤로·앞으로 이동')

  // 진입 페이지·사용설명서 카드
  const entry = await readFile(path.resolve('../../output/web/assessment/terms/index.html'), 'utf8')
  assert.match(entry, /<title>앱 서비스 개발 용어 \| 대륜고<\/title>/); assert.match(entry, /https:\/\/daeryun\.life\/assessment\/terms\//)
  await page.goto(`${base}/#student/assessment-help/subject`); await page.locator('#assessment-help-subject').waitFor()
  assert.equal(await page.locator('#assessment-preparation .prep-card').count(), 4)
  await page.locator('#assessment-preparation .prep-card[href="/assessment/terms/"]').click(); await page.waitForURL('**/assessment/terms/'); await page.locator('#terms-heading').waitFor()
  await page.locator('.terms-back').click(); await page.locator('#assessment-help-subject').waitFor()
  mark('진입 페이지 메타, 평가과제 도움 자료의 용어 카드와 복귀 링크')

  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors.filter(t => !/favicon/.test(t)), []); assert.deepEqual(writes, [])
  mark('런타임 예외 0, 콘솔 오류 0, 서버 쓰기 요청 0')
} catch (error) {
  results.push({ name: 'terms', result: 'FAIL', error: String(error) })
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  await writeFile(path.join(out, 'terms-results.json'), JSON.stringify({ base, results, errors, consoleErrors, writes, metrics }, null, 2))
  await browser.close()
}
