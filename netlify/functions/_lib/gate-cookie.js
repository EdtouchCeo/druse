'use strict';
// 로그인 게이트 쿠키(서버 전용). 형식과 키 유도는 netlify/edge-functions/auth-gate.js와 같아야 한다.
const crypto = require('node:crypto');

const COOKIE_NAME = '__Host-dr_gate';
const TTL_SECONDS = 24 * 60 * 60;
const b64 = (v) => Buffer.from(v).toString('base64url');

function cookieKey(serviceKey) {
  return crypto.createHmac('sha256', String(serviceKey)).update('dr-gate-cookie-v1').digest();
}
function sign(payload, serviceKey) {
  return crypto.createHmac('sha256', cookieKey(serviceKey)).update(payload).digest('base64url');
}
function issue({ sub, tier }, serviceKey, now = Date.now()) {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const payload = b64(JSON.stringify({ sub, tier, exp }));
  return { value: `v1.${payload}.${sign(payload, serviceKey)}`, exp };
}
function verify(value, serviceKey, now = Date.now()) {
  const [v, payload, sig, extra] = String(value || '').split('.');
  if (v !== 'v1' || !payload || !sig || extra !== undefined || !serviceKey) return null;
  const expected = Buffer.from(sign(payload, serviceKey));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!claims || typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}
function setCookieHeader(value) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_SECONDS}`;
}
function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
function readCookie(event) {
  const raw = String(event.headers?.cookie || event.headers?.Cookie || '');
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === COOKIE_NAME) return part.slice(at + 1).trim();
  }
  return '';
}
// 함수 앞단 검사: 통과하면 null, 막히면 그대로 돌려줄 응답.
function requireTeacher(event) {
  const claims = verify(readCookie(event), String(process.env.SUPABASE_SERVICE_KEY || '').trim());
  if (claims && claims.tier === 'teacher') return null;
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error: '승인된 교사 계정으로 로그인한 뒤 이용할 수 있습니다.', code: 'AUTH_REQUIRED' }),
  };
}

module.exports = { COOKIE_NAME, TTL_SECONDS, issue, verify, setCookieHeader, clearCookieHeader, readCookie, requireTeacher };
