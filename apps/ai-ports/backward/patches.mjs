// /backward/ 포트의 화면 적응. 원본(data_analysis)이 바뀌어 기준 문자열을 못 찾으면 빌드가 멈춘다.
export const patches = {
  'src/composables/useBackwardApi.ts': [
    [
      '전송 모듈 import',
      "import { useLlmMode } from './useLlmMode';\n",
      "import { backwardBlockedMessage, postBackward } from '../backward-standalone/transport';\n",
    ],
    // data_analysis 93b5fc1부터 원본은 useLlmMode의 llmFetch·aiBlockReason(EdTouch 로그인)을 쓴다. 대륜고판은 transport로 바꾼다.
    ['헤더 훅 제거', "  const { llmFetch, aiBlockReason } = useLlmMode();\n", ''],
    [
      '호출 경로',
      /const blocked = await aiBlockReason\('backward'\);\n\s*if \(blocked\) throw new BackwardApiError\(blocked\);\n\s*const res = await llmFetch\('backward', `\/api\/backward\/\$\{mode\}`, \{[\s\S]*?\}\);\n/,
      "const blocked = backwardBlockedMessage();\n      if (blocked) throw new BackwardApiError(blocked);\n      const res = await postBackward(mode, JSON.stringify(body));\n",
    ],
  ],
  'src/views/BackwardHomeView.vue': [
    // 대륜고판에서는 AI 연결 상태를 셸의 AiAccessBar가 모든 화면에서 보여 준다.
    ['소개 문장', /\n\s*<span class="inline-block">단계마다 AI가 3안을 제안하고, 확정은 늘 선생님이 합니다\.<\/span>/, ''],
    ['크레딧', /\n\s*<p[^>]*>\n\s*김태우 수석교사\(사수중\)의 개념기반탐구학습 설계 가이드에 따라 제작되었습니다\.\n\s*<\/p>/, ''],
  ],
  'src/components/backward/WizardShell.vue': [
    // 2026-08-05 대륜고판부터 원형 출처 상자를 싣지 않는다.
    ['출처 상수', /\/\/ 원형 출처 표기[^\n]*\nconst credit = [\s\S]*?const refLabel = [^\n]*\n/, ''],
    // 원본의 ServerAiGate는 EdTouch 로그인(firebase)과 edtouch.ai 가입 링크를 쓴다. 대륜고판은 셸의 AiAccessBar가 같은 일을 한다.
    ['AI 연결 안내 import', "import ServerAiGate from '../ServerAiGate.vue';\n", ''],
    ['AI 연결 안내', /\n {8}<ServerAiGate platform="backward" \/>\n/, '\n'],
    ['출처 상자', /\n\s*<div class="mt-3 rounded-xl border border-border bg-card\/60 px-3 py-2\.5">[\s\S]*?\{\{ refLabel \}\}\s*<\/a>\s*<\/div>/, ''],
  ],
  'src/components/UserKeySettings.vue': [
    // gemini-2.5-flash-lite는 API 키 경로에서 퇴역해 연결 확인이 404로 실패한다.
    ['연결 확인 모델', 'models/gemini-2.5-flash-lite:generateContent', 'models/gemini-2.5-flash:generateContent'],
    ['삭제 안내', "message: '저장된 키를 삭제했습니다.'", "message: '저장된 키를 삭제했습니다. 이제 교사 로그인으로 서버 AI를 씁니다.'"],
  ],
  // 결과 묶음의 제목. 대륜고판은 편집 단추가 없으므로 '편집'을 뺀다.
  'src/views/UnitDesignView.vue': [
    ['묶음 제목', '<p class="mb-2 text-sm font-bold text-foreground">설계안 MD 저장과 편집</p>', '<p class="mb-2 text-sm font-bold text-foreground">설계안 MD 저장</p>'],
  ],
  'src/views/LessonPlanView.vue': [
    ['묶음 제목', '<p class="mb-2 text-sm font-bold text-foreground">설계안과 활동지 MD 저장과 편집</p>', '<p class="mb-2 text-sm font-bold text-foreground">설계안과 활동지 MD 저장</p>'],
  ],
  // 공용 저장·편집 묶음. 대륜고에는 문서작성 AI가 없으므로 MD 저장만 남기고 넘기기 안내 문구를 지운다.
  'src/components/export/ExportActions.vue': [
    ['보일 단추', "const ALL: Format[] = ['md', 'hwpx', 'xlsx', 'pptx'];\n", "const ALL: Format[] = ['md'];\n"],
    ['넘기기 안내', /\n {4}<div v-if="editFormats\.length" class="[^"]*">\n {6}<p>문서작성 AI 새 탭에서 엽니다\.<\/p>\n[\s\S]*?\n {4}<\/div>/, ''],
  ],
}

export const forbidden = ['initializeApp', 'firebaseapp.com', 'getAuth(', 'idToken', '승인 교육자만 쓸', '교육자 회원', '김태우', '`/api/backward/', 'docai?handoff', '문서작성 AI 새 탭에서 엽니다', 'edtouch-handoff', 'edtouch.ai/#/consent']
export const required = ['/api/backward/', '/bw-api/', 'x-auth-site', 'dr_sess_v1', 'Anthropic', 'x-user-gemini-key', 'MD 저장']
