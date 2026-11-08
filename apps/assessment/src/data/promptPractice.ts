// 구현 프롬프트 연습(/assessment/implementation-prompt/)의 단계 안내와 예시.
// 작성 방법·용어 사용 조건·나쁜 예·제출 전 점검·예시 '다먹 AI'는 대륜고등학교 정보과
// 「인공지능 서비스 구현: 구현 프롬프트와 개선 보고서 작성 안내」의 문장을 그대로 옮겼다.
// 공통 조건 문장 틀과 예시 상태 분해는 edtouch01 v2/src/data/promptBuilder.ts에서 옮겼다.
// 질문·단서·문장 틀은 이 도구를 위해 새로 쓴 것이다.
import { emptyFeature, josa } from '../lib/promptCore'
import type { PromptState } from '../lib/promptCore'
import type { Guide } from '../lib/types'

export type PromptStepKey = 'read' | 'role' | 'screen' | 'features' | 'common' | 'done'


/** 제출 전 점검(안내자료 그대로). 구현 프롬프트에 해당하는 항목만 골랐다. */
export const SUBMIT_CHECKS = [
  '프롬프트에 설계안의 AI 핵심 기능이 모두 들어 있고, 기능마다 입력 → 처리 → 출력이 있는가?',
  '서비스 관련 용어(자료에 나온 용어나 스스로 공부한 용어)를 5개 이상, 세 범주에서 각각 1개 이상 썼는가? 용어마다 동작 조건이 붙어 있는가?',
  '개선 방안이 최종 프롬프트에 (개선: 기능 이름)으로 반영되어 있는가?',
]

export const PROMPT_GUIDES: (Guide & { key: PromptStepKey })[] = [
  {
    key: 'read', label: '사전 읽기',
    question: '구현 프롬프트에는 무엇을 어떤 순서로 쓰나요?',
    clue: '', starter: '',
    checks: ['다섯 묶음의 순서를 말할 수 있나요?', '용어 사용 조건(5개 이상, 세 범주에서 각각 1개 이상)을 확인했나요?', '설계안의 [입력] → [처리] → [결과] 표시를 옆에 두었나요?'],
  },
  {
    key: 'role', label: '역할과 만들 형태',
    question: 'AI에게 어떤 역할을 맡기고, 무엇으로 어떤 형태의 서비스를 만들게 하나요?',
    clue: '역할은 한 문장으로 씁니다. 서비스 이름과 화면(탭) 목록은 피그마 설계안에서 그대로 가져옵니다. 만드는 방식에는 파일 형태, 디자인 도구, 화면 전환 방식, 화면 크기 대응을 적습니다.',
    starter: '너는 ___ 경험이 있는 ___야. / ___와 ___을 사용한 ___로 만들어 줘. 아래쪽 메뉴 탭을 누르면 ___로 만들고, 스마트폰에서는 ___로 해 줘.',
    checks: ['역할 문장에 ① 범주 용어가 들어 있나요?', '설계안의 화면(탭) 이름을 빠짐없이 옮겼나요?', '만드는 방식에 파일 형태와 화면 전환 방식이 들어 있나요?'],
  },
  {
    key: 'screen', label: '화면 구성',
    question: '첫 화면에 무엇을 두고, 가장 중요한 버튼을 누르면 어디로 가나요?',
    clue: '설계안의 프로토타입 연결을 그대로 옮깁니다. 첫 화면에서 사용자가 가장 먼저 할 행동 하나를 CTA 버튼으로 정하고, 누르면 이동할 화면을 적습니다.',
    starter: '첫 화면에는 ___와 \'___\' CTA 버튼을 두고, 버튼을 누르면 ___ 탭으로 이동해 줘.',
    checks: ['첫 화면에 보일 정보가 구체적인가요?', 'CTA 버튼 문구가 누르면 일어날 일을 동사로 나타내나요?', '버튼을 누른 뒤 이동할 화면이 설계안의 연결과 같나요?'],
  },
  {
    key: 'features', label: '기능별 동작 조건',
    question: '기능마다 무엇을 입력하면, 어떤 규칙으로 처리해서, 무엇을 보여 주나요?',
    clue: '설계안의 [입력] → [처리] → [결과] 상자를 그대로 옮깁니다. 처리 칸에는 숫자, 기준, 계산식을 씁니다. 입력하지 않았을 때나 기록이 부족할 때 어떻게 할지도 적습니다.',
    starter: '___을 입력하고 \'___\'를 누르면, / ___ 규칙(기준 ___)으로 ___을 계산해 / ___로 보여 줘. / ___이 없으면 \'___\'라고 안내해 줘.',
    checks: ['기능마다 입력, 처리, 결과 세 칸을 채웠나요?', '처리 칸에 숫자나 기준이 들어 있나요?', '예외 상황을 한 가지 이상 정했나요?', '개선 방안을 반영한 기능에 (개선: 기능 이름)을 표시했나요?'],
  },
  {
    key: 'common', label: '공통 조건',
    question: '여러 기능에 함께 적용할 조건은 무엇인가요?',
    clue: '저장 안내, 저장한 값의 공유, 한눈에 보는 화면, 빈 입력 안내처럼 화면 여러 곳에 걸리는 조건을 고릅니다. 고른 문장의 빈칸에 버튼 이름, 문구, 초를 채웁니다.',
    starter: '\'___\'를 누르면 \'___\' 토스트 알림을 ___초 동안 보여 줘. 저장한 값을 ___에서도 그대로 쓰게 해 줘.',
    checks: ['고른 문장에 빈칸 [  ]이 남아 있지 않나요?', '저장한 값이 어느 화면에서 쓰이는지 적었나요?', '빈 입력처럼 예외 상황에서 보일 안내 문구가 있나요?'],
  },
  {
    key: 'done', label: '완성과 점검',
    question: '조립한 프롬프트가 수행평가 조건을 모두 갖췄나요?',
    clue: '아래 점검표의 필수 조건부터 확인합니다. 표에 없는 용어를 스스로 공부해 썼다면 추가 용어 칸에 이름과 범주를 적어 개수에 넣습니다.',
    starter: '',
    checks: SUBMIT_CHECKS,
  },
]

