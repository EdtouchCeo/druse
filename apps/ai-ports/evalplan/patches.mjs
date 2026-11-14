// /evalplan/ 포트의 화면 적응. 원본(edtouch01 v2)이 바뀌어 기준 문자열을 못 찾으면 빌드가 멈춘다.
export const patches = {
  'src/views/EvalPlanView.vue': [
    ['RouterLink import', "import { RouterLink } from 'vue-router'\n", ''],
    ['플랫폼 뒤로 링크', /\n {6}<RouterLink\n {8}to="\/apps"[\s\S]*?<\/RouterLink>/, ''],
    [
      '세션 import',
      "import { serverLlmEnded } from '@/lib/llmDefaults'\n",
      "import { serverLlmEnded } from '@/lib/llmDefaults'\nimport { TEACHER_LOGIN_URL } from '@/daeryun-port/common/drSession'\n",
    ],
    [
      '서버 선택 여부',
      'const connOk = computed(() => ready.value && !serverEndedNow.value)\n',
      `const connOk = computed(() => ready.value && !serverEndedNow.value)
const usingServer = computed(() => {
  settingsVersion.value
  return loadLlmSettings().provider === 'server'
})
`,
    ],
    [
      '상태 제목',
      "{{ connOk ? 'AI 사용 준비 완료' : '먼저 AI 설정을 확인해 주세요' }}",
      "{{ connOk ? 'AI 사용 준비 완료' : serverEndedNow ? '교사 로그인 후 이용할 수 있습니다' : '먼저 AI 설정을 확인해 주세요' }}",
    ],
    [
      '로그인 전 안내',
      'EdTouch 서버 AI는 승인 교육자만 쓸 수 있습니다. AI 설정에서 개인 키(Gemini 무료 키·Ollama)나 구독 연결(Claude·ChatGPT)을 선택해 주세요.',
      '서버 AI는 승인 교사만 쓸 수 있습니다. 로그인하지 않으려면 AI 설정에서 Gemini 무료 키, 구독 연결(Claude·ChatGPT), Ollama 가운데 하나를 고르세요.',
    ],
    [
      '연결 상태 문구',
      `<p v-else class="text-xs leading-relaxed text-muted-foreground">
            기본은 EdTouch 서버 제공(무료·키 설정 불필요)입니다. 개인 Gemini 키나 Ollama도 쓸 수 있어요.
          </p>`,
      `<p v-else-if="usingServer" class="break-keep text-xs leading-relaxed text-muted-foreground">
            서버 AI(Claude)로 생성합니다. 입력한 내용은 답변을 만들기 위해 Anthropic으로 전송되며, 서버에는 저장하지 않습니다.
          </p>
          <p v-else class="break-keep text-xs leading-relaxed text-muted-foreground">
            {{ connOk ? 'AI 설정에서 고른 개인 연결로 생성합니다.' : 'AI 설정에서 고른 연결의 키나 모델을 입력해 주세요.' }}
          </p>`,
    ],
    [
      '교사 로그인 버튼',
      `      <button
        type="button"
        @click="showSettings = true"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent"
      >
        <Settings class="size-4" /> AI 설정
      </button>`,
      `      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <a
          v-if="serverEndedNow"
          :href="TEACHER_LOGIN_URL"
          target="_blank"
          rel="noopener"
          class="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:brightness-110"
        >
          교사 로그인 <ExternalLink class="size-3.5" />
        </a>
        <button
          type="button"
          @click="showSettings = true"
          class="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent"
        >
          <Settings class="size-4" /> AI 설정
        </button>
      </div>`,
    ],
    [
      '교육과정 AI 링크',
      /<RouterLink\n {12}to="\/curriculum"\n {12}target="_blank"\n {12}class="([^"]*)"\n {10}>\n {12}성취기준 원문이 필요하면 교육과정 AI에서 조회 <ExternalLink class="size-3" \/>\n {10}<\/RouterLink>/,
      '<a\n            href="https://daeryun.life/#ai"\n            target="_blank"\n            rel="noopener"\n            class="$1"\n          >\n            성취기준 원문이 필요하면 국가교육과정 AI에서 조회 <ExternalLink class="size-3" />\n          </a>',
    ],
    [
      '수행 과제물 생성기 링크',
      '<RouterLink to="/exemplar" target="_blank" class="font-semibold text-brand hover:underline">수행 과제물 생성기</RouterLink>',
      '<a href="https://edtouch.ai/#/exemplar" target="_blank" rel="noopener" class="font-semibold text-brand hover:underline">수행 과제물 생성기</a>',
    ],
    [
      '수업·평가·기록 AI 링크',
      /<RouterLink to="\/wiki" target="_blank" class="font-semibold text-brand hover:underline">수업·평가·기록 AI<\/RouterLink>를 함께 쓰세요\./,
      '<a href="https://edtouch.ai/#/wiki" target="_blank" rel="noopener" class="font-semibold text-brand hover:underline">수업·평가·기록 AI</a>를 함께 쓰세요. (EdTouch AI 사이트에서 열립니다.)',
    ],
    ['생성 버튼 조건', ':disabled="!canGenerate || !ready || busy"', ':disabled="!canGenerate || !connOk || busy"'],
    [
      '생성 버튼 아래 안내',
      /(\n {8}<p v-if="status === 'idle' && !canGenerate" class="([^"]*)">\n {10}학교급·학년, 과목, 성취기준을 채우면 생성할 수 있습니다\.\n {8}<\/p>)/,
      `$1\n        <p v-if="status === 'idle' && canGenerate && !connOk" class="$2">\n          {{ serverEndedNow ? '위의 교사 로그인을 마치거나 AI 설정에서 개인 키를 고르면 생성할 수 있습니다.' : '위의 AI 설정을 마치면 생성할 수 있습니다.' }}\n        </p>`,
    ],
  ],
  // 공용 저장·편집 묶음. 대륜고에는 문서작성 AI가 없으므로 MD 저장·PDF 저장·한글로 편집만 보인다.
  // 한글로 편집은 EvalPlanView가 hwpxAction으로 양식 정보 창을 열고, 그 창에서 한글 파일을 내려받는다.
  'src/components/export/ExportActions.vue': [
    ['보일 단추', "const ALL: Format[] = ['md', 'pdf', 'hwpx', 'xlsx', 'pptx']\n", "const ALL: Format[] = ['md', 'pdf', 'hwpx']\n"],
    [
      '편집 단추 안내',
      '<span class="text-sm text-muted-foreground break-keep">문서작성 AI 새 탭에서 엽니다.</span>',
      '<span class="text-sm text-muted-foreground break-keep">한글로 편집은 양식 모양의 한글 파일을 내려받습니다.</span>',
    ],
  ],
  'src/components/evalPlan/EvalPlanFormInfoDialog.vue': [
    [
      '문서작성 AI 단추',
      /\n {10}<Button type="button" variant="soft" :disabled="!!busy" :aria-busy="busy === 'docai' \? 'true' : undefined" @click="toDocAi">[\s\S]*?문서작성 AI에서 편집\n {10}<\/Button>/,
      '',
    ],
    [
      '새 탭 차단 안내',
      /\n {8}<p v-if="blocked" class="[^"]*" role="alert">\n {10}브라우저가 새 탭을 막았습니다\.[^\n]*\n {8}<\/p>/,
      '',
    ],
  ],
  // 양식 틀은 build.mjs가 output/web/evalplan/evalplan-forms/에 싣는다. /evalplan/ 아래라 화면과 같은 교사 게이트를 받는다.
  'src/lib/evalPlan/hwpxForm.ts': [
    [
      '양식 틀 주소',
      "export const EVALPLAN_FORM_URL = '/evalplan-forms/2026/task1.hwpx'",
      "export const EVALPLAN_FORM_URL = '/evalplan/evalplan-forms/2026/task1.hwpx'",
    ],
  ],
}

/** build.mjs가 원본 커밋에서 꺼내 output/web/evalplan/ 아래로 함께 싣는 정적 파일. [원본 경로, 싣는 경로] */
export const staticFiles = [['public/evalplan-forms', 'evalplan-forms']]

export const forbidden = ['initializeApp', 'firebaseapp.com', 'getAuth(', 'idToken', '승인 교육자만 쓸', '교육자 회원', 'EdTouch 서버 제공', 'docai?handoff', '문서작성 AI 새 탭에서 엽니다', '문서작성 AI에서 편집']
export const required = ['generate-open', 'x-auth-site', 'dr_sess_v1', 'Anthropic', '/evalplan/evalplan-forms/2026/task1.hwpx', '한글 파일 받기']
