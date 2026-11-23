// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 실습 나란히 보기와 발표 화면(프로젝터), 리모컨 키를 점검한다.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = 'http://127.0.0.1:8765';
const OUT = OUT_DIR;
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(`${p.url()} ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errors.push(`console ${p.url()} ${m.text()}`)); });

  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l01p`);
  await teacher.waitForSelector('#stage img');
  await teacher.click('#open-room');
  await teacher.fill('#open-code', '');
  await teacher.click('.open-card button[type=submit]');
  const code = (await teacher.textContent('.big-code')).trim();
  await teacher.click('.overlay');

  const student = await ctx.newPage();
  await student.goto(`${BASE}/ait/room.html?code=${code}`);
  await student.waitForSelector('#app:not([hidden])', { timeout: 8000 });

  // 실습 모드
  await teacher.click('[data-mode="lab"]');
  await teacher.waitForSelector('#lab-pane .cell');
  await student.waitForSelector('#lab-view:not([hidden]) .cell', { timeout: 8000 });
  check('student lab opens in lab mode', true);
  for (let i = 0; i < 6; i++) await teacher.keyboard.press('PageDown');
  await wait(400);
  check('teacher on slide 7', (await teacher.textContent('#count')).startsWith('7 /'), await teacher.textContent('#count'));
  check('teacher lab focuses cell 1', await teacher.isVisible('#cell-c1.linked'));
  check('student lab focuses cell 1', await student.isVisible('#cell-c1.linked'));

  // 학생이 전체 실행
  await student.click('#lab-pane .lab-tools button:has-text("전체 실행")');
  await student.waitForFunction(() => {
    const cells = [...document.querySelectorAll('#lab-pane .cell')];
    return cells.length && cells.every((c) => c.dataset.status === 'ok' || c.dataset.status === 'error') || cells.some((c) => c.dataset.status === 'error');
  }, null, { timeout: 300000, polling: 1000 });
  const statuses = await student.$$eval('#lab-pane .cell', (cs) => cs.map((c) => `${c.id.replace('cell-', '')}:${c.dataset.status}`));
  const okCount = statuses.filter((s) => s.endsWith(':ok')).length;
  check('student runs all 19 cells', okCount === 19, statuses.filter((s) => !s.endsWith(':ok')).join(' ') || `${okCount} ok`);
  const c6 = await student.textContent('#cell-c6 .cell-out');
  check('cell 6 shape (334, 7)', c6.includes('(334, 7)'), c6.trim().slice(0, 40));
  const c13 = await student.textContent('#cell-c13 .cell-out');
  check('cell 13 finds row 336', c13.includes('336'), c13.trim().slice(0, 60));
  const imgs = await student.$$eval('#lab-pane .cell-out img', (x) => x.length);
  check('graphs drawn', imgs >= 9, String(imgs));
  await student.locator('#cell-c16').scrollIntoViewIfNeeded();
  await shot(student, '21_student_lab_mode');

  // 발표 화면 띄우기
  const [proj] = await Promise.all([ctx.waitForEvent('page'), teacher.click('#present')]);
  await proj.waitForLoadState();
  await proj.waitForSelector('#stage img');
  await wait(500);
  check('teacher sees projector connected', await teacher.isVisible('#present-badge'));
  check('presenter bar visible', await teacher.isVisible('#presenter'));
  await proj.click('#start');
  await wait(300);
  const before = await teacher.textContent('#count');
  await proj.keyboard.press('PageDown');
  await wait(300);
  check('clicker on projector advances console', (await teacher.textContent('#count')).startsWith('8 /'), `${before} -> ${await teacher.textContent('#count')}`);
  check('projector shows slide 8', (await proj.getAttribute('#stage img', 'src')).endsWith('s08.webp'));
  await proj.keyboard.press('PageUp');
  await wait(300);
  check('clicker back', (await teacher.textContent('#count')).startsWith('7 /'));
  await proj.keyboard.press('b');
  await wait(300);
  check('black screen on projector', await proj.isVisible('#blank'));
  check('console shows blank state', await teacher.isVisible('#blank-state'));
  await proj.keyboard.press('PageDown');
  await wait(300);
  check('next key unblanks first', !(await proj.isVisible('#blank')) && (await teacher.textContent('#count')).startsWith('7 /'));

  // 진행 화면에서 실행하면 발표 화면에 결과가 보인다
  await teacher.click('#cell-c1 .run');
  await proj.waitForSelector('#mirror-c1 table', { timeout: 120000 });
  check('projector mirrors lab output', true);
  await wait(300);
  await shot(proj, '22_projector_lab');
  await shot(teacher, '23_teacher_lab_present');
  const rows = await teacher.evaluate(() => { const c = document.querySelector('.controls'); return Math.round(c.getBoundingClientRect().height); });
  check('controls fit one row', rows < 70, `${rows}px`);

  // 슬라이드 모드 발표 화면
  await teacher.click('[data-mode="slides"]');
  await wait(300);
  check('projector single layout', !(await proj.isVisible('#lab')));
  await shot(proj, '24_projector_slide');

  // 다른 차시(교과서 나란히)
  if ((await teacher.getAttribute('#side-btn', 'aria-pressed')) !== 'true') await teacher.click('#side-btn');
  await teacher.click('[data-tab="textbook"]');
  await teacher.waitForSelector('#tb-img[src*="p0"]');
  check('teacher textbook tab', (await teacher.textContent('#tb-title')).includes('쪽'), await teacher.textContent('#tb-title'));

  // 휴대폰 너비 학생 실습
  await student.setViewportSize({ width: 390, height: 844 });
  await wait(200);
  await shot(student, '25_student_lab_mobile');
  const ov = await student.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('student mobile overflow', ov <= 0, String(ov));

  results.push(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  fs.writeFileSync(path.join(OUT, 'stage2_results.txt'), results.join('\n'), 'utf8');
  await browser.close();
})().catch((e) => { fs.writeFileSync(path.join(OUT, 'stage2_results.txt'), results.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
