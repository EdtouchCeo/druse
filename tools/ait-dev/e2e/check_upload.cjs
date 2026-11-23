// Dave AIT Class 화면 시험(Playwright). 사용법은 같은 폴더 README.md.
const OUT_DIR = process.env.AIT_E2E_OUT || require('path').join(require('os').tmpdir(), 'ait-e2e');
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const REPO_DIR = require('path').resolve(__dirname, '../../..');
const { chromium } = require(process.env.PW);
const gate = require(require('path').join(REPO_DIR, 'netlify/functions/_lib/gate-cookie.js'));
const DIR = require('path').join(REPO_DIR, 'output/web/ait/content');
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext();
  await ctx.addCookies([{ name: gate.COOKIE_NAME, value: gate.issue({ sub: '33333333-3333-4333-8333-333333333333', tier: 'teacher', adm: true }, 'dev-service-key').value, domain: '127.0.0.1', path: '/', secure: true, httpOnly: true }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:8766/ait/upload.html');
  // 잘못된 폴더(차시 하나)를 고르면 멈춘다
  await p.setInputFiles('#folder', `${DIR}/ai-basics/u2/l01p`);
  await p.waitForFunction(() => document.querySelector('#msg').textContent.length > 0);
  console.log('wrong folder:', (await p.textContent('#msg')).slice(0, 40));
  await p.setInputFiles('#folder', DIR);
  await p.waitForSelector('#plan:not([hidden])', { timeout: 120000 });
  console.log('plan:', (await p.textContent('#plan')).slice(0, 120));
  const t0 = Date.now();
  await p.click('#plan button');
  await p.waitForFunction(() => /마쳤습니다|실패했습니다/.test(document.querySelector('#msg').textContent), null, { timeout: 300000 });
  console.log('done:', await p.textContent('#msg'), `${Math.round((Date.now() - t0) / 1000)}s`);
  const st = await (await fetch('http://127.0.0.1:8766/fake-sb/__state')).json();
  console.log('fake uploads:', st.uploads.length, 'manifest saved:', st.uploads.includes('_manifest.json'));
  await p.reload();
  await p.setInputFiles('#folder', DIR);
  await p.waitForSelector('#plan:not([hidden])', { timeout: 120000 });
  console.log('second pick:', (await p.textContent('#plan')).slice(0, 80));
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
