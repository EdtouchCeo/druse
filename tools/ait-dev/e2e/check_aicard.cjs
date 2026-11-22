// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
const path = require('path');
const { chromium } = require(process.env.PW);
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  for (const [n, vp] of [['pc', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: vp });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:8765/');
    await p.waitForTimeout(1200);
    await p.evaluate(() => { switchTab('ai', document.getElementById('tab-btn-ai')); document.getElementById('ai-login-required').style.display = 'none'; document.getElementById('ai-content').style.display = ''; switchAiSub(12); });
    await p.waitForTimeout(400);
    const card = p.locator('#ai-sub-12 > div');
    const m = await card.evaluate((n) => ({ w: n.getBoundingClientRect().width, over: document.documentElement.scrollWidth > innerWidth + 1, shown: getComputedStyle(n.parentElement).display !== 'none', other: getComputedStyle(document.getElementById('ai-sub-11')).display }));
    console.log(n, JSON.stringify(m), errs.length ? errs : 'no errors');
    await card.screenshot({ path: path.join(OUT_DIR, `83_aicard_${n}.png`) });
    await p.close();
  }
  await b.close();
})();
