// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
// 장 위의 움직이는 그림(GIF)과 동영상: 자리 겹치기, 진행 화면 재생을 발표 화면이 따르는지, 학생 화면, 교과서·다른 장에서 지워지는지.
// 시험 자료: 로컬 미리보기 content의 l02 8장(GIF)과 l03 38장(동영상)에 media가 있어야 한다.
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

const goto = async (page, n) => {
  await page.keyboard.press('Home');
  for (let i = 1; i < n; i += 1) await page.keyboard.press('PageDown');
  await wait(400);
};
// 겹친 그림이 장 그림 안의 기대 자리(비율)에 있는지
const placed = (page, sel, item) => page.evaluate(([sel, item]) => {
  // 장 그림이 상자 안에서 실제로 차지하는 자리(object-fit: contain)
  const el = document.querySelector('#stage .zoom-box > img');
  const b = el.getBoundingClientRect();
  const k = Math.min(b.width / el.naturalWidth, b.height / el.naturalHeight);
  const img = { width: el.naturalWidth * k, height: el.naturalHeight * k };
  img.left = b.left + (b.width - img.width) / 2;
  img.top = b.top + (b.height - img.height) / 2;
  const m = document.querySelector(sel).getBoundingClientRect();
  return { dx: (m.left - img.left) / img.width - item.x, dy: (m.top - img.top) / img.height - item.y, dw: m.width / img.width - item.w };
}, [sel, item]);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const errors = [];
  ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(`${p.url()} ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errors.push(`console ${p.url()} ${m.text()}`)); });

  // 1. GIF (l02 8장)
  const t2 = await ctx.newPage();
  await t2.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l02`);
  await t2.waitForSelector('#stage img');
  await goto(t2, 8);
  check('l02 on slide 8', (await t2.textContent('#count')).startsWith('8 /'));
  await t2.waitForFunction(() => document.querySelector('#stage .slide-media img.gif')?.naturalWidth > 0, null, { timeout: 8000 }).catch(() => {});
  check('gif overlay shown', await t2.isVisible('#stage .slide-media img.gif'));
  const g = await placed(t2, '#stage .slide-media img.gif', { x: 0.0465, y: 0.26, w: 0.906 });
  check('gif placed where the PPT has it', Math.abs(g.dx) < 0.01 && Math.abs(g.dy) < 0.01 && Math.abs(g.dw) < 0.01, JSON.stringify(g));
  await shot(t2, 'media_teacher_gif');
  await t2.keyboard.press('PageDown');
  await wait(300);
  check('next slide clears overlay', (await t2.$$('#stage .slide-media > *')).length === 0);
  await t2.keyboard.press('PageUp');
  await wait(300);
  await t2.keyboard.press('+');
  await wait(200);
  check('overlay is inside zoom box', await t2.$eval('#stage .zoom-box', (b) => /scale/.test(b.style.transform) && !!b.querySelector('.slide-media img.gif')));
  await t2.keyboard.press('0');
  await t2.close();

  // 2. 동영상 (l03 38장): 진행 화면 재생을 발표 화면이 따른다
  const teacher = await ctx.newPage();
  await teacher.goto(`${BASE}/ait/teach.html?l=ai-basics/u2/l03`);
  await teacher.waitForSelector('#stage img');
  const present = await ctx.newPage();
  await present.setViewportSize({ width: 1280, height: 720 });
  await present.goto(`${BASE}/ait/present.html?l=ai-basics/u2/l03`);
  await present.waitForSelector('#stage img');
  await present.click('#start').catch(() => {});
  await wait(800);
  await teacher.bringToFront();
  await goto(teacher, 38);
  check('l03 on slide 38', (await teacher.textContent('#count')).startsWith('38 /'));
  await teacher.waitForFunction(() => document.querySelector('#stage video')?.readyState >= 2, null, { timeout: 8000 }).catch(() => {});
  check('teacher video has controls', await teacher.$eval('#stage video', (v) => v.controls && v.readyState >= 2));
  check('present has the same video', await present.$eval('#stage video', (v) => !v.controls).catch(() => false));
  const v = await placed(teacher, '#stage video', { x: 0.04125, y: 0.21733, w: 0.91725 });
  check('video placed where the PPT has it', Math.abs(v.dx) < 0.01 && Math.abs(v.dy) < 0.01 && Math.abs(v.dw) < 0.01, JSON.stringify(v));
  await teacher.$eval('#stage video', (x) => x.play());
  await wait(1500);
  const pPlaying = await present.$eval('#stage video', (x) => !x.paused && x.currentTime > 0.2);
  check('present plays when teacher plays', pPlaying);
  await teacher.$eval('#stage video', (x) => x.pause());
  await wait(500);
  check('present pauses when teacher pauses', await present.$eval('#stage video', (x) => x.paused));
  const tt = await teacher.$eval('#stage video', (x) => x.currentTime);
  const pt = await present.$eval('#stage video', (x) => x.currentTime);
  check('present time follows teacher', Math.abs(tt - pt) < 0.6, `${tt.toFixed(2)} / ${pt.toFixed(2)}`);
  await shot(present, 'media_present_video');
  await shot(teacher, 'media_teacher_video');
  // 판서 중에도 동영상 자리 위에 그릴 수 있다(캔버스가 위에 있다)
  await teacher.keyboard.press('d');
  const top = await teacher.evaluate(() => {
    const r = document.querySelector('#stage video').getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.className;
  });
  check('ink canvas is above the video while drawing', String(top).includes('ink-canvas'), top);
  await teacher.keyboard.press('Escape');
  // 교과서로 바꾸면 겹친 것이 사라진다
  await teacher.click('[data-mode="textbook"]');
  await wait(400);
  check('textbook mode clears video', (await teacher.$$('#stage video')).length === 0);
  await wait(300);
  check('present clears video in textbook mode', (await present.$$('#stage video')).length === 0);
  await teacher.click('[data-mode="slides"]');
  await wait(300);

  // 3. 학생 화면
  await teacher.click('#open-room');
  await teacher.fill('#open-code', '');
  await teacher.click('.open-card button[type=submit]');
  const code = (await teacher.textContent('.big-code')).trim();
  await teacher.click('.overlay');
  const student = await ctx.newPage();
  await student.setViewportSize({ width: 390, height: 844 });
  await student.goto(`${BASE}/ait/room.html?code=${code}`);
  await student.waitForSelector('#app:not([hidden])', { timeout: 8000 });
  await student.waitForFunction(() => document.querySelector('#stage video'), null, { timeout: 8000 }).catch(() => {});
  check('student sees video with controls, muted', await student.$eval('#stage video', (x) => x.controls && x.muted).catch(() => false));
  await shot(student, 'media_student_video');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const text = results.join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'media_results.txt'), text);
  console.log(text);
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
