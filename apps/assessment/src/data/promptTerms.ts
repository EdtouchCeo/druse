// 앱 서비스 개발 용어(제시 용어 16개).
// 원본: 대륜고등학교 정보과 「웹 서비스 개발 기본 용어」 슬라이드(2026-10-29)와
// 「구현 프롬프트와 개선 보고서 작성 안내」의 범주 표·예시 '다먹 AI'.
// 용어 화면(/assessment/terms/)과 구현 프롬프트 연습 도구가 이 파일 하나를 함께 쓴다.
// 원본 문장은 그대로 옮겼다. 원본에 없던 칸은 authored에 적어 둔다.

/** 수행평가 안내의 세 범주. ① 누가·무엇으로 만드는가 ② 화면은 어떻게 움직이는가 ③ 정보는 어떻게 오가는가 */
export type PromptTermCategory = '①' | '②' | '③'

/** 용어 카드의 '화면에서 보이는 모습' 종류. 화면 쪽 그림은 TermDemo.vue가 그린다. */
export type TermDemoKind =
  | 'layers' | 'steps' | 'house' | 'compare' | 'classes' | 'icons'
  | 'spa' | 'interactive' | 'dashboard' | 'responsive' | 'toast' | 'cta'
  | 'api' | 'log'

/** 눌러 보는 동작 예시가 있는 종류. 나머지는 정적 미니 화면이다. */
export const INTERACTIVE_DEMOS: readonly TermDemoKind[] = ['spa', 'interactive', 'dashboard', 'responsive', 'toast', 'cta']

/** 원본에 없어서 새로 쓴 칸 */
export type AuthoredField = 'meaning' | 'analogy' | 'promptExample' | 'checkHow'

export interface PromptTerm {
  /** 주소 #id와 ?term=id에 쓰는 값. 바꾸면 공유 링크가 깨진다. */
  id: string
  /** 화면과 프롬프트에 쓰는 이름 */
  name: string
  /** 영문 이름이나 약자 */
  en: string
  category: PromptTermCategory
  /**
   * 프롬프트에서 이 용어를 찾을 때 함께 인정하는 표기. name은 따로 넣지 않는다.
   * 'HTML'처럼 다른 용어(단일 HTML 파일) 안에 들어가는 짧은 표기는 넣지 않았다.
   * 찾는 쪽은 긴 표기부터 맞추고 맞춘 부분을 지운 뒤 다음 용어를 찾아야 한다.
   */
  aliases: string[]
  /** ① 한 문장 뜻 */
  meaning: string
  /** ② 생활 비유 또는 생활 속 예 */
  analogy: string
  /** ④ 동작이 붙은 프롬프트 문장. 안내자료 범주 표·예시 '다먹 AI'의 문장을 먼저 쓴다. */
  promptExample: string
  /**
   * 연습 도구의 용어 버튼이 칸에 넣는 문장 틀. 서비스마다 달라지는 부분은 빈칸 [  ]으로 두어
   * 다른 앱의 기능·수치가 학생 원고에 섞이지 않게 한다. 예시 문장(promptExample)은 보여 주기만 한다.
   */
  template: string
  /** ⑤ 결과물에서 확인하는 방법. 슬라이드 24쪽 문장을 먼저 쓴다. */
  checkHow: string
  /** ③ 화면에서 보이는 모습의 종류 */
  demo: TermDemoKind
  /** 원본에 없어 새로 쓴 칸 */
  authored: AuthoredField[]
}

export interface PromptTermCategoryInfo {
  id: PromptTermCategory
  /** 안내자료 범주 표의 이름 */
  label: string
  /** 슬라이드의 묶음 이름 */
  groups: string
  /** 대륜이 캐릭터 파일 이름(/img/daeryuni/) */
  character: string
  lead: string
}

