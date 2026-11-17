'use strict';
// 서버 AI(Claude) 연결 — 문서작성 AI(/forms/)·평가계획(/evalplan/)과 같은 EdTouch 서버 계약을 쓴다.
// Claude API 키는 그 서버에만 있고 이 함수에는 없다. 승인 교사인지는 교사 세션 토큰으로 그 서버가 다시 확인한다.
// 보내는 내용은 전략 함수가 이미 검증한 비식별 프롬프트와 응답 형식뿐이다. 계정 정보·상담·학생부 원문은 넣지 않는다.
const DEFAULT_URL = 'https://service-63986215827.us-west1.run.app/api/llm/generate-open';

function relayUrl() {
  const value = String(process.env.COUNSELING_CLAUDE_RELAY_URL || DEFAULT_URL).trim();
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

// Gemini responseSchema(OBJECT/STRING…) → 표준 JSON Schema. 알려진 키만 옮긴다.
function toJsonSchema(node) {
  if (!node || typeof node !== 'object') return {};
  const type = String(node.type || '').toLowerCase();
  const out = type ? { type } : {};
  if (typeof node.description === 'string') out.description = node.description;
  if (Array.isArray(node.enum)) out.enum = node.enum.slice();
  if (type === 'object') {
    out.properties = Object.fromEntries(Object.entries(node.properties || {}).map(([key, value]) => [key, toJsonSchema(value)]));
    if (Array.isArray(node.required)) out.required = node.required.slice();
    out.additionalProperties = false;
  }
  if (type === 'array') out.items = toJsonSchema(node.items);
  return out;
}

const unfence = text => text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();

/**
 * Gemini용으로 만든 payload를 Claude 서버 계약({prompt, schema, maxOutputTokens, label})으로 보낸다.
 * 반환은 callGemini와 같은 모양({ok,status,data})이라 뒤의 검증·보완 절차를 그대로 쓴다.
 * 서버의 오류 본문은 반환하지 않는다(상태 코드와 분류 코드만).
 */
async function callClaudeRelay({ token, payload, signal, fetchImpl = fetch }) {
  const url = relayUrl();
  if (!url || !token) return { ok: false, status: 503, data: null, via: 'claude' };
  const prompt = (payload?.contents?.[0]?.parts || []).map(part => part.text || '').join('');
  const config = payload?.generationConfig || {};
  // Claude는 같은 한국어 분량에 토큰을 더 쓴다. 한 페이지 요청이 중간에 끊기지 않게 여유를 둔다.
  const maxOutputTokens = Math.max(Number(config.maxOutputTokens) || 0, 8000);
  const response = await fetchImpl(url, {
    method: 'POST',
    ...(signal ? { signal } : {}),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'x-auth-site': 'daeryun' },
    body: JSON.stringify({ prompt, schema: toJsonSchema(config.responseSchema), maxOutputTokens, label: 'counseling-strategy' }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: response.status, data: null, code: typeof data?.code === 'string' ? data.code.slice(0, 40) : '', via: 'claude' };
  const text = unfence(String(data?.text || '').trim());
  if (!text) return { ok: false, status: 502, data: null, via: 'claude' };
  return { ok: true, status: 200, via: 'claude', data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] } };
}

module.exports = { callClaudeRelay, toJsonSchema, relayUrl, DEFAULT_URL };
