// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
// 퀴즈 입력 보존과 종료 화면: 다른 학생이 답하거나 들어와도 적던 글이 남는지, 중간에 끝내기와 종료 화면이 되는지 본다.
const path = require('path');
const fs = require('fs');
const OUT = process.env.AIT_E2E_OUT || path.join(require('os').tmpdir(), 'ait-e2e');
fs.mkdirSync(OUT, { recursive: true });
const REPO_DIR = path.resolve(__dirname, '../../..');
const { chromium } = require(process.env.PW);
const BASE = process.env.AIT_BASE || 'http://127.0.0.1:8765';
const LESSON = 'ai-basics/u2/l01';
const quiz = JSON.parse(fs.readFileSync(path.join(REPO_DIR, `output/web/ait/content/${LESSON}/quiz.json`), 'utf8'));
const shortAt = quiz.questions.findIndex((q) => q.type === 'short');
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

async function answer(page, q) {
  if (q.type === 'choice') await page.click(`.qp-grid .qz-opt:nth-child(${q.answer + 1})`);
  else if (q.type === 'ox') await page.click(`.qp-grid .qz-opt:nth-child(${q.answer ? 1 : 2})`);
  else if (q.type === 'order') {
    for (const text of q.items) await page.click(`.qp-order .qz-opt:has-text("${text}")`);
    await page.click('.qp-order .btn-gold');
  } else {
    await page.fill('.qp-short input', q.answer[0]);
    await page.click('.qp-short button');
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, acceptDownloads: true });
  const errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(`${p.url().split('/').pop()} ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`console ${m.text()}`));
    p.on('dialog', (d) => d.accept());
  });

  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/ait/teach.html?l=${LESSON}`);
  await teacher.waitForSelector('#stage img');
  await teacher.click('#open-room');
  await teacher.fill('#open-code', '');
  await teacher.click('.open-card button[type=submit]');
  const code = (await teacher.textContent('.big-code')).trim();
  await teacher.click('.overlay');
  await teacher.click('[data-mode="quiz"]');
  await teacher.waitForSelector('#quiz-host .phase-lobby');

  const open = async (size) => {
    const p = await ctx.newPage();
    await p.setViewportSize(size);
    await p.goto(`${BASE}/ait/room.html?code=${code}`);
    await p.waitForSelector('#qp-name');
    return p;
  };
  // 대화명을 적는 동안 다른 학생이 들어와도 적던 글과 커서가 남는다.
  const a = await open({ width: 390, height: 844 });
  await a.click('#qp-name');
  await a.keyboard.type('펭귄');
  await a.evaluate(() => { document.querySelector('#qp-name').dataset.mark = 'same'; });
  const b = await open({ width: 800, height: 700 });
  await b.fill('#qp-name', '둘째');
  await b.click('.qp-join button[type=submit]');
  await teacher.waitForSelector('.qz-chip');
  await wait(1200);
  check('join: name kept while another student joins', (await a.inputValue('#qp-name')) === '펭귄');
  check('join: same input element', (await a.getAttribute('#qp-name', 'data-mark')) === 'same');
  check('join: focus kept', await a.evaluate(() => document.activeElement?.id === 'qp-name'));
  await a.keyboard.type('탐험가');
  await a.click('.qp-join button[type=submit]');
  await teacher.waitForFunction(() => document.querySelectorAll('.qz-chip').length === 2);

  await teacher.click('.qz-tools .btn-gold'); // 퀴즈 시작
  for (let i = 0; i < shortAt; i += 1) {
    await a.waitForSelector('.qp-question');
    await answer(a, quiz.questions[i]);
    await answer(b, quiz.questions[i]);
    await teacher.waitForSelector('#quiz-host .phase-reveal');
    await teacher.click('.qz-tools .btn-gold'); // 순위 보기
    await teacher.waitForSelector('#quiz-host .phase-board');
    await teacher.click('.qz-tools .btn-gold'); // 다음 문제
  }

  // 단답형: 적는 중에 다른 학생이 답을 보내도, 선생님이 시간을 늘려도 글이 남는다.
  const q = quiz.questions[shortAt];
  await a.waitForSelector('.qp-short input');
  await b.waitForSelector('.qp-short input');
  await a.click('.qp-short input');
  await a.keyboard.type('적는중');
  await a.evaluate(() => { document.querySelector('.qp-short input').dataset.mark = 'same'; });
  await teacher.click('.qz-tools button:has-text("10초 더")');
  await wait(1200);
  check('short: kept after more time', (await a.inputValue('.qp-short input')) === '적는중');
  // 둘째가 보내도 첫째가 남아 있어 문제는 닫히지 않는다.
  await b.fill('.qp-short input', q.answer[0]);
  await b.click('.qp-short button');
  await teacher.waitForFunction(() => /응답 1 \/ 2/.test(document.querySelector('.qz-answered')?.textContent || ''));
  await wait(1500);
  check('short: kept after another student answers', (await a.inputValue('.qp-short input')) === '적는중');
  check('short: same input element', (await a.getAttribute('.qp-short input', 'data-mark')) === 'same');
  check('short: focus kept', await a.evaluate(() => document.activeElement?.classList.contains('qp-short-input')));
  await a.keyboard.type('입니다');
  check('short: typing continues at the end', (await a.inputValue('.qp-short input')) === '적는중입니다');
  // 일시 정지는 화면을 새로 그린다. 그래도 글과 커서가 남는다.
  await teacher.click('.qz-tools button:has-text("일시 정지")');
  await a.waitForFunction(() => /일시 정지/.test(document.querySelector('.qp-progress')?.textContent || ''));
  check('short: kept after pause repaint', (await a.inputValue('.qp-short input')) === '적는중입니다');
  check('short: focus kept after pause', await a.evaluate(() => document.activeElement?.classList.contains('qp-short-input')));
  await teacher.click('.qz-tools button:has-text("이어 하기")');
  await a.waitForFunction(() => !/일시 정지/.test(document.querySelector('.qp-progress')?.textContent || ''));
  check('short: kept after resume', (await a.inputValue('.qp-short input')) === '적는중입니다');
  await shot(a, 'qe_01_short_typing');
  // 남은 시간은 줄어든다("10초 더"로 문항 시간을 넘겨도 막대는 100%에서 멈춘다).
  await a.waitForFunction(() => parseFloat(document.querySelector('.qz-timefill').style.width) < 100, null, { timeout: 15000 });
  const timeBefore = await a.evaluate(() => parseFloat(document.querySelector('.qz-timefill').style.width));
  await wait(1500);
  const timeAfter = await a.evaluate(() => parseFloat(document.querySelector('.qz-timefill').style.width));
  check('short: timer still runs', timeAfter < timeBefore, `${timeBefore} -> ${timeAfter}`);
  await a.fill('.qp-short input', q.answer[0]);
  await a.click('.qp-short button');
  await teacher.waitForSelector('#quiz-host .phase-reveal');

  // 중간에 끝내기 → 시상대 → 문항별 결과 → 종료 화면
  const asked = shortAt + 1;
  check('stop button shown during quiz', await teacher.isVisible('.qz-tools button:has-text("퀴즈 끝내기")'));
  await teacher.click('.qz-tools button:has-text("퀴즈 끝내기")');
  await teacher.waitForSelector('#quiz-host .phase-podium');
  check('stop button hidden after end', !(await teacher.isVisible('.qz-tools button:has-text("퀴즈 끝내기")')));
  await teacher.click('.qz-tools .btn-gold'); // 문항별 결과
  await teacher.waitForSelector('#quiz-host .phase-end');
  const rows = await teacher.locator('.qz-summary tbody tr').count();
  check('summary lists only asked questions', rows === asked, `${rows}/${asked}`);
  await teacher.click('.qz-tools .btn-gold'); // 퀴즈 종료
  await teacher.waitForSelector('#quiz-host .phase-done');
  const doneText = await teacher.textContent('#quiz-host .qz-body');
  check('done: says finished', doneText.includes('퀴즈를 마쳤습니다'));
  check('done: says stopped early', doneText.includes(`전체 ${quiz.questions.length}문제 가운데 ${asked}문제까지`));
  const tiles = await teacher.locator('.qz-tile b').allTextContents();
  check('done: tiles', tiles.length === 3 && tiles[0] === '2명' && tiles[1] === '100%', tiles.join(' | '));
  check('done: ranking', (await teacher.locator('.qz-done-cols .qz-board li').count()) === 2);
  check('done: no null text', !/null|undefined|NaN/.test(await teacher.textContent('#quiz-host')));
  const overflow = await teacher.evaluate(() => { const el = document.querySelector('#quiz-host .qz-body'); return el.scrollWidth - el.clientWidth; });
  check('done: no sideways overflow', overflow <= 1, `${overflow}px`);
  const tall = await teacher.evaluate(() => { const el = document.querySelector('#quiz-host .qz-body'); return el.scrollHeight - el.clientHeight; });
  check('done: fits without scrolling at 1366x800', tall <= 1, `${tall}px`);
  await shot(teacher, 'qe_02_teacher_done');
  const [dl] = await Promise.all([teacher.waitForEvent('download'), teacher.click('.qz-tools button:has-text("CSV")')]);
  check('done: csv download', /quiz_responses_.*\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());

  // 학생 기기: 낸 문항만 결과에 나온다.
  await a.waitForSelector('.qp-report');
  await a.click('.qp-filter button:nth-child(2)');
  const items = await a.locator('.qp-items > li').count();
  check('student report lists only asked questions', items === asked, `${items}/${asked}`);
  check('student report: no null text', !/null|undefined|NaN/.test(await a.textContent('#quiz-player')));
  await shot(a, 'qe_03_student_report');

  await teacher.click('.qz-tools button:has-text("문항별 결과")');
  await teacher.waitForSelector('#quiz-host .phase-end');
  await teacher.click('.qz-tools .btn-gold');
  await teacher.waitForSelector('#quiz-host .phase-done');
  await teacher.click('.qz-tools .btn-gold'); // 슬라이드로 돌아가기
  await teacher.waitForSelector('#stage:not([hidden])');
  check('back to slides', !(await teacher.isVisible('#quiz-host')));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
  fs.writeFileSync(path.join(OUT, 'quiz_end_results.txt'), results.join('\n'));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); process.exit(1); });
