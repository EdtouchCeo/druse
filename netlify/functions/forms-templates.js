// 업무 양식 AI — 관리자 양식 목록/내려받기/올리기/수정/삭제 (교사 전용, 올리기·수정·삭제는 관리자)
// 저장: Supabase Storage 비공개 버킷(form-templates) — activity.js(교육활동 사진)와 같은 방식
//   양식 파일: files/{id}.{hwpx|hwp|xlsx}, 양식 정보: meta/{id}.json (양식당 1파일 → 동시 수정 경합 없음)
//   버킷은 최초 요청 시 자동 생성되어 콘솔 작업이 없다.
// 교사 문서·대화는 이 함수로 오지 않는다(브라우저 무저장 원칙). 서버에 남는 것은 관리자가 올린 양식뿐이다.
const ADMIN_EMAIL = 'drhong81@gmail.com';
const BUCKET = 'form-templates';
const SIGN_EXPIRES = 60 * 30; // 내려받기 서명 URL 30분
// 엑셀 양식은 3단계(시트 편집기)에서 연다. 그전까지는 한글만 받는다.
const KINDS = { hwpx: 'application/hwp+zip', hwp: 'application/x-hwp' };
const MAX_B64 = 5.5 * 1024 * 1024; // 원본 약 4MB (Netlify 함수 요청 6MB 한도 안)
let _bucketReady = false;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return json(500, { error: '서버 설정을 확인하지 못했습니다.' });

  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: '요청 형식이 올바르지 않습니다.' }); }
  const { action, token } = body;
  if (!token) return json(401, { error: '로그인이 필요합니다.' });

  const svc = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

  // 1) 토큰 → 요청자 확인 (activity.js와 같은 판정)
  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY } });
  if (!meRes.ok) return json(401, { error: '로그인이 만료되었습니다. 대륜고 사용설명서에서 다시 로그인해 주세요.' });
  const me = await meRes.json();
  // 이 사이트는 구글 로그인만 쓴다. 이메일만 같은 다른 방식의 가입으로 관리자가 되지 않도록 공급자와 확인 여부도 본다.
  const viaGoogle = ((me.app_metadata && me.app_metadata.provider) === 'google' || (me.app_metadata && Array.isArray(me.app_metadata.providers) && me.app_metadata.providers.includes('google'))) && !!(me.email_confirmed_at || me.confirmed_at);
  const isAdmin = !!viaGoogle && (me.email || '').toLowerCase() === ADMIN_EMAIL;
  const uRes = await fetch(`${SUPABASE_URL}/rest/v1/users?google_id=eq.${encodeURIComponent(me.id)}&select=id,name,role,approved`, { headers: svc });
  const profile = uRes.ok ? (await uRes.json())[0] || null : null;
  const isTeacher = isAdmin || (profile && profile.role === '교사' && profile.approved !== false);
  if (!isTeacher) return json(403, { error: '승인된 교사 계정만 이용할 수 있습니다.' });
  const userName = profile ? profile.name : '관리자';

  try {
    if (action === 'me') return json(200, { ok: true, isAdmin, name: userName });

    await ensureBucket(SUPABASE_URL, svc);

    if (action === 'list') {
      const lRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST', headers: { ...svc, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: 'meta/', limit: 200, sortBy: { column: 'name', order: 'asc' } })
      });
      const names = lRes.ok ? (await lRes.json()).filter((o) => o && o.name && o.name.endsWith('.json')).map((o) => o.name) : [];
      const items = (await Promise.all(names.map(async (n) => {
        try { const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/meta/${n}`, { headers: svc }); return r.ok ? await r.json() : null; } catch { return null; }
      }))).filter((m) => m && m.id);
      items.sort((a, b) => String(a.dept || '').localeCompare(String(b.dept || ''), 'ko') || String(a.title).localeCompare(String(b.title), 'ko'));
      return json(200, { items, isAdmin });
    }

    if (action === 'get') {
      const id = String(body.id || '');
      if (!validId(id)) return json(400, { error: '잘못된 양식입니다.' });
      const meta = await readMeta(SUPABASE_URL, svc, id);
      if (!meta) return json(404, { error: '양식을 찾을 수 없습니다. 목록을 새로 고쳐 주세요.' });
      const sRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${meta.file}`, {
        method: 'POST', headers: { ...svc, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: SIGN_EXPIRES })
      });
      if (!sRes.ok) return json(500, { error: '양식 파일을 준비하지 못했습니다.' });
      const s = await sRes.json();
      return json(200, { item: meta, url: `${SUPABASE_URL}/storage/v1${s.signedURL}` });
    }

    if (!isAdmin) return json(403, { error: '양식은 관리자만 올리거나 고칠 수 있습니다.' });

    if (action === 'save') {
      // 새 양식이면 파일 필수, 기존 양식이면 정보만 고치거나 파일을 바꾼다.
      const prev = body.id ? (validId(String(body.id)) ? await readMeta(SUPABASE_URL, svc, String(body.id)) : null) : null;
      if (body.id && !prev) return json(404, { error: '고칠 양식을 찾을 수 없습니다.' });
      const m = cleanMeta(body.meta || {});
      if (!m.title) return json(400, { error: '양식 이름을 입력해 주세요.' });
      const id = prev ? prev.id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let file = prev ? prev.file : null, kind = prev ? prev.kind : null, fileName = prev ? prev.fileName : null;
      if (body.data) {
        kind = String(body.kind || '');
        if (!KINDS[kind]) return json(400, { error: '한글(.hwp·.hwpx) 파일만 양식으로 올릴 수 있습니다.' });
        if (typeof body.data !== 'string' || body.data.length > MAX_B64) return json(413, { error: '양식 파일이 너무 큽니다. 4MB 이하로 올려 주세요.' });
        const buf = Buffer.from(body.data, 'base64');
        const newFile = `files/${id}_${Date.now()}.${kind}`;
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${newFile}`, { method: 'POST', headers: { ...svc, 'Content-Type': KINDS[kind] }, body: buf });
        if (!up.ok) { console.error('upload', up.status, (await up.text()).slice(0, 300)); return json(500, { error: '양식 파일을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }); }
        file = newFile; fileName = String(body.fileName || '').slice(0, 120);
      }
      if (!file) return json(400, { error: '양식 파일을 골라 주세요.' });
      const meta = { ...m, id, file, kind, fileName, updated_at: new Date().toISOString(), updated_by: userName, created_at: prev ? prev.created_at : new Date().toISOString() };
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/meta/${id}.json`, {
        method: prev ? 'PUT' : 'POST', headers: { ...svc, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(meta)
      });
      if (!put.ok) {
        if (body.data && file !== (prev && prev.file)) await removePaths(SUPABASE_URL, svc, [file]); // 새로 올린 파일만 치운다
        return json(500, { error: '양식 정보를 저장하지 못했습니다.' });
      }
      // 정보가 새 파일을 가리킨 뒤에 옛 파일을 지운다(중간에 실패해도 양식이 깨지지 않게).
      if (prev && prev.file && prev.file !== file) await removePaths(SUPABASE_URL, svc, [prev.file]);
      return json(200, { item: meta });
    }

    if (action === 'delete') {
      const id = String(body.id || '');
      if (!validId(id)) return json(400, { error: '잘못된 양식입니다.' });
      const meta = await readMeta(SUPABASE_URL, svc, id);
      if (!meta) return json(404, { error: '이미 삭제된 양식입니다.' });
      const ok = await removePaths(SUPABASE_URL, svc, [meta.file, `meta/${id}.json`].filter(Boolean));
      return ok ? json(200, { ok: true }) : json(500, { error: '삭제하지 못했습니다.' });
    }

    return json(400, { error: '알 수 없는 요청입니다.' });
  } catch (e) {
    console.error('forms-templates', e);
    return json(500, { error: '서버에서 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
};

function validId(id) { return /^\d+_[a-z0-9]+$/.test(id); }
function str(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
function cleanMeta(m) {
  const sugg = Array.isArray(m.suggestions) ? m.suggestions : String(m.suggestions || '').split(/\r?\n/);
  return {
    title: str(m.title, 80),
    dept: str(m.dept, 40),
    year: str(m.year, 10),
    guide: str(m.guide, 8000),
    example: str(m.example, 300),
    suggestions: sugg.map((s) => str(s, 200)).filter(Boolean).slice(0, 6)
  };
}
async function readMeta(url, svc, id) {
  try { const r = await fetch(`${url}/storage/v1/object/${BUCKET}/meta/${id}.json`, { headers: svc }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function removePaths(url, svc, paths) {
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...svc, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
  return r.ok;
}
async function ensureBucket(url, svc) {
  if (_bucketReady) return;
  try {
    const r = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, { headers: svc });
    if (!r.ok) await fetch(`${url}/storage/v1/bucket`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
    _bucketReady = true;
  } catch (e) { /* 다음 단계에서 실패로 드러난다 */ }
}
function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}
