// 복사본: 손으로 고치지 말 것. scripts/sync-prompt-core.mjs가 만든다.
// 원본: edtouch01 v2/src/lib/promptBuilder/core/parse.ts · 원본 커밋 7346b2667775 · sha256 011e86cca7ead7a3
// 붙여 넣은 초안 → 묶음별 칸 분배.
// 대륜고 apps/assessment가 복사해 쓴다. 브라우저·Vue 의존 금지.
//
// - [역할] [만들 형태] [화면 구성] [기능별 동작 조건] [공통 조건] 제목을 찾아 나눈다(띄어쓰기는 달라도 된다).
// - 제목이 하나도 없으면 전체를 첫 기능 카드의 입력 칸에 넣는다(쓴 내용을 버리지 않는다).
// - 기능 묶음은 '1)', '1.', '-', '•'로 시작하는 줄마다 기능 카드 하나다. '이름: 내용'이면 이름을 나눈다.
// - '(개선: 이름)' 표시는 기능 카드의 개선 체크로 옮긴다. 화면 구성·공통 조건의 표시는 그 묶음의 개선 이름으로.
// - '서비스명:' 줄은 서비스 이름으로(괄호 설명은 뺀다), '사용한 용어:' 줄은 버린다(조립할 때 다시 만든다).
// - 첫 묶음 제목 앞의 글은 버린다. 제목이 하나도 없을 때만 전체를 기능 칸에 넣는다.
import { emptyFeature, emptyPromptState } from './assemble'
import type { PromptFeature, PromptState, SectionId } from './types'

const HEADER = /\[\s*(역\s*할|만들\s*형\s*태|화면\s*구\s*성|기능\s*별?\s*동작\s*조건|기능|공통\s*조건)\s*\]/g

function sectionOf(raw: string): SectionId {
  const t = raw.replace(/\s+/g, '')
  if (t === '역할') return 'role'
  if (t === '만들형태') return 'form'
  if (t === '화면구성') return 'screen'
  if (t === '공통조건') return 'common'
  return 'features'
}

const IMPROVE = /\s*\(\s*개선\s*[:：]\s*([^)]*)\)/g

function takeImprove(text: string): { text: string; labels: string[] } {
  const labels: string[] = []
  const out = text.replace(IMPROVE, (_m, label: string) => {
    const l = label.trim()
    if (l) labels.push(l)
    return ''
  })
  return { text: out.trim(), labels }
}

const squash = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')

function parseFeatures(text: string): PromptFeature[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const chunks: string[] = []
  const START = /^(?:\d+\s*[).]|[-•·*])\s*/
  for (const line of lines) {
    if (START.test(line) || !chunks.length) chunks.push(line.replace(START, ''))
    else chunks[chunks.length - 1] += ` ${line}`
  }
  return chunks.map((chunk) => {
    const f = emptyFeature()
    const { text: body, labels } = takeImprove(chunk)
    const m = body.match(/^([^:：]{1,24})[:：]\s*(.*)$/)
    if (m && !/[.!?]/.test(m[1])) {
      f.name = m[1].trim()
      f.input = m[2].trim()
    } else f.input = body
    if (labels.length) {
      f.improved = true
      f.improveLabel = labels[0]
    }
    return f
  })
}

export interface ParseResult {
  state: PromptState
  /** 제목을 찾아 나눈 묶음 */
  matched: SectionId[]
}

export function parsePromptDraft(raw: string): ParseResult {
  const state = emptyPromptState()
  const text = (raw ?? '').replace(/\r\n?/g, '\n')
  const lines: string[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    const name = t.match(/^서비스\s*(?:명|이름)\s*[:：]\s*(.+)$/)
    if (name) {
      // '서비스명: 다먹 AI(설명)   학번: …'처럼 한 줄에 다른 칸이 이어지면 앞부분만 쓴다.
      // 이름 뒤 괄호 설명('다먹 AI(먹을 만큼 받고 …)')은 뺀다.
      state.serviceName = name[1].split(/\s{2,}|학번\s*[:：]/)[0].replace(/\s*[(（].*$/, '').trim()
      continue
    }
    if (/^사용한\s*용어\s*[:：]/.test(t)) continue
    lines.push(line)
  }
  const body = lines.join('\n')

  const marks: { id: SectionId; start: number; end: number }[] = []
  HEADER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HEADER.exec(body))) marks.push({ id: sectionOf(m[1]), start: m.index, end: m.index + m[0].length })

  if (!marks.length) {
    const all = body.trim()
    if (all) state.features = [{ ...emptyFeature(), input: squash(all) }]
    return { state, matched: [] }
  }

  // 첫 묶음 제목 앞의 글(안내자료 머리글, '1. 구현 프롬프트 (…)' 등)은 프롬프트가 아니므로 버린다.
  const matched: SectionId[] = []
  const pieces: Partial<Record<SectionId, string>> = {}
  marks.forEach((mk, i) => {
    const content = body.slice(mk.end, marks[i + 1]?.start ?? body.length).trim()
    pieces[mk.id] = pieces[mk.id] ? `${pieces[mk.id]}\n${content}` : content
    if (!matched.includes(mk.id)) matched.push(mk.id)
  })

  if (pieces.role !== undefined) state.role = squash(takeImprove(pieces.role).text)
  state.buildMethod = pieces.form ? squash(takeImprove(pieces.form).text) : ''
  if (pieces.screen !== undefined) {
    const { text: t, labels } = takeImprove(pieces.screen)
    state.screenExtra = squash(t)
    state.screenImproveLabel = labels[0] ?? ''
  }
  if (pieces.features !== undefined && pieces.features.trim()) state.features = parseFeatures(pieces.features)
  if (pieces.common !== undefined) {
    const { text: t, labels } = takeImprove(pieces.common)
    state.commonFree = squash(t)
    state.commonImproveLabel = labels[0] ?? ''
  }
  return { state, matched }
}
