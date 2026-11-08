import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { readdir, readFile } from 'node:fs/promises'
import { createProject, getField, isUntouchedProject, validateProject } from '../src/lib/model'
import { saveProject, loadProject, listProjects, withDefaults, takeTrimNotice } from '../src/lib/storage'
import { documentSections, documentText, importBackup, printHtml } from '../src/lib/exportProject'
import { assembleImplementation, checkImplementation, normalizeImplementation, PROMPT_DICTIONARY, requiredPassed } from '../src/lib/promptState'
import { parsePromptDraft, emptyPromptState } from '../src/lib/promptCore'
import { DAMEOK_TERMS, dameokState, EXAMPLE_NOTICE, PROMPT_GUIDES } from '../src/data/promptPractice'
import { PROMPT_TERMS } from '../src/data/promptTerms'

const backup = (project: unknown) => JSON.stringify({ format: 'daeryun-assessment', version: 1, project })
const failed = (results: ReturnType<typeof checkImplementation>) => results.filter(r => !r.ok).map(r => `${r.rule}:${r.level}`)

test('사전 어댑터는 제시 용어 16개를 이름·별칭·범주·예문 그대로 넘긴다', () => {
  assert.equal(PROMPT_DICTIONARY.length, 16)
  for (const [i, t] of PROMPT_TERMS.entries()) assert.deepEqual(PROMPT_DICTIONARY[i], { id: t.id, name: t.name, aliases: t.aliases, category: t.category, prompt: t.template })
})

test('예시 다먹 AI는 수행평가 필수 조건을 모두 통과하고 사용한 용어가 예시 줄과 같다', () => {
  const state = dameokState()
  const results = checkImplementation(state)
  assert.ok(requiredPassed(results), failed(results).join(', '))
  const a = assembleImplementation(state)
  assert.deepEqual(new Set(a.terms!.map(t => t.name)), new Set(DAMEOK_TERMS))
  assert.equal(a.terms!.length, 12)
  assert.match(a.text, /\n사용한 용어: ① .+ ② .+ ③ /)
  assert.match(a.body, /\(개선: 잔반 인식\)/)
})

test('나쁜 예는 R1·R2·R4 필수와 R6 모호어에 걸린다', () => {
  const { state } = parsePromptDraft('급식 잔반 줄이는 앱 멋있게 만들어 줘.')
  const results = checkImplementation(state)
  const rules = failed(results)
  for (const rule of ['R1:required', 'R2:required', 'R4:required', 'R6:advice']) assert.ok(rules.includes(rule), `${rule} 없음: ${rules.join(', ')}`)
  assert.equal(requiredPassed(results), false)
})

test('스스로 공부한 용어는 범주를 붙여 개수에 들어간다', () => {
  const state = emptyPromptState()
  state.role = '너는 프론트엔드와 백엔드를 함께 만드는 개발자야.'
  state.extraTerms = [{ name: '프론트엔드', category: '①' }, { name: '백엔드', category: '③' }]
  const terms = assembleImplementation(state).terms!
  assert.deepEqual(terms.map(t => [t.name, t.category]), [['프론트엔드', '①'], ['백엔드', '③']])
})

test('구현 프롬프트 항목이 없는 예전 저장본과 백업이 그대로 열린다', () => {
  const p = createProject() as unknown as Record<string, unknown>
  delete p.implementation
  const opened = withDefaults(p as never)
  assert.deepEqual(Object.keys(opened.implementation).sort(), Object.keys(emptyPromptState()).sort())
  const restored = importBackup(backup(p))
  assert.equal(restored.implementation.role, '')
  assert.equal(restored.implementation.features.length, 1)
})

test('구현 프롬프트 원고가 저장·백업·복원과 충돌 사본에 남는다', async () => {
  const p = createProject(); p.implementation = dameokState(); p.implementation.extraTerms = [{ name: '데이터베이스', category: '③' }]
  assert.equal(isUntouchedProject(p), false)
  const saved = (await saveProject(p)).project
  const loaded = (await loadProject(saved.id))!
  assert.deepEqual(loaded.implementation, p.implementation)
  assert.ok((await listProjects()).some(x => x.id === saved.id && x.implementation.serviceName === '다먹 AI'))
  const restored = importBackup(backup(loaded))
  assert.notEqual(restored.id, loaded.id)
  assert.deepEqual(restored.implementation, p.implementation)
  const stale = { ...loaded, revision: 0 }
  const conflict = await saveProject(stale)
  assert.equal(conflict.conflict, true)
  assert.deepEqual(conflict.project.implementation, p.implementation)
})

