// /backward/ 단원·차시 설계 완료 화면의 저장 묶음 시험. 헤드리스 Chrome으로 output/web을 띄운다(AI 호출 없음).
// 사용: node apps/ai-ports/smoke-backward-export.mjs [--out <폴더>] [--shots]
//  - 완료 상태는 위저드 저장본(backward:unit, backward:lesson)에 시험용 산출물을 넣고 '이어서 하기'로 복원해 만든다.
//  - 산출물 값은 data_analysis scripts/export/smoke_export_handoff.mjs의 시험 자료와 같다.
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
const HTTP = 8799
const CDP = 9337
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



const UNIT_OUT = {
  '1': { concepts: [{ keyword: '상태 변화', definition: '물질이 고체·액체·기체로 바뀌는 현상', meaning: '입자 배열의 변화', attributes: [{ key: '입자 운동', desc: '온도에 따라 달라진다', why: '없으면 설명 불가' }] }] },
  '2': { coreIdea: '물질의 상태는 입자 운동으로 설명한다.', coreQuestions: ['왜 얼음은 녹는가?'] },
  '3': { grasps: { goal: '설명 자료', role: '해설가', audience: '초등학생', situation: '축제', product: '포스터' }, stages: [{ order: 1, activity: '관찰', product: '기록', element: '관찰' }], justification: '이유', rubric: [{ element: '설명', A: 'a', B: 'b', C: 'c', D: 'd' }], aMeaning: [] },
  '4': { F: [{ id: 'F1', text: '몇 도?', link: '사실' }], C: [{ id: 'C1', text: '관계?', link: '개념' }], D: { id: 'D1', text: '되돌릴 수 있나?', link: '토론' }, coherence: '모인다' },
  '5': { preAnalysis: [], lessons: [{ no: 1, phase: '열기', title: '관찰', question: '무엇?', activity: '관찰' }], totalCheck: '총 1차시' },
}
const LESSON_OUT = {
  '1': { coordinate: '1/2', knowledge: ['녹는점'], skills: ['측정'], learningResults: ['그래프'], lessonQuestion: '왜 녹을까?' },
  '2': { name: '얼음 녹이기', aim: '관찰', outline: { form: '모둠', time: '10분', materials: '얼음', output: '기록' }, procedure: ['놓는다'], intent: '직접' },
  '3': { observe: [{ id: 'O1', q: '보이나?' }], analyze: [], interpret: [], generalize: { id: 'G1', q: '일반화?', coreIdeaLink: '입자' }, flow: '' },
  '4': { sourceType: '영상', why: '흥미', material: { desc: '영상', howToGet: '촬영', alt: '사진' }, prompt: '왜?', expected: ['더워서'], conflictPoint: '냉장고', bridge: '확인' },
  '5': { header: { unit: '상태', unitQuestion: '왜?', todayQuestion: '왜 녹을까?' }, objective: '설명한다', sections: [{ title: '관찰', items: [{ prompt: '적자', blank: true, modelAnswer: '물' }] }] },
  '6': { scenes: [{ no: 1, name: '열기', teacherActs: ['질문'], script: '오늘은', minutes: 5, transition: '활동' }], timeCheck: '5분' },
}
const BRIEF = { grade: '중2', subject: '과학', achievementStandards: ['[9과05-01] 상태 변화를 설명한다.'] }

