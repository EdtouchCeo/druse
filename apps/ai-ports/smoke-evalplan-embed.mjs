// /evalplan/의 문서작성 AI 안 모드(?embed=forms) 시험. 헤드리스 Chrome으로 output/web을 띄운다(AI 호출 없음).
// 사용: node apps/ai-ports/smoke-evalplan-embed.mjs --edtouch <edtouch01 저장소>
//  - 같은 오리진의 시험용 부모 페이지(/__embed-parent.html, 이 스크립트가 메모리에서 답함)가 iframe으로 화면을 연다.
//  - 부모는 받은 메시지를 window.__msgs에 모으고 window.__mode에 따라 답한다(ok·fail·none).
//  - none일 때는 옆 iframe(같은 오리진, 부모가 아님)이 가짜 dr-forms-opened를 보낸다. 화면은 이것을 무시해야 한다.
//  - 단독 화면 회귀는 smoke-evalplan-form.mjs가 본다.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const EDTOUCH = arg('--edtouch')
if (!EDTOUCH) throw new Error('--edtouch <edtouch01 저장소>가 필요합니다.')
const { fixtureA } = await import(pathToFileURL(resolve(EDTOUCH, '_workspace/evalplan_form_fixtures.mjs')).href)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'output', 'web')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const HTTP = 8798
const CDP = 9336
const BASE = `http://127.0.0.1:${HTTP}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PARENT = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}#other{display:none}</style></head><body>
<iframe id="ep" title="평가 운영 계획" src="/evalplan/?embed=forms"></iframe>
<iframe id="other" src="about:blank"></iframe>
<script>
window.__msgs = []; window.__mode = 'ok'; window.__fakeSent = 0;
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  const fromEp = ev.source === document.getElementById('ep').contentWindow;
  const rec = { type: d.type, v: d.v, name: d.name, fromEp, origin: ev.origin };
  if (d.bytes) {
    rec.isArrayBuffer = d.bytes instanceof ArrayBuffer;
    rec.byteLength = d.bytes.byteLength;
    rec.head = Array.from(new Uint8Array(d.bytes, 0, Math.min(64, d.bytes.byteLength)));
  }
  window.__msgs.push(rec);
  if (d.type !== 'dr-forms-open') return;
  if (window.__mode === 'ok') ev.source.postMessage({ type: 'dr-forms-opened', v: 1, ok: true }, location.origin);
  else if (window.__mode === 'fail') ev.source.postMessage({ type: 'dr-forms-opened', v: 1, ok: false, message: '시험용 실패 안내입니다.' }, location.origin);
  else {
    // 부모가 아닌 같은 오리진 창(about:blank는 부모 오리진을 물려받는다)이 가짜 성공을 보낸다.
    // 오리진 검사는 통과하므로 보낸 창(source) 검사만으로 걸러져야 한다.
    const other = document.getElementById('other').contentWindow;
    window.__fakeSent++;
    other.eval("parent.document.getElementById('ep').contentWindow.postMessage({ type: 'dr-forms-opened', v: 1, ok: true }, '*')");
  }
});
</script></body></html>`

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.hwpx': 'application/hwp+zip' }
const server = createServer((req, res) => {
  const p0 = decodeURIComponent(new URL(req.url, BASE).pathname)
  if (p0 === '/__embed-parent.html') {
    res.writeHead(200, { 'content-type': MIME['.html'] })
    return res.end(PARENT)
  }
  const file = normalize(join(ROOT, p0.endsWith('/') ? p0 + 'index.html' : p0))
  try {
    if (!file.startsWith(ROOT) || !statSync(file).isFile()) throw new Error()
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((r) => server.listen(HTTP, '127.0.0.1', r))

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' })

let wsUrl
for (let i = 0; i < 50 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch { /* 아직 안 뜸 */ }
  if (!wsUrl) await sleep(200)
}
const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { ok, no } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) no(new Error(JSON.stringify(m.error)))
    else ok(m.result)
  } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
})
const send = (method, params = {}) => new Promise((ok, no) => {
  const id = ++seq
  pending.set(id, { ok, no })
  ws.send(JSON.stringify({ id, method, params }))
})
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
// iframe 안의 문서를 d로 쓴다(같은 오리진).
const fjs = (body) => js(`(() => { const F = document.getElementById('ep').contentWindow; const d = F && F.document; if (!d) return null; ${body} })()`)
await send('Page.enable')
await send('Runtime.enable')

