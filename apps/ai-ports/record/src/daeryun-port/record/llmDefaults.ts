/*
 * /record/ 포트 전용 — `@/lib/llmDefaults` 대체(vite alias).
 * 기본 연결은 원본처럼 서버 AI다. 원본의 자격 판정은 EdTouch useAuth 등록을 기다리므로
 * 여기서 daeryun 세션 기준을 등록하고, 화면에 보일 문구를 대륜고 교사 기준으로 바꾼다.
 * 원본은 상대 경로로 불러 alias를 거치지 않는다. 같은 이름은 이 파일의 export가 우선한다.
 */
import { registerServerLlmEligibility, serverLlmEnded } from '../../lib/llmDefaults'
import { isSignedIn } from '../common/drSession'

export * from '../../lib/llmDefaults'

registerServerLlmEligibility(() => isSignedIn.value)

export const SERVER_LLM_ENDED_MESSAGE =
  '서버 AI는 교사 로그인 후 쓸 수 있습니다. 로그인하지 않으려면 AI 설정에서 Gemini 무료 키, 구독 연결(Claude · ChatGPT), Ollama 가운데 하나를 고르세요.'
export const SERVER_LLM_ENDED_SHORT = '교사 로그인 후 쓸 수 있습니다.'

export const serverChoiceLabel = () => '서버 AI (승인 교사)'
export const serverChoiceDetail = () => (serverLlmEnded() ? SERVER_LLM_ENDED_SHORT : '키 설정 없이 씁니다.')
