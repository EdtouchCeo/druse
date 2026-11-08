<script setup lang="ts">
// 용어 카드의 '화면에서 보이는 모습'. 슬라이드의 표·흐름을 그대로 옮긴 정적 미니 화면과,
// 토스트·CTA·대시보드·반응형·SPA·인터랙티브의 눌러 보는 예시를 그린다. 서버 전송 없음.
import { computed, onBeforeUnmount, ref } from 'vue'
import { ArrowDown, ArrowRight, Copy, QrCode, Search, Settings, Trash2, User } from 'lucide-vue-next'
import type { PromptTerm } from '../data/promptTerms'

const props = defineProps<{ term: PromptTerm }>()
const id = computed(() => props.term.id)

// 단계형 그림(슬라이드 5·20·22쪽)
const STEPS: Record<string, { title: string; text: string }[]> = {
  'ai-product': [
    { title: '사용자 문제 발견', text: '영어 작문 첨삭을 오래 기다리는 학생' },
    { title: 'AI 기술 선택', text: '문장 오류를 찾는 언어 모델' },
    { title: '제품으로 구현', text: '글을 붙여 넣으면 피드백이 나오는 앱' },
    { title: '사용과 개선', text: '학생 반응에 따라 설명 방식 수정' },
  ],
  'ai-algorithm': [
    { title: '입력 정보', text: '단원별 문제 풀이 기록과 풀이 시간' },
    { title: '분석·예측', text: '자주 틀리는 유형으로 취약 단원 예측' },
    { title: '조건에 맞는 결과', text: '다음에 풀 복습 문제 3개 추천' },
  ],
  qr: [
    { title: '주소 준비', text: '완성한 웹앱이나 활동지의 웹 주소' },
    { title: 'QR 코드 생성', text: '주소를 사각형 무늬로 변환' },
    { title: '카메라로 스캔', text: '스마트폰 기본 카메라로 비추기' },
    { title: '바로 접속', text: '긴 주소 입력 없이 페이지 열기' },
  ],
}
const STEP_NOTES: Record<string, string> = {
  'ai-product': '핵심: AI 기술을 실제 사용자가 활용할 수 있는 제품과 서비스로 구현하는 개발자',
  'ai-algorithm': '활용 원칙: 추천 결과는 판단을 돕는 자료이고, 최종 선택은 학생과 교사가 합니다.',
  qr: '예시: 수업 시작 때 칠판 화면에 QR 코드를 띄우면 학생 전원이 10초 안에 활동 페이지에 접속합니다.',
}

// SPA(슬라이드 12쪽의 학습 앱 탭)
const SPA_TABS = [
  { key: 'todo', label: '오늘 할 일', lines: ['수학 문제 10개 풀기', '영어 단어 20개 외우기'] },
  { key: 'record', label: '기록', lines: ['어제 공부 시간 120분', '그제 공부 시간 95분'] },
  { key: 'stats', label: '통계', lines: ['이번 주 평균 110분', '가장 많이 공부한 과목: 수학'] },
]
const spaTab = ref('todo')
const spaLoads = ref(1)
const spaChanges = ref(0)
const spaCurrent = computed(() => SPA_TABS.find(t => t.key === spaTab.value)!)
function selectSpa(key: string) { if (key !== spaTab.value) { spaTab.value = key; spaChanges.value++ } }

// 인터랙티브(슬라이드 13쪽: 국어 60분, 수학 90분, 영어 30분)
const subjects = ref([
  { name: '국어', minutes: 60, color: '#2a5298' },
  { name: '수학', minutes: 90, color: '#e8a020' },
  { name: '영어', minutes: 30, color: '#1f8b6f' },
])
function minutesOf(value: number) { return Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), 600) : 0 }
const total = computed(() => subjects.value.reduce((sum, s) => sum + minutesOf(s.minutes), 0))
const pie = computed(() => {
  if (!total.value) return 'conic-gradient(#e2e8f0 0 100%)'
  let start = 0
  const stops = subjects.value.map(s => { const end = start + minutesOf(s.minutes) / total.value * 100; const stop = `${s.color} ${start}% ${end}%`; start = end; return stop })
  return `conic-gradient(${stops.join(', ')})`
})
const percent = (minutes: number) => total.value ? Math.round(minutesOf(minutes) / total.value * 100) : 0

