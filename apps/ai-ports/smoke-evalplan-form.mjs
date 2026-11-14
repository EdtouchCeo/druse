// /evalplan/ 결과 화면의 저장 묶음과 한글 양식 시험. 헤드리스 Chrome으로 output/web을 띄운다(AI 호출 없음).
// 사용: node apps/ai-ports/smoke-evalplan-form.mjs --edtouch <edtouch01 저장소> [--out <폴더>]
//  - 결과 상태는 edtouch01 _workspace/evalplan_form_fixtures.mjs의 fixtureA를 저장본(evalplan:auto)으로 넣어 복원한다.
//  - --out을 주면 내려받은 hwpx를 그 폴더에 쓴다. 한글 확인은 hwp_pdf.py로 따로 한다.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const EDTOUCH = arg('--edtouch')
if (!EDTOUCH) throw new Error('--edtouch <edtouch01 저장소>가 필요합니다.')
const OUT = arg('--out') ? resolve(arg('--out')) : null
if (OUT) mkdirSync(OUT, { recursive: true })
const { fixtureA } = await import(pathToFileURL(resolve(EDTOUCH, '_workspace/evalplan_form_fixtures.mjs')).href)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'output', 'web')
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const HTTP = 8797
const CDP = 9335
const BASE = `http://127.0.0.1:${HTTP}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.hwpx': 'application/hwp+zip' }
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

let hookAdded = false
// 결과 화면을 연다. 내려받기는 가로채 내용을 window.__downloads에 둔다.
async function openResult() {
  await send('Page.navigate', { url: `${BASE}/favicon.ico` })
  await sleep(200)
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('evalplan:auto', ${JSON.stringify(JSON.stringify(saved))});`)
  if (!hookAdded) await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__downloads = [];
      const __create = URL.createObjectURL;
      URL.createObjectURL = (blob) => { const url = __create(blob); window.__downloads.push({ url, blob, size: blob.size, type: blob.type }); return url };
      const __click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { const d = window.__downloads.find((x) => x.url === this.href); if (d) d.name = this.download; return } return __click.call(this) };
      window.open = () => { window.__opened = (window.__opened || 0) + 1; return null };`,
  })
  hookAdded = true
  await send('Page.navigate', { url: `${BASE}/evalplan/` })
  await waitFor('!!document.querySelector("#app > *")')
  await sleep(500)
  await js(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('이어서 보기'))?.click(); true`)
  return waitFor('document.querySelectorAll("[data-export-format]").length > 0')
}

for (const w of [1440, 320]) {
  console.log(`\n[evalplan] 결과 화면 ${w}px`)
  await width(w)
  check('결과 화면 복원', await openResult())
  const labels = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('[data-export-format]')].map((b) => b.innerText.trim()))`))
  // 결과 화면 위·아래 두 곳에 묶음이 있다.
  const uniq = [...new Set(labels)]
  check('묶음 단추는 MD 저장·PDF 저장·한글로 편집만', JSON.stringify(uniq) === JSON.stringify(['MD 저장', 'PDF 저장', '한글로 편집']), JSON.stringify(labels))
  const body = await js('document.body.innerText')
  check('엑셀로 편집·PPT로 편집 없음', !body.includes('엑셀로 편집') && !body.includes('PPT로 편집'))
  check('문서작성 AI 안내 없음', !body.includes('문서작성 AI'))
  check('한글 편집 안내 문구', body.includes('한글로 편집은 양식 모양의 한글 파일을 내려받습니다.'))
  const hrefs = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('a[href]')].map((a) => a.href))`))
  const edtouchLinks = hrefs.filter((h) => h.includes('edtouch.ai'))
  check('결과 화면의 edtouch.ai 링크는 기존 두 곳뿐', edtouchLinks.every((h) => /edtouch\.ai\/#\/(exemplar|wiki)$/.test(h)), JSON.stringify(edtouchLinks))
  check(`${w}px 가로 넘침 없음(결과)`, await noOverflow())

  await js(`document.querySelector('[data-export-format=hwpx]').click(); true`)
  check('양식 정보 창 열림', await waitFor('!!document.querySelector("[aria-labelledby=ep-forminfo-title]")', 3000))
  const dlgText = await js(`document.querySelector('[aria-labelledby=ep-forminfo-title]').innerText`)
  check('창에 한글 파일 받기 단추', dlgText.includes('한글 파일 받기'))
  check('창에 문서작성 AI에서 편집 단추 없음', !dlgText.includes('문서작성 AI'))
  const dlgLinks = await js(`[...document.querySelectorAll('[aria-labelledby=ep-forminfo-title] a')].length`)
  check('창에 링크 없음', dlgLinks === 0)
  check(`${w}px 가로 넘침 없음(창)`, await noOverflow())
  const dlgFits = await js(`(() => { const r = document.querySelector('[aria-labelledby=ep-forminfo-title] > div').getBoundingClientRect(); return r.left >= 0 && r.right <= document.documentElement.clientWidth })()`)
  check(`${w}px 창이 화면 안에 들어감`, dlgFits)
  if (w === 1440 && process.argv.includes('--shots')) {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT || tmpdir(), `evalplan-forminfo-${w}.png`), Buffer.from(r.data, 'base64'))
  }

  const before = served.length
  await js(`[...document.querySelectorAll('[aria-labelledby=ep-forminfo-title] button')].find((b) => b.innerText.includes('한글 파일 받기')).click(); true`)
  const got = await waitFor('window.__downloads.some((d) => d.name && d.name.endsWith(".hwpx"))', 15000)
  check('한글 파일 받기로 hwpx 내려받음', got, JSON.stringify(await js('JSON.stringify(window.__downloads.map((d) => ({ name: d.name, size: d.size })))')))
  const tpl = served.slice(before).filter((s) => s.path.includes('task1.hwpx'))
  check('틀 요청 200(/evalplan/evalplan-forms/2026/task1.hwpx)', tpl.length > 0 && tpl.every((s) => s.status === 200 && s.path === '/evalplan/evalplan-forms/2026/task1.hwpx'), JSON.stringify(tpl))
  check('새 탭 열기 0회', !(await js('window.__opened || 0')))
  if (got) {
    const b64 = await js(`(async () => { const d = window.__downloads.find((x) => x.name && x.name.endsWith('.hwpx')); const u8 = new Uint8Array(await d.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return JSON.stringify({ name: d.name, data: btoa(s) }) })()`)
    const { name, data } = JSON.parse(b64)
    const bytes = Buffer.from(data, 'base64')
    check('hwpx가 zip(PK)로 시작', bytes[0] === 0x50 && bytes[1] === 0x4b)
    if (OUT) {
      const file = join(OUT, `${w}-${name}`)
      writeFileSync(file, bytes)
      console.log(`  저장: ${file} (${bytes.length} bytes)`)
    }
  }
}

check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '))
console.log(failed ? `\n${failed}건 실패` : '\n전부 통과')
chrome.kill()
server.close()
process.exit(failed ? 1 : 0)