test('형식이 틀린 구현 프롬프트 백업은 원인을 알리고 거절한다', () => {
  const p = createProject() as unknown as Record<string, unknown>
  for (const bad of [{ features: 'x' }, { role: 3 }, { extraTerms: [{ name: 'a', category: '④' }] }, 'text']) {
    p.implementation = bad
    assert.throws(() => validateProject(p), /구현 프롬프트|형식/)
  }
  assert.equal(normalizeImplementation(undefined).version, 1)
})

test('한도를 넘은 칸은 저장소에서 읽을 때와 백업을 불러올 때 잘라 살리고 다른 칸은 지키며 잘린 수를 알린다', async () => {
  const p = createProject(); p.implementation = dameokState()
  ;(p.implementation.screens as string[]) = ['가'.repeat(150), '기록']
  p.implementation.commonFree = '나'.repeat(4100)
  p.implementation.features[0]!.name = '다'.repeat(300)
  const saved = (await saveProject(p)).project
  const loaded = (await loadProject(saved.id))!
  assert.equal(loaded.implementation.role, p.implementation.role)
  assert.deepEqual(loaded.implementation.screens, ['가'.repeat(100), '기록'])
  assert.equal(loaded.implementation.commonFree.length, 4000)
  assert.equal(loaded.implementation.features[0]!.name.length, 200)
  assert.equal(loaded.implementation.features.length, 4)
  assert.equal(takeTrimNotice(saved.id), 3)
  assert.equal(takeTrimNotice(saved.id), 0)
  const report = { trimmed: 0 }
  const restored = importBackup(backup(p), report)
  assert.equal(report.trimmed, 3)
  assert.equal(restored.implementation.screens[0]!.length, 100)
  assert.equal(restored.implementation.role, p.implementation.role)
})

test('기기 저장소에서는 자료형이 틀린 칸만 비우고 나머지를 살린다', () => {
  const s = withDefaults({ ...createProject(), implementation: { role: '남아야 할 역할', screens: 'x', features: [{ input: 3 }, { input: '입력' }], extraTerms: [{ name: '백엔드', category: '④' }] } } as never).implementation
  assert.equal(s.role, '남아야 할 역할')
  assert.deepEqual(s.screens, [])
  assert.deepEqual(s.features.map(f => f.input), ['', '입력'])
  assert.deepEqual(s.extraTerms, [])
})

test('문서·인쇄 본문은 양식 순서의 프롬프트와 사용한 용어 줄만 담는다', () => {
  const p = createProject(); p.implementation = dameokState()
  const sections = documentSections(p, 'prompt')
  assert.equal(sections.length, 1)
  const text = sections[0]!.text
  const order = ['[역할]', '[만들 형태]', '[화면 구성]', '[기능별 동작 조건]', '[공통 조건]', '사용한 용어:'].map(m => text.indexOf(m))
  assert.ok(order.every(i => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]!), JSON.stringify(order))
  const html = printHtml(p, 'prompt')
  assert.match(html, /인공지능 서비스 구현: 구현 프롬프트/)
  for (const word of [EXAMPLE_NOTICE, '작성 도움', '참고 의견', '나쁜 예', '이 도구는 연습용']) assert.ok(!html.includes(word), word)
  assert.match(documentText(p, 'prompt'), /^인공지능 서비스 구현: 구현 프롬프트/)
  assert.equal(documentSections(createProject(), 'prompt')[0]!.text, '')
})

test('단계별 글은 내 글 점검에 쓰이고 사전 읽기에는 글이 없다', () => {
  const p = createProject(); p.implementation = dameokState()
  assert.match(getField(p, 'prompt:role'), /^\[역할\].*\n\[만들 형태\]/)
  assert.match(getField(p, 'prompt:features'), /^\[기능별 동작 조건\]\n1\) 잔반 인식:/)
  assert.equal(getField(p, 'prompt:read'), '')
  assert.deepEqual(PROMPT_GUIDES.map(g => g.key), ['read', 'role', 'screen', 'features', 'common', 'done'])
})

test('core 복사본은 손으로 고치지 말라는 머리 주석과 원본 기록을 갖는다', async () => {
  const dir = new URL('../src/lib/promptCore/', import.meta.url)
  const files = (await readdir(dir)).filter(f => f.endsWith('.ts'))
  assert.ok(files.length >= 7)
  for (const f of files) {
    const text = await readFile(new URL(f, dir), 'utf8')
    assert.match(text, /^\/\/ 복사본: 손으로 고치지 말 것/)
    assert.match(text.split('\n')[1]!, /원본 커밋 .+ · sha256 [0-9a-f]{16}/)
    assert.ok(!/from ['"](vue|@\/)/.test(text), f)
  }
})