/** 단계별 용어 버튼(제시 용어 id) */
export const STEP_TERM_IDS: Partial<Record<PromptStepKey, string[]>> = {
  role: ['fullstack', 'ai-product', 'html-css-js', 'single-html', 'tailwind', 'font-awesome', 'spa', 'responsive'],
  screen: ['cta', 'spa', 'responsive', 'dashboard', 'interactive'],
  features: ['interactive', 'ai-algorithm', 'realtime-log', 'api', 'qr', 'dashboard'],
  common: ['toast', 'dashboard', 'realtime-log', 'api', 'qr'],
}

/* ── 사전 읽기(안내자료 그대로) ─────────────────── */

export const READING = {
  order: '[역할] → [만들 형태] → [화면 구성] → [기능별 동작 조건] → [공통 조건]',
  methods: [
    '기능별 동작 조건은 "무엇을 입력하면 → 어떤 규칙으로 처리해서 → 무엇을 보여 줄지"를 한 기능씩 씁니다. 설계안의 [입력] → [처리] → [결과] 표시를 그대로 옮기면 됩니다.',
    '입력하지 않았을 때, 기록이 부족할 때처럼 예외 상황에서 어떻게 할지도 씁니다.',
    '숫자, 기준, 문구를 구체적으로 씁니다. "적당히", "멋있게" 대신 "2초 동안", "50% 이상이면"처럼 씁니다.',
    '2번에서 쓴 개선 방안이 프롬프트 어디에 반영됐는지 문장 끝에 (개선: 잔반 인식)처럼 기능 이름으로 표시합니다.',
  ],
  termRule: '웹 서비스 관련 용어를 5개 이상 쓰고, 세 범주에서 각각 1개 이상 씁니다. 용어 이름만 나열하지 말고 어떤 동작을 하게 할지와 함께 씁니다.',
  termNote: '「웹 서비스 개발 기본 용어」 자료에 없더라도 스스로 공부한 용어(예: 프론트엔드, 백엔드, 데이터베이스 등)를 써도 되며, 성격에 맞는 범주로 나누어 셉니다.',
  submitNote: '제출하는 프롬프트는 초안이 아니라, 개선 방안을 반영하여 완성한 최종 프롬프트입니다.',
}

