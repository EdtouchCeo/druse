// 복사본: 손으로 고치지 말 것. scripts/sync-prompt-core.mjs가 만든다.
// 원본: edtouch01 v2/src/lib/promptBuilder/core/terms.ts · 원본 커밋 7346b2667775 · sha256 5de2efb8d0d4a95f
// 프롬프트 안에서 사전 용어를 찾는다.
// 대륜고 apps/assessment가 복사해 쓴다. 브라우저·Vue 의존 금지.
//
// 규칙
// - 이름과 별칭을 모두 찾되, 긴 말을 먼저 차지한다. "단일 HTML 파일" 안의 "HTML"은 따로 세지 않는다.
// - 영문·숫자로 시작하거나 끝나는 말은 앞뒤가 영문·숫자가 아닐 때만 인정한다("JS"가 "JSON" 안에서 걸리지 않게).
//   대소문자는 가리지 않는다. 단 일반 영어 낱말과 겹치는 약어(REST)는 대문자일 때만 센다. 한글 뒤 조사("API를")는 그대로 인정한다.
// - 말 안의 띄어쓰기는 있어도 없어도 같다("토스트 알림" = "토스트알림").
import type { ExtraTerm, PromptTerm, TermDictionary, TermHit } from './types'

interface Needle {
  term: PromptTerm
  text: string
  re: RegExp
}

const ASCII_ALNUM = /[A-Za-z0-9]/

/** 일반 영어 낱말과 겹쳐서 대문자로 쓴 경우만 용어로 세는 약어 */
export const CASE_SENSITIVE = new Set(['REST'])

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function needleRe(text: string): RegExp {
  const body = text
    .trim()
    .split(/\s+/)
    .map(escapeRe)
    .join('\\s*')
  // 앞쪽 경계에는 '.'도 넣는다('Vue.js'의 'js'가 JavaScript로 따로 세어지지 않게).
  const head = ASCII_ALNUM.test(text.trim()[0] ?? '') ? '(?<![A-Za-z0-9.])' : ''
  const tail = ASCII_ALNUM.test(text.trim().slice(-1)) ? '(?![A-Za-z0-9])' : ''
  // 대소문자는 가리지 않는다(api, Api, json, Html 모두 인정). 일반 영어 낱말과 겹치는 약어만
  // 대문자 그대로일 때 인정한다('take a rest'가 REST로 잡히지 않게).
  const flags = CASE_SENSITIVE.has(text.trim()) ? 'g' : 'gi'
  return new RegExp(`${head}${body}${tail}`, flags)
}

/** 너무 짧아 다른 낱말 속에서 걸리는 말은 뺀다(한글 한 글자, 영문 한 글자). */
function usableNeedle(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (/^[A-Za-z0-9]$/.test(t)) return false
  if (/^[가-힣]$/.test(t)) return false
  return true
}

/** 추가 용어를 사전 항목으로 바꾼다. id는 'extra:이름'. */
export function extraTermsToDictionary(extras: ExtraTerm[] = []): TermDictionary {
  const seen = new Set<string>()
  const out: TermDictionary = []
  for (const e of extras) {
    const name = (e?.name ?? '').trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ id: `extra:${name}`, name, aliases: [], category: e.category ?? null })
  }
  return out
}

function buildNeedles(dict: TermDictionary): Needle[] {
  const out: Needle[] = []
  for (const term of dict) {
    const seen = new Set<string>()
    for (const raw of [term.name, ...term.aliases]) {
      const text = (raw ?? '').trim()
      const key = text.toLowerCase().replace(/\s+/g, '')
      if (!usableNeedle(text) || seen.has(key)) continue
      seen.add(key)
      out.push({ term, text, re: needleRe(text) })
    }
    for (const ctx of term.contextAliases ?? []) {
      const text = (ctx?.text ?? '').trim()
      const after = (ctx?.after ?? []).map((a) => a.trim()).filter(Boolean)
      if (!usableNeedle(text) || !after.length) continue
      // 뒤따르는 말은 찾은 자리에 넣지 않고 확인만 한다(용어 줄에는 '토스트'만 보인다).
      const look = after.map((a) => a.split(/\s+/).map(escapeRe).join('\\s*')).join('|')
      const base = needleRe(text)
      out.push({ term, text, re: new RegExp(`${base.source}(?=\\s*(?:${look}))`, base.flags) })
    }
  }
  return out
}

/**
 * 프롬프트에 나온 용어를 모두 찾는다. 겹치는 자리는 긴 말이 차지한다.
 * 결과는 나온 순서대로이고, 같은 용어가 여러 번 나오면 모두 담는다.
 */
export function findTermOccurrences(text: string, dict: TermDictionary, extras: ExtraTerm[] = []): TermHit[] {
  const all = [...extraTermsToDictionary(extras), ...dict]
  const needles = buildNeedles(all)
  const candidates: TermHit[] = []
  for (const n of needles) {
    n.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = n.re.exec(text))) {
      if (!m[0]) {
        n.re.lastIndex += 1
        continue
      }
      candidates.push({
        termId: n.term.id,
        name: n.term.name,
        surface: m[0],
        category: n.term.category,
        index: m.index,
        end: m.index + m[0].length,
      })
    }
  }
  candidates.sort((a, b) => b.end - b.index - (a.end - a.index) || a.index - b.index)
  const taken: TermHit[] = []
  for (const c of candidates) {
    if (taken.some((t) => c.index < t.end && t.index < c.end)) continue
    taken.push(c)
  }
  return taken.sort((a, b) => a.index - b.index)
}

/** 용어별 첫 등장만 남긴다(나온 순서). */
export function findTerms(text: string, dict: TermDictionary, extras: ExtraTerm[] = []): TermHit[] {
  const seen = new Set<string>()
  const out: TermHit[] = []
  for (const h of findTermOccurrences(text, dict, extras)) {
    if (seen.has(h.termId)) continue
    seen.add(h.termId)
    out.push(h)
  }
  return out
}
