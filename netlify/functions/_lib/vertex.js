// Gemini 호출 공용 헬퍼 — Vertex AI(체험판 크레딧 계정) 우선, 실패 시 기존 API 키로 즉시 폴백.
// data_analysis server.ts의 "Vertex 최우선 + 오류 벤치 + API 키 교대" 패턴을 함수 환경에 맞게 이식.
//
// 환경변수(둘 다 있어야 Vertex 경로 활성 — 미설정이면 기존 API 키 동작과 완전히 동일):
//   VERTEX_PROJECT  : Vertex 과금 대상 GCP 프로젝트 ID (예: edtouch-ai)
//   VERTEX_SA_KEY   : 서비스 계정 JSON — 전문 또는 최소 {"client_email","private_key"}
//                     (Lambda env 4KB 한도 대비 최소형 권장)
//   VERTEX_LOCATION : 선택, 기본 us-central1
//   VERTEX_EMBED    : '0'이면 임베딩만 Vertex 제외(벡터 공간 불일치 발견 시 차단용)

const crypto = require('crypto');

const VERTEX_PROJECT = process.env.VERTEX_PROJECT || '';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const VERTEX_EMBED_ON = process.env.VERTEX_EMBED !== '0';

let SA = null;
try {
  if (VERTEX_PROJECT && process.env.VERTEX_SA_KEY) {
    const parsed = JSON.parse(process.env.VERTEX_SA_KEY);
    if (parsed && parsed.client_email && parsed.private_key) SA = parsed;
  }
} catch {
  /* 파싱 실패 시 Vertex 비활성 — API 키 경로만 사용 */
}

// 워밍 컨테이너 동안 유지되는 모듈 상태: 액세스 토큰 캐시 + 오류 벤치
let tokenCache = { token: '', exp: 0 };
let benchedUntil = 0;

function vertexEnabled() {
  return !!SA && Date.now() >= benchedUntil;
}

// Vertex 오류 시 잠시 벤치 — 인증·경로류(401/403/404)는 10분, 일시 오류는 60초.
// 벤치 동안은 API 키 경로만 사용해 사용자 요청이 Vertex 재시도로 지연되지 않게 한다.
function bench(status) {
  const authIssue = status === 401 || status === 403 || status === 404;
  benchedUntil = Date.now() + (authIssue ? 10 * 60_000 : 60_000);
}

// 서비스 계정 JWT → OAuth2 액세스 토큰 (외부 패키지 없이 Node crypto로 서명)
async function getToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.exp - 60_000) return tokenCache.token;
  const iat = Math.floor(now / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned =
    b64({ alg: 'RS256', typ: 'JWT' }) + '.' +
    b64({
      iss: SA.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(SA.private_key).toString('base64url');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
      '&assertion=' + encodeURIComponent(unsigned + '.' + sig),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data || !data.access_token) {
    throw Object.assign(new Error('Vertex 토큰 발급 실패 (HTTP ' + resp.status + ')'), { status: resp.status });
  }
  tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

function vertexModelUrl(model, method) {
  return (
    'https://' + VERTEX_LOCATION + '-aiplatform.googleapis.com/v1/projects/' + VERTEX_PROJECT +
    '/locations/' + VERTEX_LOCATION + '/publishers/google/models/' + encodeURIComponent(model) + ':' + method
  );
}

/**
 * generateContent 호출 — payload(contents/generationConfig/systemInstruction)는
 * generativelanguage와 Vertex가 동일 shape이므로 그대로 전달한다.
 * 반환: { ok, status, data, via: 'vertex'|'key' } — 호출부의 기존 resp.ok/data 처리와 1:1 대응.
 */
async function callGemini({ apiKey, model, payload }) {
  if (vertexEnabled()) {
    try {
      const token = await getToken();
      const resp = await fetch(vertexModelUrl(model, 'generateContent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok) return { ok: true, status: resp.status, data, via: 'vertex' };
      bench(resp.status);
    } catch (e) {
      bench(e && e.status);
    }
    // 폴백으로 계속 — Vertex 실패가 사용자 요청을 실패시키지 않는다
  }
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) +
    ':generateContent?key=' + apiKey;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data, via: 'key' };
}

/**
 * 임베딩 호출 — Vertex는 :predict(instances/parameters), API 키는 :embedContent로 상이한
 * 표면을 헬퍼가 흡수한다. 같은 gemini-embedding-001 모델이므로 벡터 공간은 동일해야 하며,
 * 배포 시 두 경로 벡터 일치(코사인 유사도) 검증을 거친다. 불일치 시 VERTEX_EMBED=0으로 차단.
 * 반환: { values, via } — 실패는 기존 embedOne처럼 throw(err.status 유지).
 */
async function callEmbed({ apiKey, model, text, taskType, dim }) {
  const content = (text || ' ').toString().slice(0, 2000);
  if (vertexEnabled() && VERTEX_EMBED_ON) {
    try {
      const token = await getToken();
      const resp = await fetch(vertexModelUrl(model, 'predict'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          instances: [{ task_type: taskType, content }],
          parameters: { outputDimensionality: dim },
        }),
      });
      const data = await resp.json().catch(() => null);
      const values =
        data && data.predictions && data.predictions[0] &&
        data.predictions[0].embeddings && data.predictions[0].embeddings.values;
      if (resp.ok && values && values.length) return { values, via: 'vertex' };
      bench(resp.status);
    } catch (e) {
      bench(e && e.status);
    }
  }
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) +
    ':embedContent?key=' + apiKey;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/' + model,
      content: { parts: [{ text: content }] },
      taskType: taskType,
      outputDimensionality: dim,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error((data && data.error && data.error.message) || ('HTTP ' + resp.status));
    err.status = resp.status;
    throw err;
  }
  const values = data.embedding && data.embedding.values;
  if (!values || !values.length) throw new Error('임베딩 응답 형식 오류');
  return { values, via: 'key' };
}

module.exports = { callGemini, callEmbed };