let failed = 0
let passed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` -- ${detail}` : ''}`)
  if (ok) passed++
  else failed++
}
const waitFor = async (fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true
    await sleep(100)
  }
  return false
}
const width = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 })

const fx = fixtureA()
const saved = {
  v: 1,
  savedAt: Date.now(),
  form: { schoolGrade: fx.brief.schoolGrade, subject: fx.brief.subject, standardsText: fx.brief.standards.join('\n'), artsPE: false, totalLessons: 12 },
  brief: fx.brief,
  outputs: fx.outputs,
  edits: {},
  warnings: {},
  stale: {},
}

const DLG = '[aria-labelledby=ep-forminfo-title]'
async function openDialog(mode) {
  await send('Page.navigate', { url: `${BASE}/favicon.ico` })
  await sleep(200)
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('evalplan:auto', ${JSON.stringify(JSON.stringify(saved))}); true`)
  await send('Page.navigate', { url: `${BASE}/__embed-parent.html` })
  await waitFor(() => js('typeof window.__msgs === "object"'))
  await js(`window.__mode = ${JSON.stringify(mode)}; true`)
  await waitFor(() => fjs('return !!d.querySelector("#app > *")'))
  await sleep(500)
  await fjs(`[...d.querySelectorAll('button')].find((b) => b.innerText.includes('이어서 보기'))?.click(); return true`)
  await waitFor(() => fjs('return d.querySelectorAll("[data-export-format]").length > 0'))
  await fjs(`d.querySelector('[data-export-format=hwpx]').click(); return true`)
  return waitFor(() => fjs(`return !!d.querySelector('${DLG}')`), 3000)
}
const clickOpen = () => fjs(`d.querySelector('[data-forms-open]').click(); return true`)
const alertText = () => fjs(`return [...d.querySelectorAll('${DLG} [role=alert]')].map((e) => e.innerText.trim()).join(' | ')`)

