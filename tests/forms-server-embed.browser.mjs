// 문서작성 AI(/forms/) 화면 시험: 서버 AI 연결, 기본 양식 열기, 입력 화면이 있는 양식(겹침 창).
// 헤드리스 Chrome으로 돌린다. 서버 AI·Supabase·양식 함수는 모두 가짜 응답이고, /evalplan/은 시험용 화면으로 바꿔 띄운다.
// 실행: node tests/forms-server-embed.browser.mjs   (Chrome 위치는 환경변수 CHROME)
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../output/web')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
// 시험용 /evalplan/: 부모가 시키는 대로 파일을 보내고 받은 답을 적어 둔다.
const STUB = `<!doctype html><meta charset="utf-8"><title>stub</title><body>stub<script>
window.__id = Math.random().toString(36).slice(2); window.__replies = [];
window.addEventListener('message', function (e) { if (e.source === window.parent && e.data && e.data.type === 'dr-forms-opened') window.__replies.push(e.data); });
window.__send = async function (kind) {
  var buf;
  if (kind === 'bad') buf = new Uint8Array([1, 2, 3, 4]).buffer;
  else buf = await (await fetch('/forms/templates/campaign-plan.hwpx')).arrayBuffer();
  window.parent.postMessage({ type: 'dr-forms-open', v: 1, name: '2026학년도 통합사회 평가 운영 계획.hwpx', bytes: buf }, location.origin, [buf]);
};
window.parent.postMessage({ type: 'dr-forms-ready', v: 1 }, location.origin);
</script>`
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/evalplan/') { res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(STUB); return }
  if (p.endsWith('/')) p += 'index.html'
  const f = path.join(ROOT, p)
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-embed-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + prof, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
const wsUrl = await new Promise((resolve, reject) => {
  let buf = ''
  chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) resolve(m[1]) })
  setTimeout(() => reject(new Error('Chrome 시작 실패')), 20000)
})
const targets = await (await fetch(wsUrl.replace(/^ws/, 'http').replace(/\/devtools\/browser\/.*/, '/json/list'))).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0; const waiting = new Map(); const logs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') logs.push('예외: ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300))
})
const cdp = (method, params = {}) => new Promise((resolve) => { const id = ++seq; waiting.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })
  if (r.result.exceptionDetails) throw new Error('평가 실패: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text))
  return r.result.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(expr, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev('return !!(' + expr + ')')) return true } catch (e) {} await sleep(100) } return false }
let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS', n) } else { fail++; console.log('FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 500)) } }

const boot = `
  if (window.top === window) {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('dr_sess_v1', JSON.stringify({ token: 't1', refresh_token: 'r1', expires_at: Date.now() + 3600e3 }));
    }
    window.__relay = []; window.__mode = 'ok';
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, o) => {
      const u = String(url && url.url || url);
      if (/run\\.app\\/api\\/llm\\/generate-open/.test(u)) {
        window.__relay.push({ headers: o.headers, body: JSON.parse(o.body) });
        if (window.__mode === '401') { window.__mode = 'ok'; return new Response('{"error":"만료"}', { status: 401 }); }
        if (window.__mode === '403') { window.__mode = 'ok'; return new Response(JSON.stringify({ code: 'BYOK_REQUIRED', error: '서버 AI를 지금은 쓸 수 없습니다. 화면의 AI 설정에서 개인 Gemini 키를 등록해 주세요.' }), { status: 403 }); }
        return new Response(JSON.stringify({ text: '{"reply":"서버가 답했습니다.","edits":[]}' }), { status: 200 });
      }
      if (/supabase\\.co\\/auth\\/v1\\/token/.test(u)) return new Response(JSON.stringify({ access_token: 't2', refresh_token: 'r2', expires_in: 3600 }), { status: 200 });
      if (/generativelanguage/.test(u)) { window.__gem = (window.__gem || 0) + 1; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"reply":"제미나이 답","edits":[]}' }] } }] }), { status: 200 }); }
      if (/forms-templates/.test(u)) {
        const a = JSON.parse(o.body).action;
        return new Response(JSON.stringify(a === 'me' ? { ok: true, isAdmin: false } : { items: [] }), { status: 200 });
      }
      return realFetch(url, o);
    };
  }`
