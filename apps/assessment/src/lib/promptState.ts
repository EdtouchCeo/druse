// 구현 프롬프트 연습의 사전 어댑터, 저장값 정규화, 조립·점검 묶음.
// core(./promptCore)는 edtouch01의 복사본이라 고치지 않는다. 대륜고 쪽 규칙은 이 파일에 둔다.
import {
  assemblePrompt, checkPrompt, emptyPromptState, isPromptStateEmpty, requiredPassed,
  type CheckResult, type PromptFeature, type PromptState, type TermCategory, type TermDictionary,
} from './promptCore'
import { PROMPT_TERMS } from '../data/promptTerms'
import { DAMEOK_BASELINE, type PromptStepKey } from '../data/promptPractice'

/** 제시 용어 16개 → core 사전. prompt는 빈칸이 있는 문장 틀이다. 학생이 더한 용어는 상태의 extraTerms로 따로 센다. */
export const PROMPT_DICTIONARY: TermDictionary = PROMPT_TERMS.map(t => ({
  id: t.id, name: t.name, aliases: [...t.aliases], category: t.category, prompt: t.template,
}))

export function assembleImplementation(state: PromptState) {
  return assemblePrompt(state, { includeImprove: true, termLine: true, dictionary: PROMPT_DICTIONARY })
}

export function checkImplementation(state: PromptState): CheckResult[] {
  return checkPrompt(state, { mode: 'assessment', dictionary: PROMPT_DICTIONARY, baselineLength: DAMEOK_BASELINE })
}

export { requiredPassed, isPromptStateEmpty, emptyPromptState }

/** 단계별 글(내 글 점검과 단계 완료 표시에 쓴다). 사전 읽기는 글이 없다. */
export function stepText(state: PromptState, key: PromptStepKey | string): string {
  const assembled = assembleImplementation(state)
  const body = (id: string) => {
    const sec = assembled.sections.find(s => s.id === id)
    if (!sec?.body) return ''
    return id === 'features' ? `[${sec.title}]
${sec.body}` : `[${sec.title}] ${sec.body}`
  }
  if (key === 'role') return [body('role'), body('form')].filter(Boolean).join('\n')
  if (key === 'screen') return body('screen')
  if (key === 'features') return body('features')
  if (key === 'common') return body('common')
  if (key === 'done') return assembled.body ? assembled.text : ''
  return ''
}

/* ── 저장값·백업 정규화 ─────────────────────────── */

/** 칸별 저장 한도. 입력 칸의 maxlength, 용어 버튼 삽입, 정규화가 모두 이 값을 쓴다. */
export const LIMITS = { text: 4000, screen: 100, screens: 30, featureName: 200, improveLabel: 200, features: 20, common: 20, commonField: 500, extraName: 60, extraTerms: 30 } as const
const CATEGORIES: (TermCategory | null)[] = ['①', '②', '③', null]

/** 한도를 넘은 칸은 잘라 살리고, 잘린 칸 수를 센다. */
export interface NormalizeReport { trimmed: number }
type Mode = 'strict' | 'lenient'

function fail(): never { throw new Error('구현 프롬프트 항목의 형식이 올바르지 않습니다.') }

/**
 * 저장본·백업의 implementation을 아는 칸만 다시 만든다. 값이 없으면(예전 원고) 빈 상태를 돌려준다.
 * 글자 수나 개수가 한도를 넘으면 거절하지 않고 잘라 살리며 report.trimmed를 늘린다.
 * 형식(자료형)이 틀린 값은 strict(백업 불러오기)에서는 오류를 내고, lenient(기기 저장소)에서는 그 칸만 비운다.
 */
export function normalizeImplementation(value: unknown, report: NormalizeReport = { trimmed: 0 }, mode: Mode = 'strict'): PromptState {
  const bad = <T>(fallback: T): T => { if (mode === 'strict') fail(); return fallback }
  const obj = (v: unknown): Record<string, unknown> | null => (!v || typeof v !== 'object' || Array.isArray(v)) ? bad(null) : v as Record<string, unknown>
  const text = (v: unknown, max: number = LIMITS.text): string => {
    if (v === undefined || v === null) return ''
    if (typeof v !== 'string') return bad('')
    if (v.length > max) { report.trimmed++; return v.slice(0, max) }
    return v
  }
  const list = (v: unknown, max: number): unknown[] => {
    if (v === undefined || v === null) return []
    if (!Array.isArray(v)) return bad([])
    if (v.length > max) { report.trimmed++; return v.slice(0, max) }
    return v
  }
  if (value === undefined || value === null) return emptyPromptState()
  const o = obj(value)
  const s = emptyPromptState()
  if (!o) return s
  for (const key of ['role', 'serviceName', 'serviceIntro', 'buildMethod', 'home', 'ctaLabel', 'ctaTarget', 'screenExtra', 'screenImproveLabel', 'commonFree', 'commonImproveLabel'] as const) s[key] = text(o[key])
  s.screens = list(o.screens, LIMITS.screens).map(v => text(v, LIMITS.screen)).filter(Boolean)
  const features = list(o.features, LIMITS.features).map((v, index): PromptFeature | null => {
    const f = obj(v); if (!f) return null
    return {
      id: text(f.id, 60) || `f${index + 1}`, name: text(f.name, LIMITS.featureName), input: text(f.input), process: text(f.process), result: text(f.result),
      exception: text(f.exception), improved: f.improved === true, improveLabel: text(f.improveLabel, LIMITS.improveLabel),
    }
  }).filter((f): f is PromptFeature => !!f)
  s.features = features.length ? features : s.features
  s.common = list(o.common, LIMITS.common).flatMap(v => {
    const c = obj(v); if (!c) return []
    const rawFields = c.fields === undefined ? undefined : obj(c.fields)
    const fields = rawFields ? Object.fromEntries(Object.entries(rawFields).slice(0, 10).map(([k, val]) => [k.slice(0, 40), text(val, LIMITS.commonField)])) : undefined
    return [{ id: text(c.id, 60), text: text(c.text), ...(c.templateId === undefined ? {} : { templateId: text(c.templateId, 60) }), ...(fields ? { fields } : {}) }]
  })
  s.extraTerms = list(o.extraTerms, LIMITS.extraTerms).flatMap(v => {
    const e = obj(v); if (!e) return []
    if (!CATEGORIES.includes(e.category as TermCategory | null)) return bad([])
    const name = text(e.name, LIMITS.extraName)
    return name ? [{ name, category: e.category as TermCategory | null }] : []
  })
  return s
}

/** 기기 저장소에서 읽은 원고. 거절하지 않고 칸별로 잘라 살린다(원고 전체를 비우면 자동 저장이 덮어써 되돌릴 수 없다). */
export function implementationFromStorage(value: unknown, report: NormalizeReport = { trimmed: 0 }): PromptState {
  try { return normalizeImplementation(value, report, 'lenient') } catch { return emptyPromptState() }
}
