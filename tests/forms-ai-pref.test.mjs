// lib/dr-ai.js의 서버 AI 선택 규칙: 따로 적는 선택 키, 종료 시각, 호출기 없음.
// 실행: node tests/forms-ai-pref.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../output/web/lib/dr-ai.js', import.meta.url), 'utf8')
function load(saved, config) {
  const store = new Map(Object.entries(saved))
  const window = { DR_AI_CONFIG: config, addEventListener() {}, dispatchEvent() {} }
  vm.runInNewContext(source, { window, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    document: {}, navigator: {}, fetch: async () => { throw new Error('외부 호출 없음') }, console, setTimeout, CustomEvent: class {}, Date })
  return window.drAi
}
const calls = []
const srv = { serverLlm: async (r) => { calls.push(r); return '{"reply":"ok","edits":[]}' }, serverPrefKey: 'pref', serverName: '서버 AI (Claude)', serverScope: '서버 범위' }
const gem = JSON.stringify({ provider: 'gemini', gemini: { apiKey: 'k', model: 'gemini-3.5-flash' } })
let n = 0
const ok = (name, c) => { assert.ok(c, name); n++; console.log('PASS', name) }

let ai = load({}, srv)
ok('저장값이 없으면 서버 AI가 기본', ai.has() && ai.label() === '서버 AI (Claude)' && ai.scope() === '서버 범위')
await ai.call('p', {}); ok('서버 호출기로 보냄', calls.length === 1)
ai = load({ dr_tt_llm_v1: gem }, srv)
ok('개인 키가 저장돼 있어도 선택을 적지 않았으면 서버', ai.label() === '서버 AI (Claude)')
ai = load({ dr_tt_llm_v1: gem, pref: 'personal' }, srv)
ok('personal을 적으면 개인 연결', /^Gemini/.test(ai.label()))
ai = load({ pref: 'personal' }, srv)
ok('personal인데 키가 없으면 설정 필요', !ai.has() && ai.label() === '')
ai = load({ dr_tt_llm_v1: gem, pref: 'server' }, Object.assign({}, srv, { serverEnd: '2020-01-01T00:00:00Z' }))
ok('종료 시각이 지나면 개인 연결로 돌아감', /^Gemini/.test(ai.label()))
ai = load({}, Object.assign({}, srv, { serverEnd: '2020-01-01T00:00:00Z' }))
ok('종료 뒤 키가 없으면 설정 필요', !ai.has())
ai = load({}, Object.assign({}, srv, { serverEnd: '2999-01-01T00:00:00Z' }))
ok('종료 전에는 서버', ai.label() === '서버 AI (Claude)')
ai = load({ dr_tt_llm_v1: JSON.stringify({ provider: 'server' }) }, {})
ok('호출기가 없으면 저장값 server를 받지 않음', !ai.has())
ai = load({ k: JSON.stringify({ provider: 'gemini', gemini: { apiKey: 'k' } }) }, { storageKey: 'k', serverLlm: srv.serverLlm })
ok('선택 키가 없는 사이트(edtouch)는 저장한 개인 연결을 그대로 씀', /^Gemini/.test(ai.label()))
ai = load({}, { storageKey: 'k', serverLlm: srv.serverLlm })
ok('선택 키가 없는 사이트는 저장값이 없으면 서버', ai.label() === 'EdTouch 서버 AI')
console.log(`forms ai pref: ${n}/11 PASS`)
