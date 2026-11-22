// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 사용 설명서 평가과제 도움 자료의 Dave AIT Class 카드: PC 1280, 휴대폰 390 렌더링과 들어가기 동작.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = 'http://127.0.0.1:8765';
const OUT = OUT_DIR;
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ` (${d})` : ''}`);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const [name, vp] of [['pc', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: name === 'mobile' ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/#student/assessment-help/subject`);
    await page.waitForTimeout(1500);
    const box = page.locator('#ait-class-entry');
    const visible = await box.isVisible();
    check(`${name} card visible`, visible);
    if (!visible) continue;
    await box.scrollIntoViewIfNeeded();
    const m = await box.evaluate((n) => {
      const r = n.getBoundingClientRect();
      const copy = n.querySelector('.ait-entry-copy').getBoundingClientRect();
      const p = getComputedStyle(n.querySelector('p')).fontSize;
      const input = n.querySelector('input').getBoundingClientRect();
      const btn = n.querySelector('button').getBoundingClientRect();
      return { overflow: n.scrollWidth > n.clientWidth + 1, docOverflow: document.documentElement.scrollWidth > innerWidth + 1, width: r.width, copy: copy.width, p, input: input.height, btn: btn.height, btnRight: btn.right, right: r.right };
    });
    check(`${name} no overflow`, !m.overflow && !m.docOverflow, JSON.stringify(m));
    check(`${name} text width ok`, m.copy >= (name === 'pc' ? 500 : 240), m.copy);
    check(`${name} touch targets >= 44`, m.input >= 44 && m.btn >= 44);
    check(`${name} button inside card`, m.btnRight <= m.right);
    await box.screenshot({ path: path.join(OUT, `81_entry_${name}.png`) });
    await page.fill('#ait-entry-code', 'k7q2md');
    await Promise.all([page.waitForURL(/\/ait\/room\.html\?code=/), page.click('#ait-class-entry button')]);
    check(`${name} join goes to room`, page.url().includes('/ait/room.html?code=k7q2md'), page.url());
    await page.waitForTimeout(800);
    check(`${name} room shows code`, (await page.textContent('body')).includes('K7Q2MD'));
    check(`${name} no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'entry_results.txt'), results.join('\n'), 'utf8');
  await browser.close();
})().catch((e) => { fs.writeFileSync(path.join(OUT, 'entry_results.txt'), results.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
