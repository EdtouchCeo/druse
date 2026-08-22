// 학생 결과물 피드백 — 팀별 자유 서술 피드백 + 좋아요 (비회원 포함 누구나 작성, 관리자 삭제)
// 저장: Supabase Storage 비공개 버킷(biotech-feedback) 단독 — DB 테이블 불필요, 버킷 자동 생성.
//   피드백 1건 = 파일 1개  fb/{slug}/{ts}_{ip8}_{rand}.json   (동시 작성 경합 없음)
//   프로젝트 좋아요       plike/{slug}/{cid}.json             (같은 브라우저면 덮어써져 1인 1표)
//   피드백 좋아요         ilike/{slug}/{id}/{cid}.json
// 익명 공개 쓰기이므로 서버에서 길이·링크·금지어·개인정보·작성 속도를 모두 검사한다.
// IP는 원본을 저장하지 않고 솔트 해시 앞 8자(ip8)만 남긴다 — 속도 제한 용도.
const crypto = require('crypto');

const ADMIN_EMAIL = 'drhong81@gmail.com';
const BUCKET = 'biotech-feedback';
const ROLES = ['student', 'parent', 'teacher', 'other'];
const TAGS = ['valid', 'fit', 'usab', 'ui', 'ux', 'idea'];
const TEXT_MIN = 10;
const TEXT_MAX = 1000;
const NAME_MAX = 12;
const LIST_MAX = 120;
const RATE_PER_HOUR = 5;      // 같은 IP가 한 팀에 한 시간 동안 남길 수 있는 피드백 수
const DWELL_MIN_MS = 3000;    // 폼을 연 뒤 최소 체류 시간(봇 차단)

let _bucketReady = false;     // 웜 인스턴스 캐시

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return json(500, { error: 'Server config error' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const svcHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
  };
  await ensureBucket(SUPABASE_URL, svcHeaders);

  const action = String(body.action || '');
  const ip8 = ipHash(event);

  try {
    if (action === 'counts')   return await handleCounts(SUPABASE_URL, svcHeaders, body);
    if (action === 'list')     return await handleList(SUPABASE_URL, svcHeaders, body);
    if (action === 'create')   return await handleCreate(SUPABASE_URL, svcHeaders, body, ip8);
    if (action === 'like')     return await handleLike(SUPABASE_URL, svcHeaders, body);
    if (action === 'itemLike') return await handleItemLike(SUPABASE_URL, svcHeaders, body);
    if (action === 'delete')   return await handleDelete(SUPABASE_URL, SUPABASE_SERVICE_KEY, svcHeaders, body);
    return json(400, { error: '알 수 없는 요청입니다.' });
  } catch (e) {
    return json(500, { error: '처리 중 오류가 발생했습니다.', detail: String((e && e.message) || e) });
  }
};

// ── 목록·집계 ────────────────────────────────────────────────
// 카드에 표시할 팀별 피드백 수·좋아요 수 (여러 팀 한 번에)
async function handleCounts(URL_, h, body) {
  const slugs = (Array.isArray(body.slugs) ? body.slugs : []).filter(isValidSlug).slice(0, 40);
  if (!slugs.length) return json(200, { counts: {} });

  const counts = {};
  for (let i = 0; i < slugs.length; i += 8) {          // 8팀씩 병렬
    const chunk = slugs.slice(i, i + 8);
    const got = await Promise.all(chunk.map(async (s) => {
      const [fb, lk] = await Promise.all([
        listNames(URL_, h, `fb/${s}/`),
        listNames(URL_, h, `plike/${s}/`)
      ]);
      return [s, { feedback: fb.length, likes: lk.length }];
    }));
    got.forEach(([s, v]) => { counts[s] = v; });
  }
  return json(200, { counts });
}

// 한 팀의 피드백 목록(최신순) + 좋아요 수
async function handleList(URL_, h, body) {
  const slug = String(body.slug || '');
  if (!isValidSlug(slug)) return json(400, { error: '잘못된 요청입니다.' });
  const cid = safeCid(body.cid);

  const [names, likeNames] = await Promise.all([
    listNames(URL_, h, `fb/${slug}/`),
    listNames(URL_, h, `plike/${slug}/`)
  ]);
  const recent = names.sort().reverse().slice(0, LIST_MAX);
  const metas = await fetchMetas(URL_, h, recent.map(n => `fb/${slug}/${n}`));

  // 피드백별 좋아요 수 — ilike/{slug}/ 아래 전체를 한 번에 세어 매칭
  const itemLikes = {};
  const myItemLikes = {};
  for (const n of await listNames(URL_, h, `ilike/${slug}/`, true)) {
    const parts = n.split('/');                       // {id}/{cid}.json
    if (parts.length < 2) continue;
    const id = parts[0];
    itemLikes[id] = (itemLikes[id] || 0) + 1;
    if (cid && parts[1] === `${cid}.json`) myItemLikes[id] = true;
  }

  const items = metas
    .filter(Boolean)
    .map(m => ({
      id: m.id, name: m.name, role: m.role, tags: m.tags || [],
      text: m.text, ts: m.ts,
      likes: itemLikes[m.id] || 0,
      liked: !!myItemLikes[m.id],
      mine: !!(cid && m.cid === cid)
    }))
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));

  return json(200, {
    items,
    likes: likeNames.length,
    liked: !!(cid && likeNames.includes(`${cid}.json`))
  });
}

