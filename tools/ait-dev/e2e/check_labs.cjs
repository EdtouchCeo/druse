// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 실습 마무리 점검: 코랩 노트북 실습, 내 코랩에서 열기, 노트북 내려받기, 실습 탭과 작업 공간 분리, 다른 플랫폼 띄우기.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = 'http://127.0.0.1:8765';
const OUT = OUT_DIR;
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` (${String(d).replace(/\s+/g, ' ').slice(0, 110)})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (page, sel) => page.waitForFunction((s) => {
  const cells = [...document.querySelectorAll(`${s} .cell`)];
  return cells.length && cells.every((c) => c.dataset.status === 'ok' || c.dataset.status === 'error');
}, sel, { timeout: 300000, polling: 1000 });

async function openClass(ctx, lesson) {
  const t = await ctx.newPage();
  await t.goto(`${BASE}/ait/teach.html?l=${lesson}`);
  await t.waitForSelector('#stage img');
  await t.click('#open-room');
  const code = (await t.textContent('.big-code')).trim();
  await t.click('.overlay');
  const s = await ctx.newPage();
  await s.goto(`${BASE}/ait/room.html?code=${code}`);
  await s.waitForSelector('#app:not([hidden])');
  return { t, s };
}
async function gotoSlide(t, n) { for (let i = 1; i < n; i += 1) await t.keyboard.press('PageDown'); await wait(300); }

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); });

  // 1) 01 차시: 코랩 노트북 실습
  let { t, s } = await openClass(ctx, 'ai-basics/u2/l01');
  await gotoSlide(t, 44);
  await t.click('[data-mode="lab"]');
  await s.waitForSelector('#lab-view:not([hidden]) .cell');
  check('01 lab focuses cell 1 on slide 44', await s.isVisible('#lab-pane #cell-c1.linked'));
  check('colab open button', (await s.getAttribute('#lab-pane a:has-text("내 코랩에서 열기")', 'href') || '').includes('colab.research.google.com/drive/1At6h'));
  check('colab help mentions Drive copy', (await s.textContent('#lab-pane .lab-colab-help')).includes('Drive에 사본 저장'));
  await s.click('#lab-pane .lab-tools button:has-text("전체 실행")');
  await done(s, '#lab-pane');
  const st = await s.$$eval('#lab-pane .cell', (cs) => cs.map((c) => c.dataset.status));
  check('colab lab 10 cells ok', st.length === 10 && st.every((x) => x === 'ok'), st.join(','));
  check('cell 9 prints correlation', /상관계수: 0\.6/.test(await s.textContent('#lab-pane #cell-c9 .cell-out')), (await s.textContent('#lab-pane #cell-c9 .cell-out')).slice(0, 60));
  check('cell 10 prints matrix', (await s.textContent('#lab-pane #cell-c10 .cell-out')).includes('flipper_length_mm'));
  const [nb] = await Promise.all([s.waitForEvent('download'), s.click('#lab-pane button:has-text("노트북(.ipynb)")')]);
  const nbPath = path.join(OUT, 'lab.ipynb');
  await nb.saveAs(nbPath);
  const nbJson = JSON.parse(fs.readFileSync(nbPath, 'utf8'));
  check('ipynb valid', nbJson.nbformat === 4 && nbJson.cells.filter((c) => c.cell_type === 'code').length === 10);
  await gotoSlide(t, 10); // 44 -> 53 (정규화)
  await s.waitForTimeout(500);
  check('slide 53 focuses cell 7', await s.isVisible('#lab-pane #cell-c7.linked'), await t.textContent('#count'));
  await s.screenshot({ path: path.join(OUT, '71_student_colab_lab.png') });
  await t.close(); await s.close();

  // 2) 실습 1 차시: 실습 두 개, 탭 전환, 작업 공간 분리
  ({ t, s } = await openClass(ctx, 'ai-basics/u2/l01p'));
  await t.click('[data-mode="lab"]');
  await s.waitForSelector('#lab-view:not([hidden]) .lab-switch button');
  check('two lab tabs', (await s.$$eval('#lab-pane .lab-switch button', (x) => x.length)) === 2);
  await gotoSlide(t, 7);
  await s.waitForSelector('#lab-pane #cell-c1.linked');
  await s.click('#lab-pane #cell-c1 .run');
  await s.waitForSelector('#lab-pane #cell-c1[data-status="ok"]', { timeout: 300000 });
  await s.click('#lab-pane .lab-switch button:nth-child(2)');
  await s.waitForSelector('#lab-pane .lab-head h2:has-text("코랩")');
  check('switched to colab tab', true);
  await s.click('#lab-pane #cell-c3 .run');
  await s.waitForSelector('#lab-pane #cell-c3[data-status="error"]', { timeout: 120000 });
  check('namespaces separate (df not shared)', (await s.textContent('#lab-pane #cell-c3 .cell-error')).includes('NameError'));
  await t.keyboard.press('PageDown');
  await s.waitForTimeout(500);
  check('slide 8 switches back to practice tab', (await s.textContent('#lab-pane .lab-head h2')).includes('실습 1'), await s.textContent('#lab-pane .lab-head h2'));
  await t.close(); await s.close();

  // 3) 다른 플랫폼(미리보기 사본에만 붙인 시험용)
  ({ t, s } = await openClass(ctx, 'ai-basics/u2/l03'));
  await t.click('[data-mode="lab"]');
  await s.waitForSelector('#lab-view:not([hidden]) .lab-switch button');
  await s.click('#lab-pane .lab-switch button:has-text("화면 안")');
  check('embed lab iframe', await s.isVisible('#lab-pane iframe.lab-frame'));
  await s.click('#lab-pane .lab-switch button:has-text("새 창")');
  await s.waitForSelector('#lab-pane .lab-head h2:has-text("새 창 시험")');
  check('link lab button', (await s.getAttribute('#lab-pane a:has-text("새 창으로 열기")', 'href')) === 'https://playground.tensorflow.org/');
  check('link lab steps', (await s.$$eval('#lab-pane .lab-steps li', (x) => x.length)) === 2);
  await s.screenshot({ path: path.join(OUT, '72_student_link_lab.png') });

  results.push(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  fs.writeFileSync(path.join(OUT, 'labs_results.txt'), results.join('\n'), 'utf8');
  await browser.close();
})().catch((e) => { fs.writeFileSync(path.join(OUT, 'labs_results.txt'), results.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
