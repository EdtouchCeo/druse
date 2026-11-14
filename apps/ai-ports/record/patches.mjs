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
  // 대륜고에는 문서작성 AI가 없다. 표 아래 묶음은 MD 저장만 남기고 넘기기 안내 줄을 뺀다.
  // 엑셀은 표 위의 '엑셀 내려받기'(양식 채우기)로 받는다.
  'src/components/record/RecordTable.vue': [
    [
      '묶음 단추',
      `<ExportActions :doc="exportDoc" :formats="['md', 'xlsx']" :xlsx-file="makeXlsx" :disabled="!yearValid" />`,
      `<ExportActions :doc="exportDoc" :formats="['md']" :disabled="!yearValid" />`,
    ],
    [
      '넘기기 안내',
      /\n {6}<p class="mt-2 text-xs text-muted-foreground break-keep">문서작성 AI로 넘길 때는 이 브라우저 안의 저장소만 쓰며 서버로 보내지 않습니다\.<\/p>/,
      '',
    ],
  ],
  // 공용 묶음. 편집 단추를 아예 목록에서 빼고, 문서작성 AI 안내 문구를 번들에서 지운다.
  'src/components/export/ExportActions.vue': [
    ['보일 단추', "const ALL: Format[] = ['md', 'pdf', 'hwpx', 'xlsx', 'pptx']\n", "const ALL: Format[] = ['md', 'pdf']\n"],
    ['편집 단추 안내', /\n {8}<span class="text-sm text-muted-foreground break-keep">문서작성 AI 새 탭에서 엽니다\.<\/span>/, ''],
  ],
  // 양식은 build.mjs가 output/web/record/record-forms/에 싣는다. 화면은 BASE_URL(/record/) 기준으로 받으므로 주소 패치는 없다.
}

/** build.mjs가 원본 커밋에서 꺼내 output/web/record/ 아래로 함께 싣는 정적 파일. [원본 경로, 싣는 경로] */
export const staticFiles = [['public/record-forms', 'record-forms']]

export const forbidden = ['initializeApp', 'firebaseapp.com', 'getAuth(', 'idToken', '승인 교육자만 쓸', '교육자 회원', 'EdTouch 서버 제공', '서버 제공 (무료', 'docai?handoff', '문서작성 AI 새 탭에서 엽니다', '문서작성 AI로 넘길 때는']
export const required = ['generate-open', 'x-auth-site', 'dr_sess_v1', 'Anthropic', 'dataBase64', 'record-forms/2026/record-form.xlsx', '엑셀 내려받기']
