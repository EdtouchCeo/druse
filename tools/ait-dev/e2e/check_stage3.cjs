// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 경쟁 퀴즈 점검: 교사 1명, 학생 3명, 발표 화면 1개로 21문항을 끝까지 진행한다.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = 'http://127.0.0.1:8765';
const OUT = OUT_DIR;
const quiz = JSON.parse(fs.readFileSync(require('path').join(REPO_DIR, 'output/web/ait/content/ai-basics/u2/l02/quiz.json'), 'utf8'));
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
const results = [];
const nullHits = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function answerCorrect(page, q) {
  if (q.type === 'choice') await page.click(`.qp-grid .qz-opt:nth-child(${q.answer + 1})`);
  else if (q.type === 'ox') await page.click(`.qp-grid .qz-opt:nth-child(${q.answer ? 1 : 2})`);
  else if (q.type === 'order') {
    for (const text of q.items) await page.click(`.qp-order .qz-opt:has-text("${text}")`);
    await page.click('.qp-order .btn-gold');
  } else if (q.type === 'short') {
    await page.fill('.qp-short input', q.answer[0]);
    await page.click('.qp-short button');
  }
}
async function answerWrong(page, q) {
  if (q.type === 'choice') await page.click(`.qp-grid .qz-opt:nth-child(${q.answer === 0 ? 2 : 1})`);
  else if (q.type === 'ox') await page.click(`.qp-grid .qz-opt:nth-child(${q.answer ? 2 : 1})`);
  else if (q.type === 'order') {
    for (const text of [...q.items].reverse()) await page.click(`.qp-order .qz-opt:has-text("${text}")`);
    await page.click('.qp-order .btn-gold');
  } else if (q.type === 'short') {
    await page.fill('.qp-short input', '모름');
    await page.click('.qp-short button');
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, acceptDownloads: true });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(`${p.url().split('/').pop()} ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errors.push(`console ${m.text()}`)); });

  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l02`);
  await teacher.waitForSelector('#stage img');
  check('quiz mode enabled', !(await teacher.isDisabled('[data-mode="quiz"]')));
  await teacher.click('[data-mode="quiz"]');
  check('quiz needs open room', !(await teacher.isVisible('#quiz-host')));
  await teacher.click('#open-room');
  await teacher.fill('#open-code', '');
  await teacher.click('.open-card button[type=submit]');
  const code = (await teacher.textContent('.big-code')).trim();
  await teacher.click('.overlay');

  const [proj] = await Promise.all([ctx.waitForEvent('page'), teacher.click('#present')]);
  await proj.waitForSelector('#stage img');
  await proj.click('#start');

  const s = [];
  for (let i = 0; i < 3; i += 1) {
    const p = await ctx.newPage();
    await p.setViewportSize(i === 0 ? { width: 390, height: 844 } : { width: 800, height: 700 });
    await p.goto(`${BASE}/ait/room.html?code=${code}`);
    await p.waitForSelector('#app:not([hidden])');
    s.push(p);
  }
  await teacher.click('[data-mode="quiz"]');
  await teacher.waitForSelector('#quiz-host .qz-lobby');
  for (const p of s) await p.waitForSelector('.qp-join');
  check('students see join form', true);

  await s[0].fill('#qp-name', '펭귄탐험가');
  await s[0].click('.qp-avatar:nth-child(3)');
  await s[0].click('.qp-join .btn-gold');
  await s[1].fill('#qp-name', '시1발');
  await s[1].click('.qp-join .btn-gold');
  check('bad name blocked on device', (await s[1].textContent('.qp-join .msg')).includes('다른 대화명'));
  await s[1].fill('#qp-name', '장난꾸러기');
  await s[1].click('.qp-join .btn-gold');
  await s[2].click('.qp-join .btn-gold');
  await wait(400);
  const chips = await teacher.$$eval('#quiz-host .qz-chip span:nth-child(2)', (x) => x.map((e) => e.textContent));
  check('lobby shows 3 players', chips.length === 3, chips.join(','));
  check('blank name gets auto name', chips.some((n) => /^대륜이 \d+$/.test(n)), chips.join(','));
  await shot(proj, '31_projector_lobby');
  await shot(s[0], '32_student_lobby_mobile');

  // 장난스러운 대화명 초기화
  await teacher.click('#quiz-host .qz-chip:has-text("장난꾸러기") button:has-text("이름 초기화")');
  await wait(300);
  check('teacher reset name', (await s[1].textContent('.qp-me')).startsWith('대륜이'), await s[1].textContent('.qp-me'));
  check('student told about reset', (await s[1].textContent('.qp-body')).includes('선생님이 대화명을 바꿨습니다'));

  // 음악 분위기 고르기
  await teacher.click('#quiz-host button:has-text("잔잔한 로파이")');
  check('mood select', (await teacher.getAttribute('#quiz-host button:has-text("잔잔한 로파이")', 'aria-pressed')) === 'true');
  await teacher.click('#quiz-host button:has-text("신나는 전자음")');

  await teacher.click('#quiz-host button:has-text("퀴즈 시작")');
  let firstQuestionShot = false;
  let autoClosed = 0;
  for (let i = 0; i < quiz.questions.length; i += 1) {
    const q = quiz.questions[i];
    await s[0].waitForSelector('.qp-question', { timeout: 10000 });
    await s[1].waitForSelector('.qp-question', { timeout: 10000 });
    if (!firstQuestionShot && q.type === 'choice') { await shot(proj, '33_projector_question'); await shot(s[0], '34_student_question_mobile'); firstQuestionShot = true; }
    if (q.type === 'order' && i === 5) await shot(s[0], '35_student_order_mobile');
    await answerCorrect(s[0], q);
    await answerWrong(s[1], q);
    if (i === 0) {
      await wait(300);
      check('answered count 2/3', (await teacher.textContent('#quiz-host .qz-answered')).includes('2 / 3'), await teacher.textContent('#quiz-host .qz-answered'));
      check('answer not sent to students before reveal', !(await s[0].evaluate(() => document.body.innerHTML.includes('"answer"'))));
    }
    await wait(900); // 모두 답하면 0.7초 뒤 자동으로 정답을 공개한다.
    if (await teacher.$('#quiz-host .phase-question')) {
      if (i === 2) await proj.keyboard.press('PageDown'); // 리모컨으로 정답 공개
      else await teacher.click('#quiz-host button:has-text("정답 공개")');
    } else if (i > 3) autoClosed += 1;
    await teacher.waitForSelector('#quiz-host .phase-reveal');
    if (i === 0) {
      await wait(300);
      check('reveal rate 33%', (await teacher.textContent('#quiz-host .qz-rate')).includes('33'), await teacher.textContent('#quiz-host .qz-rate'));
      check('student 1 correct', (await s[0].textContent('.qp-card h2')).includes('정답'));
      check('student 2 wrong', (await s[1].textContent('.qp-card h2')).includes('아쉬워요'));
      check('student 3 timeout', (await s[2].textContent('.qp-card h2')).includes('시간이 끝났습니다'));
      await shot(proj, '36_projector_reveal');
      await shot(s[0], '37_student_correct_mobile');
    }
    if (q.type === 'order' || q.type === 'short') {
      check(`q${i + 1} ${q.type} scored`, (await s[0].textContent('.qp-card h2')).includes('정답'), await s[0].textContent('.qp-card h2'));
    }
    for (const [who, pg, sel] of [['teacher', teacher, '#quiz-host'], ['projector', proj, '#quiz']]) {
      const txt = await pg.textContent(sel);
      if (/null|undefined/.test(txt)) nullHits.push(`${who} q${i + 1}`);
    }
    await teacher.click('#quiz-host .qz-tools .btn-gold');
    if (i < quiz.questions.length - 1) {
      await teacher.waitForSelector('#quiz-host .phase-board');
      if (i === 0) { await shot(proj, '38_projector_board'); check('board leader', (await teacher.textContent('#quiz-host .qz-board li.top')).includes('펭귄탐험가')); }
      if (i === 3) {
        // 내보내기
        teacher.once('dialog', (d) => d.accept());
        await teacher.click('#quiz-host button:has-text("참가자")');
        await teacher.click('.people-list li:has-text("대륜이") >> nth=-1 >> button:has-text("내보내기")');
        await wait(300);
        await teacher.keyboard.press('Escape');
        check('kicked student sees message', (await s[2].textContent('.qp-card h2')).includes('나왔습니다'));
      }
      await teacher.click('#quiz-host .qz-tools .btn-gold');
    }
  }
  await teacher.waitForSelector('#quiz-host .phase-podium');
  await wait(500);
  await shot(proj, '39_projector_podium');
  await s[0].waitForSelector('.qp-report');
  await s[1].waitForSelector('.qp-report');
  const stats0 = await s[0].textContent('.qp-stats');
  check('student 1 report rank 1', stats0.includes('1위') && stats0.includes(`${quiz.questions.length}문제 맞힘`), stats0.replace(/\s+/g, ' '));
  check('student 1 no wrong items', (await s[0].textContent('.qp-report')).includes('틀린 문제가 없습니다'));
  const wrongCount = await s[1].$$eval('.qp-items li.no', (x) => x.length);
  check('student 2 sees all items wrong', wrongCount === quiz.questions.length, String(wrongCount));
  const first = await s[1].textContent('.qp-items li.no');
  check('wrong item shows my answer and correct answer', first.includes('내 답') && first.includes('정답') && first.includes('교과서 89쪽'), first.slice(0, 80));
  await s[1].click('.qp-filter button:has-text("전체")');
  check('toggle all items', (await s[1].$$eval('.qp-items li', (x) => x.length)) === quiz.questions.length);
  await s[0].click('.qp-filter button:has-text("전체")');
  await s[0].screenshot({ path: path.join(OUT, '41_student_report_mobile.png'), fullPage: false });
  await s[1].click('.qp-filter button:has-text("틀린 문제")');
  await s[1].screenshot({ path: path.join(OUT, '42_student_report_wrong.png'), fullPage: false });
  const [rdl] = await Promise.all([s[1].waitForEvent('download'), s[1].click('.qp-filter button:has-text("결과 저장")')]);
  const rfile = path.join(OUT, 'my_result.txt');
  await rdl.saveAs(rfile);
  check('student result file', fs.readFileSync(rfile, 'utf8').includes('정답:'));
  await teacher.click('#quiz-host .qz-tools .btn-gold');
  await teacher.waitForSelector('#quiz-host .phase-end');
  await shot(teacher, '40_teacher_summary');
  const lowRows = await teacher.$$eval('#quiz-host .qz-summary tr.low', (x) => x.length);
  check('summary rows', (await teacher.$$eval('#quiz-host .qz-summary tbody tr', (x) => x.length)) === quiz.questions.length);
  const [dl] = await Promise.all([teacher.waitForEvent('download'), teacher.click('#quiz-host button:has-text("CSV")')]);
  const file = path.join(OUT, 'quiz_download.csv');
  await dl.saveAs(file);
  const csv = fs.readFileSync(file, 'utf8');
  const lines = csv.trim().split(/\r?\n/);
  check('csv has BOM and header', csv.charCodeAt(0) === 0xfeff && lines[0].includes('참가자번호'), lines[0].slice(0, 60));
  check('csv rows', lines.length - 1 >= quiz.questions.length * 2, String(lines.length - 1));

  results.push(`low-rate rows: ${lowRows}`);
  check('auto reveal when all answered', autoClosed > 0, String(autoClosed));
  results.push(`audio contexts ok: ${await teacher.evaluate(() => typeof AudioContext === 'function')}`);
  check('no null text on quiz screens', nullHits.length === 0, nullHits.join(','));
  results.push(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  fs.writeFileSync(path.join(OUT, 'stage3_results.txt'), results.join('\n'), 'utf8');
  await browser.close();
})().catch((e) => { fs.writeFileSync(path.join(OUT, 'stage3_results.txt'), results.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
