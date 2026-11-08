import test from 'node:test'
import assert from 'node:assert/strict'
import { EXAMPLE_PROMPT, INTERACTIVE_DEMOS, PROMPT_TERMS, PROMPT_TERM_CATEGORIES, practiceLink, termById, termLink, termsInCategory } from '../src/data/promptTerms'

const EXPECTED = ['풀스택 웹 개발', 'AI 프로덕트 엔지니어', 'HTML · CSS · JS', '단일 HTML 파일', 'Tailwind CSS', 'Font Awesome', 'SPA', '인터랙티브 웹페이지', '대시보드', '반응형 디자인', '토스트 알림', 'CTA 버튼', 'API', 'AI 알고리즘', '실시간 로그', 'QR 코드']

test('제시 용어 16개가 수업 자료 순서대로 모두 있고 id가 겹치지 않는다', () => {
  assert.deepEqual(PROMPT_TERMS.map(t => t.name), EXPECTED)
  assert.equal(new Set(PROMPT_TERMS.map(t => t.id)).size, 16)
  for (const t of PROMPT_TERMS) assert.match(t.id, /^[a-z][a-z0-9-]*$/)
})

test('용어마다 다섯 칸과 범주·화면 예시 종류가 채워져 있다', () => {
  for (const t of PROMPT_TERMS) {
    for (const key of ['name', 'en', 'meaning', 'analogy', 'promptExample', 'checkHow', 'demo'] as const) assert.ok(String(t[key]).trim().length > 1, `${t.id}.${key}`)
    assert.ok(['①', '②', '③'].includes(t.category), t.id)
    assert.ok(Array.isArray(t.aliases) && Array.isArray(t.authored), t.id)
  }
})

test('세 범주가 모두 있고 안내자료 표의 용어 수와 같다', () => {
  assert.deepEqual(PROMPT_TERM_CATEGORIES.map(c => c.id), ['①', '②', '③'])
  assert.deepEqual(PROMPT_TERM_CATEGORIES.map(c => termsInCategory(c.id).length), [6, 6, 4])
  assert.deepEqual(PROMPT_TERM_CATEGORIES.map(c => c.label), ['누가, 무엇으로 만드는가', '화면은 어떻게 움직이는가', '정보는 어떻게 오가는가'])
})

test('프롬프트 문장에 용어 이름이 들어 있고 동작 서술이 붙어 있다', () => {
  for (const t of PROMPT_TERMS) {
    const names = [t.name, ...t.aliases]
    assert.ok(names.some(n => t.promptExample.includes(n)), `${t.id}: 이름이 문장에 없음`)
    assert.match(t.promptExample, /(줘|만들어|해 줘)\.$/, `${t.id}: 요청 문장으로 끝나지 않음`)
  }
})

test('연습용 문장 틀에는 용어 이름이 들어 있고 다른 앱의 수치를 담지 않는다', () => {
  for (const t of PROMPT_TERMS) {
    assert.ok([t.name, ...t.aliases].some(n => t.template.includes(n)), t.id)
    assert.ok(!/\d/.test(t.template.replace(/HTML|CSS|JS/g, '')), `${t.id}: 숫자`)
    assert.ok(!/잔반|급식|공부 시간|날씨|대구|투표/.test(t.template), `${t.id}: 예시 내용`)
  }
})

test('별칭은 다른 용어 이름과 겹치지 않고 로그인 같은 일상 낱말을 잡지 않는다', () => {
  const names = new Set(PROMPT_TERMS.map(t => t.name))
  for (const t of PROMPT_TERMS) for (const a of t.aliases) {
    assert.ok(!names.has(a), `${t.id}: ${a}`)
    assert.ok(!'로그인'.includes(a), `${t.id}: ${a}`)
  }
})

test('동작 예시 여섯 종류와 예시 프롬프트의 용어 연결이 맞다', () => {
  assert.deepEqual([...INTERACTIVE_DEMOS].sort(), ['cta', 'dashboard', 'interactive', 'responsive', 'spa', 'toast'])
  for (const kind of INTERACTIVE_DEMOS) assert.ok(PROMPT_TERMS.some(t => t.demo === kind), kind)
  assert.equal(EXAMPLE_PROMPT.length, 3)
  const linked = EXAMPLE_PROMPT.flatMap(s => s.parts).filter(p => p.termId)
  for (const part of linked) assert.ok(termById(part.termId!), part.termId)
  assert.equal(linked.length, 14)
  assert.equal(termLink('ai-algorithm'), '/assessment/terms/#ai-algorithm')
  assert.equal(practiceLink('qr'), '/assessment/implementation-prompt/?term=qr')
})
