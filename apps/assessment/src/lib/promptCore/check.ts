// 복사본: 손으로 고치지 말 것. scripts/sync-prompt-core.mjs가 만든다.
// 원본: edtouch01 v2/src/lib/promptBuilder/core/check.ts · 원본 커밋 7346b2667775 · sha256 1469e4591b0121e5
// 프롬프트 점검 규칙(R1~R9). 모드와 용어 사전을 인자로 받는다.
// 대륜고 apps/assessment가 복사해 쓴다. 브라우저·Vue 의존 금지.
//
// general  : 막는 항목이 없다. 개수·길이는 info, 나머지는 advice.
// assessment: 수행평가 조건(R1 용어 5개, R2 세 범주, R4 입력·처리·결과, R5 예외, 체크한 R8)은 required.
import { assemblePrompt, assembleSections, featureSentence, josa } from './assemble'
import { findTermOccurrences, findTerms } from './terms'
import { findVagueWords } from './vague'
import {
  TERM_CATEGORIES,
  TERM_CATEGORY_LABELS,
  type CheckLevel,
  type CheckResult,
  type CheckTarget,
  type PromptMode,
  type PromptState,
  type SectionId,
  type TermDictionary,
} from './types'

export interface CheckOptions {
  mode: PromptMode
  dictionary: TermDictionary
  /** assessment: 안내자료 예시의 글자 수(기준선으로 함께 보여 준다) */
  baselineLength?: number
  /** 용어 개수 기준(assessment 기본 5) */
  minTerms?: number
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** 동작을 구체적으로 정하는 말. "만들어 줘", "써서", "넣어 줘"만으로는 무엇을 하는지 알 수 없다. */
const SPECIFIC_ACTION =
  /(누르면|입력하면|고르면|선택하면|올리면|찍으면|열면|보여|표시|이동|계산|저장|바뀌|바꾸|나타|띄우|띄워|알려|안내|추천|불러|가져|반영|한 줄씩|초 동안|열리|닫|정렬|모아|세어|비교|막아|지우|숨기|나누|보내|받아|읽어|확인)/

/**
 * 예외 상황을 다루는 조건 구문. '잘못된 식습관', '장바구니 비우기'처럼 낱말만 있는 경우는 인정하지 않고
 * '~하지 않으면', '~없으면', '~부족하면', '~안 고르면'처럼 조건으로 쓴 경우만 인정한다.
 */
export const EXCEPTION_PATTERN =
  /(않으면|않고|않았을 때|않을 때|없으면|없을 때|없는 경우|없거나|부족하면|부족할 때|미만이면|미만일 때|넘으면|넘을 때|초과하면|실패[가-힣]*?\s?(면|때)|틀리면|틀렸을 때|틀린 값을 넣[가-힣]*?\s?(면|때)|빠뜨[가-힣]*?\s?(면|때)|빠지면|빠졌을 때|잘못 [가-힣]+?\s?(면|때)|잘못된 [가-힣 ]{0,12}?(넣|입력|고르|골랐|선택)[가-힣]*?\s?(면|때)|빈칸이면|빈칸일 때|빈칸으로 두면|비어 있으면|비었으면|비어 있을 때|비우고|아니면|아닐 때|벗어나[가-힣]*?\s?(면|때)|오류가 (나|생기|생겼|났)[가-힣]*?\s?(면|때)|에러가 (나|생기)[가-힣]*?\s?(면|때)|끊기면|끊겼을 때|못하면|안 고르면|안 하면|안 누르면|안 넣으면)/

/** 처리 칸의 숫자·기준. '회원', '개인'의 '회·개'에 걸리지 않게 숫자와 비교어만 본다. */
const CRITERION = /([0-9]|%|이상|이하|미만|초과|×|÷|=|\+|가장|최대|최소|평균|합계|순서대로)/

/**
 * 기능 문장 전체에서 입력·처리·결과를 알리는 말. 칸이 비었더라도 다른 칸이나 한 줄로 쓴 기능 문장에
 * 이 말이 있으면 갖춘 것으로 본다(붙여 넣은 원문과 AI 다듬기 결과는 한 칸에 통문장으로 들어온다).
 */
export const FEATURE_SIGNALS = {
  input: /(입력|고르|골라|선택|누르|눌러|올리|찍|붙여 넣|불러오|하면|으면|면,|때|에서)/,
  process: /(계산|기준|규칙|분석|추천|판단|비교|정렬|세어|합계|평균|이상|이하|미만|초과|×|÷|%|[0-9])/,
  result: /(보여|표시|알려|안내|나타|띄워|띄우|출력|그려|바꿔 줘|바뀌|저장해 줘|이동해)/,
}

/** 기능 카드에서 입력·처리·결과 가운데 빠진 것. 칸이 비었으면 기능 문장 전체에서 신호를 찾는다. */
export function featureMissingParts(f: { input: string; process: string; result: string; exception: string }): ('input' | 'process' | 'result')[] {
  const filled = [f.input, f.process, f.result, f.exception].map(clean).filter(Boolean)
  // 한 칸에만 통문장으로 쓴 경우(붙여 넣은 원문, AI 다듬기 결과)만 문장 속 신호로 판정한다.
  // 두 칸 이상 나누어 썼으면 칸이 비었는지로만 판정한다(예외 칸의 '없으면'이 입력을 대신하지 않게).
  const whole = filled.length === 1 ? filled[0] : ''
  const out: ('input' | 'process' | 'result')[] = []
  for (const key of ['input', 'process', 'result'] as const) {
    if (clean(f[key])) continue
    if (whole && FEATURE_SIGNALS[key].test(whole)) continue
    out.push(key)
  }
  return out
}

const BLANK = /\[\s*\]/g

function levelFor(mode: PromptMode, assessmentLevel: CheckLevel, generalLevel: CheckLevel): CheckLevel {
  return mode === 'assessment' ? assessmentLevel : generalLevel
}

/** 문장 단위로 나눈다(마침표·물음표·느낌표 뒤 공백, 줄바꿈). */
function sentencesOf(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = []
  const re = /[^.!?\n]+[.!?]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const t = m[0].trim()
    if (t) out.push({ text: t, start: m.index + m[0].indexOf(t) })
  }
  return out
}

