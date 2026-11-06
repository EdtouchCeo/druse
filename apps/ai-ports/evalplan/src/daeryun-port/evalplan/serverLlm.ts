/*
 * /evalplan/ 포트 전용 — `@/lib/serverLlm` 대체(vite alias).
 * 원본은 useAuth→firebase를 끌어오므로 번들에서 뺀다. daeryun 교사 세션을 Bearer로 보낸다.
 *  - Cloud Run `/api/llm/generate-open` 직접 호출(Netlify 프록시는 26초에 끊긴다), 300초 대기
 *  - 401이면 세션을 갱신해 한 번만 다시 보낸다
 *  - 실패 문구는 서버의 error를 그대로 보인다
 * ⚠️ code 값과 문구는 lib/evalPlan/runStep.ts의 isFatalLlmError 분류와 짝이다.
 */
import { getToken, isSignedIn, refreshToken, teacherHeaders } from '../common/drSession'
import { SERVER_LLM_ENDED_MESSAGE } from './llmDefaults'

const RELAY_URL = 'https://service-63986215827.us-west1.run.app/api/llm/generate-open'
const TIMEOUT_MS = 300_000

export type ServerLlmErrorCode =
  | 'AUTH_REQUIRED'
  | 'NOT_APPROVED'
  | 'SERVER_ENDED'
  | 'SERVER_UNAVAILABLE'
  | 'BLOCKED_RESPONSE'
  | 'BAD_REQUEST'
  | 'QUOTA'
  | 'BUSY'
  | 'NETWORK'
  | 'UNKNOWN'

export class ServerLlmError extends Error {
  code: ServerLlmErrorCode
  status: number
  constructor(code: ServerLlmErrorCode, status: number, message: string) {
    super(message)
    this.name = 'ServerLlmError'
    this.code = code
    this.status = status
  }
}

export interface ServerLlmRequest {
  signal?: AbortSignal
  prompt?: string
  systemInstruction?: string
  temperature?: number
  maxOutputTokens?: number
  schema?: Record<string, unknown>
  label?: string
}

const FALLBACK: Record<ServerLlmErrorCode, string> = {
  AUTH_REQUIRED: SERVER_LLM_ENDED_MESSAGE,
  NOT_APPROVED: '승인된 교사 계정만 서버 AI를 쓸 수 있습니다. AI 설정에서 개인 키를 고를 수도 있습니다.',
  SERVER_ENDED: '승인된 교사 계정만 서버 AI를 쓸 수 있습니다. AI 설정에서 개인 키를 고를 수도 있습니다.',
  SERVER_UNAVAILABLE: '지금은 서버 AI를 쓸 수 없습니다. AI 설정에서 Gemini 무료 키나 구독 연결을 골라 계속할 수 있습니다.',
  BLOCKED_RESPONSE: 'AI가 이 요청에는 답하지 않았습니다. 내용을 조금 바꿔 다시 시도해 주세요.',
  BAD_REQUEST: '입력 내용을 처리하지 못했습니다. 자료가 너무 길거나 형식이 맞지 않는지 확인해 주세요.',
  QUOTA: '지금 이용자가 많아 잠시 이용이 어렵습니다. 잠시 후 다시 시도해 주세요.',
  BUSY: 'AI 서버가 혼잡합니다. 30초쯤 뒤에 다시 시도해 주세요.',
  NETWORK: '네트워크 오류로 AI 서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
  UNKNOWN: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
}

function codeFor(status: number, serverCode?: string): ServerLlmErrorCode {
  if (status === 401) return 'AUTH_REQUIRED'
  if (serverCode === 'EDUCATOR_ONLY') return 'SERVER_ENDED'
  if (serverCode === 'BYOK_REQUIRED' || serverCode === 'SERVER_BUDGET' || serverCode === 'SERVER_CONFIG') return 'SERVER_UNAVAILABLE'
  if (serverCode === 'AI_REFUSED') return 'BLOCKED_RESPONSE'
  if (status === 403) return 'NOT_APPROVED'
  if (status === 400) return 'BAD_REQUEST'
  if (status === 429) return 'QUOTA'
  if (status === 502 || status === 503 || status === 504) return 'BUSY'
  return 'UNKNOWN'
}

export function serverLlmBlockReason(): 'signin' | null {
  return isSignedIn.value ? null : 'signin'
}

export function serverLlmAvailable(): boolean {
  return isSignedIn.value
}

export function serverLlmBlockMessage(): string {
  return isSignedIn.value ? '' : SERVER_LLM_ENDED_MESSAGE
}

/** 로그인 전에는 요청을 보내지 않는다. */
export function assertServerLlmReady(): void {
  if (!isSignedIn.value) throw new ServerLlmError('AUTH_REQUIRED', 401, SERVER_LLM_ENDED_MESSAGE)
}

function buildBody(req: ServerLlmRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (req.prompt) body.prompt = req.prompt
  if (req.systemInstruction) body.systemInstruction = req.systemInstruction
  if (typeof req.temperature === 'number') body.temperature = req.temperature
  if (typeof req.maxOutputTokens === 'number') body.maxOutputTokens = req.maxOutputTokens
  if (req.schema) body.schema = req.schema
  if (req.label) body.label = req.label
  return body
}

async function post(body: string, token: string, signal: AbortSignal): Promise<Response> {
  return fetch(RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...teacherHeaders(token) },
    body,
    signal,
  })
}

export async function callServerLlm(req: ServerLlmRequest): Promise<string> {
  assertServerLlmReady()
  const token = await getToken()
  if (!token) throw new ServerLlmError('AUTH_REQUIRED', 401, SERVER_LLM_ENDED_MESSAGE)

  const body = JSON.stringify(buildBody(req))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await post(body, token, ctrl.signal)
    if (res.status === 401) {
      const fresh = await refreshToken()
      if (fresh) res = await post(body, fresh, ctrl.signal)
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new Error('AI 응답이 너무 오래 걸려 중단했습니다. 잠시 후 다시 시도해 주세요.')
    }
    throw new ServerLlmError('NETWORK', 0, FALLBACK.NETWORK)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    let data: { code?: string; error?: string } | null = null
    try {
      data = await res.json()
    } catch {
      /* 본문 없이 status로 분기 */
    }
    const code = codeFor(res.status, data?.code)
    throw new ServerLlmError(code, res.status, data?.error?.trim() || FALLBACK[code])
  }

  let data: { text?: string }
  try {
    data = await res.json()
  } catch {
    throw new ServerLlmError('UNKNOWN', res.status, '서버 응답을 읽지 못했습니다. 다시 시도해 주세요.')
  }
  const text = (data.text ?? '').trim()
  if (!text) throw new ServerLlmError('UNKNOWN', res.status, 'AI가 빈 응답을 반환했습니다. 다시 시도해 주세요.')
  return text
}
