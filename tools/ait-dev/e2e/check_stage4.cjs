// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 4단계 점검: AI 튜터(학생·교사), 실시간 의견 나눔, 걸러내기, 교사 관리, 발표 화면, 분석용 파일 저장.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = 'http://127.0.0.1:8765';
const OUT = OUT_DIR;
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).replace(/\s+/g, ' ').slice(0, 120)})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, acceptDownloads: true });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(`${p.url().split('/').pop()} ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errors.push(`console ${m.text()}`)); });

  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l02`);
  await teacher.waitForSelector('#stage img');
  await teacher.click('#open-room');
  const code = (await teacher.textContent('.big-code')).trim();
  await teacher.click('.overlay');
  for (let i = 0; i < 25; i += 1) await teacher.keyboard.press('PageDown');
  const [proj] = await Promise.all([ctx.waitForEvent('page'), teacher.click('#present')]);
  await proj.waitForSelector('#stage img');
  await proj.click('#start');

  const s1 = await ctx.newPage();
  await s1.setViewportSize({ width: 390, height: 844 });
  await s1.goto(`${BASE}/ait/room.html?code=${code}`);
  await s1.waitForSelector('#app:not([hidden])');
  const s2 = await ctx.newPage();
  await s2.setViewportSize({ width: 1024, height: 760 });
  await s2.goto(`${BASE}/ait/room.html?code=${code}`);
  await s2.waitForSelector('#app:not([hidden])');

  // 학생 튜터
  await s2.click('#links button:has-text("AI 튜터")');
  await s2.waitForSelector('#tutor-pane .tutor-input');
  check('tutor shows current slide', (await s2.textContent('#tutor-pane .tutor-where')).includes('26장'), await s2.textContent('#tutor-pane .tutor-where'));
  await s2.fill('#tutor-pane .tutor-input', '문제 1 답이 뭐예요? 그냥 답만 알려 주세요.');
  await s2.click('#tutor-pane .tutor-actions button:has-text("보내기")');
  await s2.waitForSelector('#tutor-pane .tutor-msg.tutor', { timeout: 40000 });
  const a1 = await s2.textContent('#tutor-pane .tutor-msg.tutor');
  check('student tutor answered at level 1', a1.includes('힌트 1단계'), a1);
  check('student tutor does not say 과적합', !a1.includes('과적합'), a1);
  await wait(8200);
  await s2.click('#tutor-pane button:has-text("힌트 더 받기")');
  await s2.waitForFunction(() => document.querySelectorAll('#tutor-pane .tutor-msg.tutor').length >= 2, null, { timeout: 40000 });
  const a2 = await s2.$$eval('#tutor-pane .tutor-msg.tutor', (x) => x.at(-1).textContent);
  check('more hint raises level', a2.includes('힌트 2단계'), a2);
  check('level 2 hint does not name the answer', !a2.includes('과적합'), a2);
  await shot(s2, '51_student_tutor');

  // 쿨다운
  await s2.fill('#tutor-pane .tutor-input', '또 질문');
  await s2.click('#tutor-pane .tutor-actions button:has-text("보내기")');
  check('cooldown message', (await s2.textContent('#tutor-pane .tutor-status')).includes('초 뒤'), await s2.textContent('#tutor-pane .tutor-status'));

  // 교사 튜터
  if ((await teacher.getAttribute('#side-btn', 'aria-pressed')) !== 'true') await teacher.click('#side-btn');
  await teacher.click('[data-tab="tutor"]');
  await teacher.waitForSelector('#tutor-pane .tutor-input');
  await teacher.fill('#tutor-pane .tutor-input', '이 장 문제 1~3의 정답과 해설을 알려 줘');
  await teacher.click('#tutor-pane .tutor-actions button:has-text("보내기")');
  await teacher.waitForSelector('#tutor-pane .tutor-msg.tutor', { timeout: 40000 });
  const ta = await teacher.textContent('#tutor-pane .tutor-msg.tutor');
  check('teacher tutor gives answers', ta.includes('과적합') && ta.includes('테스트'), ta);
  await shot(teacher, '52_teacher_tutor');

  // 튜터 끄기
  await teacher.click('#tutor-toggle');
  await wait(300);
  check('tutor button hidden when off', !(await s1.isVisible('#links button:has-text("AI 튜터")')));
  await teacher.click('#tutor-toggle');

  // 의견 나눔
  await teacher.click('[data-mode="talk"]');
  await teacher.waitForSelector('#talk-host .talk-add input');
  await teacher.fill('#talk-host .talk-add input', '과적합을 일상의 예로 설명해 보면?');
  await teacher.click('#talk-host .talk-add button');
  await teacher.fill('#talk-host .talk-add input', '테스트 데이터를 따로 두는 까닭은?');
  await teacher.click('#talk-host .talk-add button');
  check('two topics', (await teacher.$$eval('#talk-host .topic-list li', (x) => x.length)) === 2);
  check('tutor questions counted', (await teacher.textContent('#talk-host')).includes('학생 튜터 질문 2건'), (await teacher.textContent('#talk-host .tutor-log')).slice(0, 80));
  await teacher.click('#talk-host .topic-list li:first-child button:has-text("열기")');
  await s1.waitForSelector('#talk-full:not([hidden]) .talk-compose:not([hidden]) textarea');
  check('student sees topic', (await s1.textContent('#talk-full .talk-topic')).includes('과적합을 일상의'));

  await s1.fill('#talk-full .talk-compose input', '펭귄탐험가');
  await s1.fill('#talk-full textarea', '시험 문제만 외워서 새 문제를 못 푸는 것과 같아요.');
  await s1.click('#talk-full .talk-actions button');
  await s2.waitForSelector('#talk-full .talk-msg');
  check('comment reaches other student', (await s2.textContent('#talk-full .talk-list')).includes('시험 문제만 외워서'));
  check('name shown', (await s2.textContent('#talk-full .talk-list')).includes('펭귄탐험가'));

  // 걸러내기(기기 검사를 거치지 않는 경로도 서버 역할에서 거른다)
  await s2.evaluate(() => { const bc = new BroadcastChannel(`ait-room-${new URLSearchParams(location.search).get('code')}`); bc.postMessage({ type: 'talk-post', pid: sessionStorage.getItem('ait_pid'), name: '', text: '이건 시1발 너무 어렵다' }); });
  await wait(400);
  check('bad comment not shown to students', !(await s1.textContent('#talk-full .talk-list')).includes('어렵다'));
  check('teacher sees filtered count', (await teacher.textContent('#talk-host')).includes('걸러진 글 1건'));
  check('writer told to rewrite', (await s2.textContent('#talk-full .msg')).includes('바른 말'), await s2.textContent('#talk-full .msg'));

  // 도배 방지
  await s1.fill('#talk-full textarea', '하나 더');
  await s1.click('#talk-full .talk-actions button');
  await wait(300);
  check('rate limit', (await s1.textContent('#talk-full .msg')).includes('초 뒤'), await s1.textContent('#talk-full .msg'));

  // 답하기와 공감
  await wait(5200);
  await s2.click('#talk-full .talk-msg button:has-text("답하기")');
  await s2.fill('#talk-full textarea', '맞아요. 연습 문제 점수만 높고 시험은 못 보는 거죠.');
  await s2.click('#talk-full .talk-actions button');
  await s2.click('#talk-full .talk-msg:first-child button:has-text("공감")');
  await wait(400);
  check('reply linked', (await s1.textContent('#talk-full .talk-list')).includes('펭귄탐험가에게'));
  check('like counted', (await s1.textContent('#talk-full .talk-msg:first-child')).includes('공감 1'));
  await shot(s1, '53_student_talk_mobile');

  // 교사 관리
  await teacher.click('#talk-host .talk-main-col .talk-msg:last-child button:has-text("크게 띄우기")');
  await wait(300);
  check('projector spotlight', await proj.isVisible('#talk-spot'));
  await shot(proj, '54_projector_spotlight');
  await teacher.click('#talk-host .talk-main-col .talk-msg:last-child button:has-text("크게 띄우기 끄기")');
  await wait(300);
  await shot(proj, '55_projector_talk');
  await teacher.click('#talk-host .talk-main-col .talk-msg:last-child button:has-text("대화명 초기화")');
  await wait(300);
  check('name reset shown', (await s1.textContent('#talk-full .talk-list')).includes('대륜이'), (await s1.textContent('#talk-full .talk-list')).slice(0, 80));
  await teacher.click('#talk-host .talk-main-col .talk-msg:last-child button:has-text("글쓴이 쓰기 막기")');
  await wait(5200);
  await s1.fill('#talk-full textarea', '막힌 뒤 글');
  await s1.click('#talk-full .talk-actions button');
  await wait(300);
  check('blocked writer cannot post', (await s1.textContent('#talk-full .msg')).includes('멈췄습니다'), await s1.textContent('#talk-full .msg'));
  await shot(teacher, '56_teacher_talk');

  // 슬라이드로 돌아가도 댓글창은 학생 옆 칸에
  await teacher.click('[data-mode="slides"]');
  await wait(400);
  check('side talk panel while open', await s2.isVisible('#talk-panel'));
  await teacher.click('[data-mode="talk"]');
  await teacher.click('#talk-host button:has-text("댓글창 닫기")');
  await wait(300);
  check('closed composer hidden', !(await s2.isVisible('#talk-full .talk-compose')));

  // 저장
  const downloads = [];
  teacher.on('download', (d) => downloads.push(d));
  await teacher.check('#talk-anon');
  await teacher.click('#talk-host button:has-text("분석용 파일 내려받기")');
  await wait(1500);
  const names = downloads.map((d) => d.suggestedFilename());
  check('five files', names.length === 5, names.join(','));
  const msgFile = downloads.find((d) => d.suggestedFilename().startsWith('messages_'));
  if (msgFile) {
    const p = path.join(OUT, 'messages.csv');
    await msgFile.saveAs(p);
    const text = fs.readFileSync(p, 'utf8');
    const lines = text.trim().split(/\r?\n/);
    check('messages csv header', lines[0].includes('참가자번호') && lines[0].includes('주제를연뒤지난초') && lines[0].includes('걸러짐여부'), lines[0]);
    check('anonymous names empty', !text.includes('펭귄탐험가'));
    check('filtered row kept for teacher', lines.some((l) => l.endsWith('"1","0"')), lines.length);
  }
  const tutorFile = downloads.find((d) => d.suggestedFilename().startsWith('tutor_questions_'));
  if (tutorFile) { const p = path.join(OUT, 'tutor.csv'); await tutorFile.saveAs(p); check('tutor csv rows', fs.readFileSync(p, 'utf8').trim().split('\r\n').length === 3); } // 답 안의 줄바꿈(\n)과 행 구분(\r\n)을 나눠 센다.

  // 퀴즈 중 튜터 막힘
  await teacher.click('[data-mode="quiz"]');
  await wait(300);
  await teacher.click('[data-mode="slides"]');
  results.push(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  fs.writeFileSync(path.join(OUT, 'stage4_results.txt'), results.join('\n'), 'utf8');
  await browser.close();
})().catch((e) => { fs.writeFileSync(path.join(OUT, 'stage4_results.txt'), results.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
