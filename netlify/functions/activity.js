// 교육활동 사진 — 목록/사진 업로드/등록/삭제 (교사 전용)
// 저장: Supabase Storage 비공개 버킷(activity-photos) 단독 —
//   사진: photos/... , 게시물 메타: meta/{event_date}_{ts}_{rand}.json (게시물당 1파일 → 동시 등록 경합 없음)
//   DB 테이블 불필요 — 버킷은 최초 요청 시 자동 생성되어 수동 설정이 없다.
const ADMIN_EMAIL = 'drhong81@gmail.com';
const BUCKET = 'activity-photos';
const SIGN_EXPIRES = 60 * 60 * 24 * 7; // 서명 URL 7일
let _bucketReady = false; // 웜 인스턴스 캐시

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
    await ensureBucket(SUPABASE_URL, svcHeaders);

    // ===== 목록 =====
    if (action === 'list') {
      // 메타 파일명이 {event_date}_{ts}_... 형식 → 이름 내림차순 = 일자 최신순
      const lRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: 'meta/', limit: 200, sortBy: { column: 'name', order: 'desc' } })
      });
      const names = lRes.ok
        ? (await lRes.json()).filter(o => o && o.name && o.name.endsWith('.json')).map(o => o.name)
        : [];

      // 메타 JSON 병렬 다운로드 (10개씩)
      const rows = [];
      for (let i = 0; i < names.length; i += 10) {
        const chunk = names.slice(i, i + 10);
        const got = await Promise.all(chunk.map(async (name) => {
          try {
            const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/meta/${name}`, { headers: svcHeaders });
            return r.ok ? await r.json() : null;
          } catch { return null; }
        }));
        got.forEach(g => { if (g && g.id) rows.push(g); });
      }

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

      const ext = type === 'image/png' ? 'png' : 'jpg';
      const path = `photos/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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
      const photos = Array.isArray(body.photos)
        ? body.photos.filter(p => typeof p === 'string' && /^photos\//.test(p)).slice(0, 30)
        : [];
      if (!title) return json(400, { error: '행사명을 입력해 주세요.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return json(400, { error: '일자를 선택해 주세요.' });
      if (photos.length === 0) return json(400, { error: '사진을 1장 이상 첨부해 주세요.' });

      const id = `${eventDate}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const meta = {
        id, title: title.slice(0, 200), event_date: eventDate, description: description.slice(0, 4000),
        photos, created_by: userId, created_by_name: userName,
        created_at: new Date().toISOString()
      };
      const mRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/meta/${id}.json`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(meta)
      });
      if (!mRes.ok) {
        const t = await mRes.text();
        return json(500, { error: '등록 실패: ' + t.slice(0, 200) });
      }
      return json(200, { item: meta });
    }

    // ===== 삭제 (작성자 본인 또는 관리자) =====
    if (action === 'delete') {
      const id = String(body.id || '');
      if (!/^\d{4}-\d{2}-\d{2}_\d+_[a-z0-9]+$/.test(id)) return json(400, { error: '잘못된 id입니다.' });
      const gRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/meta/${id}.json`, { headers: svcHeaders });
      if (!gRes.ok) return json(404, { error: '이미 삭제된 게시물입니다.' });
      const row = await gRes.json();
      if (!isAdmin && String(row.created_by) !== String(userId)) {
        return json(403, { error: '본인이 등록한 게시물만 삭제할 수 있습니다.' });
      }
      const targets = (row.photos || []).filter(p => typeof p === 'string').concat([`meta/${id}.json`]);
      const dRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...svcHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: targets })
      });
      if (!dRes.ok) return json(500, { error: '삭제에 실패했습니다.' });
      return json(200, { ok: true });
    }

    return json(400, { error: '알 수 없는 action' });
  } catch (e) {
    return json(500, { error: '서버 오류: ' + String(e && e.message || e).slice(0, 200) });
  }
};

// 비공개 버킷 없으면 생성 (이미 있으면 무시, 웜 인스턴스에선 캐시)
async function ensureBucket(SUPABASE_URL, svcHeaders) {
  if (_bucketReady) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers: svcHeaders });
    if (!r.ok) {
      await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false })
      });
    }
    _bucketReady = true;
  } catch (e) { /* 이후 단계에서 실패로 드러남 */ }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}
