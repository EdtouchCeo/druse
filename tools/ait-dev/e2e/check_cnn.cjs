// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
// 합성곱 신경망 5분 실습(/ait/labs/cnn/): 준비 문제 180, 오답 안내, 필터 옮기기·훑기, 최대 풀링, 점수 계산과 최종 선택. 좁은 칸(480)과 넓은 화면(1280).
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW);
const OUT = process.env.AIT_E2E_OUT || path.join(require('os').tmpdir(), 'ait-e2e');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.AIT_BASE || 'http://127.0.0.1:8765';
const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` (${String(d).replace(/\s+/g, ' ').slice(0, 120)})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function walk(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/ait/labs/cnn/`);
  await page.waitForSelector('#warm-px .cell');
  const tag = `[${width}]`;

  // 1단계: 오답이면 정답 대신 다시 볼 칸을 표시한다.
  await page.fill('#warm-in', '300');
  await page.click('#s1-check');
  const look = await page.locator('.look').count();
  const msg1 = await page.textContent('#s1-msg');
  check(`${tag} 오답 300: 다시 볼 칸 표시, 정답 숨김`, look === 4 && !msg1.includes('180'), `${look} ${msg1}`);
  await page.screenshot({ path: path.join(OUT, `cnn_${width}_1wrong.png`), fullPage: true });
  await page.click('#s1-reset');
  await page.fill('#warm-in', '180');
  await page.keyboard.press('Enter');
  check(`${tag} 180 정답, 사진 칸 열림`, await page.isVisible('#s1-photo'));
  // 키보드로 필터 옮기기
  const rc = async () => (await page.textContent('#s1-calc .where')).match(/(\d+)행 (\d+)열/).slice(1).map(Number);
  const [r0, c0] = await rc();
  check(`${tag} 첫 위치는 윤곽(0보다 큰 값)`, !(await page.textContent('#s1-calc .sum')).endsWith('에 0'));
  await page.focus('#cat');
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(k);
  const [r1, c1] = await rc();
  check(`${tag} 화살표로 필터 이동`, r1 === r0 + 1 && c1 === c0 + 2, `${r0},${c0} -> ${r1},${c1}`);
  await page.screenshot({ path: path.join(OUT, `cnn_${width}_1photo.png`), fullPage: true });
  await page.click('#sweep');
  await page.waitForFunction(() => document.querySelector('#fill-count').textContent.includes('1,024 / 1,024'), null, { timeout: 5000 });
  check(`${tag} 한 번에 훑기로 1,024칸`, true);

  // 2단계
  await page.click('#to2');
  const values = await page.$$eval('#pool-pick .pick', (b) => b.map((x) => Number(x.textContent)));
  const maxI = values.indexOf(Math.max(...values));
  const wrongI = maxI === 0 ? 1 : 0;
  await page.click(`#pool-pick .pick >> nth=${wrongI}`);
  await page.click('#s2-check');
  const msg2 = await page.textContent('#s2-msg');
  check(`${tag} 풀링 오답 안내`, msg2.includes('큰 값') && (await page.locator('.look').count()) === 4, msg2);
  // 키보드로 최댓값 고르기
  await page.focus(`#pool-pick .pick >> nth=${wrongI}`);
  const moves = { 0: { 1: 'ArrowRight', 2: 'ArrowDown', 3: 'ArrowDown' }, 1: { 0: 'ArrowLeft', 2: 'ArrowDown', 3: 'ArrowDown' } }[wrongI][maxI];
  await page.keyboard.press(moves);
  if (wrongI === 0 && maxI === 3) await page.keyboard.press('ArrowRight');
  if (wrongI === 1 && maxI === 2) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await page.click('#s2-check');
  const msg2b = await page.textContent('#s2-msg');
  check(`${tag} 최댓값 ${Math.max(...values)} 정답, 결과 칸 안내`, msg2b.startsWith('맞습니다') && msg2b.includes(String(Math.max(...values))), msg2b);
  await page.waitForSelector('#s2-more:not([hidden])');
  await page.click('#second');
  check(`${tag} 8×8 맵`, await page.isVisible('#p2map'));
  await page.screenshot({ path: path.join(OUT, `cnn_${width}_2pool.png`), fullPage: true });

  // 3단계
  await page.click('#to3');
  check(`${tag} 특징값 64개`, (await page.locator('#feat .fcell').count()) === 64);
  check(`${tag} 예상 전 계산 막힘`, await page.isDisabled('#compute'));
  await page.click('#flatten');
  check(`${tag} 한 줄로 64개`, (await page.locator('#strip li').count()) === 64);
  await page.click('#predict-choices button >> text=사자');
  await page.click('#compute');
  await wait(900);
  const scores = await page.$$eval('.score-row', (rows) => rows.map((r) => ({ id: r.dataset.id, v: Number(r.querySelector('.val').textContent) })));
  const top = scores.reduce((a, b) => (b.v > a.v ? b : a));
  check(`${tag} 점수 3개, 고양이가 가장 높음`, scores.length === 3 && top.id === 'cat', JSON.stringify(scores));
  await page.click('#final-choices button >> text=사자');
  await page.click('#s3-check');
  const msg3 = await page.textContent('#s3-msg');
  check(`${tag} 최종 오답은 다시 비교 안내`, msg3.includes('다시 비교') && !msg3.includes('맞습니다'), msg3);
  await page.click('#final-choices button >> text=고양이');
  await page.click('#s3-check');
  const msg3b = await page.textContent('#s3-msg');
  check(`${tag} 최종 고양이 정답, 마무리 열림`, msg3b.startsWith('맞습니다') && await page.isVisible('#wrap'), msg3b);
  await page.click('.score details summary >> nth=0');
  await page.screenshot({ path: path.join(OUT, `cnn_${width}_3fc.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${tag} 가로 넘침 없음`, overflow <= 1, overflow);
  check(`${tag} 화면 오류 없음`, errors.length === 0, errors.join(' | '));
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const w of [480, 1280]) await walk(browser, w);
  } catch (e) {
    check('실행 중 오류', false, e.message);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'cnn_results.txt'), results.join('\n'));
    console.log(results.join('\n'));
    console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} PASS`);
  }
})();
