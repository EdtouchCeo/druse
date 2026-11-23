// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 서버 연결 끝까지 시험: 가짜 Supabase(tools/ait-dev, AIT_FAKE_SB=1)에 실제 화면과 서버 함수를 붙인다.
// 교사 1명(로그인 쿠키 + 세션), 학생 3명(각자 다른 브라우저 = 다른 익명 계정).
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const gate = require(require('path').join(REPO_DIR, 'netlify/functions/_lib/gate-cookie.js'));
const { makeJwt } = require(require('path').join(REPO_DIR, 'tools/ait-dev/fake-supabase.cjs'));

const BASE = 'http://127.0.0.1:8766';
const OUT = OUT_DIR;
const TEACHER = '33333333-3333-4333-8333-333333333333';
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ` (${String(d).replace(/\s+/g, ' ').slice(0, 140)})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async () => (await fetch(`${BASE}/fake-sb/__state`)).json();
let T = null;
const quiz = JSON.parse(fs.readFileSync(require('path').join(REPO_DIR, 'output/web/ait/content/ai-basics/u2/l01/quiz.json'), 'utf8'));

async function answerCorrect(page, q) {
  if (q.type === 'choice') await page.click(`.qp-grid .qz-opt:nth-child(${q.answer + 1})`);
  else if (q.type === 'ox') await page.click(`.qp-grid .qz-opt:nth-child(${q.answer ? 1 : 2})`);
  else if (q.type === 'order') { for (const t of q.items) await page.click(`.qp-order .qz-opt:has-text("${t}")`); await page.click('.qp-order .btn-gold'); }
  else { await page.fill('.qp-short input', q.answer[0]); await page.click('.qp-short button'); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const errors = [];
  const fakeOn = (ctx) => ctx.addInitScript(() => { try { localStorage.setItem('ait_fake_sb', '1'); } catch {} });

  // 교사
  const tctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true });
  await fakeOn(tctx);
  const token = makeJwt(TEACHER);
  await tctx.addInitScript((t) => { try { localStorage.setItem('dr_sess_v1', JSON.stringify({ token: t, refresh_token: 'r.33333333-3333-4333-8333-333333333333', expires_at: Date.now() + 3600e3 })); } catch {} }, token);
  await tctx.addCookies([{ name: gate.COOKIE_NAME, value: gate.issue({ sub: TEACHER, tier: 'teacher', adm: true }, 'dev-service-key').value, domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  tctx.on('page', (p) => p.on('pageerror', (e) => errors.push(`teacher: ${e.message}`)));

  const home = await tctx.newPage();
  await home.goto(`${BASE}/ait/`);
  await home.waitForSelector('#catalog .lesson-row');
  check('teacher catalog via asset', (await home.$$eval('#catalog .lesson-row', (x) => x.length)) >= 4);
  check('upload link for teacher', await home.isVisible('a[href="/ait/upload.html"]'));
  await home.close();

  const t = await tctx.newPage();
  T = t;
  await t.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l01`);
  await t.waitForSelector('#stage img');
  await t.waitForFunction(() => document.querySelector('#stage img')?.naturalWidth > 0);
  check('teacher slide image through signed URL', true);
  await t.click('#open-room');
  await t.fill('#open-code', 'DAVE22');
  await t.click('.open-card button[type=submit]');
  await t.waitForSelector('.big-code');
  const code = (await t.textContent('.big-code')).trim();
  await t.click('.overlay');
  let st = await state();
  const myRoom = (db) => db.ait_rooms.find((r) => r.code === code);
  const roomsBefore = st.db.ait_rooms.length;
  check('room row created by teacher', myRoom(st.db)?.teacher_id === TEACHER, code);
  check('teacher-chosen code used', code === 'DAVE22', code);
  const roomId = myRoom(st.db).id;
  const mine = (db) => db.ait_members.filter((m) => m.room_id === roomId);

  // 학생 셋
  const students = [];
  for (let i = 0; i < 3; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await fakeOn(ctx);
    ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(`s${i}: ${e.message}`)));
    const p = await ctx.newPage();
    await p.goto(`${BASE}/ait/room.html?code=${code}`);
    students.push({ ctx, p });
  }
  for (const { p } of students) await p.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  check('three students joined', true);
  await students[0].p.waitForFunction(() => document.querySelector('#stage img')?.naturalWidth > 0);
  check('student slide image loads', true);
  st = await state();
  check('three member rows, numbered 1..3', mine(st.db).map((m) => m.participant_no).sort().join() === '1,2,3');
  check('anon users differ', new Set(mine(st.db).map((m) => m.user_id)).size === 3);
  await t.waitForFunction(() => /참여 3명/.test(document.querySelector('#people')?.textContent || ''), null, { timeout: 15000 });
  check('teacher sees 3 participants', true);

  // 자료 문지기: 학생 lesson.json에 노트 없음, 퀴즈 파일·다른 차시 막힘
  const s0 = students[0].p;
  const privacy = await s0.evaluate(async () => {
    const l = await (await fetch('/ait-api/asset/ai-basics/u2/l01/lesson.json')).json();
    const quizStatus = (await fetch('/ait-api/asset/ai-basics/u2/l01/quiz.json')).status;
    const other = (await fetch('/ait-api/asset/ai-basics/u2/l02/lesson.json')).status;
    const catalog = (await fetch('/ait-api/asset/catalog.json')).status;
    return { notes: l.slides.some((s) => 'notes' in s), quizStatus, other, catalog };
  });
  check('student lesson has no notes', privacy.notes === false);
  check('student cannot fetch quiz/other lesson/catalog', privacy.quizStatus === 403 && privacy.other === 403 && privacy.catalog === 403, JSON.stringify(privacy));
  const cookieIsHttpOnly = await s0.evaluate(() => !document.cookie.includes('ait_room'));
  check('room cookie hidden from page script', cookieIsHttpOnly);

  // 학생이 교사 채널을 들으려 하거나 방송을 보내려 하면 막힌다
  const sneaky = await s0.evaluate(async (rid) => {
    const { createSocket, studentToken } = await import('/ait/js/rt.js');
    const sock = createSocket(studentToken);
    const ch = sock.channel(`ait:${rid}:teacher`, () => {});
    let denied = false;
    try { await ch.ready(); } catch { denied = true; }
    const main = sock.channel(`ait:${rid}`, () => {});
    await main.ready();
    main.send({ type: 'closed' });
    await new Promise((r) => setTimeout(r, 800));
    sock.close();
    return denied;
  }, roomId);
  check('student cannot join teacher channel', sneaky);
  await wait(500);
  check('student broadcast to room is dropped', await students[1].p.isVisible('#app:not([hidden])'));

  // 따라가기
  for (let i = 0; i < 3; i += 1) await t.keyboard.press('PageDown');
  await s0.waitForFunction(() => /^4 \//.test(document.querySelector('#count')?.textContent || ''), null, { timeout: 8000 });
  check('students follow slide 4', (await students[2].p.textContent('#count')).startsWith('4 /'));

  // 퀴즈
  await t.click('[data-mode="quiz"]');
  await t.waitForSelector('#quiz-host .qz-lobby');
  for (const { p } of students) await p.waitForSelector('.qp-join', { timeout: 10000 });
  await students[0].p.fill('#qp-name', '펭귄탐험가');
  await students[0].p.click('.qp-join .btn-gold');
  await students[1].p.fill('#qp-name', '장난꾸러기');
  await students[1].p.click('.qp-join .btn-gold');
  await students[2].p.click('.qp-join .btn-gold');
  await t.waitForFunction(() => document.querySelectorAll('#quiz-host .qz-chip').length === 3, null, { timeout: 10000 });
  check('quiz lobby has 3 players', true);
  st = await state();
  check('room state recorded as quiz', myRoom(st.db).state.mode === 'quiz', JSON.stringify(myRoom(st.db).state));
  // 학생 튜터가 서버 AI(Claude)를 쓸 수 있게 교사 화면이 세션 토큰을 방에 맡긴다. 암호문만 적히고 모드를 바꿔도 남는다.
  check('teacher token shared with room as ciphertext', /^a1\./.test(myRoom(st.db).state.ai?.v || '') && myRoom(st.db).state.ai.exp > Date.now());
  await t.click('#quiz-host button:has-text("퀴즈 시작")');
  for (let i = 0; i < 2; i += 1) {
    const q = quiz.questions[i];
    await s0.waitForSelector('.qp-question', { timeout: 10000 });
    if (i === 0) await students[1].p.waitForSelector('.qp-question', { timeout: 10000 });
    if (i === 0) check('answer not on student device before reveal', !(await s0.evaluate(() => document.body.innerHTML.includes('"answer"'))));
    await answerCorrect(s0, q);
    await wait(1200);
    if (await t.$('#quiz-host .phase-question')) await t.click('#quiz-host button:has-text("정답 공개")');
    await t.waitForSelector('#quiz-host .phase-reveal');
    await s0.waitForFunction(() => /정답/.test(document.querySelector('.qp-card h2')?.textContent || ''), null, { timeout: 8000 });
    if (i === 0) check('student 1 sees own correct result', true);
    await t.click('#quiz-host .qz-tools .btn-gold');
    if (i === 0) {
      await t.waitForSelector('#quiz-host .phase-board');
      t.once('dialog', (d) => d.accept());
      await t.click('#quiz-host button:has-text("참가자")');
      await t.click('.people-list li:has-text("장난꾸러기") button:has-text("내보내기")');
      await wait(300);
      await t.keyboard.press('Escape');
      await t.click('#quiz-host .qz-tools .btn-gold');
    }
  }
  await students[1].p.waitForSelector('#waiting:not([hidden])', { timeout: 8000 });
  check('kicked student sees stop screen', (await students[1].p.textContent('#wait-title')).includes('들어올 수 없습니다'), await students[1].p.textContent('#wait-title'));
  st = await state();
  check('kick recorded', mine(st.db).find((m) => m.participant_no === 2)?.kicked === true);
  await students[1].p.reload();
  await students[1].p.waitForSelector('#waiting:not([hidden])');
  await wait(1500);
  check('kicked student cannot rejoin', (await students[1].p.textContent('#wait-title')).includes('들어올 수 없습니다'), await students[1].p.textContent('#wait-title'));

  // 끝까지 넘겨 시상대와 내 결과
  for (let guard = 0; guard < 60 && !(await t.$('#quiz-host .phase-podium')); guard += 1) {
    if (await t.$('#quiz-host .phase-question')) await t.click('#quiz-host button:has-text("정답 공개")');
    else await t.click('#quiz-host .qz-tools .btn-gold');
    await wait(250);
  }
  await s0.waitForSelector('.qp-report', { timeout: 10000 });
  check('student final report arrives privately', (await s0.textContent('.qp-report')).includes('펭귄탐험가'));
  await s0.screenshot({ path: path.join(OUT, '91_server_report.png') });

  // 의견 나눔
  await t.click('[data-mode="talk"]');
  await t.waitForSelector('#talk-host .talk-add input');
  await t.fill('#talk-host .talk-add input', '과적합을 일상의 예로 설명해 보면?');
  await t.click('#talk-host .talk-add button');
  await t.click('#talk-host .topic-list li:first-child button:has-text("열기")');
  await s0.waitForSelector('#talk-full:not([hidden]) .talk-compose:not([hidden]) textarea', { timeout: 10000 });
  check('quiz nickname carried into talk', !(await s0.$('#talk-full .talk-compose input')));
  await s0.fill('#talk-full textarea', '시험 문제만 외워서 새 문제를 못 푸는 것과 같아요.');
  await s0.click('#talk-full .talk-actions button');
  await students[2].p.waitForSelector('#talk-full .talk-msg', { timeout: 10000 });
  check('comment reaches other student', (await students[2].p.textContent('#talk-full .talk-list')).includes('시험 문제만'));

  // 튜터(실제 Gemini): 방 확인 → 기록 → 교사 화면
  await t.click('[data-mode="slides"]');
  await wait(800);
  const tutor = await s0.evaluate(async () => {
    const r = await fetch('/ait-api/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'student', question: '이 장에서 뭘 봐야 해요?', level: 1, context: { slideN: 4, notes: '정답: 가짜' } }) });
    const again = await fetch('/ait-api/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'student', question: '하나 더', level: 1, context: { slideN: 4 } }) });
    return { status: r.status, body: await r.json(), again: again.status };
  });
  check('student tutor answers in open room', tutor.status === 200 && tutor.body.answer?.length > 10, `${tutor.status} ${JSON.stringify(tutor.body).slice(0, 80)}`);
  check('server gap blocks quick second question', tutor.again === 429, tutor.again);
  st = await state();
  check('tutor log stored', st.db.ait_tutor_logs.filter((l) => l.room_id === roomId).length === 1);
  await t.click('[data-mode="talk"]');
  await t.waitForFunction(() => /학생 튜터 질문 1건/.test(document.querySelector('#talk-host')?.textContent || ''), null, { timeout: 8000 }).then(() => check('teacher sees tutor question', true), () => check('teacher sees tutor question', false));

  // 새로 고침 뒤 같은 방 이어 열기
  await t.reload();
  await t.waitForSelector('#code-chip:not([hidden])', { timeout: 10000 });
  check('teacher reload resumes same room', (await t.textContent('#code-chip')).trim() === code);
  st = await state();
  check('no new room on reload', st.db.ait_rooms.length === roomsBefore);

  // 수업 닫기
  t.once('dialog', (d) => d.accept());
  await t.click('#close-room');
  await s0.waitForSelector('#waiting:not([hidden])', { timeout: 8000 });
  check('students see class ended', (await s0.textContent('#wait-title')).includes('끝났습니다'));
  st = await state();
  check('room closed_at set', !!myRoom(st.db).closed_at);
  const late = await browser.newContext();
  await fakeOn(late);
  const lp = await late.newPage();
  await lp.goto(`${BASE}/ait/room.html?code=${code}`);
  await lp.waitForFunction(() => /찾지 못했습니다/.test(document.querySelector('#wait-title')?.textContent || ''), null, { timeout: 10000 }).then(() => check('closed code cannot be joined', true), () => check('closed code cannot be joined', false));

  st = await state();
  results.push(`broadcasts ${st.stats.broadcasts}, delivered ${st.stats.delivered}, denied ${st.stats.denied.length} (${[...new Set(st.stats.denied.map((d) => d.replace(/[0-9a-f-]{36}/g, '…')))].join(' | ')})`);
  results.push(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  fs.writeFileSync(path.join(OUT, 'server_results.txt'), results.join('\n'), 'utf8');
  await browser.close();
})().catch(async (e) => { if (T) { await T.screenshot({ path: path.join(OUT, '99_crash_teacher.png') }).catch(() => {}); results.push('teacher text: ' + (await T.textContent('#quiz-host').catch(() => '')).slice(0, 300)); } fs.writeFileSync(path.join(OUT, 'server_results.txt'), results.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
