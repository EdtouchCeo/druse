'use strict';
// Supabase 로그인 토큰을 서버에서 확인한 뒤 HttpOnly 게이트 쿠키를 발급한다.
// 등급(tier)은 localStorage 값이 아니라 항상 users 테이블 기준으로 정한다.
//   teacher: 관리자 또는 승인된 교사 / member: 그 밖의 로그인 사용자
const gate = require('./_lib/gate-cookie');

const ADMIN_EMAIL = 'drhong81@gmail.com';
const AUTH_TIMEOUT_MS = 8000;

exports.handler = async (event) => {
  if (event.httpMethod === 'DELETE') return json(200, { tier: null }, gate.clearCookieHeader());
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST 요청만 허용됩니다.', code: 'METHOD_NOT_ALLOWED' });

  const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = String(process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!SUPABASE_URL || !KEY) return json(503, { error: '회원 확인 서버 설정이 준비되지 않았습니다.', code: 'SERVER_CONFIG' });

  const token = String(event.headers.authorization || event.headers.Authorization || '')
    .match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  if (!token) return json(401, { error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, gate.clearCookieHeader());

  try {
    const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: KEY },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (meRes.status === 401 || meRes.status === 403) {
      return json(401, { error: '세션이 만료되었습니다. 다시 로그인해 주세요.', code: 'AUTH_REQUIRED' }, gate.clearCookieHeader());
    }
    if (!meRes.ok) return json(503, { error: '로그인 확인 서버에 연결하지 못했습니다.', code: 'AUTH_SERVICE_UNAVAILABLE' });
    const me = await meRes.json();
    if (!me || !me.id) return json(401, { error: '로그인 정보를 확인하지 못했습니다.', code: 'AUTH_REQUIRED' }, gate.clearCookieHeader());

    let tier = 'member';
    if (String(me.email || '').toLowerCase() === ADMIN_EMAIL) {
      tier = 'teacher';
    } else {
      const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?google_id=eq.${encodeURIComponent(me.id)}&select=role,approved&limit=1`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) },
      );
      if (!profileRes.ok) return json(503, { error: '회원 승인 상태를 확인하지 못했습니다.', code: 'AUTH_SERVICE_UNAVAILABLE' });
      const rows = await profileRes.json();
      const profile = Array.isArray(rows) ? rows[0] : null;
      if (profile && profile.role === '교사' && profile.approved !== false) tier = 'teacher';
    }
    const { value, exp } = gate.issue({ sub: me.id, tier }, KEY);
    return json(200, { tier, exp }, gate.setCookieHeader(value));
  } catch {
    return json(503, { error: '로그인 확인 서버에 연결하지 못했습니다.', code: 'AUTH_SERVICE_UNAVAILABLE' });
  }
};

function json(statusCode, body, cookie) {
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  return { statusCode, headers, body: JSON.stringify(body) };
}
