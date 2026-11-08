// 복사본: 손으로 고치지 말 것. scripts/sync-prompt-core.mjs가 만든다.
// 원본: edtouch01 v2/src/lib/promptBuilder/core/types.ts · 원본 커밋 7346b2667775 · sha256 284fa22dda6c1725
// 웹 서비스 구현 프롬프트 작성 도우미 — 공통 핵심(형 정의).
// 대륜고 apps/assessment가 복사해 쓴다. 브라우저·Vue 의존 금지(순수 TypeScript만).
// 원본: edtouch01 v2/src/lib/promptBuilder/core. 복사본은 손으로 고치지 않는다.

/** general = 누구나 쓰는 범용 도구(점검은 모두 참고), assessment = 수행평가 연습(조건 필수). */
export type PromptMode = 'general' | 'assessment'

/** 안내자료의 세 범주. ① 누가, 무엇으로 만드는가 ② 화면은 어떻게 움직이는가 ③ 정보는 어떻게 오가는가 */
export type TermCategory = '①' | '②' | '③'

export const TERM_CATEGORIES: TermCategory[] = ['①', '②', '③']

export const TERM_CATEGORY_LABELS: Record<TermCategory, string> = {
  '①': '누가, 무엇으로 만드는가',
  '②': '화면은 어떻게 움직이는가',
  '③': '정보는 어떻게 오가는가',
}

/** 용어 사전 한 항목. 사전은 호출하는 쪽이 만들어 넘긴다. */
export interface PromptTerm {
  id: string
  /** 화면에 보일 이름 */
  name: string
  /** 프롬프트에서 이 용어로 인정할 말(이름은 따로 넣지 않아도 찾는다) */
  aliases: string[]
  /**
   * 일상어와 겹치는 줄임말. 바로 뒤에 after 가운데 하나가 올 때만 센다.
   * 예: { text: '토스트', after: ['알림', '로 보여'] } → '토스트로 보여'는 세고 '토스트를 구워'는 세지 않는다.
   */
  contextAliases?: { text: string; after: string[] }[]
  /** 세 범주 중 하나. 범주 밖 용어는 null(개수에는 들어간다) */
  category: TermCategory | null
  /** 이 용어를 넣은 예문(용어 버튼이 칸에 넣는 문장) */
  prompt?: string
}

export type TermDictionary = PromptTerm[]

/** 사용자가 스스로 공부해 더한 용어 */
export interface ExtraTerm {
  name: string
  category: TermCategory | null
}

export interface PromptFeature {
  id: string
  name: string
  /** 무엇을 입력하면 */
  input: string
  /** 어떤 규칙으로 처리해서 */
  process: string
  /** 무엇을 보여 줄지 */
  result: string
  /** 입력하지 않았을 때, 기록이 부족할 때처럼 예외 상황 */
  exception: string
  /** assessment: 개선 방안을 반영한 기능인지 */
  improved: boolean
  /** assessment: (개선: 이름)에 들어갈 기능 이름 */
  improveLabel: string
}

/** 공통 조건 한 줄. templateId·fields는 화면이 문장 틀을 다시 그릴 때만 쓴다. 조립에는 text만 쓴다. */
export interface CommonItem {
  id: string
  text: string
  templateId?: string
  fields?: Record<string, string>
}

export interface PromptState {
  version: 1
  /** [역할] 문장 전체. 예: 너는 AI 프로덕트 엔지니어야. */
  role: string
  serviceName: string
  /** '~하는'으로 끝나는 꾸미는 말이면 이름 앞에, 문장이면 이름 뒤에 붙는다 */
  serviceIntro: string
  /** 화면(탭) 이름 목록 */
  screens: string[]
  /** [만들 형태]의 나머지 문장(만드는 방식) */
  buildMethod: string
  /** [화면 구성] 첫 화면에 둘 것 */
  home: string
  ctaLabel: string
  ctaTarget: string
  screenExtra: string
  screenImproveLabel: string
  features: PromptFeature[]
  common: CommonItem[]
  commonFree: string
  commonImproveLabel: string
  extraTerms: ExtraTerm[]
}

export type SectionId = 'role' | 'form' | 'screen' | 'features' | 'common'

export const SECTION_TITLES: Record<SectionId, string> = {
  role: '역할',
  form: '만들 형태',
  screen: '화면 구성',
  features: '기능별 동작 조건',
  common: '공통 조건',
}

export const SECTION_ORDER: SectionId[] = ['role', 'form', 'screen', 'features', 'common']

/** 점검 결과가 가리키는 자리. field는 화면의 입력칸 이름이다. */
export interface CheckTarget {
  section: SectionId | 'terms' | 'all'
  field?: string
  featureId?: string
}

export type CheckLevel = 'required' | 'advice' | 'info'

export type CheckRule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'BLANK'

export interface CheckResult {
  id: string
  rule: CheckRule
  level: CheckLevel
  ok: boolean
  message: string
  /** 줄 단위 세부 내용(빠진 칸 목록 등) */
  items?: string[]
  target?: CheckTarget
}

export interface TermHit {
  termId: string
  /** 사전의 이름 */
  name: string
  /** 프롬프트에 실제로 쓰인 말 */
  surface: string
  category: TermCategory | null
  index: number
  end: number
}