/** R3: 용어 세 개 이상이 쉼표 따위로 나열되었는데 무엇을 하게 할지 서술이 없는 문장을 찾는다. */
export function findListedTerms(text: string, dict: TermDictionary, extras: PromptState['extraTerms'] = []): string[] {
  const flagged: string[] = []
  for (const sen of sentencesOf(text)) {
    const hits = findTermOccurrences(sen.text, dict, extras)
    if (!hits.length) continue
    let remainder = ''
    let cursor = 0
    for (const h of hits) {
      remainder += sen.text.slice(cursor, h.index)
      cursor = h.end
    }
    remainder += sen.text.slice(cursor)
    let listSeparators = 0
    for (let i = 1; i < hits.length; i++) {
      const gap = sen.text.slice(hits[i - 1].end, hits[i].index)
      if (/^\s*(,|·|、|와|과|및)\s*$/.test(gap)) listSeparators += 1
    }
    const listLike = hits.length >= 3 && listSeparators >= 2
    if (listLike && !SPECIFIC_ACTION.test(remainder)) flagged.push(sen.text)
  }
  return flagged
}

interface FieldText {
  target: CheckTarget
  label: string
  text: string
}

/** 점검에 쓰는 입력칸 목록(모호어 위치 안내용). */
function fieldsOf(s: PromptState): FieldText[] {
  const out: FieldText[] = [
    { target: { section: 'role', field: 'role' }, label: '[역할]', text: s.role },
    { target: { section: 'form', field: 'serviceIntro' }, label: '[만들 형태] 서비스 소개', text: s.serviceIntro },
    { target: { section: 'form', field: 'buildMethod' }, label: '[만들 형태] 만드는 방식', text: s.buildMethod },
    { target: { section: 'screen', field: 'home' }, label: '[화면 구성] 첫 화면', text: s.home },
    { target: { section: 'screen', field: 'screenExtra' }, label: '[화면 구성] 더 쓸 내용', text: s.screenExtra },
  ]
  s.features.forEach((f, i) => {
    const name = clean(f.name) || `기능 ${i + 1}`
    const parts: [keyof typeof f, string][] = [
      ['input', '입력'],
      ['process', '처리'],
      ['result', '결과'],
      ['exception', '예외'],
    ]
    for (const [field, label] of parts) {
      out.push({ target: { section: 'features', field: String(field), featureId: f.id }, label: `[기능] ${name}의 ${label}`, text: String(f[field] ?? '') })
    }
  })
  s.common.forEach((c) => out.push({ target: { section: 'common', field: `common:${c.id}` }, label: '[공통 조건]', text: c.text }))
  out.push({ target: { section: 'common', field: 'commonFree' }, label: '[공통 조건] 더 쓸 내용', text: s.commonFree })
  return out
}

