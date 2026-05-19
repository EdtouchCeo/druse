// 관리자 전용 — 회원 목록 + 활동 로그 통계 조회
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

  const token = body.token;
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };
  }

  // 1) 토큰으로 요청자 이메일 확인 → 관리자 검증
  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_SERVICE_KEY }
  });
  if (!meRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
  }
  const me = await meRes.json();
  if (!me || (me.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return { statusCode: 403, body: JSON.stringify({ error: '관리자 권한이 없습니다.' }) };
  }

  const h = { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` };

  // 2) 회원 목록
  const usersRes = await fetch(`${SUPABASE_URL}/rest/v1/users?select=*&order=id.desc`, { headers: h });
  const users = usersRes.ok ? await usersRes.json() : [];

  // 3) 활동 로그 (최근 1000건)
  const logsRes = await fetch(`${SUPABASE_URL}/rest/v1/logs?select=*&order=id.desc&limit=1000`, { headers: h });
  const logs = logsRes.ok ? await logsRes.json() : [];

  // 4) 통계 집계
  const byRole = {};
  let pending = 0;
  users.forEach(u => {
    const r = u.role || '미지정';
    byRole[r] = (byRole[r] || 0) + 1;
    if (u.approved === false) pending += 1;
  });

  const byEvent = {};
  const tabCount = {};
  const searchCount = {};
  logs.forEach(l => {
    const e = l.event_type || '기타';
    byEvent[e] = (byEvent[e] || 0) + 1;
    if (e === '탭클릭' && l.detail) tabCount[l.detail] = (tabCount[l.detail] || 0) + 1;
    if (e === '검색' && l.detail) searchCount[l.detail] = (searchCount[l.detail] || 0) + 1;
  });

  const topTabs = Object.entries(tabCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topSearches = Object.entries(searchCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // user_id → 이름 매핑 (최근 활동 표시용)
  const idName = {};
  users.forEach(u => { idName[u.google_id] = u.name; });
  const recent = logs.slice(0, 40).map(l => ({
    name: idName[l.user_id] || '(알 수 없음)',
    event_type: l.event_type,
    detail: l.detail,
    created_at: l.created_at || null
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      users,
      stats: {
        total_users: users.length,
        by_role: byRole,
        pending,
        total_logs: logs.length,
        by_event: byEvent,
        top_tabs: topTabs,
        top_searches: topSearches
      },
      recent
    })
  };
};
