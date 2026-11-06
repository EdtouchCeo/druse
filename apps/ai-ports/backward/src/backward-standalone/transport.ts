/*
 * /backward/ 생성 요청.
 *  - 개인 키가 있으면 그 키만 보낸다. 없으면 교사 세션을 보낸다. 둘 다 없으면 요청하지 않는다.
 *  - Cloud Run을 직접 부른다. Netlify 프록시는 26초에 끊긴 실사고가 있어 fetch 예외일 때만 /bw-api로 간다.
 *  - 401이면 세션을 갱신해 한 번만 다시 보낸다.
 */
import { getToken, isSignedIn, refreshToken, teacherHeaders } from '../daeryun-port/common/drSession'
import { useLlmMode } from '../composables/useLlmMode'

const DIRECT = 'https://service-63986215827.us-west1.run.app/api/backward/'
const PROXY = '/bw-api/'

const LOGIN_REQUIRED = '교사 로그인 후 이용할 수 있습니다. 화면 위의 교사 로그인을 누르거나 개인 Gemini 키를 등록해 주세요.'

/** 요청을 보낼 수 없으면 안내 문구를, 보낼 수 있으면 null을 돌려준다. */
export function backwardBlockedMessage(): string | null {
  const { getUserKey } = useLlmMode()
  return getUserKey() || isSignedIn.value ? null : LOGIN_REQUIRED
}

async function send(path: string, body: string, headers: Record<string, string>): Promise<Response> {
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }
  try {
    return await fetch(DIRECT + path, init)
  } catch {
    return fetch(PROXY + path, init)
  }
}

export async function postBackward(path: string, body: string): Promise<Response> {
  const key = useLlmMode().getUserKey()
  if (key) return send(path, body, { 'x-user-gemini-key': key })

  const token = await getToken()
  if (!token) return new Response(JSON.stringify({ error: LOGIN_REQUIRED }), { status: 401 })
  const res = await send(path, body, teacherHeaders(token))
  if (res.status !== 401) return res
  const fresh = await refreshToken()
  return fresh ? send(path, body, teacherHeaders(fresh)) : res
}