for (const w of [1440, 320]) {
  console.log(`\n[evalplan embed] ${w}px`)
  await width(w)

  // (b) 화면 모양과 성공 왕복
  check('양식 정보 창 열림(embed)', await openDialog('ok'))
  const ready = JSON.parse(await js('JSON.stringify(window.__msgs.filter((m) => m.type === "dr-forms-ready"))'))
  check('준비 신호 1회(dr-forms-ready, v1, 부모 오리진)', ready.length === 1 && ready[0].v === 1 && ready[0].fromEp && ready[0].origin === BASE, JSON.stringify(ready))
  const shell = JSON.parse(await fjs(`return JSON.stringify({ header: !!d.querySelector('header img[alt="대륜고등학교"]'), footer: d.body.innerText.includes('개발 및 운영') })`))
  check('상단 사이트 띠 없음', !shell.header)
  check('푸터 없음', !shell.footer)
  const btns = JSON.parse(await fjs(`return JSON.stringify([...d.querySelectorAll('${DLG} button')].map((b) => ({ t: b.innerText.trim(), h: b.getBoundingClientRect().height, open: b.hasAttribute('data-forms-open') })))`))
  const openBtn = btns.find((b) => b.open)
  check('문서작성 AI에서 열기 단추', !!openBtn && openBtn.t === '문서작성 AI에서 열기', JSON.stringify(btns))
  check('단추 높이 44px 이상', !!openBtn && openBtn.h >= 44, JSON.stringify(openBtn))
  const footBtns = btns.filter((b) => ['문서작성 AI에서 열기', '한글 파일 받기', '닫기'].includes(b.t)).map((b) => b.t)
  check('주 단추가 먼저, 한글 파일 받기 유지', footBtns[0] === '문서작성 AI에서 열기' && footBtns.includes('한글 파일 받기'), JSON.stringify(footBtns))
  check(`${w}px 가로 넘침 없음(창)`, await fjs('return d.documentElement.scrollWidth <= d.documentElement.clientWidth'))
  const fits = await fjs(`const r = d.querySelector('${DLG} > div').getBoundingClientRect(); return r.left >= 0 && r.right <= d.documentElement.clientWidth`)
  check(`${w}px 창이 화면 안에 들어감`, fits)
  const lines = await fjs(`const b = d.querySelector('[data-forms-open]'); const r = b.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(b).lineHeight) || 20; return r.height < lh * 2 + 24`)
  check(`${w}px 단추 글자 한 줄`, lines)

  await clickOpen()
  const gotOpen = await waitFor(() => js('window.__msgs.some((m) => m.type === "dr-forms-open")'), 15000)
  const msg = JSON.parse(await js('JSON.stringify(window.__msgs.find((m) => m.type === "dr-forms-open") || null)'))
  check('dr-forms-open 받음', gotOpen && !!msg)
  if (msg) {
    check('type·v·보낸 창', msg.v === 1 && msg.fromEp && msg.origin === BASE, JSON.stringify({ v: msg.v, fromEp: msg.fromEp, origin: msg.origin }))
    check('name이 .hwpx', typeof msg.name === 'string' && msg.name.length > 5 && msg.name.endsWith('.hwpx'), msg.name)
    check('bytes가 ArrayBuffer', msg.isArrayBuffer && msg.byteLength > 1000, JSON.stringify({ isAB: msg.isArrayBuffer, len: msg.byteLength }))
    const h = msg.head || []
    check('zip 서명 PK', h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04)
    const nlen = (h[26] | (h[27] << 8))
    const first = String.fromCharCode(...h.slice(30, 30 + nlen))
    check('첫 항목이 mimetype', first === 'mimetype', first)
  }
  check('성공 답에 창 닫힘', await waitFor(() => fjs(`return !d.querySelector('${DLG}')`), 5000))

  // (c) 실패 답
  check('양식 정보 창 열림(fail)', await openDialog('fail'))
  await clickOpen()
  check('실패 안내 보임', await waitFor(async () => (await alertText()).includes('시험용 실패 안내입니다.'), 15000), await alertText())
  check('실패 뒤 창 유지', await fjs(`return !!d.querySelector('${DLG}')`))
  check('실패 뒤 단추 다시 누를 수 있음', await fjs(`const b = d.querySelector('[data-forms-open]'); return !b.disabled && b.getAttribute('aria-busy') !== 'true'`))

  // (d) 다른 창의 가짜 답 무시 + 20초 시간 초과
  check('양식 정보 창 열림(none)', await openDialog('none'))
  await clickOpen()
  await waitFor(() => js('window.__fakeSent > 0'), 15000)
  await sleep(800)
  check('가짜 dr-forms-opened 보냄', await js('window.__fakeSent === 1'))
  check('가짜 답에 창이 닫히지 않음', await fjs(`return !!d.querySelector('${DLG}')`))
  check('보내는 동안 단추 잠금·aria-busy', await fjs(`const b = d.querySelector('[data-forms-open]'); return b.disabled && b.getAttribute('aria-busy') === 'true'`))
  check('보내는 동안 안내 없음', (await alertText()) === '')
  const timedOut = await waitFor(async () => (await alertText()).includes('문서작성 AI가 응답하지 않습니다. 한글 파일 받기로 내려받은 뒤 문서작성 AI에 올려 주세요.'), 25000)
  check('20초 뒤 시간 초과 안내', timedOut, await alertText())
  check('시간 초과 뒤 창 유지·잠금 풀림', await fjs(`const b = d.querySelector('[data-forms-open]'); return !!b && !b.disabled`))
}

// (a) 부모 없이 ?embed=forms만 붙인 단독 열기는 단독 화면 그대로
console.log('\n[evalplan] 부모 없는 ?embed=forms')
await width(1440)
await send('Page.navigate', { url: `${BASE}/evalplan/?embed=forms` })
await waitFor(() => js('!!document.querySelector("#app > *")'))
await sleep(500)
await js(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('이어서 보기'))?.click(); true`)
await waitFor(() => js('document.querySelectorAll("[data-export-format]").length > 0'))
check('상단 띠 있음', await js('!!document.querySelector(\'header img[alt="대륜고등학교"]\')'))
check('푸터 있음', await js('document.body.innerText.includes("개발 및 운영")'))
await js(`document.querySelector('[data-export-format=hwpx]').click(); true`)
await waitFor(() => js(`!!document.querySelector('${DLG}')`), 3000)
check('문서작성 AI에서 열기 단추 없음', await js(`!document.querySelector('[data-forms-open]') && !document.querySelector('${DLG}').innerText.includes('문서작성 AI')`))

check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '))
console.log(failed ? `\n${passed}건 통과, ${failed}건 실패` : `\n전부 통과(${passed}건)`)
chrome.kill()
server.close()
process.exit(failed ? 1 : 0)
