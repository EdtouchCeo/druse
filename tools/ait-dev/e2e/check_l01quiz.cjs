// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 01 차시(교사 제작) 퀴즈 점검: 2배 점수, 문항 그림, 교사 메모 숨김, 단답형 다른 표기.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = 'http://127.0.0.1:8765';
const OUT = OUT_DIR;
const quiz = JSON.parse(fs.readFileSync(require('path').join(REPO_DIR, 'output/web/ait/content/ai-basics/u2/l01/quiz.json'), 'utf8'));
const results = [];
const nullHits = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` (${String(d).replace(/\s+/g, ' ').slice(0, 100)})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHORT = { q04: '모델', q11: '범주형 데이터', q15: 'eda', q17: '결측값' };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && errors.push(m.text())); });
  const t = await ctx.newPage();
  await t.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l01`);
  await t.waitForSelector('#stage img');
  await t.click('#open-room');
  await t.fill('#open-code', '');
  await t.click('.open-card button[type=submit]');
  const code = (await t.textContent('.big-code')).trim();
  await t.click('.overlay');
  const [proj] = await Promise.all([ctx.waitForEvent('page'), t.click('#present')]);
  await proj.waitForSelector('#stage img');
  await proj.click('#start');
  const s = await ctx.newPage();
  await s.setViewportSize({ width: 390, height: 844 });
  await s.goto(`${BASE}/ait/room.html?code=${code}`);
  await s.waitForSelector('#app:not([hidden])');
  await t.click('[data-mode="quiz"]');
  await s.waitForSelector('.qp-join');
  await s.fill('#qp-name', '데이터탐험가');
  await s.click('.qp-join .btn-gold');
  await t.waitForSelector('#quiz-host .qz-chip');
  await t.click('#quiz-host button:has-text("퀴즈 시작")');

  for (let i = 0; i < quiz.questions.length; i += 1) {
    const q = quiz.questions[i];
    await s.waitForSelector('.qp-question', { timeout: 10000 });
    if (q.double) check(`${q.id} double badge on student`, await s.isVisible('.qp-progress .qz-double'));
    if (q.image) {
      check(`${q.id} image on projector`, await proj.isVisible('#quiz .qz-img'));
      check(`${q.id} image on student`, await s.isVisible('.qp-img'));
      await proj.screenshot({ path: path.join(OUT, '61_projector_image_question.png') });
      await s.screenshot({ path: path.join(OUT, '62_student_image_question.png') });
    }
    if (q.type === 'choice') await s.click(`.qp-grid .qz-opt:nth-child(${q.answer + 1})`);
    else if (q.type === 'ox') await s.click(`.qp-grid .qz-opt:nth-child(${q.answer ? 1 : 2})`);
    else { await s.fill('.qp-short input', SHORT[q.id]); await s.click('.qp-short button'); }
    await t.waitForSelector('#quiz-host .phase-reveal', { timeout: 10000 });
    await wait(250);
    const head = await s.textContent('.qp-card h2');
    if (q.type === 'short') check(`${q.id} accepts "${SHORT[q.id]}"`, head.includes('정답'), head);
    if (q.double) {
      const pts = Number((await s.textContent('.qp-points')).replace(/[^0-9]/g, ''));
      check(`${q.id} double points`, pts >= 1000, pts);
    }
    if (q.teacher_note) {
      const tn = await t.textContent('#quiz-host .qz-explain');
      check(`${q.id} teacher note on teacher`, tn.includes('교사 메모'), tn.slice(-40));
      check(`${q.id} note hidden on projector`, !(await proj.textContent('#quiz')).includes(q.teacher_note.slice(0, 12)));
      check(`${q.id} note hidden on student`, !(await s.evaluate((x) => document.body.textContent.includes(x), q.teacher_note.slice(0, 12))));
      if (q.id === 'q13') await t.screenshot({ path: path.join(OUT, '63_teacher_note.png') });
    }
    for (const [who, pg, sel] of [['teacher', t, '#quiz-host'], ['projector', proj, '#quiz']]) {
      const txt = await pg.textContent(sel);
      if (/null|undefined/.test(txt)) nullHits.push(`${who} q${i + 1}`);
    }
    await t.click('#quiz-host .qz-tools .btn-gold');
    if (i < quiz.questions.length - 1) { await t.waitForSelector('#quiz-host .phase-board'); await t.click('#quiz-host .qz-tools .btn-gold'); }
  }
  await s.waitForSelector('.qp-report');
  const stats = await s.textContent('.qp-stats');
  check('all 20 correct in report', stats.includes('20문제 맞힘'), stats);
  check('no null text on quiz screens', nullHits.length === 0, nullHits.join(','));
  results.push(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  fs.writeFileSync(path.join(OUT, 'l01quiz_results.txt'), results.join('\n'), 'utf8');
  await browser.close();
})().catch((e) => { fs.writeFileSync(path.join(OUT, 'l01quiz_results.txt'), results.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
