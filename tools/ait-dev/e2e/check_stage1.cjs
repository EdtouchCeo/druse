// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
// 1단계 화면 점검: 첫 화면, 교사 진행 화면, 학생 따라가기를 PC와 휴대폰 너비로 렌더링한다.
const path = require('path');
const { chromium } = require(process.env.PW);
const BASE = 'http://127.0.0.1:8765';
const OUT = OUT_DIR;
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
async function fontSizes(page, sels) {
  return page.evaluate((s) => s.map((q) => { const e = document.querySelector(q); return e ? `${q}=${getComputedStyle(e).fontSize}` : `${q}=none`; }), sels);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(`${p.url()} ${e.message}`)));

  // 첫 화면
  const home = await ctx.newPage();
  home.on('console', (m) => m.type() === 'error' && errors.push(`console ${m.text()}`));
  await home.goto(`${BASE}/ait/`);
  await home.waitForSelector('.lesson-row');
  await shot(home, '01_home_pc');
  check('home overflow pc', (await overflow(home)) <= 0);
  results.push('fonts home: ' + (await fontSizes(home, ['.hero-text p', '.lesson-row .title', '.teacher-note p'])).join(', '));
  await home.fill('#code', 'ab1');
  await home.click('#join button');
  check('join invalid code message', (await home.textContent('#join-msg')).includes('6자리'));

  // 교사 진행 화면
  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l02`);
  await teacher.waitForSelector('#stage img');
  await shot(teacher, '02_teacher_before_open');
  await teacher.click('#open-room');
  await teacher.waitForSelector('.overlay');
  const code = (await teacher.textContent('.big-code')).trim();
  check('room code 6 chars', /^[A-Z0-9]{6}$/.test(code), code);
  await shot(teacher, '03_teacher_code_overlay');
  await teacher.click('.overlay');

  // 학생 입장
  const student = await ctx.newPage();
  await student.goto(`${BASE}/ait/room.html?code=${code}`);
  await student.waitForSelector('#app:not([hidden])', { timeout: 8000 });
  check('student joined', true);
  await teacher.waitForTimeout(300);
  check('teacher sees participant', (await teacher.textContent('#people')).includes('1명'), await teacher.textContent('#people'));

  // 따라가기
  for (let i = 0; i < 3; i++) await teacher.keyboard.press('ArrowRight');
  await student.waitForTimeout(300);
  check('student follows to 4', (await student.textContent('#count')).startsWith('4 /'), await student.textContent('#count'));
  await shot(student, '04_student_follow_pc');

  // 둘러보기와 돌아오기
  await student.click('#prev');
  await student.waitForTimeout(100);
  check('browse banner shown', await student.isVisible('#follow-banner'));
  await shot(student, '05_student_browse_pc');
  await teacher.keyboard.press('ArrowRight');
  await student.waitForTimeout(300);
  check('browsing stays on own slide', (await student.textContent('#count')).startsWith('3 /'), await student.textContent('#count'));
  await student.click('#follow');
  check('follow returns to teacher', (await student.textContent('#count')).startsWith('5 /'), await student.textContent('#count'));

  // 교과서 연결
  await student.click('#links button');
  await student.waitForSelector('#tb-pane:not([hidden]) img');
  check('student textbook page', (await student.textContent('#tb-title')).includes('88쪽'), await student.textContent('#tb-title'));
  await shot(student, '06_student_textbook_side');
  await student.click('#tb-close');

  // 메모
  await student.fill('#memo', '지도학습은 정답이 있는 데이터로 배운다.');
  await student.click('#memo-save');
  check('memo saved', (await student.textContent('#memo-saved')).includes('저장'));

  // 화면 고정
  await teacher.click('#lock');
  await student.waitForTimeout(300);
  check('lock disables browse', await student.isDisabled('#prev'));
  check('lock banner', await student.isVisible('#mode-banner'));
  await teacher.click('#lock');

  // 교과서 모드
  await teacher.click('[data-mode="textbook"]');
  await student.waitForTimeout(300);
  check('textbook mode on student', (await student.textContent('#count')).includes('교과서'), await student.textContent('#count'));
  await shot(student, '07_student_textbook_mode');
  await teacher.keyboard.press('ArrowRight');
  await student.waitForTimeout(300);
  check('textbook page follows', (await student.textContent('#count')).includes('89쪽'), await student.textContent('#count'));
  await teacher.click('[data-mode="slides"]');

  // 교사 화면: 노트와 교과서 나란히
  await teacher.click('#notes-btn');
  await teacher.click('#side-btn');
  await teacher.waitForSelector('#tb-img[src*="p088"]');
  await shot(teacher, '08_teacher_split_notes');
  check('teacher overflow', (await overflow(teacher)) <= 0);
  results.push('fonts teacher: ' + (await fontSizes(teacher, ['.notes p', '#count', '.modebar button'])).join(', '));

  // 휴대폰 너비 학생
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // 다른 컨텍스트는 BroadcastChannel이 닿지 않으므로 같은 컨텍스트 페이지를 휴대폰 크기로 바꿔 본다.
  await student.setViewportSize({ width: 390, height: 844 });
  await student.waitForTimeout(200);
  await shot(student, '09_student_mobile');
  check('student overflow mobile', (await overflow(student)) <= 0, String(await overflow(student)));
  results.push('fonts student mobile: ' + (await fontSizes(student, ['#count', '.panel h2', '#memo'])).join(', '));
  const mhome = await mctx.newPage();
  await mhome.goto(`${BASE}/ait/`);
  await mhome.waitForSelector('.lesson-row');
  await shot(mhome, '10_home_mobile');
  check('home overflow mobile', (await overflow(mhome)) <= 0, String(await overflow(mhome)));

  // 수업 닫기
  teacher.once('dialog', (d) => d.accept());
  await teacher.click('#close-room');
  await student.waitForTimeout(500);
  check('student sees closed', (await student.textContent('#wait-title')).includes('끝났습니다'));

  // 잘못된 코드
  const lost = await ctx.newPage();
  await lost.goto(`${BASE}/ait/room.html?code=ZZZZZZ`);
  await lost.waitForTimeout(4500);
  check('unknown room message', (await lost.textContent('#wait-title')).includes('찾지 못했습니다'));

  results.push(`errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  require('fs').writeFileSync(path.join(OUT, 'stage1_results.txt'), results.join('\n'), 'utf8');
  await browser.close();
})().catch((e) => { require('fs').writeFileSync(path.join(OUT, 'stage1_results.txt'), results.join('\n') + '\nCRASH ' + e.stack, 'utf8'); process.exit(1); });
