/*
 * daeryun.life 교사 세션 — /evalplan/·/backward/ 공용.
 * 본 사이트(index.html)가 localStorage `dr_sess_v1`에 저장한 Supabase 세션을 읽고,
 * 샛별 AI PDF 압축기·업무 양식 AI와 같은 방식으로 갱신한다.
 * 다른 탭에서 로그인·로그아웃하면 storage 이벤트로 이 화면의 상태도 바뀐다.
 */
import { computed, ref } from 'vue'

const SESSION_KEY = 'dr_sess_v1'
const SB_URL = 'https://aafpkfcxzdrguuctdwth.supabase.co'
// 공개 anon 키. index.html·forms/app.js와 같은 값이다.
const SB_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhZnBrZmN4emRyZ3V1Y3Rkd3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MzEwNjYsImV4cCI6MjA5MjMwNzA2Nn0.1VWheZHC2qNwWJhJ6KTFhjfFf9-bAfAdjzja2cD-xmw'

/** 본 사이트 로그인으로 가는 주소. 새 탭으로 열면 입력 중인 내용이 그대로 남는다. */
export const TEACHER_LOGIN_URL = '/#login'

interface DrSession {
  token?: string
  refresh_token?: string | null
  expires_at?: number | null
}

function read(): DrSession | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

const session = ref<DrSession | null>(read())

function sync() {
  session.value = read()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === SESSION_KEY || e.key === null) sync()
  })
  window.addEventListener('focus', sync)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync()
  })
}

/** 로그인 세션이 있는가. 승인 교사인지는 서버가 판정한다. */
export const isSignedIn = computed(() => !!session.value?.token)

let inFlight: Promise<string | null> | null = null

async function doRefresh(): Promise<string | null> {
  const s = read()
  if (!s?.refresh_token) return null
  try {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    })
    const cur = read()
    // 다른 창이 먼저 갱신했으면 그 토큰을 쓴다(refresh token은 한 번만 쓸 수 있다).
    if (cur?.token && cur.refresh_token !== s.refresh_token) {
      sync()
      return cur.token
    }
    if (!r.ok) return null
    const d = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!d.access_token || !cur) return null
    cur.token = d.access_token
    if (d.refresh_token) cur.refresh_token = d.refresh_token
    cur.expires_at = Date.now() + (d.expires_in || 3600) * 1000
    localStorage.setItem(SESSION_KEY, JSON.stringify(cur))
    sync()
    return cur.token
  } catch {
    return null
  }
}

/** 세션을 갱신해 새 토큰을 돌려준다. 동시에 불러도 갱신 요청은 한 번만 나간다. */
export function refreshToken(): Promise<string | null> {
  if (!inFlight) inFlight = doRefresh().finally(() => (inFlight = null))
  return inFlight
}

/** 지금 쓸 토큰. 만료가 1분 안으로 다가왔으면 먼저 갱신한다. */
export async function getToken(): Promise<string | null> {
  const s = read()
  if (!s?.token) return null
  if (s.refresh_token && (!s.expires_at || Date.now() > s.expires_at - 60_000)) {
    const fresh = await refreshToken()
    if (fresh) return fresh
  }
  return read()?.token ?? null
}

/** 서버 AI 요청 헤더(계약: daeryun 교사). */
export function teacherHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'x-auth-site': 'daeryun' }
}
