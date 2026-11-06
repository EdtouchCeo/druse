// /record/ 포트의 화면 적응. 원본(edtouch01 v2)이 바뀌어 기준 문자열을 못 찾으면 빌드가 멈춘다.
const VIEW_NOTICE = [
  '학생 자료 안내',
  '학생 자료는 <span class="font-semibold">이 브라우저에서만</span> 처리되며 서버에 저장되지 않습니다.',
  '작성한 표와 기록은 <span class="font-semibold">이 브라우저에만</span> 저장됩니다. 서버 AI를 쓰면 입력 내용이 Anthropic으로 전송되며, 서버에는 저장하지 않습니다.',
]

export const patches = {
  'src/views/record/SebakRecordView.vue': [VIEW_NOTICE],
  'src/views/record/ClubRecordView.vue': [VIEW_NOTICE],
  'src/views/record/JayulRecordView.vue': [VIEW_NOTICE],
  'src/views/record/JinroRecordView.vue': [VIEW_NOTICE],
  'src/views/record/HaengtukRecordView.vue': [VIEW_NOTICE],
  'src/composables/useRecordLlm.ts': [
    [
      '판정 import',
      "import { defaultProvider } from '@/lib/llmDefaults'\n",
      "import { defaultProvider, serverLlmEnded } from '@/lib/llmDefaults'\n",
    ],
    [
      // 옛 대륜고판은 기본이 Gemini라 키 없이 저장한 값이 남아 있을 수 있다. 키가 없으면 개인 연결이 아니다.
      '키 없는 옛 저장값',
      '    if (own) return own\n',
      "    if (own) return own.provider === 'gemini' && !own.gemini.apiKey.trim() ? { ...own, provider: 'server' } : own\n",
    ],
    [
      '서버 준비 판정',
      "if (s.provider === 'server') return true // 서버 제공 모드는 키가 필요 없다",
      "if (s.provider === 'server') return !serverLlmEnded() // 키는 필요 없고 교사 로그인이 필요하다",
    ],
    [
      '호출 전 로그인 안내',
      "    if (!hasLlmSettings(s)) throw new Error('먼저 AI 설정을 완료해 주세요.')\n",
      "    if (s.provider === 'server') assertServerLlmReady()\n    if (!hasLlmSettings(s)) throw new Error('먼저 AI 설정을 완료해 주세요.')\n",
    ],
  ],
  'src/components/record/RecordWorkbench.vue': [
    ['vue import', "import { computed, ref } from 'vue'\n", "import { computed, ref, watch } from 'vue'\nimport { isSignedIn } from '@/daeryun-port/common/drSession'\n"],
    [
      '다른 탭 로그인 반영',
      'const configured = ref(hasLlmSettings())\n',
      'const configured = ref(hasLlmSettings())\nwatch(isSignedIn, () => {\n  configured.value = hasLlmSettings()\n})\n',
    ],
  ],
  'src/components/record/RecordFileInput.vue': [
    [
      '이미지 첨부 조건',
      "error.value = '이미지·캡처 추출은 AI(비전) 설정이 필요합니다. 상단의 AI 설정을 완료해 주세요.'",
      "error.value = '이미지·캡처를 읽으려면 AI 연결이 필요합니다. 교사 로그인을 하거나 AI 설정에서 개인 연결을 골라 주세요.'",
    ],
    ['추출 안내', 'AI(Gemini/Ollama 비전)로 텍스트를 추출합니다', 'AI로 텍스트를 추출합니다'],
  ],
}

export const forbidden = ['initializeApp', 'firebaseapp.com', 'getAuth(', 'idToken', '승인 교육자만 쓸', '교육자 회원', 'EdTouch 서버 제공', '서버 제공 (무료']
export const required = ['generate-open', 'x-auth-site', 'dr_sess_v1', 'Anthropic', 'dataBase64']
