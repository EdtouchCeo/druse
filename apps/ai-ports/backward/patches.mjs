// /backward/ 포트의 화면 적응. 원본(data_analysis)이 바뀌어 기준 문자열을 못 찾으면 빌드가 멈춘다.
export const patches = {
  'src/composables/useBackwardApi.ts': [
    [
      '전송 모듈 import',
      "import { useLlmMode } from './useLlmMode';\n",
      "import { backwardBlockedMessage, postBackward } from '../backward-standalone/transport';\n",
    ],
    ['헤더 훅 제거', "  const { llmHeaders } = useLlmMode();\n", ''],
    [
      '호출 경로',
      /const res = await fetch\(`\/api\/backward\/\$\{mode\}`, \{[\s\S]*?\}\);\n/,
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
    ['출처 상자', /\n\s*<div class="mt-3 rounded-xl border border-border bg-card\/60 px-3 py-2\.5">[\s\S]*?\{\{ refLabel \}\}\s*<\/a>\s*<\/div>/, ''],
  ],
  'src/components/UserKeySettings.vue': [
    // gemini-2.5-flash-lite는 API 키 경로에서 퇴역해 연결 확인이 404로 실패한다.
    ['연결 확인 모델', 'models/gemini-2.5-flash-lite:generateContent', 'models/gemini-2.5-flash:generateContent'],
    ['삭제 안내', "message: '저장된 키를 삭제했습니다.'", "message: '저장된 키를 삭제했습니다. 이제 교사 로그인으로 서버 AI를 씁니다.'"],
  ],
}

export const forbidden = ['initializeApp', 'firebaseapp.com', 'getAuth(', 'idToken', '승인 교육자만 쓸', '교육자 회원', '김태우', '`/api/backward/']
export const required = ['/api/backward/', '/bw-api/', 'x-auth-site', 'dr_sess_v1', 'Anthropic', 'x-user-gemini-key']
