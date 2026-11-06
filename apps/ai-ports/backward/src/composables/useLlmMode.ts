/*
 * /backward/ 포트 전용 — 원본 useLlmMode를 대체한다.
 * 대륜고판은 /api/config를 읽지 않는다. 개인 키가 있으면 키를, 없으면 교사 세션을 쓰고,
 * 키 등록과 로그인 안내는 셸의 AiAccessBar가 모든 화면에서 맡는다.
 * 그래서 원본 홈 화면의 BYOK 배너가 나오지 않도록 needsKey는 false, effectiveMode는 server를 돌려준다.
 * 키는 localStorage `da-user-llm`에만 저장한다(원본과 같은 키).
 */
import { ref } from 'vue'

export type Platform = 'analysis' | 'backward'

const STORAGE_KEY = 'da-user-llm'

function loadUserKey(): string {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : ''
  } catch {
    return ''
  }
}

const hasKey = ref(loadUserKey().length > 0)

function saveUserKey(key: string): void {
  const trimmed = (key || '').trim()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey: trimmed }))
  } catch {
    /* 저장 실패(사파리 프라이빗 등)는 무시 */
  }
  hasKey.value = trimmed.length > 0
}

function clearUserKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 무시 */
  }
  hasKey.value = false
}

export function useLlmMode() {
  return {
    hasKey,
    getUserKey: loadUserKey,
    saveUserKey,
    clearUserKey,
    effectiveMode: (_platform: Platform): 'server' | 'byok' => 'server',
    needsKey: (_platform: Platform): boolean => false,
  }
}