await cdp('Page.enable'); await cdp('Runtime.enable')
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot })
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/forms/index.html` })
ok('화면이 뜸', await until("!document.getElementById('app').hidden && window.__drForms && document.querySelectorAll('#form-cards .form-card').length", 20000))
if (!pass) { console.log(logs, await ev('return document.title')); process.exit(1) }
const send = (text) => ev(`document.getElementById('prompt').value = ${JSON.stringify(text)}; document.getElementById('btn-send').click(); return true;`)
const replies = (re) => until(`[...document.querySelectorAll('#chat-log .msg')].some((m) => ${re}.test(m.textContent))`, 15000)

// ── 1. 서버 AI가 기본 연결 ──
ok('연결 이름이 서버 AI (Claude)', await ev("return document.getElementById('ai-chip').textContent") === 'AI: 서버 AI (Claude)', await ev("return document.getElementById('ai-chip').textContent"))
ok('전송 안내에 Anthropic', await ev("return /Anthropic/.test(document.getElementById('scope').textContent)"))
await send('안녕')
ok('서버 답이 대화에 보임', await replies('/서버가 답했습니다/'))
const r1 = await ev('return __relay[0]')
ok('교사 토큰과 사이트 표시를 보냄', r1 && r1.headers.Authorization === 'Bearer t1' && r1.headers['x-auth-site'] === 'daeryun', r1 && r1.headers)
ok('요청 모양(prompt, schema, 16384)', r1 && typeof r1.body.prompt === 'string' && r1.body.schema && r1.body.maxOutputTokens === 16384 && !('images' in r1.body), r1 && Object.keys(r1.body))

// 이미지 첨부도 서버로
await ev(`const c = document.createElement('canvas'); c.width = 200; c.height = 100; c.getContext('2d').fillRect(0, 0, 200, 100);
  const b = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], '그림.png', { type: 'image/png' }));
  const inp = document.getElementById('attach-input'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return true;`)
await until("document.querySelectorAll('#attach-chips .att-name').length === 1")
await send('그림 설명')
await until('__relay.length === 2', 15000)
const r2 = await ev('return __relay[1] && { n: (__relay[1].body.images || []).length, mime: __relay[1].body.images && __relay[1].body.images[0].mimeType, has: !!(__relay[1].body.images && __relay[1].body.images[0].dataBase64) }')
ok('이미지는 images[{mimeType,dataBase64}]로', r2 && r2.n === 1 && r2.mime === 'image/png' && r2.has, r2)
await until("!__drForms.state.busy")

// 401이면 세션을 갱신해 한 번 더
await ev("window.__mode = '401'; return true"); await send('다시')
await until('__relay.length === 4', 15000)
const r4 = await ev('return __relay[3] && __relay[3].headers.Authorization')
ok('401 뒤 새 토큰으로 다시 보냄', r4 === 'Bearer t2', r4)
await until("!__drForms.state.busy")

// 서버가 닫혔을 때 서버 문구를 그대로
await ev("window.__mode = '403'; return true"); await send('닫힘')
ok('서버 종료 안내가 보임', await replies('/개인 Gemini 키를 등록/'))
await until("!__drForms.state.busy")

// 로그인 세션이 없으면 보내지 않음
const before = await ev('return __relay.length')
await ev("window.__keep = localStorage.getItem('dr_sess_v1'); localStorage.removeItem('dr_sess_v1'); return true"); await send('세션 없음')
ok('세션 없으면 로그인 안내, 요청 없음', await replies('/교사 로그인이 필요합니다/') && (await ev('return __relay.length')) === before)
await ev("localStorage.setItem('dr_sess_v1', window.__keep); return true")
await until("!__drForms.state.busy")

// ── 2. AI 설정 창 ──
await ev("document.getElementById('ai-chip').click(); return true")
ok('설정 창에 서버 선택지가 보이고 골라져 있음', await until("document.querySelector('#drai-modal input[value=server]') && document.querySelector('#drai-modal input[value=server]').checked && document.getElementById('drai-srv-choice').style.display !== 'none'"))
ok('서버를 고르면 연결 확인 단추를 감춤', await ev("return document.getElementById('drai-test').style.display === 'none' && /12월 12일/.test(document.getElementById('drai-srv-help').textContent)"))
await ev(`const g = document.querySelector('#drai-modal input[value=gemini]'); g.checked = true; g.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('drai-gem-key').value = 'fake-key'; document.getElementById('drai-save').click(); return true;`)
ok('개인 연결로 바꾸면 이름이 바뀜', await until("/^AI: Gemini/.test(document.getElementById('ai-chip').textContent)"), await ev("return document.getElementById('ai-chip').textContent"))
ok('선택은 따로 적고 개인 설정은 gemini', await ev("return localStorage.getItem('dr_forms_ai_v1') === 'personal' && JSON.parse(localStorage.getItem('dr_tt_llm_v1')).provider === 'gemini'"))
const nRelay = await ev('return __relay.length')
await send('개인 연결')
ok('개인 연결은 서버를 부르지 않음', await replies('/제미나이 답/') && (await ev('return __relay.length')) === nRelay)
await until("!__drForms.state.busy")
await ev(`document.getElementById('ai-chip').click(); const s = document.querySelector('#drai-modal input[value=server]'); s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('drai-save').click(); return true;`)
ok('다시 서버를 고르면 개인 설정에 server를 쓰지 않음', await until("document.getElementById('ai-chip').textContent === 'AI: 서버 AI (Claude)'") && await ev("return localStorage.getItem('dr_forms_ai_v1') === 'server' && JSON.parse(localStorage.getItem('dr_tt_llm_v1')).provider === 'gemini'"))

// ── 3. 양식 목록과 기본 양식 열기 ──
const cards = await ev("return [...document.querySelectorAll('#form-cards .form-card')].map((c) => c.textContent)")
ok('양식 카드 12개', cards.length === 12, cards)
ok('평가 운영 계획 카드에 입력 화면 표시', cards.some((c) => /교수학습·평가 운영 계획/.test(c) && /입력 화면/.test(c)), cards[0])
const ids = await ev("return window.DR_FORMS.filter((f) => f.template).map((f) => f.id)")
for (const id of ids) {
  const r = await ev(`const t = await __drForms.openForm(${JSON.stringify(id)}, { quiet: true });
    if (!t) return { err: '열지 못함' };
    const hwpx = await __drForms.state.editor.exportHwpx(); const doc = await DrHwpxDoc.open(hwpx);
    return { loaded: __drForms.state.editorTabId === t.id, items: Object.keys(doc.items).length, tables: Object.keys(doc.tables).length, name: t.form.fileName(doc), guide: t.form.guide.length };`)
  ok('양식 열기: ' + id, r && r.loaded && r.items > 5 && r.tables >= 1 && /\.hwpx$/.test(r.name) && r.guide > 100, r)
}

// ── 4. 입력 화면이 있는 양식(겹침 창) ──
const tabsBefore = await ev('return __drForms.state.tabs.length')
await ev("document.querySelector('#form-cards .form-card').click(); return true")
ok('카드를 누르면 겹침 창이 뜸', await until("document.querySelector('.app-form') && !document.querySelector('.app-form').hidden && /\\/evalplan\\/\\?embed=forms$/.test(document.querySelector('.app-form iframe').src)"))
ok('창에 이름과 닫기 단추', await ev("const w = document.querySelector('.app-form'); return w.getAttribute('role') === 'dialog' && w.getAttribute('aria-label') === '교수학습·평가 운영 계획' && document.activeElement === w.querySelector('.app-form-x')"))
const frame = () => "document.querySelector('.app-form iframe').contentWindow"
await until(frame() + '.__send')
const stubId = await ev('return ' + frame() + '.__id')

// 다른 창이 보낸 가짜 메시지는 무시
await ev("window.postMessage({ type: 'dr-forms-open', v: 1, name: '가짜.hwpx', bytes: new Uint8Array([0x50, 0x4b, 3, 4]).buffer }, location.origin); return true")
await sleep(500)
ok('우리가 띄운 창이 아닌 메시지는 무시', (await ev('return __drForms.state.tabs.length')) === tabsBefore)

// 한글 파일이 아니면 거절
await ev(frame() + ".__send('bad'); return true")
ok('잘못된 파일은 거절하고 이유를 답함', await until(frame() + '.__replies.length === 1') && await ev('const r = ' + frame() + ".__replies[0]; return r.ok === false && /한글/.test(r.message)"), await ev('return ' + frame() + '.__replies'))
ok('거절하면 창은 그대로', await ev("return !document.querySelector('.app-form').hidden"))

// 정상 파일
await ev(frame() + ".__send('ok'); return true")
ok('파일을 받으면 ok를 답함', await until(frame() + '.__replies.length === 2', 20000) && await ev('return ' + frame() + '.__replies[1].ok === true'), await ev('return ' + frame() + '.__replies'))
const opened = await ev(`const s = __drForms.state, t = s.tabs[s.tabs.length - 1];
  return { n: s.tabs.length, name: t.name, kind: t.kind, target: s.targetId === t.id, active: s.activeId === t.id, guide: /성취기준/.test(t.form.guide), file: t.form.fileName(), hidden: document.querySelector('.app-form').hidden };`)
ok('한글 탭으로 열리고 고칠 문서가 됨', opened.n === tabsBefore + 1 && opened.kind === 'hwp' && opened.target && opened.active && opened.name === '2026학년도 통합사회 평가 운영 계획', opened)
ok('평가 계획 작성 기준이 붙고 파일 이름을 지킴', opened.guide && opened.file === '2026학년도 통합사회 평가 운영 계획.hwpx', opened)
ok('겹침 창이 닫힘', opened.hidden === true)
ok('대화에 안내가 남음', await replies('/문서를 열었습니다/'))

// 받은 문서를 서버 AI로 고치기
const n0 = await ev('return __relay.length')
await send('제목을 다듬어 줘')
await until('__relay.length === ' + (n0 + 1), 20000)
ok('받은 문서의 지도와 작성 기준을 서버로 보냄', await ev(`const p = __relay[__relay.length - 1].body.prompt; return /\\[문서 현재 내용\\]/.test(p) && /배점의 합은 100점/.test(p)`))
await until("!__drForms.state.busy")

// 다시 열면 같은 화면, Esc로 닫기
await ev("document.getElementById('btn-forms').click(); return true")
await until("!document.getElementById('start').hidden")
await ev("document.querySelector('#form-cards .form-card').click(); return true")
ok('다시 열면 하던 화면이 그대로', await until("!document.querySelector('.app-form').hidden") && (await ev('return ' + frame() + '.__id')) === stubId && (await ev("return document.querySelectorAll('.app-form').length")) === 1)
await ev("document.querySelector('.app-form-x').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true")
ok('Esc로 닫힘', await until("document.querySelector('.app-form').hidden"))

// 좁은 화면
await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 700, deviceScaleFactor: 1, mobile: true })
await ev("document.getElementById('btn-forms').click(); return true"); await sleep(300)
await ev("__drForms.openForm('evalplan'); return true")
await until("!document.querySelector('.app-form').hidden")
const m = await ev(`const x = document.querySelector('.app-form-x').getBoundingClientRect(), w = document.querySelector('.app-form').getBoundingClientRect(), f = document.querySelector('.app-form iframe').getBoundingClientRect();
  return { xh: x.height, xr: x.right, ww: w.width, fh: f.height, sw: document.documentElement.scrollWidth };`)
ok('375px: 닫기 단추 44px 이상, 넘침 없음', m.xh >= 44 && m.xr <= 375 && m.ww <= 375 && m.fh > 500, m)

// ── 5. 로그인 상태 표시와 잠금 ──
await ev("document.querySelector('.app-form-x').click(); return true")
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
ok('로그인하면 상태 표시가 로그인됨', await ev("const c = document.getElementById('auth-chip'); return c.dataset.state === 'ok' && /로그인됨/.test(c.textContent) && document.getElementById('auth-bar').hidden && !document.body.classList.contains('locked')"), await ev("return document.getElementById('auth-chip').textContent"))
await ev("window.__keep2 = localStorage.getItem('dr_sess_v1'); localStorage.removeItem('dr_sess_v1'); window.dispatchEvent(new StorageEvent('storage', { key: 'dr_sess_v1' })); return true")
ok('로그아웃되면 화면은 남고 안내 띠가 보임', await until("document.getElementById('auth-chip').dataset.state === 'none'") && await ev("return !document.getElementById('app').hidden && !document.getElementById('auth-bar').hidden && document.body.classList.contains('locked') && document.getElementById('prompt').disabled"))
ok('로그인 주소에 돌아올 경로가 있음', await ev("return document.getElementById('auth-bar-login').getAttribute('href') === '/?gate_return=' + encodeURIComponent('/forms/index.html') + '#login'"), await ev("return document.getElementById('auth-bar-login').getAttribute('href')"))
const lockedTabs = await ev('return __drForms.state.tabs.length')
await ev("document.getElementById('btn-forms').click(); return true"); await sleep(200)
await ev("const c = document.querySelector('#form-cards .form-card'); if (c) c.click(); document.getElementById('btn-new-hwp').click(); document.getElementById('btn-send').click(); return true"); await sleep(500)
ok('잠긴 동안 양식·새 문서·보내기가 동작하지 않음', (await ev('return __drForms.state.tabs.length')) === lockedTabs && await ev("return !document.querySelector('.app-form:not([hidden])')"))
ok('잠긴 단추를 누르면 로그인 단추로 초점 이동', await ev("return document.activeElement && document.activeElement.id === 'auth-bar-login'"))
await ev("localStorage.setItem('dr_sess_v1', window.__keep2); window.dispatchEvent(new StorageEvent('storage', { key: 'dr_sess_v1' })); return true")
ok('다시 로그인하면 잠금이 풀림', await until("document.getElementById('auth-chip').dataset.state === 'ok' && !document.body.classList.contains('locked') && !document.getElementById('prompt').disabled"))

ok('화면 예외 없음', logs.length === 0, logs)
console.log(`forms server·embed smoke: ${pass}/${pass + fail} PASS`)
ws.close(); chrome.kill(); server.close()
process.exit(fail ? 1 : 0)