// 대시보드(슬라이드 14쪽 가상 예시)
const done = ref(4)
const GOAL = 6

// 반응형(슬라이드 15쪽)
const DEVICES = [
  { key: 'pc', label: '컴퓨터', columns: 3 },
  { key: 'tablet', label: '태블릿', columns: 2 },
  { key: 'phone', label: '스마트폰', columns: 1 },
] as const
const device = ref<(typeof DEVICES)[number]['key']>('pc')
const columns = computed(() => DEVICES.find(d => d.key === device.value)!.columns)

// 토스트 알림(슬라이드 16쪽)
const TOASTS = [
  { button: '기록 저장하기', message: '저장되었습니다' },
  { button: '링크 공유하기', message: '링크가 복사되었습니다' },
  { button: '연결이 끊겼을 때', message: '연결을 확인하세요' },
]
const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(message: string) { toastMessage.value = ''; clearTimeout(toastTimer); requestAnimationFrame(() => { toastMessage.value = message }); toastTimer = setTimeout(() => { toastMessage.value = '' }, 2000) }
onBeforeUnmount(() => clearTimeout(toastTimer))

// CTA 버튼(슬라이드 17쪽)
const CTA_ROWS = [
  { vague: '확인', cta: '과제 제출하기', change: '누르면 일어날 일을 버튼에 표시' },
  { vague: '다음', cta: '오늘 기록 저장하기', change: '사용자가 할 행동을 동사로 안내' },
  { vague: '클릭', cta: '퀴즈 시작하기', change: '그 화면의 핵심 행동 하나를 강조' },
]
const ctaOn = ref(false)
const ctaPressed = ref('')
</script>

