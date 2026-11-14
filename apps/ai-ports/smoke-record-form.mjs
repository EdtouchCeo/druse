// /record/ 누적 결과 표의 엑셀 양식 내려받기와 저장 묶음 시험. 헤드리스 Chrome으로 output/web을 띄운다(AI 호출 없음).
// 사용: node apps/ai-ports/smoke-record-form.mjs [--out <폴더>]
//  - 누적 결과는 localStorage(edtouch-record-sebak-v1)에 시험용 두 줄을 넣어 만든다.
//  - --out을 주면 내려받은 xlsx·md를 그 폴더에 쓴다. 양식 모양은 openpyxl로 따로 확인한다.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const OUT = arg('--out') ? resolve(arg('--out')) : null
if (OUT) mkdirSync(OUT, { recursive: true })

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'output', 'web')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const HTTP = 8798
const CDP = 9336
const BASE = `http://127.0.0.1:${HTTP}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.hwpx': 'application/hwp+zip', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
const served = []
const server = createServer((req, res) => {
  const p0 = decodeURIComponent(new URL(req.url, BASE).pathname)
  const file = normalize(join(ROOT, p0.endsWith('/') ? p0 + 'index.html' : p0))
  try {
    if (!file.startsWith(ROOT) || !statSync(file).isFile()) throw new Error()
    served.push({ path: p0, status: 200 })
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
  } catch {
    served.push({ path: p0, status: 404 })
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
await send('Page.enable')
await send('Runtime.enable')

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` -- ${detail}` : ''}`)
  if (!ok) failed++
}
const waitFor = async (expr, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await js(expr)) return true
    await sleep(100)
  }
  return false
}
const width = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 })
const noOverflow = () => js('document.documentElement.scrollWidth <= document.documentElement.clientWidth')


const now = Date.now()
const ROWS = [
  { id: 'r1', classNo: '1-1-1', name: '학생 가', body: '탐구 주제를 스스로 정하고 자료를 비교하며 결론을 정리하였음.', chars: 33, bytes: 90, byteLimit: 1500, competencies: [], createdAt: now, updatedAt: now },
  { id: 'r2', classNo: '1-1-2', name: '학생 나', body: '모둠 토의에서 근거를 들어 의견을 조정하고 발표 자료를 완성함.', chars: 34, bytes: 92, byteLimit: 1500, competencies: [], createdAt: now, updatedAt: now },
]

let hookAdded = false
async function openTable() {
  await send('Page.navigate', { url: `${BASE}/favicon.ico` })
  await sleep(200)
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('edtouch-record-sebak-v1', ${JSON.stringify(JSON.stringify(ROWS))});`)
  if (!hookAdded) await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__downloads = [];
      const __create = URL.createObjectURL;
      URL.createObjectURL = (blob) => { const url = __create(blob); window.__downloads.push({ url, blob, size: blob.size, type: blob.type }); return url };
      const __click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { const d = window.__downloads.find((x) => x.url === this.href); if (d) d.name = this.download; return } return __click.call(this) };
      window.open = () => { window.__opened = (window.__opened || 0) + 1; return null };`,
  })
  hookAdded = true
  await send('Page.navigate', { url: `${BASE}/record/#/sebak` })
  await waitFor('!!document.querySelector("#app > *")')
  return waitFor('!!document.querySelector("[data-record-form-settings]")')
}

const setValue = (selector, value) => js(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error('없음: ' + ${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`)

async function saveDownload(ext, prefix) {
  const b64 = await js(`(async () => { const d = [...window.__downloads].reverse().find((x) => x.name && x.name.endsWith('${ext}')); if (!d) return null; const u8 = new Uint8Array(await d.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return JSON.stringify({ name: d.name, data: btoa(s) }) })()`)
  if (!b64) return null
  const { name, data } = JSON.parse(b64)
  const bytes = Buffer.from(data, 'base64')
  if (OUT) {
    const file = join(OUT, `${prefix}-${name}`)
    writeFileSync(file, bytes)
    console.log(`  저장: ${file} (${bytes.length} bytes)`)
  }
  return { name, bytes }
}

for (const w of [1440, 320]) {
  console.log(`\n[record] 누적 결과 ${w}px`)
  await width(w)
  check('누적 결과 표 표시', await openTable())
  const yearInput = await js(`!!document.querySelector('[data-record-form-settings] input[inputmode=numeric]')`)
  const statusInput = await js(`!!document.querySelector('[data-record-status]')`)
  check('학년도 입력 보임', yearInput)
  check('학적변동 구분 입력 보임', statusInput)
  await setValue('[data-record-form-settings] input[inputmode=numeric]', '2026')
  await setValue('[data-record-status]', '재학')
  const body = await js('document.body.innerText')
  check('엑셀 내려받기 단추 보임', body.includes('엑셀 내려받기'))
  const labels = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('[data-record-export-bundle] [data-export-format]')].map((b) => b.innerText.trim()))`))
  check('표 아래 묶음은 MD 저장만', JSON.stringify(labels) === JSON.stringify(['MD 저장']), JSON.stringify(labels))
  check('문서작성 AI 문구 없음', !body.includes('문서작성 AI'))
  check('엑셀로 편집·한글로 편집·PPT로 편집 없음', !/엑셀로 편집|한글로 편집|PPT로 편집/.test(body))
  const edtouch = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.includes('edtouch.ai')))`))
  check('화면에 edtouch.ai 링크 없음', edtouch.length === 0, JSON.stringify(edtouch))
  check(`${w}px 가로 넘침 없음`, await noOverflow())

  const before = served.length
  await js(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('엑셀 내려받기')).click(); true`)
  const got = await waitFor('window.__downloads.some((d) => d.name && d.name.endsWith(".xlsx"))', 15000)
  check('엑셀 내려받기로 xlsx 내려받음', got, await js('JSON.stringify(window.__downloads.map((d) => ({ name: d.name, size: d.size })))'))
  const tpl = served.slice(before).filter((s) => s.path.includes('record-form.xlsx'))
  check('양식 요청 200(/record/record-forms/2026/record-form.xlsx)', tpl.length > 0 && tpl.every((s) => s.status === 200 && s.path === '/record/record-forms/2026/record-form.xlsx'), JSON.stringify(tpl))
  if (got) {
    const file = await saveDownload('.xlsx', w)
    check('xlsx가 zip(PK)로 시작', file && file.bytes[0] === 0x50 && file.bytes[1] === 0x4b)
  }

  await js(`document.querySelector('[data-record-export-bundle] [data-export-format=md]').click(); true`)
  const gotMd = await waitFor('window.__downloads.some((d) => d.name && d.name.endsWith(".md"))', 5000)
  check('MD 저장으로 md 내려받음', gotMd)
  if (gotMd) {
    const md = await saveDownload('.md', w)
    const text = md ? md.bytes.toString('utf8') : ''
    check('md에 학생 두 줄', text.includes('학생 가') && text.includes('학생 나'))
  }
  check('새 탭 열기 0회', !(await js('window.__opened || 0')))
  if (process.argv.includes('--shots')) {
    await js(`document.querySelector('[data-record-form-settings]').scrollIntoView(); true`)
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT || tmpdir(), `record-table-${w}.png`), Buffer.from(r.data, 'base64'))
  }
}

check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '))
console.log(failed ? `\n${failed}건 실패` : '\n전부 통과')
chrome.kill()
server.close()
process.exit(failed ? 1 : 0)
