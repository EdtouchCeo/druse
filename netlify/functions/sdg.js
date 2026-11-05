// 수행평가 구현 미리보기의 학생용 기능: 입장, 상태 확인, 제출, 미리보기.
// 생성은 교사 PC의 처리 프로그램이 맡는다. 이 함수에는 Claude API 키가 없다.
//
// 필요한 Netlify 환경변수:
//   SDG_SECRET                : 입장 쿠키 서명용 임의 문자열 (필수, 32자 이상)
//   SDG_SUPABASE_URL          : 작업 보관함 주소 (없으면 SUPABASE_URL)
//   SDG_SUPABASE_SERVICE_KEY  : 작업 보관함 서비스 키 (없으면 SUPABASE_SERVICE_KEY)

const crypto = require('node:crypto');
const { MAX_IMAGES, validatePlan, validStudentId, validName } = require('../../tools/sdg-preview/lib/filter.cjs');

const BUCKET = 'sdg-uploads';
const COOKIE = 'sdg_session';
const SESSION_SECONDS = 8 * 60 * 60;
const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
// 생성물은 불투명 출처로 격리한다. 부모 화면, 쿠키, 네트워크에 접근할 수 없다.
const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-modals; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
// 우클릭과 저장·소스 보기 단축키를 막는다. 입력칸의 복사는 그대로 둔다.
const PREVIEW_GUARD = "<style>body,body *{-webkit-user-select:none;user-select:none}input,textarea,[contenteditable]{-webkit-user-select:text;user-select:text}</style><script>document.addEventListener('contextmenu',function(e){e.preventDefault()});document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&/^[sup]$/i.test(e.key))e.preventDefault()});document.addEventListener('dragstart',function(e){e.preventDefault()});</script>";

const MESSAGES = {
  throttled: '입력 오류가 많아 1분 동안 입장할 수 없습니다.',
  closed: '아직 열리지 않았습니다. 선생님이 열면 다시 시도해 주세요.',
  code: '입장 코드가 맞지 않습니다.',
  busy: '이미 생성 중입니다.',
  used: '이미 1회 생성했습니다. 다시 하려면 선생님께 요청해 주세요.',
  locked: '부적절하거나 기획서로 인식되지 않은 입력이 반복되어 잠겼습니다. 선생님께 문의해 주세요.',
  unknown: '다시 입장해 주세요.',
};

const config = () => ({
  url: (process.env.SDG_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  key: process.env.SDG_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
  secret: process.env.SDG_SECRET || '',
});

const reply = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: MESSAGES[code] || code, code });

