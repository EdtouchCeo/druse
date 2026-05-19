// 관리자 전용 — 회원 승인 / 승인 해제 / 삭제 / 구분 변경
const ADMIN_EMAIL = 'drhong81@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server config error' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { token, google_id, action, value } = body;
  if (!token)     return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };
  if (!google_id) return { statusCode: 400, body: JSON.stringify({ error: 'google_id required' }) };

  // 관리자 검증
  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_SERVICE_KEY }
  });
  if (!meRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
  const me = await meRes.json();
  if (!me || (me.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return { statusCode: 403, body: JSON.stringify({ error: '관리자 권한이 없습니다.' }) };
  }

  const base = `${SUPABASE_URL}/rest/v1/users?google_id=eq.${encodeURIComponent(google_id)}`;
  const h = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Prefer': 'return=representation'
  };

  let res;
  if (action === 'approve' || action === 'unapprove') {
    res = await fetch(base, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ approved: action === 'approve' })
    });
  } else if (action === 'role') {
    if (!value) return { statusCode: 400, body: JSON.stringify({ error: 'role value required' }) };
    res = await fetch(base, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ role: value })
    });
  } else if (action === 'delete') {
    res = await fetch(base, { method: 'DELETE', headers: h });
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  }

  const data = await res.json().catch(() => ({}));
  return {
    statusCode: res.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(res.ok ? { ok: true, data } : { error: data })
  };
};
