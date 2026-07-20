// 주간 교육활동 안내 — 부서별 주간 안내 목록/등록/수정/삭제 (교사 전용, 텍스트 전용)
// 저장: Supabase Storage 비공개 버킷(weekly-notices) 단독 —
//   게시물 메타: notices/{학년도}-{월2자리}-{주차}/{ts}_{rand}.json (게시물당 1파일 → 동시 등록 경합 없음)
//   주차별 프리픽스로 저장하여 list 시 해당 주차 폴더만 조회한다.
//   DB 테이블 불필요 — 버킷은 최초 요청 시 자동 생성되어 수동 설정이 없다.
const ADMIN_EMAIL = 'drhong81@gmail.com';
const BUCKET = 'weekly-notices';
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

    // ===== 목록 (해당 주차 프리픽스만) =====
    if (action === 'list') {
      const slot = parseSlot(body);
      if (!slot) return json(400, { error: '학년도·월·주차 값이 올바르지 않습니다.' });

      const lRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: `notices/${slot}/`, limit: 200, sortBy: { column: 'name', order: 'desc' } })
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
            const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/notices/${slot}/${name}`, { headers: svcHeaders });
            return r.ok ? await r.json() : null;
          } catch { return null; }
        }));
        got.forEach(g => { if (g && g.id) rows.push(g); });
      }

      const items = rows.map(row => ({
        id: row.id,
        year: row.year, month: row.month, week: row.week,
        title: row.title,
        content: row.content || '',
        created_by: row.created_by,
        created_by_name: row.created_by_name || '',
        created_at: row.created_at,
        updated_at: row.updated_at || null,
        mine: isAdmin || String(row.created_by) === String(userId)
      }));
      // 등록 최신순 (같은 주차 내)
      items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return json(200, { items, isAdmin });
    }

    // ===== 등록 =====
    if (action === 'create') {
      const slot = parseSlot(body);
      if (!slot) return json(400, { error: '학년도·월·주차를 선택해 주세요.' });
      const title = (body.title || '').trim();
      const content = (body.content || '').trim();
      if (!title) return json(400, { error: '부서명(제목)을 입력해 주세요.' });
      if (!content) return json(400, { error: '안내 내용을 입력해 주세요.' });

      const y = Number(body.year), mo = Number(body.month), wk = Number(body.week);
      const id = `${slot}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const meta = {
        id, year: y, month: mo, week: wk,
        title: title.slice(0, 100),
        content: content.slice(0, 4000),
        created_by: userId, created_by_name: userName,
        created_at: new Date().toISOString()
      };
      const mRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/notices/${id}.json`, {
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

    // ===== 수정 (작성자 본인 또는 관리자) — 제목·내용만, 주차 슬롯은 고정 =====
    if (action === 'update') {
      const id = String(body.id || '');
      if (!isValidId(id)) return json(400, { error: '잘못된 id입니다.' });
      const gRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/notices/${id}.json`, { headers: svcHeaders });
      if (!gRes.ok) return json(404, { error: '게시물을 찾을 수 없습니다.' });
      const row = await gRes.json();
      if (!isAdmin && String(row.created_by) !== String(userId)) {
        return json(403, { error: '본인이 등록한 안내만 수정할 수 있습니다.' });
      }
      const title = (body.title || '').trim();
      const content = (body.content || '').trim();
      if (!title) return json(400, { error: '부서명(제목)을 입력해 주세요.' });
      if (!content) return json(400, { error: '안내 내용을 입력해 주세요.' });

      const meta = {
        ...row,
        title: title.slice(0, 100),
        content: content.slice(0, 4000),
        updated_at: new Date().toISOString()
      };
      const pRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/notices/${id}.json`, {
        method: 'PUT',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', 'x-upsert': 'true' },
        body: JSON.stringify(meta)
      });
      if (!pRes.ok) {
        const t = await pRes.text();
        return json(500, { error: '수정 실패: ' + t.slice(0, 200) });
      }
      return json(200, { item: meta });
    }

    // ===== 삭제 (작성자 본인 또는 관리자) =====
    if (action === 'delete') {
      const id = String(body.id || '');
      if (!isValidId(id)) return json(400, { error: '잘못된 id입니다.' });
      const gRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/notices/${id}.json`, { headers: svcHeaders });
      if (!gRes.ok) return json(404, { error: '이미 삭제된 게시물입니다.' });
      const row = await gRes.json();
      if (!isAdmin && String(row.created_by) !== String(userId)) {
        return json(403, { error: '본인이 등록한 안내만 삭제할 수 있습니다.' });
      }
      const dRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...svcHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [`notices/${id}.json`] })
      });
      if (!dRes.ok) return json(500, { error: '삭제에 실패했습니다.' });
      return json(200, { ok: true });
    }

    return json(400, { error: '알 수 없는 action' });
  } catch (e) {
    return json(500, { error: '서버 오류: ' + String(e && e.message || e).slice(0, 200) });
  }
};

// 학년도-월-주차 → 정규화 슬러그 (경로 조작 차단: 숫자만 허용)
// year: 2000~2100, month: 1~12, week: 1~5 → "2026-07-3"
function parseSlot(body) {
  const y = Number(body.year), mo = Number(body.month), wk = Number(body.week);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) return null;
  if (!Number.isInteger(wk) || wk < 1 || wk > 5) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${wk}`;
}

// id 형식 검증 (경로 조작 차단): 2026-07-3/1737000000000_ab12cd
function isValidId(id) {
  return /^\d{4}-\d{2}-[1-5]\/\d+_[a-z0-9]+$/.test(id);
}

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
