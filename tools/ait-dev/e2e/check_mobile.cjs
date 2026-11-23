// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 휴대폰·태블릿 화면 점검: 기기 크기별로 학생 화면의 넘침, 슬라이드 크기, 누르기 쉬운 버튼 크기, 글자 크기를 잰다.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = 'http://127.0.0.1:8765';
const OUT = OUT_DIR;
const DEVICES = [
  { name: 'phone-small', width: 360, height: 740 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'tablet', width: 820, height: 1180 },
];
const lines = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(page, label) {
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const overflow = document.documentElement.scrollWidth - vw;
    const img = document.querySelector('#stage img');
    let slide = null;
    if (img && img.offsetParent && img.naturalWidth) {
      const r = img.getBoundingClientRect();
      const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      slide = `${Math.round(img.naturalWidth * scale)}x${Math.round(img.naturalHeight * scale)}`;
    }
    const small = [...document.querySelectorAll('button, a.btn, input, textarea')].filter((b) => b.offsetParent && getComputedStyle(b).visibility !== 'hidden')
      .map((b) => ({ t: (b.textContent || b.getAttribute('aria-label') || b.tagName).trim().slice(0, 14), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }))
      .filter((b) => b.h < 40 || b.w < 40);
    const texts = [...document.querySelectorAll('p, span, label, h2, li')].filter((e) => e.offsetParent && e.textContent.trim() && e.children.length === 0)
      .map((e) => parseFloat(getComputedStyle(e).fontSize));
    const minFont = texts.length ? Math.min(...texts) : null;
    const header = document.querySelector('.top');
    return { vw, vh, overflow, slide, small: small.slice(0, 6), minFont, headerH: header ? Math.round(header.getBoundingClientRect().height) : 0 };
  });
  lines.push(`${label}: overflow=${m.overflow} header=${m.headerH}px slide=${m.slide || '-'} minFont=${m.minFont}px small=${m.small.map((s) => `${s.t}(${s.w}x${s.h})`).join(', ') || 'none'}`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l01p`);
  await teacher.waitForSelector('#stage img');
  await teacher.click('#open-room');
  await teacher.fill('#open-code', '');
  await teacher.click('.open-card button[type=submit]');
  const code = (await teacher.textContent('.big-code')).trim();
  await teacher.click('.overlay');
  for (let i = 0; i < 6; i += 1) await teacher.keyboard.press('PageDown');

  const s = await ctx.newPage();
  await s.goto(`${BASE}/ait/room.html?code=${code}`);
  await s.waitForSelector('#app:not([hidden])');
  for (const d of DEVICES) {
    await s.setViewportSize({ width: d.width, height: d.height });
    await teacher.click('[data-mode="slides"]');
    await wait(400);
    await measure(s, `${d.name} slides`);
    await s.screenshot({ path: path.join(OUT, `m_${d.name}_slides.png`) });
    await s.click('#links button:has-text("교과서")');
    await wait(400);
    await measure(s, `${d.name} textbook`);
    await s.screenshot({ path: path.join(OUT, `m_${d.name}_textbook.png`) });
    await s.click('#tb-close');
    await teacher.click('[data-mode="lab"]');
    await s.waitForSelector('#lab-view:not([hidden]) .cell');
    await wait(400);
    await measure(s, `${d.name} lab`);
    await s.screenshot({ path: path.join(OUT, `m_${d.name}_lab.png`) });
  }
  // 첫 화면
  const home = await ctx.newPage();
  for (const d of DEVICES) {
    await home.setViewportSize({ width: d.width, height: d.height });
    await home.goto(`${BASE}/ait/`);
    await home.waitForSelector('.lesson-row');
    await measure(home, `${d.name} home`);
  }
  fs.writeFileSync(path.join(OUT, 'mobile_results.txt'), lines.join('\n'), 'utf8');
  await browser.close();
})().catch((e) => { fs.writeFileSync(path.join(OUT, 'mobile_results.txt'), lines.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
