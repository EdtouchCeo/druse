// 복사본: 손으로 고치지 말 것. scripts/sync-prompt-core.mjs가 만든다.
// 원본: edtouch01 v2/src/lib/promptBuilder/core/assemble.ts · 원본 커밋 7346b2667775 · sha256 177c51b763f8b08d
// 입력 상태 → 다섯 묶음 프롬프트 문자열.
// 대륜고 apps/assessment가 복사해 쓴다. 브라우저·Vue 의존 금지.
import { findTerms } from './terms'
import {
  SECTION_ORDER,
  SECTION_TITLES,
  TERM_CATEGORIES,
  type PromptFeature,
  type PromptState,
  type SectionId,
  type TermDictionary,
  type TermHit,
} from './types'

/* ── 빈 상태 ─────────────────────────────────────── */

let featureSeq = 0
export function newFeatureId(): string {
  featureSeq += 1
  return `f${Date.now().toString(36)}${featureSeq}`
}

export function emptyFeature(id = newFeatureId()): PromptFeature {
  return { id, name: '', input: '', process: '', result: '', exception: '', improved: false, improveLabel: '' }
}

export function emptyPromptState(): PromptState {
  return {
    version: 1,
    role: '',
    serviceName: '',
    serviceIntro: '',
    screens: [],
    buildMethod: '',
    home: '',
    ctaLabel: '',
    ctaTarget: '',
    screenExtra: '',
    screenImproveLabel: '',
    features: [emptyFeature()],
    common: [],
    commonFree: '',
    commonImproveLabel: '',
    extraTerms: [],
  }
}

/** 깊은 복사(상태는 JSON으로 표현되는 값만 담는다). */
export function clonePromptState(s: PromptState): PromptState {
  return JSON.parse(JSON.stringify(s)) as PromptState
}

/* ── 조사 ────────────────────────────────────────── */

// 영문·숫자로 끝나는 말은 읽는 소리로 받침을 정한다. L(엘) M(엠) N(엔) R(알)과 0 1 3 6 7 8은 받침이 있다.
const ASCII_BATCHIM = new Set(['l', 'm', 'n', 'r', '0', '1', '3', '6', '7', '8'])

