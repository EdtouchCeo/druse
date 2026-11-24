// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
// 판서(줌잇식 단축키)와 확대: 진행 화면에서 그리면 발표 화면이 따라 그리는지, 교과서 확대, 학생 화면 확대.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const BASE = process.env.AIT_BASE || 'http://127.0.0.1:8765';
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (p, name) => p.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });

// 캔버스에서 칠해진 점의 수(색이 있는 점)
const inked = (page, sel) => page.$eval(sel, (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n += 1;
  return n;
});

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(`${p.url()} ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errors.push(`console ${p.url()} ${m.text()}`)); });

  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l03`);
  await teacher.waitForSelector('#stage img');
  await teacher.waitForFunction(() => document.querySelector('#stage img').naturalWidth > 0);
  const present = await ctx.newPage();
  await present.setViewportSize({ width: 1280, height: 720 });
  await present.goto(`${BASE}/ait/present.html?l=ai-basics/u2/l03`);
  await present.waitForSelector('#stage img');
  await present.click('#start').catch(() => {});
  await wait(800);
  await teacher.bringToFront();

  // 37장으로
  for (let i = 1; i < 37; i += 1) await teacher.keyboard.press('PageDown');
  await wait(300);
  check('teacher on slide 37', (await teacher.textContent('#count')).startsWith('37 /'), await teacher.textContent('#count'));

  // D로 판서 시작
  await teacher.keyboard.press('d');
  check('D starts drawing', await teacher.$eval('#stage', (s) => s.classList.contains('inking')));
  check('ink bar visible', await teacher.isVisible('.ink-bar'));
  check('ink button pressed', (await teacher.getAttribute('#ink-btn', 'aria-pressed')) === 'true');

  const box = await teacher.$eval('#stage', (s) => { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (fx, fy) => [box.x + box.w * fx, box.y + box.h * fy];
  const drag = async (a, b, mods = []) => {
    for (const m of mods) await teacher.keyboard.down(m);
    await teacher.mouse.move(...at(...a));
    await teacher.mouse.down();
    for (let i = 1; i <= 8; i += 1) await teacher.mouse.move(...at(a[0] + (b[0] - a[0]) * i / 8, a[1] + (b[1] - a[1]) * i / 8));
    await teacher.mouse.up();
    for (const m of mods.reverse()) await teacher.keyboard.up(m);
  };
  await drag([0.2, 0.3], [0.35, 0.45]); // 펜
  await teacher.keyboard.press('g');
  await drag([0.4, 0.3], [0.6, 0.3], ['Shift']); // 직선
  await teacher.keyboard.press('b');
  await drag([0.2, 0.55], [0.35, 0.7], ['Control']); // 네모
  await teacher.keyboard.press('o');
  await drag([0.45, 0.55], [0.6, 0.7], ['Tab']); // 원
  await teacher.keyboard.press('p');
  await drag([0.65, 0.4], [0.8, 0.25], ['Control', 'Shift']); // 화살표
  await teacher.keyboard.press('t');
  await teacher.mouse.click(...at(0.65, 0.6));
  await teacher.waitForSelector('.ink-input');
  await teacher.keyboard.type('Feature map');
  await teacher.keyboard.press('Enter');
  await wait(200);
  check('blank not toggled by B while drawing', (await teacher.getAttribute('#blank', 'aria-pressed')) !== 'true');
  const tState = await teacher.evaluate(() => null);
  const tInk = await inked(teacher, '#stage .ink-canvas');
  check('teacher canvas has ink', tInk > 200, String(tInk));
  await wait(400);
  const pInk = await inked(present, '#stage .ink-canvas');
  check('present mirrors ink', pInk > 200, String(pInk));
  await teacher.hover('.ink-bar [data-tool="line"]');
  await wait(150);
  const tip = await teacher.$eval('.ink-bar [data-tool="line"]', (b) => getComputedStyle(b, '::after').content);
  check('icon tooltip shows shortcut', tip.includes('Shift'), tip);
  check('tool buttons are icons', (await teacher.$$('.ink-bar .ink-btn svg')).length >= 13);
  await shot(teacher, 'ink_teacher_shapes');
  await teacher.mouse.move(5, 5);
  await shot(present, 'ink_present_shapes');

  // 굵기·칠판·되돌리기
  await teacher.keyboard.press('w');
  await wait(200);
  check('W white board on present', await present.isVisible('#stage .ink-sheet.white'));
  await shot(present, 'ink_present_board');
  await teacher.keyboard.press('w');
  const before = await inked(teacher, '#stage .ink-canvas');
  await teacher.keyboard.press('Control+z');
  await wait(100);
  const after = await inked(teacher, '#stage .ink-canvas');
  check('Ctrl+Z undoes last shape', after < before, `${before}→${after}`);

  // 확대
  await teacher.keyboard.press('+');
  await teacher.keyboard.press('+');
  await wait(300);
  const tz = await teacher.$eval('#stage .zoom-box', (b) => b.style.transform);
  const pz = await present.$eval('#stage .zoom-box', (b) => b.style.transform);
  check('teacher zooms with +', /scale\(1\.5/.test(tz), tz);
  check('present follows zoom', /scale\(1\.5/.test(pz), pz);
  check('zoom badge shown', await teacher.isVisible('.zoom-badge'));
  await shot(present, 'ink_present_zoom');
  await teacher.keyboard.press('0');
  await wait(100);
  check('0 resets zoom', (await teacher.$eval('#stage .zoom-box', (b) => b.style.transform)) === '');

  // E로 지우기, Esc로 끝내기
  await teacher.keyboard.press('e');
  await wait(300);
  check('E clears teacher', (await inked(teacher, '#stage .ink-canvas')) === 0);
  check('E clears present', (await inked(present, '#stage .ink-canvas')) === 0);
  await drag([0.3, 0.3], [0.5, 0.5]);
  await teacher.keyboard.press('Escape');
  await wait(300);
  check('Esc ends drawing', !(await teacher.$eval('#stage', (s) => s.classList.contains('inking'))));
  check('Esc clears ink', (await inked(present, '#stage .ink-canvas')) === 0);

  // 판서 중 장 넘김은 되고 판서는 지워진다
  await teacher.keyboard.press('d');
  await drag([0.3, 0.3], [0.5, 0.5]);
  await teacher.keyboard.press('PageDown');
  await wait(400);
  check('PageDown still navigates while drawing', (await teacher.textContent('#count')).startsWith('38 /'), await teacher.textContent('#count'));
  check('page change clears ink', (await inked(present, '#stage .ink-canvas')) === 0);
  await teacher.keyboard.press('Escape');
  // 판서가 아닐 때 B는 그대로 가리기(발표 화면 연결 시)
  await teacher.keyboard.press('b');
  await wait(300);
  check('B blanks when not drawing', await present.isVisible('#blank'));
  await teacher.keyboard.press('b');

  // 교과서 모드: 무대 확대와 판서
  await teacher.click('[data-mode="textbook"]');
  await wait(500);
  await teacher.mouse.move(...at(0.5, 0.4));
  await teacher.keyboard.down('Control');
  await teacher.mouse.wheel(0, -400);
  await teacher.keyboard.up('Control');
  await wait(300);
  const tbz = await teacher.$eval('#stage .zoom-box', (b) => b.style.transform);
  check('Ctrl+wheel zooms textbook page', /scale/.test(tbz), tbz);
  await shot(teacher, 'ink_teacher_textbook_zoom');
  await teacher.keyboard.press('0');
  await teacher.click('[data-mode="slides"]');

  // 나란히 보기 교과서 확대 단추
  await teacher.click('#side-btn');
  await teacher.waitForSelector('#tb-img');
  const w0 = await teacher.$eval('#tb-img', (i) => i.getBoundingClientRect().width);
  await teacher.click('#tb-zoom button[aria-label="교과서 확대"]');
  await teacher.click('#tb-zoom button[aria-label="교과서 확대"]');
  await wait(200);
  const w1 = await teacher.$eval('#tb-img', (i) => i.getBoundingClientRect().width);
  check('side textbook zoom in', w1 > w0 * 1.3, `${Math.round(w0)}→${Math.round(w1)}`);
  check('side textbook level label', (await teacher.textContent('#tb-zoom .zoom-level')) === '150%');
  await shot(teacher, 'ink_side_textbook_zoom');

  // 학생 화면: Ctrl+휠·두 번 누르기 확대(판서 없음)
  await teacher.click('#open-room');
  await teacher.fill('#open-code', '');
  await teacher.click('.open-card button[type=submit]');
  const code = (await teacher.textContent('.big-code')).trim();
  await teacher.click('.overlay');
  const student = await ctx.newPage();
  await student.setViewportSize({ width: 390, height: 844 });
  await student.goto(`${BASE}/ait/room.html?code=${code}`);
  await student.waitForSelector('#app:not([hidden])', { timeout: 8000 });
  await student.waitForFunction(() => document.querySelector('#stage img')?.naturalWidth > 0);
  const sb = await student.$eval('#stage', (s) => { const r = s.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.15 }; }); // 장 위쪽(가운데에 동영상이 있으면 그 단추가 두 번 누르기를 받는다)
  await student.mouse.dblclick(sb.x, sb.y);
  await wait(200);
  const sz = await student.$eval('#stage .zoom-box', (b) => b.style.transform);
  check('student double-click zooms', /scale\(2\)/.test(sz), sz);
  check('student has no ink bar', (await student.$$('.ink-bar')).length === 0);
  await shot(student, 'ink_student_zoom');
  await student.mouse.dblclick(sb.x, sb.y);
  await wait(200);
  check('student double-click resets', (await student.$eval('#stage .zoom-box', (b) => b.style.transform)) === '');
  await student.click('#links button:has-text("교과서")').catch(() => {});
  await wait(300);
  if (await student.isVisible('#tb-pane')) {
    await student.click('#tb-zoom button[aria-label="교과서 확대"]');
    await wait(200);
    check('student textbook zoom label', (await student.textContent('#tb-zoom .zoom-level')) === '125%');
    await shot(student, 'ink_student_textbook_zoom');
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const text = results.join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'ink_results.txt'), text);
  console.log(text);
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