/* ── 공통 조건 문장 틀 ───────────────────────────── */

export interface CommonField { key: string; label: string; placeholder: string }
export interface CommonTemplate { id: string; label: string; effect: string; fields: CommonField[]; render: (f: Record<string, string>) => string }

const v = (f: Record<string, string>, k: string) => (f[k] ?? '').trim() || '[  ]'
const j = (word: string, pair: '을/를' | '은/는') => (word === '[  ]' ? `${pair.split('/')[0]}(${pair.split('/')[1]})` : josa(word, pair))

export const COMMON_TEMPLATES: CommonTemplate[] = [
  {
    id: 'toast', label: '저장 안내(토스트 알림)', effect: '저장 버튼을 누르면 화면 아래에 문구가 잠깐 나타났다 사라집니다.',
    fields: [{ key: 'button', label: '버튼 이름', placeholder: '예: 저장하기' }, { key: 'message', label: '보일 문구', placeholder: '예: 저장되었습니다' }, { key: 'seconds', label: '보이는 시간(초)', placeholder: '예: 2' }],
    render: f => { const b = v(f, 'button'); return `'${b}'${j(b, '을/를')} 누르면 '${v(f, 'message')}' 토스트 알림을 ${v(f, 'seconds')}초 동안 보여 줘.` },
  },
  {
    id: 'share', label: '저장한 값을 다른 화면에서도 쓰기', effect: '한 화면에서 저장한 값이 다른 탭에서도 그대로 보입니다.',
    fields: [{ key: 'tabs', label: '함께 쓸 화면', placeholder: '예: 배식량 추천과 기록 탭' }],
    render: f => `저장한 값을 ${v(f, 'tabs')}에서도 그대로 쓰게 해 줘.`,
  },
  {
    id: 'dashboard', label: '한눈에 보는 화면(대시보드)', effect: '여러 숫자와 그래프가 한 화면에 모여 보입니다.',
    fields: [{ key: 'tab', label: '화면 이름', placeholder: '예: 기록 탭' }, { key: 'items', label: '보여 줄 것', placeholder: '예: 오늘 잔반량, 지난주 대비 증감, 메뉴별 막대그래프' }],
    render: f => { const t = v(f, 'tab'); const items = v(f, 'items'); return `${t}${j(t, '은/는')} ${items}${j(items, '을/를')} 한눈에 보여 주는 대시보드로 만들어 줘.` },
  },
  {
    id: 'empty', label: '빈 입력 안내', effect: '입력을 빠뜨리고 버튼을 누르면 무엇을 채워야 하는지 알려 줍니다.',
    fields: [{ key: 'what', label: '빠뜨릴 수 있는 입력', placeholder: '예: 남긴 정도' }, { key: 'button', label: '버튼 이름', placeholder: '예: 분석하기' }, { key: 'message', label: '안내 문구', placeholder: '예: 모든 메뉴의 남긴 정도를 골라 주세요' }],
    render: f => { const w = v(f, 'what'); const b = v(f, 'button'); return `${w}${j(w, '을/를')} 입력하지 않고 '${b}'${j(b, '을/를')} 누르면 '${v(f, 'message')}'라고 안내해 줘.` },
  },
  {
    id: 'log', label: '진행 과정 보여 주기(실시간 로그)', effect: '계산하는 동안 무엇을 하고 있는지 화면 아래에 한 줄씩 나타납니다.',
    fields: [{ key: 'process', label: '보여 줄 과정', placeholder: '예: 조리량 계산 과정' }],
    render: f => { const p = v(f, 'process'); return `${p}${j(p, '을/를')} 실시간 로그로 화면 아래에 한 줄씩 보여 줘.` },
  },
]

/* ── 나쁜 예와 고친 예(안내자료 그대로) ──────────── */

export const BAD_GOOD_EXAMPLES: { bad: string; good: string }[] = [
  { bad: '급식 잔반 줄이는 앱 멋있게 만들어 줘.', good: "남긴 정도(0, 25, 50, 75, 100%)를 메뉴마다 고르고 '분석하기' CTA 버튼을 누르면, 배식량 × 남긴 정도로 메뉴별 잔반량(g)을 계산해 표로 보여 줘." },
  { bad: 'SPA, 토스트 알림, API, 대시보드를 써서 만들어 줘.', good: "기록을 저장하면 '저장되었습니다' 토스트 알림을 2초 동안 보여 주고, 기록 탭의 대시보드에 오늘 잔반량을 바로 반영해 줘." },
]

