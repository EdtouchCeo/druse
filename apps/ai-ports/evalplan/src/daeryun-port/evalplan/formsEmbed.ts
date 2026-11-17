/*
 * 문서작성 AI(/forms/) 안에서 열리는 모드.
 * /evalplan/?embed=forms 로 열리고 부모 창이 있을 때만 켜진다. 그 밖에는 아무 일도 하지 않는다.
 * 부모와의 약속(같은 오리진 postMessage):
 *   자식 → 부모  { type: 'dr-forms-ready', v: 1 }
 *   자식 → 부모  { type: 'dr-forms-open', v: 1, name, bytes: ArrayBuffer }  (bytes는 전송 목록으로 넘긴다)
 *   부모 → 자식  { type: 'dr-forms-opened', v: 1, ok: true } | { ..., ok: false, message }
 */

export const FORMS_TIMEOUT_MS = 20000
export const FORMS_TIMEOUT_MESSAGE = '문서작성 AI가 응답하지 않습니다. 한글 파일 받기로 내려받은 뒤 문서작성 AI에 올려 주세요.'

let cached: boolean | null = null

export function isFormsEmbed(): boolean {
  if (cached !== null) return cached
  try {
    cached = new URLSearchParams(window.location.search).get('embed') === 'forms' && window.parent !== window
  } catch {
    cached = false
  }
  return cached
}

export function postFormsReady(): void {
  if (!isFormsEmbed()) return
  window.parent.postMessage({ type: 'dr-forms-ready', v: 1 }, window.location.origin)
}

export type FormsOpenResult = { ok: true } | { ok: false; message: string }

/** 한글 파일을 부모(문서작성 AI)에 보내고 답을 기다린다. 부모·같은 오리진에서 온 답만 받는다. */
export function sendToForms(name: string, bytes: Uint8Array | ArrayBuffer, timeoutMs = FORMS_TIMEOUT_MS): Promise<FormsOpenResult> {
  return new Promise((resolve) => {
    // 원본 배열을 넘겨 버리지 않도록 새 ArrayBuffer로 복사해 전송한다.
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const buf = src.slice().buffer as ArrayBuffer
    let timer = 0
    const done = (r: FormsOpenResult) => {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(r)
    }
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin || ev.source !== window.parent) return
      const d = ev.data as { type?: unknown; v?: unknown; ok?: unknown; message?: unknown } | null
      if (!d || typeof d !== 'object' || d.type !== 'dr-forms-opened' || d.v !== 1) return
      if (d.ok === true) done({ ok: true })
      else {
        const message = typeof d.message === 'string' && d.message.trim() ? d.message.trim() : '문서작성 AI가 파일을 열지 못했습니다.'
        done({ ok: false, message })
      }
    }
    window.addEventListener('message', onMessage)
    timer = window.setTimeout(() => done({ ok: false, message: FORMS_TIMEOUT_MESSAGE }), timeoutMs)
    try {
      window.parent.postMessage({ type: 'dr-forms-open', v: 1, name, bytes: buf }, window.location.origin, [buf])
    } catch (err) {
      const why = err instanceof Error ? err.message : ''
      done({ ok: false, message: `문서작성 AI로 보내지 못했습니다.${why ? ` ${why}` : ''}` })
    }
  })
}
