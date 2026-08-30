// 샛별 AI PDF 압축용 최소 인증 게이트.
// PDF 본문은 이 함수에 오지 않으며, daeryun Supabase access token과 교사 승인 여부만 확인한다.
const ADMIN_EMAIL = 'drhong81@gmail.com';
const AUTH_TIMEOUT_MS = 8000;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST 요청만 허용됩니다.', code: 'METHOD_NOT_ALLOWED' });

  const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const SUPABASE_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json(503, { error: '회원 확인 서버 설정이 준비되지 않았습니다.', code: 'SERVER_CONFIG' });
  }

  const token = String(event.headers.authorization || event.headers.Authorization || '')
    .match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  if (!token) return json(401, { error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' });

  try {
    const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!meRes.ok) return json(401, { error: '세션이 만료되었습니다. 다시 로그인해 주세요.', code: 'AUTH_REQUIRED' });
    const me = await meRes.json();
    if (!me || !me.id) return json(401, { error: '로그인 정보를 확인하지 못했습니다.', code: 'AUTH_REQUIRED' });
    if (String(me.email || '').toLowerCase() === ADMIN_EMAIL) return json(200, { ok: true });

    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?google_id=eq.${encodeURIComponent(me.id)}&select=role,approved&limit=1`,
      {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      },
    );
    if (!profileRes.ok) {
      return json(503, { error: '회원 승인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', code: 'AUTH_SERVICE_UNAVAILABLE' });
    }
    const profiles = await profileRes.json();
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile || profile.role !== '교사' || profile.approved === false) {
      return json(403, { error: '승인된 교사 계정만 이용할 수 있습니다.', code: 'NOT_APPROVED' });
    }
    return json(200, { ok: true });
  } catch {
    return json(503, { error: '로그인 확인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', code: 'AUTH_SERVICE_UNAVAILABLE' });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(body),
  };
}
