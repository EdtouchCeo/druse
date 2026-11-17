// 문서작성 AI(/forms/)와 실제 /evalplan/ 빌드를 붙여 돌리는 왕복 시험.
// 평가 계획 결과는 edtouch01 _workspace/evalplan_form_fixtures.mjs의 저장본으로 만든다(AI 호출 없음).
// 실행: node tests/forms-evalplan-roundtrip.browser.mjs <edtouch01 저장소>
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { fixtureA } = await import(pathToFileURL(path.resolve(process.argv[2], '_workspace/evalplan_form_fixtures.mjs')).href)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../output/web')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
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
// 저장본은 따로 넣는다(boot 문자열 안에 넣으면 역슬래시가 깨진다).
const fx = fixtureA()
const saved = {
  v: 1, savedAt: Date.now(),
  form: { schoolGrade: fx.brief.schoolGrade, subject: fx.brief.subject, standardsText: fx.brief.standards.join('\n'), artsPE: false, totalLessons: 12 },
  brief: fx.brief, outputs: fx.outputs, edits: {}, warnings: {}, stale: {},
}
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'if (!localStorage.getItem("evalplan:auto")) localStorage.setItem("evalplan:auto", ' + JSON.stringify(JSON.stringify(saved)) + ');' })
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/forms/index.html` })
ok('화면이 뜸', await until("!document.getElementById('app').hidden && window.__drForms && document.querySelectorAll('#form-cards .form-card').length", 20000))
if (!pass) { console.log(logs, await ev('return document.title')); process.exit(1) }
const send = (text) => ev(`document.getElementById('prompt').value = ${JSON.stringify(text)}; document.getElementById('btn-send').click(); return true;`)
const replies = (re) => until(`[...document.querySelectorAll('#chat-log .msg')].some((m) => ${re}.test(m.textContent))`, 15000)


const F = "document.querySelector('.app-form iframe').contentDocument"
const fclick = (sel) => ev(`const d = ${F}; const b = ${sel}; if (!b) return false; b.click(); return true;`)
await ev("document.querySelector('#form-cards .form-card').click(); return true")
ok('겹침 창에 실제 평가 계획 화면이 뜸', await until(`${F} && ${F}.querySelectorAll('button').length > 2`, 20000), await ev(`const d = ${F}; return { href: d && d.location.href, n: d && d.querySelectorAll('button').length, text: d && d.body && d.body.innerText.slice(0, 200) }`))
ok('안쪽 화면에 사이트 띠와 푸터가 없음', await ev(`const d = ${F}; return !d.querySelector('header img[alt="대륜고등학교"]') && !d.body.innerText.includes('개발 및 운영')`))
await until(`[...${F}.querySelectorAll('button')].some((b) => b.innerText.includes('이어서 보기'))`, 10000)
await fclick("[...d.querySelectorAll('button')].find((b) => b.innerText.includes('이어서 보기'))")
ok('저장된 계획이 열림', await until(`${F}.querySelector('[data-export-format=hwpx]')`, 15000))
await fclick("d.querySelector('[data-export-format=hwpx]')")
ok('양식 정보 창에 문서작성 AI에서 열기', await until(`${F}.querySelector('[data-forms-open]')`, 10000))
const before = await ev('return __drForms.state.tabs.length')
await fclick("d.querySelector('[data-forms-open]')")
ok('문서작성 AI에 한글 탭이 열림', await until('__drForms.state.tabs.length === ' + (before + 1) + " && document.querySelector('.app-form').hidden", 30000), await ev(`return { n: __drForms.state.tabs.length, hidden: document.querySelector('.app-form').hidden, alert: (${F}.querySelector('[role=alert]') || {}).innerText }`))
const got = await ev(`const s = __drForms.state, t = s.tabs[s.tabs.length - 1]; await new Promise((r) => setTimeout(r, 500));
  const doc = await DrHwpxDoc.open(await s.editor.exportHwpx()); const map = doc.toPrompt();
  return { name: t.name, target: s.targetId === t.id, loaded: s.editorTabId === t.id, tables: Object.keys(doc.tables).length, len: map.length, readonly: map.split(String.fromCharCode(10)).filter((l) => l.includes('수정 불가')).length, items: Object.keys(doc.items).length };`)
ok('받은 문서가 편집기에 올라가고 고칠 문서가 됨', got.target && got.loaded && got.tables >= 5 && got.items > 30, got)
console.log('문서:', JSON.stringify(got))
ok('양식 정보 창이 닫힘', await until(`!${F}.querySelector('[data-forms-open]')`, 5000))
await ev(`document.getElementById('prompt').value = '3차시 주안점을 다듬어 줘'; document.getElementById('btn-send').click(); return true;`)
await until('__relay.length === 1', 20000)
ok('받은 문서를 서버 AI로 보냄', await ev(`const p = __relay[0].body.prompt; return p.includes('[문서 현재 내용]') && p.includes('배점의 합은 100점') && __relay[0].headers['x-auth-site'] === 'daeryun'`))
ok('화면 예외 없음', logs.length === 0, logs)
console.log(`forms·evalplan roundtrip: ${pass}/${pass + fail} PASS`)
ws.close(); chrome.kill(); server.close()
process.exit(fail ? 1 : 0)
