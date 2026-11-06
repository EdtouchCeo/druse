// /evalplan/·/record/·/backward/ 시험. 헤드리스 Chrome에서 실제 화면을 띄우고 외부 요청은 모두 가로채 가짜로 답한다(AI 호출 없음).
// 사용: node apps/ai-ports/smoke.mjs [스크린샷 폴더]
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'output', 'web')
const SHOTS = process.argv[2]
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const HTTP = 8796
const CDP = 9334
const BASE = `http://127.0.0.1:${HTTP}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }
const proxyCalls = []
const server = createServer((req, res) => {
  const p0 = decodeURIComponent(new URL(req.url, BASE).pathname)
  if (p0.startsWith('/bw-api/')) {
    proxyCalls.push({ url: p0, method: req.method, headers: req.headers })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ step: '1', data: { concepts: [] } }))
    return
  }
  const file = normalize(join(ROOT, p0.endsWith('/') ? p0 + 'index.html' : p0))
  try {
    if (!statSync(file).isFile()) throw new Error()
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
const listeners = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { ok, no } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) no(new Error(JSON.stringify(m.error)))
    else ok(m.result)
  } else if (m.method) listeners.forEach((l) => l(m))
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

const CORS = [
  { name: 'access-control-allow-origin', value: '*' },
  { name: 'access-control-allow-headers', value: 'content-type,authorization,x-auth-site,x-user-gemini-key,apikey' },
  { name: 'access-control-allow-methods', value: 'POST,OPTIONS' },
  { name: 'content-type', value: 'application/json' },
]
let handler = () => ({ status: 500, body: {} })
let calls = []
listeners.push(async (m) => {
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params
    if (request.method === 'OPTIONS') {
      await send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS })
      return
    }
    const call = { url: request.url, headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v])), body: request.postData || '' }
    calls.push(call)
    const out = handler(call)
    if (out.fail) await send('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' })
    else await send('Fetch.fulfillRequest', { requestId, responseCode: out.status, responseHeaders: CORS, body: Buffer.from(JSON.stringify(out.body)).toString('base64') })
  }
})
await send('Page.enable')
await send('Runtime.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*run.app*' }, { urlPattern: '*supabase.co*' }, { urlPattern: '*generativelanguage*' }] })

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
const text = () => js('document.body.innerText')
const shot = async (name) => {
  if (!SHOTS) return
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'))
}
const width = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false })
const noOverflow = () => js('document.documentElement.scrollWidth <= document.documentElement.clientWidth')

const SESSION = { token: 'old-token', refresh_token: 'rt-1', expires_at: Date.now() + 3600_000, user: { name: '시험 교사', role: '교사' } }

async function open(path, storage = {}) {
  calls = []
  await send('Page.navigate', { url: `${BASE}/favicon.ico` })
  await sleep(200)
  await js(`localStorage.clear(); sessionStorage.clear(); ${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))});`).join('')}`)
  await send('Page.navigate', { url: BASE + path })
  await sleep(300)
  await js('location.reload()').catch(() => {})
  await waitFor('!!document.querySelector("#app > *")')
  await sleep(300)
}
const setValue = (selector, value) => js(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error('없음: ' + ${JSON.stringify(selector)});
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
})()`)
const clickText = (label) => js(`(() => {
  const b = [...document.querySelectorAll('button,a')].find((x) => x.innerText.includes(${JSON.stringify(label)}) && !x.disabled);
  if (!b) return false; b.click(); return true;
})()`)
const buttonDisabled = (label) => js(`[...document.querySelectorAll('button')].find((x) => x.innerText.includes(${JSON.stringify(label)}))?.disabled`)
const relay = () => calls.filter((c) => c.url.includes('run.app'))
const refreshes = () => calls.filter((c) => c.url.includes('supabase.co'))
const REFRESH_OK = { status: 200, body: { access_token: 'new-token', refresh_token: 'rt-2', expires_in: 3600 } }
const FORBIDDEN_WORDS = ['승인 교육자', '교육자 회원', 'EdTouch 회원', 'EdTouch 서버 제공', '서버 제공(무료', '서버 제공 기간']

/* ── /evalplan/ ── */
async function fillEvalplan() {
  await setValue('input[placeholder="예: 고등학교 1학년"]', '고등학교 1학년')
  await setValue('input[placeholder="예: 공통국어1"]', '통합사회1')
  await js(`(() => { const t = [...document.querySelectorAll('textarea')][0]; const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(t, '[10통사1-01-01] 시험용 성취기준'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(200)
}

console.log('\n[evalplan] 비로그인')
handler = () => ({ status: 500, body: {} })
await open('/evalplan/')
let t = await text()
check('로그인 안내 표시', t.includes('교사 로그인 후 이용할 수 있습니다'))
check('교사 로그인 링크', await js(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/#login' && a.target === '_blank')`))
check('AI 설정 버튼', t.includes('AI 설정'))
for (const w of FORBIDDEN_WORDS) check(`문구 없음: ${w}`, !t.includes(w))
await fillEvalplan()
check('생성 버튼 잠김', (await buttonDisabled('계획 생성')) === true)
check('생성 버튼 아래 안내', (await text()).includes('교사 로그인을 마치거나'))
await shot('evalplan-guest-1280')
await width(375)
check('375px 가로 넘침 없음', await noOverflow())
await shot('evalplan-guest-375')
await width(1280)
await clickText('AI 설정')
await sleep(300)
t = await text()
check('설정 창에 서버 AI 선택지', t.includes('서버 AI (승인 교사)'))
check('설정 창에 개인 키 선택지', t.includes('Gemini 무료 키') && t.includes('Ollama'))
check('설정 창에 로그인 안내', t.includes('서버 AI는 교사 로그인 후 쓸 수 있습니다'))
for (const w of FORBIDDEN_WORDS) check(`설정 창 문구 없음: ${w}`, !t.includes(w))
await shot('evalplan-guest-settings')
check('서버 호출 0건', relay().length === 0)

console.log('\n[evalplan] 다른 탭 로그인 반영')
await open('/evalplan/')
await js(`localStorage.setItem('dr_sess_v1', ${JSON.stringify(JSON.stringify(SESSION))}); window.dispatchEvent(new StorageEvent('storage', { key: 'dr_sess_v1' }))`)
await sleep(300)
check('준비 완료로 바뀜', (await text()).includes('AI 사용 준비 완료'))

console.log('\n[evalplan] 교사 세션')
let serverHits = 0
handler = (c) => {
  if (c.url.includes('supabase.co')) return REFRESH_OK
  serverHits++
  if (serverHits === 1) return { status: 401, body: { error: '로그인이 만료되었습니다.', code: 'AUTH_REQUIRED' } }
  return { status: 403, body: { error: '시험: 서버 문구 그대로', code: 'NOT_APPROVED' } }
}
await open('/evalplan/', { dr_sess_v1: SESSION })
t = await text()
check('Anthropic 전송 안내', t.includes('Anthropic으로 전송'))
for (const w of FORBIDDEN_WORDS) check(`문구 없음: ${w}`, !t.includes(w))
await shot('evalplan-teacher-1280')
await fillEvalplan()
check('생성 버튼 열림', (await buttonDisabled('계획 생성')) === false)
await clickText('계획 생성')
check('서버 문구 표시', await waitFor(`document.body.innerText.includes('시험: 서버 문구 그대로')`))
let r = relay()
check('generate-open 호출', r.length >= 2 && r.every((c) => c.url.endsWith('/api/llm/generate-open')), JSON.stringify(r.map((c) => c.url)))
check('첫 요청 Bearer·x-auth-site', r[0]?.headers.authorization === 'Bearer old-token' && r[0]?.headers['x-auth-site'] === 'daeryun', JSON.stringify(r[0]?.headers))
check('401 뒤 새 토큰으로 재전송', r[1]?.headers.authorization === 'Bearer new-token', JSON.stringify(r[1]?.headers))
check('재전송 1회만', r.length === 2, String(r.length))
check('세션 갱신 1회', refreshes().length === 1, String(refreshes().length))
check('body에 idToken 없음', !r[0]?.body.includes('idToken'))
check('개인 키 헤더 없음', !r[0]?.headers['x-user-gemini-key'])
check('갱신된 세션 저장', await js(`JSON.parse(localStorage.getItem('dr_sess_v1')).token === 'new-token'`))
await shot('evalplan-teacher-error')

console.log('\n[evalplan] 401 반복')
handler = (c) => (c.url.includes('supabase.co') ? REFRESH_OK : { status: 401, body: { error: '시험: 다시 로그인', code: 'AUTH_REQUIRED' } })
await open('/evalplan/', { dr_sess_v1: SESSION })
await fillEvalplan()
await clickText('계획 생성')
check('두 번째 401 문구 표시', await waitFor(`document.body.innerText.includes('시험: 다시 로그인')`))
check('요청 2건에서 멈춤', relay().length === 2, String(relay().length))

console.log('\n[evalplan] 개인 키')
handler = () => ({ status: 400, body: { error: { message: 'stub' } } })
await open('/evalplan/', {
  dr_sess_v1: SESSION,
  'edtouch-evalplan-llm': { provider: 'gemini', gemini: { apiKey: 'AIza-test', model: 'gemini-3.5-flash' }, ollama: {}, bridge: {} },
})
t = await text()
check('개인 연결 안내', t.includes('개인 연결로 생성'))
await fillEvalplan()
await clickText('계획 생성')
await waitFor(`${JSON.stringify(false)} || document.body.innerText.includes('권한이 없습니다')`, 5000)
check('Gemini로 직접 호출', calls.some((c) => c.url.includes('generativelanguage') && c.url.includes('AIza-test')))
check('서버 호출 0건', relay().length === 0)
check('Gemini에 세션 토큰 미전송', calls.every((c) => !c.headers.authorization))

/* ── /backward/ ── */
async function fillBackward() {
  await waitFor(`!!document.querySelector('input[placeholder^="예) 고등학교"]')`)
  await setValue('input[placeholder^="예) 고등학교"]', '고등학교 1학년')
  await js(`(() => { const s = document.querySelector('select'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await js(`(() => { const t = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, '[10통사1-01-01] 시험용 성취기준'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(100)
  await js(`document.querySelector('label input[type=checkbox]').click()`)
  await sleep(200)
}
const UNIT = '/backward/#/backward/unit'
const OK_DATA = { status: 200, body: { step: '1', data: { concepts: [{ keyword: '시험 개념', definition: '정의', meaning: '의미', attributes: [] }] } } }

console.log('\n[backward] 비로그인')
handler = () => OK_DATA
await open('/backward/')
t = await text()
check('로그인 안내 표시', t.includes('교사 로그인 후 이용할 수 있습니다'))
check('교사 로그인 링크', await js(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/#login' && a.target === '_blank')`))
check('개인 키 등록 버튼', t.includes('개인 키 등록'))
check('삭제한 소개 문구 없음', !t.includes('확정은 늘 선생님이') && !t.includes('김태우'))
await shot('backward-guest-1280')
await width(375)
check('375px 가로 넘침 없음', await noOverflow())
await shot('backward-guest-375')
await width(1280)
await open(UNIT)
await fillBackward()
await clickText('핵심 개념 분석하기')
check('호출 전 차단 문구', await waitFor(`document.body.innerText.includes('화면 위의 교사 로그인')`))
check('서버 호출 0건', relay().length === 0)
check('프록시 호출 0건', proxyCalls.length === 0)
await shot('backward-guest-blocked')

console.log('\n[backward] 교사 세션')
serverHits = 0
handler = (c) => {
  if (c.url.includes('supabase.co')) return REFRESH_OK
  serverHits++
  if (serverHits === 1) return { status: 401, body: { error: '만료', code: 'AUTH_REQUIRED' } }
  if (serverHits === 2) return OK_DATA
  return { status: 503, body: { error: '시험: 예산 문구 그대로', code: 'SERVER_BUDGET' } }
}
await open(UNIT, { dr_sess_v1: SESSION })
t = await text()
check('Anthropic 전송 안내', t.includes('Anthropic으로 전송'))
for (const w of FORBIDDEN_WORDS) check(`문구 없음: ${w}`, !t.includes(w))
await fillBackward()
await clickText('핵심 개념 분석하기')
check('결과 표시', await waitFor(`document.body.innerText.includes('시험 개념')`))
r = relay()
check('Cloud Run 직접 호출', r[0]?.url === 'https://service-63986215827.us-west1.run.app/api/backward/unit', r[0]?.url)
check('첫 요청 Bearer·x-auth-site', r[0]?.headers.authorization === 'Bearer old-token' && r[0]?.headers['x-auth-site'] === 'daeryun', JSON.stringify(r[0]?.headers))
check('401 뒤 새 토큰으로 재전송', r[1]?.headers.authorization === 'Bearer new-token')
check('재전송 1회만', r.length === 2, String(r.length))
check('프록시 호출 0건', proxyCalls.length === 0)
await clickText('개념 분석 다시 하기')
check('서버 문구 표시', await waitFor(`document.body.innerText.includes('시험: 예산 문구 그대로')`))

console.log('\n[backward] Cloud Run 연결 실패')
handler = (c) => (c.url.includes('run.app') ? { fail: true } : REFRESH_OK)
proxyCalls.length = 0
await open(UNIT, { dr_sess_v1: SESSION })
await fillBackward()
await clickText('핵심 개념 분석하기')
await waitFor(`${JSON.stringify(false)} || document.body.innerText.includes('핵심 개념 다시') || document.body.innerText.includes('개념 분석 다시 하기')`, 5000)
check('/bw-api로 폴백', proxyCalls.length === 1 && proxyCalls[0].url === '/bw-api/unit', JSON.stringify(proxyCalls.map((c) => c.url)))
check('폴백에도 같은 헤더', proxyCalls[0]?.headers.authorization === 'Bearer old-token' && proxyCalls[0]?.headers['x-auth-site'] === 'daeryun')

console.log('\n[backward] 개인 키')
handler = () => OK_DATA
proxyCalls.length = 0
await open(UNIT, { dr_sess_v1: SESSION, 'da-user-llm': { apiKey: 'AIza-test' } })
t = await text()
check('개인 키 안내', t.includes('개인 Gemini 키로 생성합니다'))
await fillBackward()
await clickText('핵심 개념 분석하기')
await waitFor(`document.body.innerText.includes('시험 개념')`)
r = relay()
check('x-user-gemini-key 전송', r[0]?.headers['x-user-gemini-key'] === 'AIza-test', JSON.stringify(r[0]?.headers))
check('세션 토큰 미전송', !r[0]?.headers.authorization && !r[0]?.headers['x-auth-site'])

/* ── /record/ ── */
const OBS = 'textarea[placeholder^="학생을 관찰한"]'
const NAME = 'input[placeholder="학생 이름"]'
async function fillRecord() {
  await waitFor(`!!document.querySelector(${JSON.stringify(OBS)})`)
  await setValue(NAME, '김철수')
  await setValue(OBS, '김철수는 토론에서 근거를 들어 발표하였음.')
  await sleep(150)
}
const attachImage = () => js(`(() => {
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'capture.png', { type: 'image/png' }));
  const input = document.querySelector('input[type=file]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`)
const RECORD_OK = { status: 200, body: { text: JSON.stringify({ body: '토론에서 근거를 들어 발표함.', evidence: [], warnings: [], variants: [] }) } }

console.log('\n[record] 비로그인')
handler = () => RECORD_OK
for (const route of ['sebak', 'club', 'jayul', 'jinro', 'haengtuk']) {
  await open(`/record/#/${route}`)
  t = await text()
  check(`${route} 화면과 로그인 안내`, t.includes('특기사항 생성') && t.includes('교사 로그인 후 이용할 수 있습니다'))
  check(`${route} 셸과 푸터`, t.includes('학생부 특기사항 AI') && t.includes('개발 및 운영 : 교사 홍대화'))
  check(`${route} 가림 안내 유지`, t.includes('마스킹'))
  check(`${route} Anthropic 안내`, t.includes('Anthropic으로 전송'))
  for (const w of FORBIDDEN_WORDS) check(`${route} 문구 없음: ${w}`, !t.includes(w))
}
await open('/record/#/sebak')
check('교사 로그인 링크', await js(`[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/#login' && a.target === '_blank')`))
check('파비콘 유지', await js(`!!document.querySelector('link[rel=icon][href^="data:image"]')`))
check('로고 표시', await js(`!!document.querySelector('img[alt="대륜고등학교"]')?.naturalWidth`))
await fillRecord()
await shot('record-guest-1280')
await width(375)
check('375px 가로 넘침 없음', await noOverflow())
await shot('record-guest-375')
await width(1280)
await clickText('특기사항 생성')
await sleep(400)
t = await text()
check('생성을 눌러도 호출 0건', relay().length === 0)
check('설정 창 열림(로그인·개인 키 선택지)', t.includes('서버 AI (승인 교사)') && t.includes('Gemini 무료 키') && t.includes('서버 AI는 교사 로그인 후'))
await shot('record-guest-settings')
await open('/record/#/sebak')
await attachImage()
await sleep(500)
check('첨부도 호출 0건', relay().length === 0)
check('첨부 안내 문구', (await text()).includes('교사 로그인을 하거나'))

console.log('\n[record] 다른 탭 로그인 반영')
await open('/record/#/sebak')
await js(`localStorage.setItem('dr_sess_v1', ${JSON.stringify(JSON.stringify(SESSION))}); window.dispatchEvent(new StorageEvent('storage', { key: 'dr_sess_v1' }))`)
await sleep(300)
t = await text()
check('로그인 안내 사라짐', !t.includes('교사 로그인 후 이용할 수 있습니다'))
check('서버 AI 안내로 바뀜', t.includes('서버 AI(Claude)로 생성합니다'))

console.log('\n[record] 교사 세션')
serverHits = 0
handler = (c) => {
  if (c.url.includes('supabase.co')) return REFRESH_OK
  serverHits++
  if (serverHits === 1) return { status: 401, body: { error: '만료', code: 'AUTH_REQUIRED' } }
  return RECORD_OK
}
await open('/record/#/sebak', { dr_sess_v1: SESSION })
await fillRecord()
await shot('record-teacher-1280')
await clickText('특기사항 생성')
check('결과 표시', await waitFor(`[...document.querySelectorAll('textarea')].some((t) => t.value.includes('토론에서 근거를 들어 발표함'))`))
r = relay()
check('generate-open 호출', r[0]?.url.endsWith('/api/llm/generate-open'), r[0]?.url)
check('첫 요청 Bearer·x-auth-site', r[0]?.headers.authorization === 'Bearer old-token' && r[0]?.headers['x-auth-site'] === 'daeryun', JSON.stringify(r[0]?.headers))
check('401 뒤 새 토큰으로 재전송', r[1]?.headers.authorization === 'Bearer new-token')
check('세션 갱신 1회', refreshes().length === 1, String(refreshes().length))
check('재전송 1회만', r.length === 2, String(r.length))
check('실명이 전송되지 않음', !r.some((c) => c.body.includes('김철수')))
check('body에 idToken 없음', !r[0]?.body.includes('idToken'))
check('시간표·양식 AI 저장 키를 건드리지 않음', await js(`localStorage.getItem('dr_tt_llm_v1') === null`))

console.log('\n[record] 첨부를 서버로 전송')
handler = () => ({ status: 200, body: { text: '캡처에서 읽은 활동 기록' } })
await open('/record/#/sebak', { dr_sess_v1: SESSION })
await attachImage()
check('추출 글이 입력칸에 들어옴', await waitFor(`document.querySelector(${JSON.stringify(OBS)})?.value.includes('캡처에서 읽은 활동 기록')`))
r = relay()
const imageBody = r[0] ? JSON.parse(r[0].body) : {}
check('body.image 전송', imageBody.image?.mimeType === 'image/png' && imageBody.image?.dataBase64?.length > 20, r[0]?.body.slice(0, 200))
check('첨부 요청 헤더', r[0]?.headers.authorization === 'Bearer old-token' && r[0]?.headers['x-auth-site'] === 'daeryun')

console.log('\n[record] 오류 문구')
handler = () => ({ status: 403, body: { error: '시험: 서버 문구 그대로', code: 'NOT_APPROVED' } })
await open('/record/#/sebak', { dr_sess_v1: SESSION })
await fillRecord()
await clickText('특기사항 생성')
check('서버 문구 표시', await waitFor(`document.body.innerText.includes('시험: 서버 문구 그대로')`))
await shot('record-teacher-error')
handler = (c) => (c.url.includes('supabase.co') ? REFRESH_OK : { status: 401, body: { error: '시험: 다시 로그인', code: 'AUTH_REQUIRED' } })
await open('/record/#/sebak', { dr_sess_v1: SESSION })
await fillRecord()
await clickText('특기사항 생성')
check('두 번째 401 문구 표시', await waitFor(`document.body.innerText.includes('시험: 다시 로그인')`))
check('요청 2건에서 멈춤', relay().length === 2, String(relay().length))

console.log('\n[record] 저장된 개인 연결')
handler = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: RECORD_OK.body.text }] } }] } })
const gemini = { provider: 'gemini', gemini: { apiKey: 'AIza-test', model: 'gemini-3.5-flash' }, ollama: {}, bridge: {} }
await open('/record/#/sebak', { dr_sess_v1: SESSION, 'edtouch-record-llm': gemini })
await fillRecord()
check('서버 안내 없음', !(await text()).includes('서버 AI(Claude)로 생성합니다'))
await clickText('특기사항 생성')
check('결과 표시', await waitFor(`[...document.querySelectorAll('textarea')].some((t) => t.value.includes('토론에서 근거를 들어 발표함'))`))
check('Gemini로 직접 호출', calls.some((c) => c.url.includes('generativelanguage') && c.url.includes('AIza-test')))
check('서버 호출 0건', relay().length === 0)
check('Gemini에 세션 토큰 미전송', calls.every((c) => !c.headers.authorization))
await open('/record/#/sebak', { 'edtouch-record-llm': gemini })
check('비로그인이어도 개인 키면 로그인 안내 없음', !(await text()).includes('교사 로그인 후 이용할 수 있습니다'))
await open('/record/#/sebak', { 'edtouch-record-llm': { ...gemini, gemini: { apiKey: '', model: 'gemini-3.5-flash' } } })
check('키 없는 옛 저장값은 서버 AI로', (await text()).includes('교사 로그인 후 이용할 수 있습니다'))
await open('/record/#/sebak', { 'edtouch-record-llm': { provider: 'ollama', gemini: { apiKey: '', model: '' }, ollama: { url: 'http://localhost:11434', model: 'qwen3:8b' }, bridge: {} } })
check('Ollama 저장값 유지', !(await text()).includes('교사 로그인 후 이용할 수 있습니다') && (await js(`JSON.parse(localStorage.getItem('edtouch-record-llm')).provider === 'ollama'`)))
await open('/record/#/sebak', { 'edtouch-record-llm': { provider: 'bridge', gemini: { apiKey: '', model: '' }, ollama: {}, bridge: { provider: 'claude', model: '' } } })
check('구독 연결 저장값 유지', !(await text()).includes('교사 로그인 후 이용할 수 있습니다'))

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과')
ws.close()
chrome.kill()
server.close()
process.exit(failed ? 1 : 0)
