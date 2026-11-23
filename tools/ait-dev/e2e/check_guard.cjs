// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 학생 화면의 이미지 저장 막기 점검.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = 'http://127.0.0.1:8765';
const out = [];
const check = (n, ok, d = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` (${d})` : ''}`);
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const t = await ctx.newPage();
  await t.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l02`);
  await t.waitForSelector('#stage img');
  await t.click('#open-room');
  await t.fill('#open-code', '');
  await t.click('.open-card button[type=submit]');
  const code = (await t.textContent('.big-code')).trim();
  await t.click('.overlay');
  const s = await ctx.newPage();
  await s.goto(`${BASE}/ait/room.html?code=${code}`);
  await s.waitForSelector('#app:not([hidden]) #stage img');
  const r = await s.evaluate(() => {
    const img = document.querySelector('#stage img');
    const fire = (type, target) => { const e = new MouseEvent(type, { bubbles: true, cancelable: true }); target.dispatchEvent(e); return e.defaultPrevented; };
    const drag = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    img.dispatchEvent(drag);
    const key = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(key);
    const cs = getComputedStyle(img);
    return { menu: fire('contextmenu', img), stageMenu: fire('contextmenu', document.querySelector('#stage')), drag: drag.defaultPrevented, save: key.defaultPrevented, pe: cs.pointerEvents, callout: cs.webkitTouchCallout || cs.getPropertyValue('-webkit-touch-callout') };
  });
  check('right-click menu blocked on slide', r.menu && r.stageMenu);
  check('image drag blocked', r.drag);
  check('Ctrl+S blocked', r.save);
  check('image ignores long-press', r.pe === 'none', r.pe);
  await s.emulateMedia({ media: 'print' });
  check('print hides lesson', !(await s.isVisible('#stage')));
  await s.emulateMedia({ media: 'screen' });
  // 학생 메모 칸의 복사·붙여넣기는 그대로
  const memoMenu = await s.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector('#memo').dispatchEvent(e); return e.defaultPrevented; });
  check('memo context menu still allowed', !memoMenu);
  // 교사 화면은 막지 않는다
  const tMenu = await t.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector('#stage img').dispatchEvent(e); return e.defaultPrevented; });
  check('teacher screen not blocked', !tMenu);
  fs.writeFileSync(path.join(OUT_DIR, 'guard_results.txt'), out.join('\n'), 'utf8');
  await browser.close();
})().catch((e) => { fs.writeFileSync(path.join(OUT_DIR, 'guard_results.txt'), out.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