// ── 작성 ────────────────────────────────────────────────────
async function handleCreate(URL_, h, body, ip8) {
  const slug = String(body.slug || '');
  if (!isValidSlug(slug)) return json(400, { error: '잘못된 요청입니다.' });

  // 봇 차단: 허니팟은 비어 있어야 하고, 폼을 연 뒤 최소 체류 시간이 필요하다
  if (String(body.hp || '').trim()) return json(400, { error: '전송할 수 없습니다.' });
  if (Number(body.dwell || 0) < DWELL_MIN_MS) {
    return json(400, { error: '조금 더 작성한 뒤 남겨 주세요.' });
  }

  let text = String(body.text || '').replace(/\r/g, '').trim();
  text = text.replace(/\n{3,}/g, '\n\n');
  if (text.length < TEXT_MIN) return json(400, { error: `내용을 ${TEXT_MIN}자 이상 적어 주세요.` });
  if (text.length > TEXT_MAX) return json(400, { error: `내용은 ${TEXT_MAX}자까지 쓸 수 있습니다.` });

  const links = (text.match(/https?:\/\//gi) || []).length;
  if (links > 1) return json(400, { error: '링크는 하나까지만 넣을 수 있습니다.' });

  const bad = findBadWord(text);
  if (bad) return json(400, { error: '비방·욕설로 보이는 표현이 있어 등록하지 않았습니다.' });

  text = maskPersonal(text);

  const name = String(body.name || '').trim().slice(0, NAME_MAX) || '익명';
  if (findBadWord(name)) return json(400, { error: '사용할 수 없는 이름입니다.' });
  const role = ROLES.includes(body.role) ? body.role : 'other';
  const tags = (Array.isArray(body.tags) ? body.tags : []).filter(t => TAGS.includes(t)).slice(0, 3);
  const cid = safeCid(body.cid);

  // 속도 제한 — 같은 IP 해시가 한 시간 안에 남긴 수를 파일명으로 센다
  const names = await listNames(URL_, h, `fb/${slug}/`);
  const hourAgo = Date.now() - 3600 * 1000;
  const recentSame = names.filter(n => {
    if (!n.includes(`_${ip8}_`)) return false;
    const t = Date.parse(tsFromName(n));
    return Number.isFinite(t) && t > hourAgo;
  });
  if (recentSame.length >= RATE_PER_HOUR) {
    return json(429, { error: '잠시 후 다시 남겨 주세요. (같은 연결에서 너무 자주 등록되었습니다)' });
  }

  const ts = new Date().toISOString();
  const id = `${ts.replace(/[-:.TZ]/g, '')}_${rand(6)}`;
  const path = `fb/${slug}/${ts.replace(/[:.]/g, '-')}_${ip8}_${rand(6)}.json`;
  const meta = { id, slug, name, role, tags, text, ts, ip8, cid };

  const ok = await putJson(URL_, h, path, meta);
  if (!ok) return json(500, { error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });

  return json(200, { ok: true, item: { id, name, role, tags, text, ts, likes: 0, liked: false, mine: true } });
}

// ── 좋아요 ──────────────────────────────────────────────────
async function handleLike(URL_, h, body) {
  const slug = String(body.slug || '');
  const cid = safeCid(body.cid);
  if (!isValidSlug(slug) || !cid) return json(400, { error: '잘못된 요청입니다.' });

  const path = `plike/${slug}/${cid}.json`;
  if (body.on === false) await del(URL_, h, path);
  else await putJson(URL_, h, path, { ts: new Date().toISOString() });

  const likes = (await listNames(URL_, h, `plike/${slug}/`)).length;
  return json(200, { ok: true, likes, liked: body.on !== false });
}

async function handleItemLike(URL_, h, body) {
  const slug = String(body.slug || '');
  const cid = safeCid(body.cid);
  const id = String(body.id || '');
  if (!isValidSlug(slug) || !cid || !/^[0-9]{8,}_[A-Za-z0-9]{4,8}$/.test(id)) {
    return json(400, { error: '잘못된 요청입니다.' });
  }

  const path = `ilike/${slug}/${id}/${cid}.json`;
  if (body.on === false) await del(URL_, h, path);
  else await putJson(URL_, h, path, { ts: new Date().toISOString() });

  const likes = (await listNames(URL_, h, `ilike/${slug}/${id}/`)).length;
  return json(200, { ok: true, likes, liked: body.on !== false });
}

// ── 삭제(관리자) ────────────────────────────────────────────
async function handleDelete(URL_, KEY, h, body) {
  const slug = String(body.slug || '');
  const id = String(body.id || '');
  const token = body.token;
  if (!isValidSlug(slug) || !id) return json(400, { error: '잘못된 요청입니다.' });
  if (!token) return json(401, { error: '로그인이 필요합니다.' });

  const meRes = await fetch(`${URL_}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': KEY }
  });
  if (!meRes.ok) return json(401, { error: '세션이 만료되었습니다. 다시 로그인해 주세요.' });
  const me = await meRes.json();
  if (!me || String(me.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return json(403, { error: '관리자만 삭제할 수 있습니다.' });
  }

  // id로 파일을 찾아 지우고, 그 글에 달린 좋아요도 함께 정리
  const names = await listNames(URL_, h, `fb/${slug}/`);
  const metas = await fetchMetas(URL_, h, names.map(n => `fb/${slug}/${n}`));
  const idx = metas.findIndex(m => m && m.id === id);
  if (idx < 0) return json(404, { error: '이미 삭제된 글입니다.' });

  await del(URL_, h, `fb/${slug}/${names[idx]}`);
  for (const ln of await listNames(URL_, h, `ilike/${slug}/${id}/`)) {
    await del(URL_, h, `ilike/${slug}/${id}/${ln}`);
  }
  return json(200, { ok: true });
}

// ── 검증·정제 ───────────────────────────────────────────────
function isValidSlug(s) { return typeof s === 'string' && /^[a-z0-9-]{2,32}$/.test(s); }
function safeCid(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(v) ? v : ''; }
function rand(n) { return crypto.randomBytes(16).toString('hex').slice(0, n); }
function tsFromName(n) {
  const m = n.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  if (!m) return '';
  const [d, t] = m[1].split('T');
  return `${d}T${t.replace(/-/g, ':')}Z`;
}

// 전화번호·이메일은 저장 단계에서 가린다 (공개 페이지이므로)
function maskPersonal(t) {
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[이메일 삭제]')
    .replace(/\b01[016-9][-. ]?\d{3,4}[-. ]?\d{4}\b/g, '[연락처 삭제]');
}

const BAD = ['시발', '씨발', 'ㅅㅂ', '병신', 'ㅂㅅ', '좆', '지랄', '개새', '꺼져', '죽어', 'fuck', 'shit'];
function findBadWord(t) {
  const s = String(t).toLowerCase().replace(/\s/g, '');
  return BAD.find(w => s.includes(w)) || '';
}

// 속도 제한용 IP 해시 — 원본 IP는 저장하지 않는다
function ipHash(event) {
  const ip = String((event.headers && (event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for'])) || '').split(',')[0].trim();
  return crypto.createHash('sha256').update('daeryun-biofeedback:' + ip).digest('hex').slice(0, 8);
}

// ── Storage 헬퍼 ────────────────────────────────────────────
async function listNames(URL_, h, prefix, deep = false) {
  const out = [];
  let offset = 0;
  for (let round = 0; round < 6; round++) {           // 최대 600건
    const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!r.ok) break;
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const o of rows) {
      if (!o || !o.name) continue;
      if (o.name.endsWith('.json')) out.push(o.name);
      else if (deep) {                                 // 하위 폴더(피드백 id)까지 한 단계 더
        for (const c of await listNames(URL_, h, `${prefix}${o.name}/`)) out.push(`${o.name}/${c}`);
      }
    }
    if (rows.length < 100) break;
    offset += 100;
  }
  return out;
}

async function fetchMeta(URL_, h, path) {
  try {
    const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, { headers: h });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function fetchMetas(URL_, h, paths) {
  const rows = [];
  for (let i = 0; i < paths.length; i += 10) {
    const got = await Promise.all(paths.slice(i, i + 10).map(p => fetchMeta(URL_, h, p)));
    got.forEach(g => rows.push(g));
  }
  return rows;
}

async function putJson(URL_, h, path, obj) {
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json', 'x-upsert': 'true' },
    body: JSON.stringify(obj)
  });
  return r.ok;
}

async function del(URL_, h, path) {
  try { await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers: h }); }
  catch { /* 무시 */ }
}

async function ensureBucket(URL_, h) {
  if (_bucketReady) return;
  try {
    const r = await fetch(`${URL_}/storage/v1/bucket/${BUCKET}`, { headers: h });
    if (!r.ok) {
      await fetch(`${URL_}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false })
      });
    }
    _bucketReady = true;
  } catch { /* 이후 단계에서 실패로 드러남 */ }
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