export const PROMPT_TERM_CATEGORIES: PromptTermCategoryInfo[] = [
  { id: '①', label: '누가, 무엇으로 만드는가', groups: '만드는 사람과 범위 · 만드는 재료', character: 'pose_maker.webp', lead: '역할과 재료를 정하면 AI가 어떤 파일을 어떤 도구로 만들지 정해집니다.' },
  { id: '②', label: '화면은 어떻게 움직이는가', groups: '화면의 구조와 동작', character: 'pose_explore.webp', lead: '화면이 바뀌는 방식과 안내 방식을 정하면 AI가 만들 화면의 움직임이 정해집니다.' },
  { id: '③', label: '정보는 어떻게 오가는가', groups: '정보의 연결과 처리', character: 'pose_mentor.webp', lead: '정보를 가져오고 계산하고 기록하는 방식을 정하면 화면 뒤의 처리 과정이 정해집니다.' },
]

export const PROMPT_TERMS: PromptTerm[] = [
  // ① 누가, 무엇으로 만드는가
  {
    id: 'fullstack', name: '풀스택 웹 개발', en: 'Full-stack Web Development', category: '①',
    aliases: ['풀스택 웹 개발자', '풀스택 개발', '풀스택'],
    meaning: '사용자가 보는 화면부터 데이터를 처리하는 기능까지 웹 서비스 전체를 만드는 일',
    analogy: '급식 메뉴 투표 사이트 — 투표 버튼(화면) → 표 집계(처리) → 결과 보관(저장)',
    promptExample: '너는 풀스택 웹 개발자야. 투표 버튼을 누르면 표를 세고, 결과를 저장해 다시 열어도 남아 있게 만들어 줘.',
    checkHow: '새로고침한 뒤에도 투표 결과가 남아 있는지',
    template: '너는 풀스택 웹 개발자야. [  ] 화면부터 [  ]을(를) 계산하고 저장하는 기능까지 만들어 줘.',
    demo: 'layers', authored: ['promptExample', 'checkHow'],
  },
  {
    id: 'ai-product', name: 'AI 프로덕트 엔지니어', en: 'AI Product Engineer', category: '①',
    aliases: ['AI 프로덕트'],
    meaning: 'AI 기술을 실제 사용자가 활용할 수 있는 제품과 서비스로 구현하는 개발자',
    analogy: '영어 작문 첨삭을 오래 기다리는 학생 → 문장 오류를 찾는 언어 모델 → 글을 붙여 넣으면 피드백이 나오는 앱 → 학생 반응에 따라 설명 방식 수정',
    promptExample: '너는 AI 프로덕트 엔지니어야. Tailwind CSS와 Font Awesome을 사용한 단일 HTML 파일로 만들어 줘.',
    checkHow: '처음에 정한 사용자의 문제를 넣었을 때 그 문제를 푸는 결과가 나오는지',
    template: '너는 [  ] 경험이 있는 AI 프로덕트 엔지니어야.',
    demo: 'steps', authored: ['checkHow'],
  },
  {
    id: 'html-css-js', name: 'HTML · CSS · JS', en: 'HTML · CSS · JavaScript', category: '①',
    aliases: ['HTML·CSS·JS', 'HTML, CSS, JS', 'HTML·CSS·JavaScript', 'HTML, CSS, JavaScript', 'JavaScript', '자바스크립트'],
    meaning: '웹페이지를 이루는 세 언어로, HTML은 화면에 무엇을 배치할지, CSS는 화면의 모양, JavaScript(JS)는 실제 동작을 정한다',
    analogy: 'HTML: 집의 구조 · CSS: 집의 디자인 · JavaScript(JS): 집의 작동 장치',
    promptExample: 'HTML·CSS·JS로 만들되, HTML로 입력창과 버튼을 배치하고, CSS로 색과 여백을 정하고, JS로 버튼을 누르면 입력값을 계산해 결과를 보여 줘.',
    checkHow: '버튼을 누르면 화면이 바뀌는지(JS), 색과 여백이 요청한 대로인지(CSS)',
    template: 'HTML·CSS·JS로 만들되, HTML로 [  ]을(를) 배치하고, CSS로 [  ]을(를) 정하고, JS로 [  ]을(를) 누르면 [  ]을(를) 보여 줘.',
    demo: 'house', authored: ['meaning', 'promptExample', 'checkHow'],
  },
  {
    id: 'single-html', name: '단일 HTML 파일', en: 'Single HTML File', category: '①',
    aliases: ['단일 HTML', 'HTML 파일 하나', 'HTML 파일 한 개'],
    meaning: 'HTML · CSS · JS를 index.html 하나에 모두 담은 웹페이지',
    analogy: '세 파일을 한 폴더로 묶어 전달하는 대신 파일 하나만 전달하고, 더블클릭하면 브라우저에서 바로 실행',
    promptExample: '단일 HTML 파일로 Tailwind CSS와 Font Awesome을 사용한 반응형 SPA를 만들어 줘.',
    checkHow: '파일 하나를 더블클릭해 바로 열리는지',
    template: '단일 HTML 파일로 만들어 줘.',
    demo: 'compare', authored: ['meaning', 'analogy'],
  },
  {
    id: 'tailwind', name: 'Tailwind CSS', en: 'Tailwind CSS', category: '①',
    aliases: ['Tailwind', '테일윈드'],
    meaning: '정해진 이름표(클래스)를 붙여 화면을 꾸미는 디자인 도구',
    analogy: '이름표로 꾸미는 디자인 — bg-blue-500 이름표를 붙이면 파란 배경, rounded-lg를 붙이면 모서리가 둥글게',
    promptExample: 'Tailwind CSS로 저장 버튼을 파란 배경, 흰 글자, 둥근 모서리로 꾸며 줘.',
    checkHow: '버튼과 카드에 요청한 색, 여백, 둥근 모서리가 적용되었는지',
    template: 'Tailwind CSS로 [  ] 버튼을 [  ] 배경, [  ] 글자, 둥근 모서리로 꾸며 줘.',
    demo: 'classes', authored: ['meaning', 'analogy', 'promptExample', 'checkHow'],
  },
  {
    id: 'font-awesome', name: 'Font Awesome', en: 'Font Awesome', category: '①',
    aliases: ['폰트어썸', '폰트 어썸'],
    meaning: '기능을 알려 주는 아이콘을 코드 이름으로 불러 쓰는 아이콘 모음',
    analogy: '건물 안내판의 비상구 그림처럼, 글을 읽지 않아도 무엇을 하는 버튼인지 알려 준다',
    promptExample: 'Font Awesome의 톱니바퀴 아이콘을 설정 버튼에, 휴지통 아이콘을 삭제 버튼에 붙여 줘.',
    checkHow: '검색, 설정, 삭제 버튼에 알맞은 아이콘이 보이는지',
    template: 'Font Awesome의 [  ] 아이콘을 [  ] 버튼에 붙여 줘.',
    demo: 'icons', authored: ['meaning', 'analogy', 'promptExample', 'checkHow'],
  },

  // ② 화면은 어떻게 움직이는가
  {
    id: 'spa', name: 'SPA', en: 'Single Page Application', category: '②',
    aliases: ['싱글 페이지 애플리케이션', '싱글 페이지 앱', 'Single Page Application'],
    meaning: '페이지는 처음 한 번만 불러오고, 화면을 바꿀 때 필요한 부분의 내용만 교체하는 웹앱',
    analogy: '일반 웹사이트는 페이지를 넘기는 느낌, SPA는 앱처럼 끊김 없는 전환',
    promptExample: '아래 탭을 누르면 내용만 바뀌는 SPA로 만들고, 저장하면 토스트 알림을 2초 동안 보여 줘.',
    checkHow: '탭을 누르면 화면 전체가 다시 뜨지 않고 아래 내용만 바뀌는지',
    template: '아래 탭을 누르면 내용만 바뀌는 SPA로 만들어 줘.',
    demo: 'spa', authored: ['meaning', 'checkHow'],
  },
  {
    id: 'interactive', name: '인터랙티브 웹페이지', en: 'Interactive Web Page', category: '②',
    aliases: ['인터랙티브'],
    meaning: '읽기만 하는 페이지와 달리 사용자의 행동에 따라 결과가 달라지는 웹페이지',
    analogy: '자판기처럼 누른 버튼에 따라 나오는 결과가 달라진다',
    promptExample: '과목별 공부 시간을 입력하면 대시보드의 숫자와 그래프가 바로 바뀌는 인터랙티브 웹페이지로 만들어 줘.',
    checkHow: '값을 바꾸면 숫자와 그래프가 함께 바뀌는지',
    template: '[  ]을(를) 입력하면 [  ]이(가) 바로 바뀌는 인터랙티브 웹페이지로 만들어 줘.',
    demo: 'interactive', authored: ['analogy'],
  },
  {
    id: 'dashboard', name: '대시보드', en: 'Dashboard', category: '②',
    aliases: ['Dashboard'],
    meaning: '흩어진 기록을 숫자와 그래프로 한 화면에 모아 핵심 정보를 한눈에 보여 주는 화면',
    analogy: '자동차 계기판처럼 지금 알아야 할 숫자를 한자리에 모아 보여 준다',
    promptExample: '기록 탭은 오늘 잔반량, 지난주 대비 증감, 메뉴별 막대그래프를 한눈에 보여 주는 대시보드로 만들어 줘.',
    checkHow: '값을 바꾸면 숫자와 그래프가 함께 바뀌는지',
    template: '[  ] 탭은 [  ]을(를) 한눈에 보여 주는 대시보드로 만들어 줘.',
    demo: 'dashboard', authored: ['analogy'],
  },
  {
    id: 'responsive', name: '반응형 디자인', en: 'Responsive Design', category: '②',
    aliases: ['반응형 웹', '반응형'],
    meaning: '컴퓨터, 태블릿, 스마트폰의 화면 크기에 맞춰 레이아웃이 바뀌는 디자인',
    analogy: '같은 내용, 화면 폭에 따라 배치만 변경 — 컴퓨터는 3열, 태블릿은 2열, 스마트폰은 1열',
    promptExample: '스마트폰에서는 1열로 보이는 반응형 디자인으로 해 줘.',
    checkHow: '브라우저 폭을 줄이거나 휴대폰으로 열어 배치 확인',
    template: '스마트폰에서는 [  ]열로 보이는 반응형 디자인으로 해 줘.',
    demo: 'responsive', authored: [],
  },
  {
    id: 'toast', name: '토스트 알림', en: 'Toast Notification', category: '②',
    aliases: ['토스트 메시지', '토스트'],
    meaning: '작업을 마친 뒤 화면에 잠깐 나타났다가 저절로 사라지는 짧은 알림',
    analogy: '확인 버튼으로 닫는 팝업 창과 달리 작업을 멈추지 않고 저절로 사라짐',
    promptExample: '기록을 저장하면 \'저장되었습니다\' 토스트 알림을 2초 동안 보여 주고, 기록 탭의 대시보드에 오늘 잔반량을 바로 반영해 줘.',
    checkHow: '저장·복사 버튼을 눌러 메시지가 잠깐 나타나는지',
    template: '[  ]을(를) 누르면 \'[  ]\' 토스트 알림을 [  ]초 동안 보여 줘.',
    demo: 'toast', authored: ['meaning'],
  },
  {
    id: 'cta', name: 'CTA 버튼', en: 'Call To Action', category: '②',
    aliases: ['CTA', '행동 유도 버튼'],
    meaning: '누르면 일어날 일을 버튼에 표시해 사용자의 행동을 이끄는 버튼',
    analogy: '‘확인’ 대신 ‘과제 제출하기’, ‘다음’ 대신 ‘오늘 기록 저장하기’처럼 할 행동을 동사로 안내',
    promptExample: '홈에는 오늘 잔반량 요약 카드와 \'오늘 잔반 기록하기\' CTA 버튼을 두고, 버튼을 누르면 잔반 인식 탭으로 이동해 줘.',
    checkHow: '첫 화면에서 가장 중요한 버튼이 바로 눈에 띄는지',
    template: '첫 화면에 \'[  ]\' CTA 버튼을 두고, 버튼을 누르면 [  ] 화면으로 이동해 줘.',
    demo: 'cta', authored: [],
  },

  // ③ 정보는 어떻게 오가는가
  {
    id: 'api', name: 'API', en: 'Application Programming Interface', category: '③',
    aliases: ['Application Programming Interface'],
    meaning: '서로 다른 프로그램이 정보를 주고받을 수 있도록 정해 놓은 연결 규칙',
    analogy: '손님(웹앱)이 메뉴판(API)의 방식대로 주문 → 주방(날씨 서비스)이 음식(정보) 제공',
    promptExample: '날씨 API로 대구의 오늘 날씨를 받아 \'오늘 날씨\' 칸에 기온과 함께 보여 주고, 받아 오지 못하면 \'날씨 정보를 불러오지 못했어요\'라고 안내해 줘.',
    checkHow: '정보를 받아 오지 못했을 때 안내 문구가 나오는지, API 키가 HTML 파일 안에 그대로 들어 있지 않은지',
    template: '[  ] API로 [  ] 정보를 받아 [  ]에 보여 주고, 받아 오지 못하면 \'[  ]\'라고 안내해 줘.',
    demo: 'api', authored: ['promptExample', 'checkHow'],
  },
  {
    id: 'ai-algorithm', name: 'AI 알고리즘', en: 'AI Algorithm', category: '③',
    aliases: ['인공지능 알고리즘', 'AI 추천 알고리즘'],
    meaning: '입력 정보를 분석·예측해 조건에 맞는 결과를 내는 절차',
    analogy: '단원별 문제 풀이 기록과 풀이 시간 → 자주 틀리는 유형으로 취약 단원 예측 → 다음에 풀 복습 문제 3개 추천',
    promptExample: '요일, 메뉴, 지난주 같은 메뉴의 잔반율을 입력하면 기본 조리량 × (1 - 잔반율 × 0.5)로 다음 조리량을 계산하는 AI 알고리즘을 만들고, 계산 과정을 실시간 로그로 한 줄씩 보여 줘.',
    checkHow: '실제 AI 연결인지, 단순 규칙 계산인지 설명 요청',
    template: '[  ]을(를) 입력하면 [  ] 규칙으로 [  ]을(를) 계산하는 AI 알고리즘을 만들어 줘.',
    demo: 'steps', authored: ['meaning'],
  },
  {
    id: 'realtime-log', name: '실시간 로그', en: 'Real-time Log', category: '③',
    aliases: ['처리 로그', '진행 로그'],
    meaning: '프로그램이 일하는 과정을 시각과 함께 한 줄씩 남기는 작업 과정의 기록',
    analogy: '택배 배송 조회처럼 지금 어느 단계까지 왔는지 시각과 함께 보여 준다',
    promptExample: 'AI 알고리즘의 계산 과정을 실시간 로그로 한 줄씩 보여 줘.',
    checkHow: '결과가 이상할 때 로그를 보고 어느 단계에서 문제가 생겼는지 찾을 수 있는지',
    template: '[  ] 과정을 실시간 로그로 한 줄씩 보여 줘.',
    demo: 'log', authored: ['meaning', 'analogy', 'checkHow'],
  },
  {
    id: 'qr', name: 'QR 코드', en: 'QR Code', category: '③',
    aliases: ['QR', '큐알 코드', '큐알'],
    meaning: '웹 주소를 사각형 무늬로 바꾼 것으로, 스마트폰 카메라로 비추면 긴 주소 입력 없이 페이지가 열린다',
    analogy: '수업 시작 때 칠판 화면에 QR 코드 → 학생 전원이 10초 안에 활동 페이지 접속',
    promptExample: '\'공유하기\' 버튼을 누르면 이 페이지 주소로 QR 코드를 만들어 화면 가운데에 보여 줘.',
    checkHow: '다른 기기로 찍어 같은 페이지가 열리는지',
    template: '\'[  ]\' 버튼을 누르면 이 페이지 주소로 QR 코드를 만들어 화면에 보여 줘.',
    demo: 'steps', authored: ['meaning', 'promptExample'],
  },
]

