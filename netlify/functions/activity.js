// 교육활동 사진 — 목록/사진 업로드/등록/삭제 (교사 전용)
// 저장: Supabase activities 테이블 + Storage 비공개 버킷(activity-photos, 서명 URL 조회)
const ADMIN_EMAIL = 'drhong81@gmail.com';
const BUCKET = 'activity-photos';
const SIGN_EXPIRES = 60 * 60 * 24 * 7; // 서명 URL 7일

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json(500, { error: 'Server config error' });
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { action, token } = body;
  if (!token) return json(401, { error: '로그인이 필요합니다.' });

  const svcHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
  };

  // 1) 토큰 검증 → 요청자 확인
  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_SERVICE_KEY }
  });
  if (!meRes.ok) return json(401, { error: '세션이 만료되었습니다. 다시 로그인해 주세요.' });
  const me = await meRes.json();
  const email = (me.email || '').toLowerCase();
  const isAdmin = email === ADMIN_EMAIL;

  // 2) users 프로필 조회 (google_id = Supabase auth uid)
  const uRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?google_id=eq.${encodeURIComponent(me.id)}&select=id,name,role,approved`,
    { headers: svcHeaders }
  );
  const profiles = uRes.ok ? await uRes.json() : [];
  const profile = profiles[0] || null;
  const isTeacher = isAdmin || (profile && profile.role === '교사' && profile.approved !== false);
  if (!isTeacher) return json(403, { error: '승인된 교사 계정만 이용할 수 있습니다.' });

  const userId = profile ? profile.id : me.id;
  const userName = profile ? profile.name : (isAdmin ? '관리자' : '교사');

  try {
    // ===== 목록 =====
    if (action === 'list') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/activities?select=*&order=event_date.desc,created_at.desc&limit=200`,
        { headers: svcHeaders }
      );
      if (!r.ok) {
        const t = await r.text();
        if (r.status === 404 || /relation .* does not exist|PGRST/.test(t)) {
          return json(500, { error: 'activities 테이블이 아직 생성되지 않았습니다. 관리자에게 문의하세요.' });
        }
        return json(500, { error: '목록 조회에 실패했습니다.' });
      }
      const rows = await r.json();

      // 사진 경로 → 서명 URL 일괄 발급
      const allPaths = [];
      rows.forEach(row => (row.photos || []).forEach(p => allPaths.push(p)));
      let signed = {};
      if (allPaths.length > 0) {
        const sRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}`, {
          method: 'POST',
          headers: { ...svcHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: SIGN_EXPIRES, paths: allPaths })
        });
        if (sRes.ok) {
          const arr = await sRes.json();
          arr.forEach(it => {
            if (it && it.path && it.signedURL) {
              signed[it.path] = `${SUPABASE_URL}/storage/v1${it.signedURL}`;
            }
          });
        }
      }
      const items = rows.map(row => ({
        id: row.id,
        title: row.title,
        event_date: row.event_date,
        description: row.description || '',
        created_by: row.created_by,
        created_by_name: row.created_by_name || '',
        created_at: row.created_at,
        mine: isAdmin || String(row.created_by) === String(userId),
        photos: (row.photos || []).map(p => ({ path: p, url: signed[p] || null }))
      }));
      return json(200, { items, isAdmin });
    }

    // ===== 사진 1장 업로드 (base64) =====
    if (action === 'upload') {
      const data = body.data;
      const type = body.type === 'image/png' ? 'image/png' : 'image/jpeg';
      if (!data || typeof data !== 'string') return json(400, { error: '이미지 데이터가 없습니다.' });
      if (data.length > 5.5 * 1024 * 1024) return json(413, { error: '이미지가 너무 큽니다. (압축 후 4MB 이하)' });

      let buf;
      try { buf = Buffer.from(data, 'base64'); }
      catch { return json(400, { error: '이미지 데이터 형식 오류' }); }

      await ensureBucket(SUPABASE_URL, svcHeaders);

      const ext = type === 'image/png' ? 'png' : 'jpg';
      const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Content-Type': type },
        body: buf
      });
      if (!upRes.ok) {
        const t = await upRes.text();
        return json(500, { error: '사진 업로드 실패: ' + t.slice(0, 200) });
      }
      return json(200, { path });
    }

    // ===== 등록 =====
    if (action === 'create') {
      const title = (body.title || '').trim();
      const eventDate = (body.event_date || '').trim();
      const description = (body.description || '').trim();
      const photos = Array.isArray(body.photos) ? body.photos.filter(p => typeof p === 'string').slice(0, 30) : [];
      if (!title) return json(400, { error: '행사명을 입력해 주세요.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return json(400, { error: '일자를 선택해 주세요.' });
      if (photos.length === 0) return json(400, { error: '사진을 1장 이상 첨부해 주세요.' });

      const ins = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({
          title, event_date: eventDate, description,
          photos, created_by: userId, created_by_name: userName
        })
      });
      const insData = await ins.json().catch(() => null);
      if (!ins.ok) {
        const msg = insData && insData.message ? insData.message : '';
        if (/relation .* does not exist/.test(msg)) {
          return json(500, { error: 'activities 테이블이 아직 생성되지 않았습니다. 관리자에게 문의하세요.' });
        }
        return json(500, { error: '등록 실패: ' + msg.slice(0, 200) });
      }
      return json(200, { item: Array.isArray(insData) ? insData[0] : insData });
    }

    // ===== 삭제 (작성자 본인 또는 관리자) =====
    if (action === 'delete') {
      const id = body.id;
      if (!id) return json(400, { error: 'id가 없습니다.' });
      const gRes = await fetch(
        `${SUPABASE_URL}/rest/v1/activities?id=eq.${encodeURIComponent(id)}&select=id,created_by,photos`,
        { headers: svcHeaders }
      );
      const rows = gRes.ok ? await gRes.json() : [];
      const row = rows[0];
      if (!row) return json(404, { error: '이미 삭제된 게시물입니다.' });
      if (!isAdmin && String(row.created_by) !== String(userId)) {
        return json(403, { error: '본인이 등록한 게시물만 삭제할 수 있습니다.' });
      }
      // 스토리지 사진 삭제 (실패해도 게시물 삭제는 진행)
      const paths = row.photos || [];
      if (paths.length > 0) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
          method: 'DELETE',
          headers: { ...svcHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: paths })
        }).catch(() => {});
      }
      const dRes = await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: svcHeaders
      });
      if (!dRes.ok) return json(500, { error: '삭제에 실패했습니다.' });
      return json(200, { ok: true });
    }

    return json(400, { error: '알 수 없는 action' });
  } catch (e) {
    return json(500, { error: '서버 오류: ' + String(e && e.message || e).slice(0, 200) });
  }
};

// 비공개 버킷 없으면 생성 (이미 있으면 무시)
async function ensureBucket(SUPABASE_URL, svcHeaders) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers: svcHeaders });
    if (r.ok) return;
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false })
    });
  } catch (e) { /* 업로드 단계에서 실패로 드러남 */ }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}