let hookAdded = false
async function openDone(mode, outputs) {
  const ids = Object.keys(outputs)
  const shape = { v: 1, savedAt: Date.now(), currentIndex: ids.length - 1, confirmed: ids, outputs, drafts: {}, brief: BRIEF }
  await send('Page.navigate', { url: `${BASE}/favicon.ico` })
  await sleep(200)
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('backward:${mode}', ${JSON.stringify(JSON.stringify(shape))});`)
  if (!hookAdded) await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__downloads = [];
      const __create = URL.createObjectURL;
      URL.createObjectURL = (blob) => { const url = __create(blob); window.__downloads.push({ url, blob, size: blob.size, type: blob.type }); return url };
      const __click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { const d = window.__downloads.find((x) => x.url === this.href); if (d) d.name = this.download; return } return __click.call(this) };
      window.open = () => { window.__opened = (window.__opened || 0) + 1; return null };`,
  })
  hookAdded = true
  await send('Page.navigate', { url: `${BASE}/backward/#/backward/${mode}` })
  await waitFor('!!document.querySelector("#app > *")')
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.innerText.includes('이어서 하기'))`, 5000)
  await js(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('이어서 하기'))?.click(); true`)
  return waitFor(`!!document.querySelector('[data-export-scope] [data-export-actions]')`, 5000)
}

for (const [mode, outputs, scope, heading] of [
  ['unit', UNIT_OUT, 'unit-design', '설계안 MD 저장'],
  ['lesson', LESSON_OUT, 'lesson-plan', '설계안과 활동지 MD 저장'],
]) {
  for (const w of [1440, 320]) {
    console.log(`\n[backward] ${mode} 완료 ${w}px`)
    await width(w)
    check('완료 상태 복원·묶음 표시', await openDone(mode, outputs))
    const box = `document.querySelector('[data-export-scope="${scope}"]')`
    const labels = JSON.parse(await js(`JSON.stringify([...${box}.querySelectorAll('[data-export-format]')].map((b) => b.innerText.trim()))`))
    check('묶음은 MD 저장만', JSON.stringify(labels) === JSON.stringify(['MD 저장']), JSON.stringify(labels))
    const boxText = await js(`${box}.innerText`)
    check(`묶음 제목 '${heading}'`, boxText.split('\n')[0].trim() === heading, boxText.split('\n')[0])
    const body = await js('document.body.innerText')
    check('문서작성 AI 문구 없음', !body.includes('문서작성 AI'))
    check('편집 단추 없음', !/한글로 편집|엑셀로 편집|PPT로 편집/.test(body))
    // 단원은 '설계안 PDF 저장', 차시는 '설계안 PDF'·'활동지 PDF'.
    check('기존 PDF 단추 유지', await js(`[...document.querySelectorAll('button')].some((b) => /설계안 PDF/.test(b.innerText))`))
    const edtouch = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.includes('edtouch.ai') && !h.startsWith('mailto:')))`))
    check('화면에 edtouch.ai 링크 없음(문의 메일 제외)', edtouch.length === 0, JSON.stringify(edtouch))
    check(`${w}px 가로 넘침 없음`, await noOverflow())
    await js(`${box}.querySelector('[data-export-format=md]').click(); true`)
    const got = await waitFor('window.__downloads.some((d) => d.name && d.name.endsWith(".md"))', 5000)
    check('MD 저장으로 md 내려받음', got, await js('JSON.stringify(window.__downloads.map((d) => ({ name: d.name, size: d.size })))'))
    if (got) {
      const text = await js(`(async () => { const d = window.__downloads.find((x) => x.name && x.name.endsWith('.md')); return await d.blob.text() })()`)
      check('md에 설계 내용', text.includes('중2') && text.includes('과학') && (text.includes('상태 변화') || text.includes('얼음')), text.slice(0, 120))
      if (OUT && w === 1440) writeFileSync(join(OUT, `backward-${mode}.md`), text)
    }
    check('새 탭 열기 0회', !(await js('window.__opened || 0')))
    if (process.argv.includes('--shots')) {
      await js(`${box}.scrollIntoView({ block: 'center' }); true`)
      await sleep(200)
      const r = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(OUT || tmpdir(), `backward-${scope}-${w}.png`), Buffer.from(r.data, 'base64'))
    }
  }
}

check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '))
console.log(failed ? `\n${failed}건 실패` : '\n전부 통과')
chrome.kill()
server.close()
process.exit(failed ? 1 : 0)