/** 슬라이드 23쪽 '용어를 담은 프롬프트 예시'. 조각마다 용어 id를 붙였다. */
export interface ExamplePromptSentence {
  /** 슬라이드의 '구성' 설명 */
  role: string
  parts: { text: string; termId?: string }[]
}

export const EXAMPLE_PROMPT: ExamplePromptSentence[] = [
  {
    role: '1문장: 역할과 만드는 방식',
    parts: [
      { text: '너는 ' }, { text: '풀스택 웹 개발', termId: 'fullstack' }, { text: '자이자 ' },
      { text: 'AI 프로덕트 엔지니어', termId: 'ai-product' }, { text: '야. ' },
      { text: '단일 HTML 파일', termId: 'single-html' }, { text: '로 ' },
      { text: 'Tailwind CSS', termId: 'tailwind' }, { text: '와 ' },
      { text: 'Font Awesome', termId: 'font-awesome' }, { text: '을 사용한 ' },
      { text: '반응형', termId: 'responsive' }, { text: ' ' },
      { text: 'SPA', termId: 'spa' }, { text: '를 만들어 줘.' },
    ],
  },
  {
    role: '2문장: 화면의 동작',
    parts: [
      { text: '과목별 공부 시간을 입력하면 ' }, { text: '대시보드', termId: 'dashboard' },
      { text: '의 숫자와 그래프가 바로 바뀌는 ' }, { text: '인터랙티브 웹페이지', termId: 'interactive' },
      { text: '로 만들고, \'오늘 기록 저장하기\' ' }, { text: 'CTA 버튼', termId: 'cta' },
      { text: '을 누르면 ' }, { text: '토스트 알림', termId: 'toast' }, { text: '을 보여 줘.' },
    ],
  },
  {
    role: '3문장: 정보 처리 기능',
    parts: [
      { text: '기록을 분석해 복습 단원을 추천하는 ' }, { text: 'AI 알고리즘', termId: 'ai-algorithm' },
      { text: ', 처리 과정을 보여 주는 ' }, { text: '실시간 로그', termId: 'realtime-log' },
      { text: ', 공유 링크용 ' }, { text: 'QR 코드', termId: 'qr' }, { text: ' 기능을 넣어 줘.' },
    ],
  },
]

export const PROMPT_TERM_SOURCE = '대륜고등학교 정보과 「웹 서비스 개발 기본 용어」, 「구현 프롬프트와 개선 보고서 작성 안내」'

/** 구현 프롬프트 연습 도구가 배포되면 true로 바꾼다. 카드의 '이 용어로 프롬프트 연습하기' 링크가 나타난다. */
export const PRACTICE_LINK_ENABLED = true
export const practiceLink = (id: string) => `/assessment/implementation-prompt/?term=${encodeURIComponent(id)}`
export const termLink = (id: string) => `/assessment/terms/#${encodeURIComponent(id)}`

export const termById = (id: string) => PROMPT_TERMS.find(t => t.id === id)
export const termsInCategory = (category: PromptTermCategory) => PROMPT_TERMS.filter(t => t.category === category)