/* ── 예시 '다먹 AI'(안내자료 예시 전문) ──────────── */

export const EXAMPLE_NOTICE = '안내자료의 예시입니다. 그대로 제출하면 안 됩니다.'

export const DAMEOK_PROMPT_TEXT = `[역할] 너는 풀스택 웹 개발 경험이 있는 AI 프로덕트 엔지니어야.
[만들 형태] 학교 급식 잔반을 줄이는 '다먹 AI'를 Tailwind CSS와 Font Awesome을 사용한 단일 HTML 파일로 만들어 줘. 아래쪽 메뉴 탭 6개(홈, 잔반 인식, 배식량 추천, 조리량 예측, 메뉴 조합, 기록)를 누르면 같은 화면에서 내용만 바뀌는 SPA로 만들고, 스마트폰에서는 1열로 보이는 반응형 디자인으로 해 줘.
[화면 구성] 홈에는 오늘 잔반량 요약 카드와 '오늘 잔반 기록하기' CTA 버튼을 두고, 버튼을 누르면 잔반 인식 탭으로 이동해 줘.(개선: 기록 저장과 화면 이동)
[기능별 동작 조건]
1) 잔반 인식: 오늘 메뉴 4개(밥 210g, 국 250g, 시금치나물 70g, 고등어구이 80g)마다 남긴 정도(0, 25, 50, 75, 100%)를 고르고 '분석하기'를 누르면, 배식량 × 남긴 정도로 메뉴별 잔반량(g)을 계산해 표로 보여 주고 표 아래에 계산식을 보여 줘.(개선: 잔반 인식)
2) 배식량 추천: 최근 기록에서 평균 50% 이상 남긴 메뉴는 '조금', 10% 이하인 메뉴는 '보통'으로 추천하고, "최근 5번 중 4번 절반 이상 남김"처럼 추천 이유를 한 문장으로 보여 줘. 기록이 3회 미만이면 '기록이 더 필요해요'와 함께 '보통'을 추천해 줘.(개선: 배식량 추천)
3) 조리량 예측: 요일, 메뉴, 지난주 같은 메뉴의 잔반율을 입력하면 기본 조리량 × (1 - 잔반율 × 0.5)로 다음 조리량을 계산하는 AI 알고리즘을 만들고, 계산 과정을 실시간 로그로 한 줄씩 보여 줘.
4) 메뉴 조합 제안: 잔반율이 가장 높은 반찬 1개와, 함께 나왔을 때 잔반율이 낮았던 메뉴 조합 2개를 보여 줘.
[공통 조건] 잔반 인식에서 '저장하기'를 누르면 '저장되었습니다' 토스트 알림을 2초 동안 보여 주고, 저장한 값을 배식량 추천과 기록 탭에서도 그대로 쓰게 해 줘. 기록 탭은 오늘 잔반량, 지난주 대비 증감, 메뉴별 막대그래프를 한눈에 보여 주는 대시보드로 만들어 줘.(개선: 기록 저장과 화면 이동) 남긴 정도를 고르지 않고 '분석하기'를 누르면 '모든 메뉴의 남긴 정도를 골라 주세요'라고 안내해 줘.
사용한 용어: ①풀스택 웹 개발, AI 프로덕트 엔지니어, Tailwind CSS, Font Awesome, 단일 HTML 파일 ② SPA, 반응형 디자인, CTA 버튼, 토스트 알림, 대시보드 ③ AI 알고리즘, 실시간 로그`

/** 예시의 '사용한 용어' 줄에 적힌 용어 */
export const DAMEOK_TERMS = ['풀스택 웹 개발', 'AI 프로덕트 엔지니어', 'Tailwind CSS', 'Font Awesome', '단일 HTML 파일', 'SPA', '반응형 디자인', 'CTA 버튼', '토스트 알림', '대시보드', 'AI 알고리즘', '실시간 로그']