export function checkPrompt(s: PromptState, opts: CheckOptions): CheckResult[] {
  const { mode, dictionary } = opts
  const minTerms = opts.minTerms ?? 5
  const results: CheckResult[] = []
  const assembled = assemblePrompt(s, { includeImprove: mode === 'assessment' })
  const body = assembled.body
  const sections = assembleSections(s, mode === 'assessment')
  const terms = findTerms(body, dictionary, s.extraTerms)
  const names = terms.map((t) => t.surface)

  /* R1 용어 개수 */
  if (mode === 'assessment') {
    const ok = terms.length >= minTerms
    results.push({
      id: 'R1',
      rule: 'R1',
      level: 'required',
      ok,
      message: ok
        ? `서비스 관련 용어를 ${terms.length}개 썼습니다.`
        : `서비스 관련 용어가 ${terms.length}개입니다. ${minTerms}개 이상 써야 합니다.`,
      items: names.length ? [names.join(', ')] : undefined,
      target: { section: 'terms' },
    })
  } else {
    results.push({
      id: 'R1',
      rule: 'R1',
      level: 'info',
      ok: true,
      message: terms.length ? `용어 ${terms.length}개가 들어 있습니다.` : '아직 들어간 용어가 없습니다. 용어 버튼으로 문장을 넣어 볼 수 있습니다.',
      items: names.length ? [names.join(', ')] : undefined,
      target: { section: 'terms' },
    })
  }

  /* R2 세 범주 */
  if (mode === 'assessment') {
    const missing = TERM_CATEGORIES.filter((c) => !terms.some((t) => t.category === c))
    results.push({
      id: 'R2',
      rule: 'R2',
      level: 'required',
      ok: missing.length === 0,
      message: missing.length === 0 ? '세 범주에서 모두 용어를 썼습니다.' : '세 범주에서 각각 1개 이상 써야 합니다. 아래 범주의 용어가 없습니다.',
      items: missing.length ? missing.map((c) => `${c} ${TERM_CATEGORY_LABELS[c]}`) : undefined,
      target: { section: 'terms' },
    })
  }

  /* R3 용어마다 동작 조건 */
  sections.forEach((sec) => {
    if (!sec.body) return
    findListedTerms(sec.body, dictionary, s.extraTerms).forEach((sentence, i) => {
      results.push({
        id: `R3:${sec.id}:${i}`,
        rule: 'R3',
        level: 'advice',
        ok: false,
        message: '용어 이름만 나열되어 있습니다. 용어마다 어떤 동작을 하게 할지 함께 씁니다.',
        items: [sentence],
        target: { section: sec.id },
      })
    })
  })

  /* R4 기능마다 입력·처리·결과 */
  {
    const level = levelFor(mode, 'required', 'advice')
    const written = s.features.filter((f) => featureSentence(f, false) || clean(f.name))
    if (!written.length) {
      results.push({
        id: 'R4',
        rule: 'R4',
        level,
        ok: false,
        message: '기능별 동작 조건이 비어 있습니다. 기능 하나를 무엇을 입력하면, 어떻게 처리해서, 무엇을 보여 줄지로 씁니다.',
        target: { section: 'features', featureId: s.features[0]?.id },
      })
    } else {
      const missing: string[] = []
      let firstTarget: CheckTarget | undefined
      s.features.forEach((f, i) => {
        if (!featureSentence(f, false) && !clean(f.name)) return
        const parts = featureMissingParts(f)
        const names = { input: '입력', process: '처리', result: '결과' }
        if (parts.length) {
          missing.push(`${clean(f.name) || `기능 ${i + 1}`}: ${parts.map((p) => names[p]).join(', ')}${josa(names[parts[parts.length - 1]], '이/가')} 보이지 않습니다.`)
          if (!firstTarget) firstTarget = { section: 'features', featureId: f.id, field: parts[0] }
        }
      })
      results.push({
        id: 'R4',
        rule: 'R4',
        level,
        ok: missing.length === 0,
        message: missing.length === 0 ? `기능 ${written.length}개 모두 입력, 처리, 결과가 있습니다.` : '입력, 처리, 결과 가운데 빠진 것이 있는 기능이 있습니다.',
        items: missing.length ? missing : undefined,
        target: firstTarget ?? { section: 'features' },
      })
    }
  }

  /* R5 예외 상황 */
  {
    // 예외 칸에 쓴 내용, 또는 기능·공통 조건 문장 속의 조건 구문만 인정한다(소개 문장의 낱말은 보지 않는다).
    const inFeature = s.features.some((f) => clean(f.exception) || EXCEPTION_PATTERN.test(featureSentence(f, false)))
    const commonText = [...s.common.map((c) => c.text), s.commonFree].join(' ')
    const inCommon = s.common.some((c) => c.templateId === 'empty') || EXCEPTION_PATTERN.test(commonText)
    const ok = inFeature || inCommon
    results.push({
      id: 'R5',
      rule: 'R5',
      level: levelFor(mode, 'required', 'advice'),
      ok,
      message: ok
        ? '예외 상황에서 어떻게 할지 정해 두었습니다.'
        : '예외 상황이 없습니다. 입력하지 않았을 때, 기록이 부족할 때처럼 예외 상황에서 어떻게 할지도 씁니다.',
      target: { section: 'features', field: 'exception', featureId: s.features[0]?.id },
    })
  }

  /* R6 모호어 */
  {
    let n = 0
    for (const f of fieldsOf(s)) {
      for (const hit of findVagueWords(f.text)) {
        results.push({
          id: `R6:${n++}`,
          rule: 'R6',
          level: 'advice',
          ok: false,
          message: `${f.label}의 "${hit.word}"${josa(hit.word, '은/는')} AI마다 다르게 해석합니다. ${hit.instead}`,
          target: f.target,
        })
      }
    }
  }

  /* R7 처리에 숫자·기준 */
  s.features.forEach((f, i) => {
    if (!clean(f.process) || CRITERION.test(f.process)) return
    results.push({
      id: `R7:${f.id}`,
      rule: 'R7',
      level: 'advice',
      ok: false,
      message: `${clean(f.name) || `기능 ${i + 1}`}의 처리 칸에 숫자나 기준이 없습니다. "50% 이상이면", "3회 미만이면"처럼 판단 기준을 쓰면 AI가 계산 규칙을 정합니다.`,
      target: { section: 'features', field: 'process', featureId: f.id },
    })
  })

  /* R8 개선 표시 */
  if (mode === 'assessment') {
    const checked = s.features.filter((f) => f.improved)
    const unnamed = checked.filter((f) => !clean(f.improveLabel) && !clean(f.name))
    const tags = [...body.matchAll(/\(\s*개선\s*[:：]\s*([^)]*)\)/g)].map((m) => clean(m[1])).filter(Boolean)
    if (checked.length || tags.length) {
      results.push({
        id: 'R8',
        rule: 'R8',
        level: checked.length ? 'required' : 'info',
        ok: unnamed.length === 0,
        message:
          unnamed.length === 0
            ? `개선 표시 ${tags.length}곳이 들어 있습니다.`
            : '개선을 반영했다고 표시한 기능에 기능 이름이 없습니다. (개선: 기능 이름)에 들어갈 이름을 씁니다.',
        items: tags.length ? [[...new Set(tags)].map((t) => `(개선: ${t})`).join(' ')] : undefined,
        target: unnamed[0] ? { section: 'features', field: 'improveLabel', featureId: unnamed[0].id } : { section: 'features' },
      })
    }
  }

  /* 빈칸 [  ] */
  {
    const blanks = (assembled.text.match(BLANK) ?? []).length
    if (blanks) {
      results.push({
        id: 'BLANK',
        rule: 'BLANK',
        level: 'advice',
        ok: false,
        message: `채우지 않은 빈칸 [  ]이 ${blanks}곳 있습니다. 숫자나 문구를 넣어 채웁니다.`,
        target: { section: 'all' },
      })
    }
  }

  /* R9 글자 수 */
  {
    const len = assembled.text.length
    const base = mode === 'assessment' && opts.baselineLength ? ` 안내자료 예시는 ${opts.baselineLength}자입니다.` : ''
    results.push({
      id: 'R9',
      rule: 'R9',
      level: 'info',
      ok: true,
      message: `지금 프롬프트는 공백을 포함해 ${len}자입니다.${base}`,
      target: { section: 'all' },
    })
  }

  return results
}

/** required 항목이 모두 통과했는지(general은 required가 없으므로 늘 true). */
export function requiredPassed(results: CheckResult[]): boolean {
  return results.filter((r) => r.level === 'required').every((r) => r.ok)
}

/** 점검 결과를 묶음 위치별로 고를 때 쓴다. */
export function resultsForSection(results: CheckResult[], section: SectionId): CheckResult[] {
  return results.filter((r) => r.target?.section === section)
}