/** 마지막 글자의 받침. 없음=0, ㄹ=8, 그 밖=1. 판단할 수 없으면 null. */
function batchimOf(word: string): number | null {
  const t = word.replace(/['"‘’“”)\]\s]+$/u, '')
  const ch = t.slice(-1)
  if (!ch) return null
  const code = ch.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28
  const lower = ch.toLowerCase()
  if (/[a-z0-9]/.test(lower)) return ASCII_BATCHIM.has(lower) ? (lower === 'l' || lower === '1' || lower === '7' || lower === '8' ? 8 : 1) : 0
  return null
}

export type JosaPair = '을/를' | '이/가' | '은/는' | '와/과' | '으로/로'

/** 낱말 뒤에 붙일 조사. 받침을 알 수 없으면 '을(를)'처럼 둘 다 쓴다. */
export function josa(word: string, pair: JosaPair): string {
  const b = batchimOf(word)
  const [withB, without] = pair.split('/')
  if (pair === '와/과') return b === null ? '와(과)' : b === 0 ? '와' : '과'
  if (b === null) return `${withB}(${without})`
  if (pair === '으로/로') return b === 0 || b === 8 ? '로' : '으로'
  return b === 0 ? without : withB
}

/* ── 조립 ────────────────────────────────────────── */

export interface AssembleOptions {
  /** (개선: 기능 이름) 표시를 넣는다. false면 상태 안의 표시도 지운다(edtouch). */
  includeImprove?: boolean
  /** 끝에 '사용한 용어:' 줄을 붙인다(assessment). dictionary가 필요하다. */
  termLine?: boolean
  dictionary?: TermDictionary
}

export interface AssembledSection {
  id: SectionId
  title: string
  body: string
}

export interface AssembledPrompt {
  /** 사용한 용어 줄까지 포함한 전체 */
  text: string
  /** 사용한 용어 줄을 뺀 본문 */
  body: string
  sections: AssembledSection[]
  /** termLine을 요청했을 때만 */
  termLine?: string
  terms?: TermHit[]
}

const IMPROVE_TAG = /\s*\(\s*개선\s*[:：][^)]*\)/g

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

function withImprove(text: string, label: string | undefined, include: boolean): string {
  const base = include ? text : text.replace(IMPROVE_TAG, '')
  const l = clean(label)
  if (!include || !l || !base) return base.trim()
  return `${base.trim()}(개선: ${l})`
}

/** 이름 앞에 붙일 꾸미는 말인지(예: '학교 급식 잔반을 줄이는'). 문장으로 끝나면 false. */
function isModifier(intro: string): boolean {
  return !/[.!?다요]$/.test(intro)
}

function formBody(s: PromptState): string {
  const parts: string[] = []
  const name = clean(s.serviceName)
  const intro = clean(s.serviceIntro)
  const method = clean(s.buildMethod)
  // 만드는 방식 칸에 이미 서비스 이름을 쓴 문장이 있으면(붙여 넣은 원문, 예시) 이름 문장을 따로 만들지 않는다.
  const namedInMethod = !!name && method.includes(name)
  if (namedInMethod) {
    if (intro && !isModifier(intro)) parts.push(intro)
  } else if (name) {
    if (intro && isModifier(intro)) parts.push(`${intro} '${name}'${josa(name, '을/를')} 만들어 줘.`)
    else {
      parts.push(`'${name}'${josa(name, '을/를')} 만들어 줘.`)
      if (intro) parts.push(intro)
    }
  } else if (intro) {
    parts.push(isModifier(intro) ? `${intro} 서비스를 만들어 줘.` : intro)
  }
  const screens = (s.screens ?? []).map(clean).filter(Boolean)
  if (screens.length) parts.push(`화면은 메뉴 탭 ${screens.length}개(${screens.join(', ')})로 나누어 줘.`)
  if (method) parts.push(method)
  return parts.join(' ')
}

function screenBody(s: PromptState): string {
  const home = clean(s.home)
  const cta = clean(s.ctaLabel)
  const target = clean(s.ctaTarget)
  const parts: string[] = []
  if (cta) {
    const lead = home ? `첫 화면에는 ${home}${josa(home, '와/과')} '${cta}' CTA 버튼을 두고,` : `첫 화면에 '${cta}' CTA 버튼을 두고,`
    if (target) {
      const place = /(화면|탭|페이지)$/.test(target) ? target : `${target} 화면`
      parts.push(`${lead} 버튼을 누르면 ${place}${josa(place, '으로/로')} 이동해 줘.`)
    } else parts.push(`${lead} 가장 눈에 띄게 보여 줘.`)
  } else if (home) {
    parts.push(`첫 화면에는 ${home}${josa(home, '을/를')} 보여 줘.`)
  }
  const extra = clean(s.screenExtra)
  if (extra) parts.push(extra)
  return parts.join(' ')
}

/** 기능 한 개의 문장(번호 없이). 칸들을 띄어 이어 붙인다. */
export function featureSentence(f: PromptFeature, includeImprove = true): string {
  const joined = [f.input, f.process, f.result, f.exception].map(clean).filter(Boolean).join(' ')
  if (!joined && !clean(f.name)) return ''
  const label = f.improved ? clean(f.improveLabel) || clean(f.name) : ''
  return withImprove(joined, label, includeImprove)
}

function featuresBody(s: PromptState, includeImprove: boolean): string {
  const lines: string[] = []
  for (const f of s.features ?? []) {
    const sentence = featureSentence(f, includeImprove)
    const name = clean(f.name)
    if (!sentence && !name) continue
    lines.push(`${lines.length + 1}) ${name ? `${name}: ` : ''}${sentence}`.trim())
  }
  return lines.join('\n')
}

function commonBody(s: PromptState, includeImprove: boolean): string {
  const items = (s.common ?? []).map((c) => clean(c.text)).filter(Boolean)
  const free = clean(s.commonFree)
  const joined = [...items, free].filter(Boolean).join(' ')
  return withImprove(joined, s.commonImproveLabel, includeImprove)
}

/** 묶음별 본문. 비어 있는 묶음도 body ''로 돌려준다. */
export function assembleSections(s: PromptState, includeImprove = true): AssembledSection[] {
  const bodies: Record<SectionId, string> = {
    role: withImprove(clean(s.role), '', includeImprove),
    form: withImprove(formBody(s), '', includeImprove),
    screen: withImprove(screenBody(s), s.screenImproveLabel, includeImprove),
    features: featuresBody(s, includeImprove),
    common: commonBody(s, includeImprove),
  }
  return SECTION_ORDER.map((id) => ({ id, title: SECTION_TITLES[id], body: bodies[id] }))
}

/** 쓰인 용어를 범주별로 묶어 '사용한 용어:' 줄을 만든다. 범주 밖 용어는 '기타'로. */
export function buildTermLine(hits: TermHit[]): string {
  const groups: string[] = []
  for (const c of TERM_CATEGORIES) {
    const names = hits.filter((h) => h.category === c).map((h) => h.surface)
    if (names.length) groups.push(`${c} ${names.join(', ')}`)
  }
  const etc = hits.filter((h) => h.category === null).map((h) => h.surface)
  if (etc.length) groups.push(`기타 ${etc.join(', ')}`)
  return `사용한 용어: ${groups.join(' ')}`.trim()
}

export function assemblePrompt(s: PromptState, opts: AssembleOptions = {}): AssembledPrompt {
  const includeImprove = opts.includeImprove ?? false
  const sections = assembleSections(s, includeImprove)
  const lines: string[] = []
  for (const sec of sections) {
    if (!sec.body) continue
    if (sec.id === 'features') lines.push(`[${sec.title}]\n${sec.body}`)
    else lines.push(`[${sec.title}] ${sec.body}`)
  }
  const body = lines.join('\n')
  if (!opts.termLine || !opts.dictionary) return { text: body, body, sections }
  const terms = findTerms(body, opts.dictionary, s.extraTerms)
  const termLine = terms.length ? buildTermLine(terms) : '사용한 용어: '
  return { text: body ? `${body}\n${termLine}` : termLine, body, sections, termLine, terms }
}

/** 상태에 쓴 내용이 하나라도 있는지. */
export function isPromptStateEmpty(s: PromptState): boolean {
  return !assemblePrompt(s, { includeImprove: true }).body && !(s.extraTerms ?? []).length
}