/** 예시 원문의 프롬프트 본문 글자 수(사용한 용어 줄 제외). 글자 수 기준선으로 보여 준다. */
export const DAMEOK_BASELINE = DAMEOK_PROMPT_TEXT.split('\n사용한 용어:')[0]!.length

/**
 * 예시를 입력 상태로 나눈 것. 기능 칸은 원문 문장을 끊어 담아 조립하면 원문 기능 네 줄과 같다.
 * [만들 형태]·[화면 구성]은 칸으로 문장을 만들기 때문에 원문과 다르다('다먹 AI'를 만들어 줘. 화면은 메뉴 탭 6개(…)로 나누어 줘.'가 따로 들어가고 '홈에는'이 '첫 화면에는'이 된다).
 * 화면의 '예제로 익히기'는 원문 DAMEOK_PROMPT_TEXT를 보여 주고, 이 함수는 점검 시험에만 쓴다.
 */
export function dameokState(): PromptState {
  const f = (id: string, name: string, input: string, process: string, result: string, exception = '', improveLabel = '') =>
    ({ ...emptyFeature(id), name, input, process, result, exception, improved: !!improveLabel, improveLabel })
  return {
    version: 1,
    role: '너는 풀스택 웹 개발 경험이 있는 AI 프로덕트 엔지니어야.',
    serviceName: '다먹 AI',
    serviceIntro: '학교 급식 잔반을 줄이는',
    screens: ['홈', '잔반 인식', '배식량 추천', '조리량 예측', '메뉴 조합', '기록'],
    buildMethod: 'Tailwind CSS와 Font Awesome을 사용한 단일 HTML 파일로 만들어 줘. 아래쪽 메뉴 탭을 누르면 같은 화면에서 내용만 바뀌는 SPA로 만들고, 스마트폰에서는 1열로 보이는 반응형 디자인으로 해 줘.',
    home: '오늘 잔반량 요약 카드',
    ctaLabel: '오늘 잔반 기록하기',
    ctaTarget: '잔반 인식 탭',
    screenExtra: '',
    screenImproveLabel: '기록 저장과 화면 이동',
    features: [
      f('ex1', '잔반 인식', "오늘 메뉴 4개(밥 210g, 국 250g, 시금치나물 70g, 고등어구이 80g)마다 남긴 정도(0, 25, 50, 75, 100%)를 고르고 '분석하기'를 누르면,", '배식량 × 남긴 정도로 메뉴별 잔반량(g)을 계산해', '표로 보여 주고 표 아래에 계산식을 보여 줘.', '', '잔반 인식'),
      f('ex2', '배식량 추천', '최근 기록에서', "평균 50% 이상 남긴 메뉴는 '조금', 10% 이하인 메뉴는 '보통'으로 추천하고,", '"최근 5번 중 4번 절반 이상 남김"처럼 추천 이유를 한 문장으로 보여 줘.', "기록이 3회 미만이면 '기록이 더 필요해요'와 함께 '보통'을 추천해 줘.", '배식량 추천'),
      f('ex3', '조리량 예측', '요일, 메뉴, 지난주 같은 메뉴의 잔반율을 입력하면', '기본 조리량 × (1 - 잔반율 × 0.5)로 다음 조리량을 계산하는 AI 알고리즘을 만들고,', '계산 과정을 실시간 로그로 한 줄씩 보여 줘.'),
      f('ex4', '메뉴 조합 제안', '잔반율이 가장 높은 반찬 1개와,', '함께 나왔을 때 잔반율이 낮았던 메뉴 조합 2개를', '보여 줘.'),
    ],
    common: [],
    commonFree: "잔반 인식에서 '저장하기'를 누르면 '저장되었습니다' 토스트 알림을 2초 동안 보여 주고, 저장한 값을 배식량 추천과 기록 탭에서도 그대로 쓰게 해 줘. 기록 탭은 오늘 잔반량, 지난주 대비 증감, 메뉴별 막대그래프를 한눈에 보여 주는 대시보드로 만들어 줘.(개선: 기록 저장과 화면 이동) 남긴 정도를 고르지 않고 '분석하기'를 누르면 '모든 메뉴의 남긴 정도를 골라 주세요'라고 안내해 줘.",
    commonImproveLabel: '',
    extraTerms: [],
  }
}