<template>
  <div class="term-demo" :data-demo="term.demo">
    <!-- 풀스택: 세 층 -->
    <template v-if="id === 'fullstack'">
      <ol class="demo-flow">
        <li><strong>화면 (프론트엔드)</strong><span>사용자가 보고 누르는 부분</span><em>투표 버튼</em></li>
        <li aria-hidden="true" class="flow-arrow"><ArrowRight :size="20" /></li>
        <li><strong>처리 (백엔드)</strong><span>요청을 받아 계산·판단</span><em>표 집계</em></li>
        <li aria-hidden="true" class="flow-arrow"><ArrowRight :size="20" /></li>
        <li><strong>저장 (데이터베이스)</strong><span>정보를 모아 보관</span><em>결과 보관</em></li>
      </ol>
      <p class="demo-caption">화살표는 사용자의 요청이 처리되는 방향입니다.</p>
    </template>

    <!-- 단계형 -->
    <template v-else-if="STEPS[id]">
      <ol class="demo-steps">
        <li v-for="(s, index) in STEPS[id]" :key="s.title"><span class="step-no">{{ String(index + 1).padStart(2, '0') }}</span><strong><QrCode v-if="id === 'qr' && index === 1" :size="18" /> {{ s.title }}</strong><span>{{ s.text }}</span></li>
      </ol>
      <p class="demo-caption">{{ STEP_NOTES[id] }}</p>
    </template>

    <!-- HTML·CSS·JS: 집 -->
    <template v-else-if="id === 'html-css-js'">
      <div class="demo-house">
        <div><span class="house-tag">HTML</span><strong>집의 구조</strong><span>제목, 문단, 버튼, 입력창처럼 화면에 무엇을 배치할지 결정</span><div class="house-sample plain" aria-hidden="true"><span class="sample-input">공부 시간</span><span class="sample-button">저장</span></div></div>
        <div><span class="house-tag">CSS</span><strong>집의 디자인</strong><span>색상, 글꼴, 여백, 크기, 배치 등 화면의 모양 결정</span><div class="house-sample styled" aria-hidden="true"><span class="sample-input">공부 시간</span><span class="sample-button">저장</span></div></div>
        <div><span class="house-tag">JS</span><strong>집의 작동 장치</strong><span>버튼을 누르면 화면 변경, 입력값 분석, 그래프 갱신</span><div class="house-sample styled" aria-hidden="true"><span class="sample-input">공부 시간</span><span class="sample-button">저장</span><span class="sample-result">저장 완료</span></div></div>
      </div>
      <p class="demo-caption">JS는 JavaScript(자바스크립트)의 약자로, 웹페이지에 실제 동작과 상호작용을 만드는 프로그래밍 언어입니다.</p>
    </template>

    <!-- 단일 HTML 파일: 비교 -->
    <template v-else-if="id === 'single-html'">
      <div class="demo-table compare" role="table" aria-label="여러 파일로 나눈 웹페이지와 단일 HTML 파일 비교">
        <div role="row" class="table-head"><span role="columnheader">비교 기준</span><span role="columnheader">여러 파일로 나눈 웹페이지</span><span role="columnheader">단일 HTML 파일</span></div>
        <div v-for="row in [['파일 구성','index.html · style.css · script.js','index.html 하나에 HTML · CSS · JS'],['공유 방법','세 파일을 한 폴더로 묶어 전달','파일 하나만 전달'],['실행','세 파일이 모두 있어야 정상 작동','더블클릭하면 브라우저에서 바로 실행'],['알맞은 경우','기능이 많은 큰 서비스','수업용 작은 도구']]" :key="row[0]" role="row"><span role="rowheader">{{ row[0] }}</span><span role="cell"><small>여러 파일</small>{{ row[1] }}</span><span role="cell" class="highlight"><small>단일 HTML 파일</small>{{ row[2] }}</span></div>
      </div>
      <p class="demo-caption">주의: 기능이 커지면 파일이 길어져 수정이 어렵습니다.</p>
    </template>

    <!-- Tailwind: 이름표 -->
    <template v-else-if="id === 'tailwind'">
      <div class="demo-pairs">
        <div v-for="row in [['bg-blue-500','파란 배경'],['text-white','흰 글자'],['p-4','안쪽 여백 넣기'],['rounded-lg','모서리를 둥글게'],['md:w-1/2','화면이 넓을 때 너비를 절반으로']]" :key="row[0]"><code>{{ row[0] }}</code><ArrowRight :size="16" aria-hidden="true" /><span>{{ row[1] }}</span></div>
      </div>
      <div class="code-sample"><code>&lt;button class="bg-blue-500 text-white p-4 rounded-lg"&gt;저장&lt;/button&gt;</code><ArrowDown :size="18" aria-hidden="true" /><span class="tw-button" aria-hidden="true">저장</span><small>파란 둥근 저장 버튼</small></div>
    </template>

    <!-- Font Awesome: 아이콘 -->
    <template v-else-if="id === 'font-awesome'">
      <div class="demo-icons">
        <div><Search :size="24" aria-hidden="true" /><strong>돋보기</strong><code>fa-magnifying-glass</code><span>검색 창</span></div>
        <div><Settings :size="24" aria-hidden="true" /><strong>톱니바퀴</strong><code>fa-gear</code><span>설정 메뉴</span></div>
        <div><User :size="24" aria-hidden="true" /><strong>사람 모양</strong><code>fa-user</code><span>로그인, 내 정보</span></div>
        <div><Trash2 :size="24" aria-hidden="true" /><strong>휴지통</strong><code>fa-trash</code><span>삭제 버튼</span></div>
        <div><Copy :size="24" aria-hidden="true" /><strong>겹친 종이</strong><code>fa-copy</code><span>링크 복사 버튼</span></div>
      </div>
      <p class="demo-caption">예시: <code>&lt;i class="fa-solid fa-gear"&gt;&lt;/i&gt; 설정</code>을 쓰면 톱니바퀴 아이콘이 붙은 설정 버튼이 됩니다. 그림은 모양을 보여 주는 예시입니다.</p>
    </template>

    <!-- SPA -->
    <template v-else-if="id === 'spa'">
      <div class="mini-screen spa-screen">
        <div class="mini-header">학습 앱</div>
        <div class="spa-content" aria-live="polite"><strong>{{ spaCurrent.label }}</strong><p v-for="line in spaCurrent.lines" :key="line">{{ line }}</p></div>
        <div class="spa-tabs" role="group" aria-label="학습 앱 탭"><button v-for="t in SPA_TABS" :key="t.key" type="button" :aria-pressed="spaTab === t.key" :class="{ active: spaTab === t.key }" @click="selectSpa(t.key)">{{ t.label }}</button></div>
      </div>
      <p class="demo-caption">탭을 눌러 보세요. 내용이 {{ spaChanges }}번 바뀌는 동안 페이지를 새로 불러온 횟수는 {{ spaLoads }}번 그대로입니다.</p>
    </template>

    <!-- 인터랙티브 -->
    <template v-else-if="id === 'interactive'">
      <div class="mini-screen interactive-screen">
        <div class="interactive-inputs">
          <label v-for="s in subjects" :key="s.name"><span><i :style="{ background: s.color }" aria-hidden="true" />{{ s.name }} (분)</span><input v-model.number="s.minutes" type="number" min="0" max="600" step="10" inputmode="numeric" /></label>
        </div>
        <div class="interactive-result" aria-live="polite">
          <div class="pie" :style="{ background: pie }" role="img" :aria-label="subjects.map(s => `${s.name} ${percent(s.minutes)}%`).join(', ')" />
          <div><strong>총 {{ total }}분</strong><p v-for="s in subjects" :key="s.name">{{ s.name }} {{ percent(s.minutes) }}%</p></div>
        </div>
      </div>
      <p class="demo-caption">공부 시간을 바꿔 보세요. 프로그램이 총합과 비율을 계산하고, 숫자와 원그래프가 바로 바뀝니다.</p>
    </template>

    <!-- 대시보드 -->
    <template v-else-if="id === 'dashboard'">
      <div class="mini-screen dash-screen">
        <div class="dash-tiles">
          <div><strong>130분</strong><span>오늘 공부 시간</span><small>어제보다 20분 증가</small></div>
          <div><strong aria-live="polite">{{ done }}개</strong><span>완료한 과제</span><small>이번 주 목표 {{ GOAL }}개</small><span class="dash-bar" aria-hidden="true"><i :style="{ width: `${done / GOAL * 100}%` }" /></span></div>
          <div><strong>85%</strong><span>단원평가 정답률</span><small>지난주 78%</small></div>
        </div>
        <div class="button-row"><button type="button" class="secondary" :disabled="done >= GOAL" @click="done++">과제 하나 완료하기</button><button type="button" class="text-button" :disabled="done === 4" @click="done = 4">처음 값으로</button></div>
      </div>
      <p class="demo-caption">가상 예시입니다. 흩어진 기록을 숫자와 그래프로 한 화면에 모아 보여 줍니다.</p>
    </template>

    <!-- 반응형 -->
    <template v-else-if="id === 'responsive'">
      <div class="device-switch" role="group" aria-label="화면 크기 고르기"><button v-for="d in DEVICES" :key="d.key" type="button" :aria-pressed="device === d.key" :class="{ active: device === d.key }" @click="device = d.key">{{ d.label }}: {{ d.columns }}열</button></div>
      <div class="responsive-stage"><div class="mini-screen responsive-screen" :class="device"><div class="responsive-grid" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"><span>공지</span><span>일정</span><span>기록</span></div></div></div>
      <p class="demo-caption">같은 내용을 화면 폭에 따라 배치만 바꿉니다. Tailwind의 md:, lg: 이름표로 폭별 배치를 지정할 수 있습니다.</p>
    </template>

    <!-- 토스트 -->
    <template v-else-if="id === 'toast'">
      <div class="mini-screen toast-screen">
        <div class="button-row"><button v-for="t in TOASTS" :key="t.button" type="button" class="secondary" @click="showToast(t.message)">{{ t.button }}</button></div>
        <div class="toast-slot" role="status" aria-live="polite"><span v-if="toastMessage" class="mini-toast">{{ toastMessage }}</span></div>
      </div>
      <p class="demo-caption">버튼을 눌러 보세요. 알림이 2초 동안 보였다가 저절로 사라집니다. 확인 버튼으로 닫는 팝업 창과 달리 작업을 멈추지 않습니다.</p>
    </template>

    <!-- CTA -->
    <template v-else-if="id === 'cta'">
      <div class="device-switch" role="group" aria-label="버튼 문구 고르기"><button type="button" :aria-pressed="!ctaOn" :class="{ active: !ctaOn }" @click="ctaOn = false; ctaPressed = ''">무엇을 하는지 모호한 버튼</button><button type="button" :aria-pressed="ctaOn" :class="{ active: ctaOn }" @click="ctaOn = true; ctaPressed = ''">CTA 버튼</button></div>
      <div class="mini-screen cta-screen">
        <div class="cta-buttons"><button v-for="(row, index) in CTA_ROWS" :key="row.cta" type="button" :class="ctaOn && index === 0 ? 'cta-main' : 'cta-plain'" @click="ctaPressed = ctaOn ? row.change : '누르기 전에는 무슨 일이 일어날지 알 수 없습니다.'">{{ ctaOn ? row.cta : row.vague }}</button></div>
        <p class="cta-feedback" aria-live="polite">{{ ctaPressed || '버튼을 눌러 보세요.' }}</p>
      </div>
      <p class="demo-caption">만드는 법: 행동이 드러나는 문구, 눈에 띄는 색과 크기, 한 화면에 핵심 행동 하나.</p>
    </template>

    <!-- API -->
    <template v-else-if="id === 'api'">
      <ol class="demo-flow api-flow">
        <li><strong>우리 웹앱</strong><span>오늘 날씨 표시 칸</span></li>
        <li aria-hidden="true" class="flow-arrow"><span>요청</span><ArrowRight :size="20" /></li>
        <li class="api-core"><strong>API (약속된 규칙)</strong><span>요청과 응답의 형식</span></li>
        <li aria-hidden="true" class="flow-arrow"><span>전달</span><ArrowRight :size="20" /></li>
        <li><strong>날씨 서비스</strong><span>기상 자료 보유</span></li>
      </ol>
      <p class="api-response"><span>응답</span>대구 맑음, 18℃</p>
      <p class="demo-caption">API 키는 HTML 파일 안에 그대로 넣지 말고 서버나 별도 설정에 보관합니다.</p>
    </template>

    <!-- 실시간 로그 -->
    <template v-else-if="id === 'realtime-log'">
      <div class="mini-screen log-screen" role="table" aria-label="실시간 로그 예시">
        <div v-for="row in [['10:02:11','학생 기록 파일 불러오기 완료 (28건)'],['10:02:12','데이터 분석 시작'],['10:02:15','취약 단원 계산 완료'],['10:02:16','경고: 15번 기록 점수 빈칸 → 계산에서 제외'],['10:02:17','결과 화면 표시']]" :key="row[0]" role="row" :class="{ warn: row[1].startsWith('경고') }"><span role="cell">{{ row[0] }}</span><span role="cell">{{ row[1] }}</span></div>
      </div>
      <p class="demo-caption">가상 예시입니다. 프로그램이 멈추거나 결과가 이상할 때 어느 단계에서 문제가 생겼는지 확인합니다.</p>
    </template>
  </div>