async function rpc(name, args) {
  const { url, key } = config();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

async function signUpload(path) {
  const { url, key } = config();
  const res = await fetch(`${url}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: '{}',
  });
  if (!res.ok) throw new Error(`sign ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return `${url}/storage/v1${data.url}`;
}

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token, secret) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

const header = (event, name) => event.headers?.[name] ?? event.headers?.[name.toLowerCase()];
function sessionOf(event, secret) {
  const raw = header(event, 'cookie') || '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(raw);
  return m ? verify(m[1], secret) : null;
}
const isHttps = (event) => header(event, 'x-forwarded-proto') === 'https';
function cookie(event, value, maxAge) {
  return `${COOKIE}=${value}; Path=/sdg-api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(event) ? '; Secure' : ''}`;
}
// 다른 사이트에서 보낸 요청을 막는다.
function badOrigin(event) {
  const origin = header(event, 'origin');
  const host = header(event, 'x-forwarded-host') || header(event, 'host');
  if (origin) {
    try {
      if (new URL(origin).host !== host) return true;
    } catch {
      return true;
    }
  }
  return !(header(event, 'content-type') || '').startsWith('application/json');
}
function parseBody(event) {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body;
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

async function login(event, secret) {
  const body = parseBody(event);
  if (!body) return fail(400, '요청 형식이 잘못되었습니다.');
  const id = String(body.id || '').trim();
  const name = String(body.name || '').trim();
  if (!validStudentId(id)) return fail(400, '학번을 확인해 주세요. 예: 10301 (1학년 3반 1번)');
  if (!validName(name)) return fail(400, '이름을 입력해 주세요.');
  const ip = header(event, 'x-nf-client-connection-ip') || header(event, 'x-forwarded-for') || 'unknown';
  const device = String(body.device || '').slice(0, 64) || null;
  const out = await rpc('sdg_login', { p_id: id, p_name: name, p_code: String(body.code || '').trim(), p_ip: ip, p_device: device });
  if (out.error) return fail(out.error === 'throttled' ? 429 : 403, out.error);
  const token = sign({ id, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }, secret);
  return reply(200, { ok: true }, { 'Set-Cookie': cookie(event, token, SESSION_SECONDS) });
}

async function submitPlan(session, event) {
  const body = parseBody(event);
  if (!body) return fail(400, '요청 형식이 잘못되었습니다.');
  const can = await rpc('sdg_can_submit', { p_id: session.id, p_stage: 1 });
  if (can.error) return fail(can.error === 'locked' || can.error === 'closed' ? 403 : 409, can.error);
  const checked = validatePlan(body.text);
  if (checked.banned) {
    await rpc('sdg_note_refusal', { p_id: session.id, p_stage: 1, p_reason: checked.error });
    return fail(400, checked.error);
  }
  if (checked.error) return fail(400, checked.error);
  const out = await rpc('sdg_submit', { p_id: session.id, p_stage: 1, p_text: checked.text, p_prefix: null, p_count: null });
  if (out.error) return fail(out.error === 'locked' || out.error === 'closed' ? 403 : 409, out.error);
  return reply(202, { ok: true });
}

// 2차 이미지는 함수 크기 제한을 피해 브라우저가 보관함에 직접 올린다. 여기서는 일회용 주소만 발급한다.
async function prepareUpload(session, event) {
  const body = parseBody(event);
  const count = Number(body?.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGES) return fail(400, `이미지는 ${MAX_IMAGES}장까지 처리할 수 있습니다.`);
  const can = await rpc('sdg_can_submit', { p_id: session.id, p_stage: 2 });
  if (can.error) return fail(can.error === 'locked' || can.error === 'closed' ? 403 : 409, can.error);
  const prefix = `${session.id}/${crypto.randomBytes(8).toString('hex')}`;
  const urls = await Promise.all(
    Array.from({ length: count }, (_, i) => signUpload(`${prefix}/${String(i + 1).padStart(2, '0')}.jpg`)),
  );
  return reply(200, { prefix, urls });
}

async function submitDesign(session, event) {
  const body = parseBody(event);
  const count = Number(body?.count);
  const prefix = String(body?.prefix || '');
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGES) return fail(400, `이미지는 ${MAX_IMAGES}장까지 처리할 수 있습니다.`);
  // 자기 학번 폴더만 제출할 수 있다.
  if (!new RegExp(`^${session.id}/[a-f0-9]{16}$`).test(prefix)) return fail(400, '요청 형식이 잘못되었습니다.');
  const out = await rpc('sdg_submit', { p_id: session.id, p_stage: 2, p_text: null, p_prefix: prefix, p_count: count });
  if (out.error) return fail(out.error === 'locked' || out.error === 'closed' ? 403 : 409, out.error);
  return reply(202, { ok: true });
}

async function preview(session, event, stage) {
  // 화면 안 틀에서만 열리게 하여 주소를 직접 열거나 저장하기 어렵게 한다.
  if (header(event, 'sec-fetch-dest') !== 'iframe') {
    return { statusCode: 403, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }, body: '미리보기 화면에서만 볼 수 있습니다.' };
  }
  const html = await rpc('sdg_result', { p_id: session.id, p_stage: stage });
  if (!html) return { statusCode: 404, headers: BASE_HEADERS, body: 'not found' };
  return {
    statusCode: 200,
    headers: { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PREVIEW_CSP },
    body: html.replace(/<!doctype html>/i, (m) => `${m}${PREVIEW_GUARD}`),
  };
}

exports.handler = async (event) => {
  const { url, key, secret } = config();
  if (!url || !key || secret.length < 32) return fail(500, '서버 설정이 끝나지 않았습니다. 선생님께 알려 주세요.');
  const route = /(?:sdg-api|functions\/sdg)\/(.*)$/.exec(event.path || '')?.[1] || '';
  const method = event.httpMethod;
  try {
    if (method === 'POST' && badOrigin(event)) return fail(403, '허용되지 않은 요청입니다.');
    if (route === 'login' && method === 'POST') return await login(event, secret);
    if (route === 'logout' && method === 'POST') return reply(200, { ok: true }, { 'Set-Cookie': cookie(event, '', 0) });

    const session = sessionOf(event, secret);
    if (!session) return fail(401, '입장이 필요합니다.');
    if (route === 'me' && method === 'GET') {
      const me = await rpc('sdg_me', { p_id: session.id });
      return me.error ? fail(401, me.error) : reply(200, me);
    }
    if (route === 'submit/1' && method === 'POST') return await submitPlan(session, event);
    if (route === 'prepare/2' && method === 'POST') return await prepareUpload(session, event);
    if (route === 'submit/2' && method === 'POST') return await submitDesign(session, event);
    const p = /^preview\/([12])$/.exec(route);
    if (p && method === 'GET') return await preview(session, event, Number(p[1]));
    return fail(404, '없는 경로입니다.');
  } catch (err) {
    console.error('[sdg]', err.message);
    return fail(502, '일시적인 오류입니다. 잠시 뒤 다시 시도해 주세요.');
  }
};
