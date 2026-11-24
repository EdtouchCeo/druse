// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
// l02 실습 2(교과서 98~101쪽, 목둘레로 허리둘레를 예측하는 선형 회귀): 44장 실습 모드에서 9셀을 모두 실행하고 교과서 결과와 대조한다.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = process.env.AIT_BASE || 'http://127.0.0.1:8765';
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const errors = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(`${p.url()} ${e.message}`)));
  const t = await ctx.newPage();
  await t.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l02`);
  await t.waitForSelector('#stage img');
  await t.keyboard.press('Home');
  for (let i = 1; i < 44; i += 1) await t.keyboard.press('PageDown');
  await wait(300);
  check('on slide 44', (await t.textContent('#count')).startsWith('44 /'), await t.textContent('#count'));
  await t.click('[data-mode="lab"]');
  await t.waitForSelector('#lab-pane .cell');
  check('lab has 9 cells', (await t.$$('#lab-pane .cell')).length === 9);
  check('slide 44 links cell 1', await t.isVisible('#cell-c1.linked'));
  await t.click('#lab-pane .lab-tools button:has-text("전체 실행")');
  await t.waitForFunction(() => {
    const cells = [...document.querySelectorAll('#lab-pane .cell')];
    return cells.every((c) => ['ok', 'error'].includes(c.dataset.status)) || cells.some((c) => c.dataset.status === 'error');
  }, null, { timeout: 240000 });
  const statuses = await t.$$eval('#lab-pane .cell', (cs) => cs.map((c) => `${c.id.replace('cell-', '')}:${c.dataset.status}`));
  check('all 9 cells run', statuses.every((s) => s.endsWith(':ok')), statuses.join(' '));
  const out = async (id) => (await t.textContent(`#cell-${id} .cell-out`) || '').trim();
  const outs = {};
  for (const id of ['c1', 'c3', 'c5', 'c6', 'c7', 'c8']) outs[id] = await out(id);
  check('c1 head shows 33.8 / 62.9', outs.c1.includes('33.8') && outs.c1.includes('62.9'), outs.c1.slice(0, 80));
  check('c3 shapes (674, 1) (289, 1)', outs.c3.includes('(674, 1)') && outs.c3.includes('(289, 1)'), outs.c3);
  check('c5 coef 2.8324 intercept -24.72 (textbook)', outs.c5.includes('2.8324') && outs.c5.includes('-24.72'), outs.c5);
  check('c6 train R2 0.698 (textbook)', outs.c6.startsWith('0.698'), outs.c6);
  check('c7 test R2 0.71255 (textbook)', outs.c7.startsWith('0.71255'), outs.c7);
  check('c8 first prediction 80.077 (textbook)', outs.c8.includes('80.077'), outs.c8.slice(0, 120));
  check('c9 draws a graph', (await t.$$('#cell-c9 .cell-out img')).length === 1);
  await t.locator('#cell-c9').scrollIntoViewIfNeeded();
  await t.screenshot({ path: path.join(OUT_DIR, 'practice2_teacher_lab.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'practice2_outputs.json'), JSON.stringify(outs, null, 1));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const text = results.join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'practice2_results.txt'), text);
  console.log(text);
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
