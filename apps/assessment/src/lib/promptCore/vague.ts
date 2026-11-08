// 복사본: 손으로 고치지 말 것. scripts/sync-prompt-core.mjs가 만든다.
// 원본: edtouch01 v2/src/lib/promptBuilder/core/vague.ts · 원본 커밋 7346b2667775 · sha256 492399242e12fec7
// 모호어 목록과 대체 예. AI가 사람마다 다르게 해석하는 말을 찾는다.
// 대륜고 apps/assessment가 복사해 쓴다. 브라우저·Vue 의존 금지.

export interface VagueWord {
  word: string
  /** 찾는 규칙. '잘'처럼 다른 낱말 속에 자주 들어가는 말은 앞뒤 띄어쓰기를 본다. */
  pattern: RegExp
  /** 대신 쓸 구체적인 예 */
  instead: string
}

const plain = (w: string) => new RegExp(w)

export const VAGUE_WORDS: VagueWord[] = [
  { word: '적당히', pattern: plain('적당히'), instead: '"2초 동안", "50% 이상이면"처럼 숫자와 기준을 씁니다.' },
  { word: '멋있게', pattern: plain('멋있게'), instead: '"파란 배경에 흰 글자, 둥근 모서리"처럼 색과 모양을 씁니다.' },
  { word: '멋지게', pattern: plain('멋지게'), instead: '"파란 배경에 흰 글자, 둥근 모서리"처럼 색과 모양을 씁니다.' },
  { word: '예쁘게', pattern: plain('예쁘게'), instead: '"글자 크기 18px, 카드 사이 간격 16px"처럼 크기와 간격을 씁니다.' },
  { word: '이쁘게', pattern: plain('이쁘게'), instead: '"글자 크기 18px, 카드 사이 간격 16px"처럼 크기와 간격을 씁니다.' },
  { word: '세련되게', pattern: plain('세련되게'), instead: '"흰 배경에 남색 강조색 하나만 쓴다"처럼 색과 규칙을 씁니다.' },
  { word: '깔끔하게', pattern: plain('깔끔하게'), instead: '"한 화면에 카드 3개까지, 버튼은 하나만 크게"처럼 개수와 배치를 씁니다.' },
  { word: '알아서', pattern: plain('알아서'), instead: '무엇을 어떤 기준으로 정할지 직접 씁니다. 정하지 못했으면 "[  ]"로 빈칸을 남깁니다.' },
  { word: '잘', pattern: /(^|[\s,])잘(?=[\s,.]|$)/, instead: '"입력이 틀리면 칸 아래에 이유를 보여 준다"처럼 어떻게 되어야 하는지 씁니다.' },
  { word: '좋게', pattern: plain('좋게'), instead: '무엇이 어떻게 되면 좋은지 결과로 씁니다. 예: "3초 안에 결과가 보인다".' },
  { word: '다양하게', pattern: plain('다양하게'), instead: '"메뉴 4개", "색 3가지"처럼 종류와 개수를 씁니다.' },
  { word: '적절히', pattern: plain('적절히'), instead: '"10% 이하이면 보통"처럼 판단 기준을 씁니다.' },
  { word: '많이', pattern: /(?<!가장\s?)많이/, instead: '"5개 이상", "하루 3회"처럼 수를 씁니다.' },
  { word: '편하게', pattern: plain('편하게'), instead: '"버튼 하나로 저장된다"처럼 사용자가 하는 일을 줄이는 방법을 씁니다.' },
]

export interface VagueHit {
  word: string
  instead: string
}

/** 한 칸의 글에서 모호어를 찾는다(같은 말은 한 번만). */
export function findVagueWords(text: string): VagueHit[] {
  const out: VagueHit[] = []
  if (!text) return out
  for (const v of VAGUE_WORDS) {
    if (v.pattern.test(text) && !out.some((o) => o.word === v.word)) out.push({ word: v.word, instead: v.instead })
  }
  return out
}