</template>

<style scoped>
.term-demo{min-width:0}
.demo-caption{margin:12px 0 0;font-size:15px;line-height:1.75;color:var(--muted)}
.demo-caption code,.code-sample code,.demo-pairs code,.demo-icons code{font-family:Consolas,'D2Coding',monospace;font-size:14px;background:var(--subtle);border-radius:5px;padding:1px 5px;overflow-wrap:anywhere}
.demo-flow{list-style:none;margin:0;padding:0;display:flex;align-items:stretch;gap:6px}
.demo-flow>li:not(.flow-arrow){flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.demo-flow strong{font-size:15px;color:#1e3a6b}
.demo-flow span{font-size:14px;line-height:1.6;color:var(--muted)}
.demo-flow em{font-style:normal;font-size:14px;font-weight:600;color:#8a5a00;background:#fff5e0;border-radius:6px;padding:2px 8px;align-self:flex-start}
.flow-arrow{display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--brand)}
.flow-arrow span{font-size:13px;color:var(--muted)}
.api-core{border-color:#e8a020!important;background:#fffaf0!important}
.api-response{display:flex;gap:10px;align-items:center;margin:10px 0 0;padding:10px 14px;border-radius:10px;background:var(--sky-soft);color:var(--sky);font-weight:700;font-size:15px}
.api-response span{font-size:13px;font-weight:700;background:#fff;border-radius:999px;padding:1px 9px}
.demo-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:8px;counter-reset:none}
.demo-steps li{display:flex;flex-direction:column;gap:4px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.step-no{font-size:13px;font-weight:700;color:#8a5a00}
.demo-steps strong{font-size:15px;color:#1e3a6b;display:flex;align-items:center;gap:4px}
.demo-steps li>span:last-child{font-size:14px;line-height:1.6;color:var(--muted)}
.demo-house{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.demo-house>div{display:flex;flex-direction:column;gap:5px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--card);min-width:0}
.house-tag{align-self:flex-start;font-size:13px;font-weight:700;color:#fff;background:#1e3a6b;border-radius:6px;padding:1px 8px}
.demo-house strong{font-size:15px;color:#1e3a6b}
.demo-house>div>span:not(.house-tag){font-size:14px;line-height:1.6;color:var(--muted)}
.house-sample{margin-top:auto;padding-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.sample-input{font-size:13px;padding:4px 8px;border:1px solid #94a3b8;flex:1 1 70px;min-width:0}
.sample-button{font-size:13px;padding:4px 10px;border:1px solid #94a3b8;background:#efefef}
.styled .sample-input{border-color:var(--border);border-radius:8px;background:#fff}
.styled .sample-button{background:var(--brand);color:#fff;border-color:var(--brand);border-radius:8px;font-weight:600}
.sample-result{font-size:13px;font-weight:600;color:#1f8b6f}
.demo-table{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card)}
.demo-table>div{display:grid;grid-template-columns:7.5em minmax(0,1fr) minmax(0,1fr)}
.demo-table>div>span{padding:10px 12px;font-size:14px;line-height:1.6;border-top:1px solid var(--border);min-width:0}
.demo-table .table-head>span{border-top:0;background:var(--subtle);font-weight:700;color:#1e3a6b}
.demo-table [role=rowheader]{font-weight:700;color:#1e3a6b}
.demo-table .highlight{background:#fffaf0}
.demo-table small{display:none}
.demo-pairs{display:grid;gap:6px}
.demo-pairs>div{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;border:1px solid var(--border);border-radius:10px;background:var(--card);font-size:15px}
.demo-pairs svg{color:var(--muted)}
.code-sample{margin-top:10px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:12px;border-radius:12px;background:var(--subtle)}
.code-sample svg{color:var(--muted)}
.tw-button{background:#3b82f6;color:#fff;padding:16px;border-radius:8px;font-weight:600;font-size:15px;line-height:1}
.code-sample small{font-size:14px}
.demo-icons{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,128px),1fr));gap:8px}
.demo-icons>div{display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--card);min-width:0}
.demo-icons svg{color:#1e3a6b}
.demo-icons strong{font-size:15px;color:#1e3a6b}
.demo-icons span{font-size:14px;color:var(--muted)}
.demo-icons code{align-self:flex-start}
.mini-screen{border:1px solid var(--border);border-radius:14px;background:var(--card);padding:14px;box-shadow:inset 0 0 0 4px var(--subtle)}
.mini-header{font-size:14px;font-weight:700;color:#fff;background:#1e3a6b;border-radius:8px;padding:6px 12px}
.spa-screen{display:flex;flex-direction:column;gap:10px;padding:12px}
.spa-content{min-height:96px;padding:10px 12px;border-radius:8px;background:var(--brand-soft)}
.spa-content strong{font-size:15px;color:#1e3a6b}
.spa-content p{margin:4px 0 0;font-size:15px;line-height:1.6}
.spa-tabs,.device-switch{display:flex;gap:6px;flex-wrap:wrap}
.spa-tabs button,.device-switch button{flex:1 1 0;min-width:max-content;min-height:44px;padding:8px 10px;border:1px solid var(--border);border-radius:9px;background:var(--card);font-size:14px;font-weight:600;color:var(--muted)}
.spa-tabs button.active,.device-switch button.active{background:#1e3a6b;border-color:#1e3a6b;color:#fff}
.device-switch{margin-bottom:10px}
.device-switch button{min-width:0}
.interactive-screen{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center}
.interactive-inputs{display:grid;gap:8px}
.interactive-inputs label{display:grid;grid-template-columns:minmax(0,1fr) 7em;gap:8px;align-items:center;font-size:15px;font-weight:600}
.interactive-inputs label>span{display:flex;align-items:center;gap:6px}
.interactive-inputs i{display:inline-block;width:10px;height:10px;border-radius:50%}
.interactive-inputs input{min-height:44px;padding:8px 10px}
.interactive-result{display:flex;align-items:center;gap:14px}
.pie{width:96px;height:96px;border-radius:50%;flex-shrink:0}
.interactive-result strong{font-size:18px;color:#1e3a6b}
.interactive-result p{margin:2px 0 0;font-size:14px;line-height:1.6}
.dash-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}
.dash-tiles>div{display:flex;flex-direction:column;gap:2px;padding:12px;border-radius:10px;background:var(--brand-soft);min-width:0}
.dash-tiles strong{font-size:22px;color:#1e3a6b;line-height:1.3}
.dash-tiles span{font-size:14px;font-weight:600}
.dash-tiles small{font-size:13px}
.dash-bar{display:block;height:6px;border-radius:3px;background:#dbe4f3;margin-top:4px;overflow:hidden}
.dash-bar i{display:block;height:100%;background:#e8a020;transition:width .2s}
.responsive-stage{display:flex;justify-content:center;padding:8px;border-radius:12px;background:var(--subtle)}
.responsive-screen{width:100%;transition:width .25s;padding:10px}
.responsive-screen.tablet{width:72%}
.responsive-screen.phone{width:46%;min-width:120px}
.responsive-grid{display:grid;gap:6px}
.responsive-grid span{padding:12px 8px;text-align:center;border-radius:8px;background:var(--brand-soft);color:#1e3a6b;font-weight:600;font-size:14px}
.toast-screen{position:relative;min-height:150px;display:flex;flex-direction:column;justify-content:space-between;gap:12px}
.toast-screen .secondary{flex:1 1 auto}
.toast-slot{min-height:44px;display:flex;justify-content:center;align-items:flex-end}
.mini-toast{background:#1e293b;color:#fff;font-size:15px;font-weight:600;padding:10px 18px;border-radius:999px;box-shadow:0 8px 20px -8px rgba(15,23,42,.5);animation:toast-in .2s ease-out}
@keyframes toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.cta-buttons{display:flex;flex-direction:column;gap:8px}
.cta-buttons button{min-height:44px;border-radius:10px;font-size:15px;font-weight:600;padding:10px 14px}
.cta-plain{background:var(--card);border:1px solid var(--border)!important;color:var(--foreground)}
.cta-main{background:#e8a020;color:#1e2a44;font-size:17px!important;font-weight:800!important;box-shadow:0 6px 16px -8px rgba(232,160,32,.8)}
.cta-feedback{margin:10px 0 0;font-size:15px;color:#1e3a6b;font-weight:600}
.log-screen{padding:0;overflow:hidden;font-family:Consolas,'D2Coding',monospace;background:#0f172a;box-shadow:none;border-color:#0f172a}
.log-screen>div{display:grid;grid-template-columns:5.6em minmax(0,1fr);gap:10px;padding:7px 12px;font-size:14px;line-height:1.6;color:#e2e8f0}
.log-screen>div>span:first-child{color:#94a3b8}
.log-screen>div.warn{background:rgba(232,160,32,.18);color:#fcd58a}
@media(max-width:640px){
  .demo-flow{flex-direction:column}
  .flow-arrow{flex-direction:row;gap:6px}
  .flow-arrow svg{transform:rotate(90deg)}
  .demo-house{grid-template-columns:1fr}
  .demo-table .table-head{display:none!important}
  .demo-table>div{grid-template-columns:1fr}
  .demo-table>div>span{border-top:0;padding:4px 12px}
  .demo-table>div>[role=rowheader]{border-top:1px solid var(--border);padding-top:10px;background:var(--subtle)}
  .demo-table>div:nth-child(2)>[role=rowheader]{border-top:0}
  .demo-table>div>span:last-child{padding-bottom:10px}
  .demo-table small{display:block;font-size:13px;font-weight:700}
  .interactive-screen{grid-template-columns:1fr}
  .dash-tiles{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:reduce){.mini-toast{animation:none}.responsive-screen,.dash-bar i{transition:none}}
</style>
