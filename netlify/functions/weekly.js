// 주간 교육활동 안내 — 부서별 주간 안내 목록/등록/수정/삭제 (교사 전용, 텍스트 전용)
// 저장: Supabase Storage 비공개 버킷(weekly-notices) 단독 —
//   게시물 메타: notices/{학년도}-{월2자리}-{주차}/{ts}_{rand}.json (게시물당 1파일 → 동시 등록 경합 없음)
//   주차별 프리픽스로 저장하여 list 시 해당 주차 폴더만 조회한다.
//   DB 테이블 불필요 — 버킷은 최초 요청 시 자동 생성되어 수동 설정이 없다.
//
// [월 캘린더 이벤트 — 2026-08 개편]
//   등록 1건(그룹)은 날짜별 이벤트 배열을 가지며, 이벤트가 여러 달에 걸치면
//   events/{yyyy}-{mm}/{groupId}.json 으로 달별 분할 저장(fan-out)한다.
//   각 조각(fragment)은 그룹 전체의 달 목록(months)·등록 달(regSlot)을 가져
//   수정·삭제 시 전 조각을 함께 처리한다. (기간 이벤트는 시작일의 달에 배속)
//   구 주차 게시판 데이터는 month-list 가 legacy 로 함께 반환한다.
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

    // ===== [월 캘린더] 해당 달 이벤트 + 구 주차 게시판 통합 조회 =====
    if (action === 'month-list') {
      const slot = parseMonthSlot(body);
      if (!slot) return json(400, { error: '연도·월 값이 올바르지 않습니다.' });

      await ensureSeed(SUPABASE_URL, svcHeaders);

      // ① 새 형식: events/{slot}/
      const names = await listJson(SUPABASE_URL, svcHeaders, `events/${slot}/`);
      const frags = await fetchMetas(SUPABASE_URL, svcHeaders, names.map(n => `events/${slot}/${n}`));
      const posts = frags.filter(f => f && f.id).map(f => ({
        id: f.id, group: f.group, months: f.months || [], regSlot: f.regSlot || slot,
        year: f.year, month: f.month,
        department: f.department || '',
        events: Array.isArray(f.events) ? f.events : [],
        created_by: f.created_by, created_by_name: f.created_by_name || '',
        created_at: f.created_at, updated_at: f.updated_at || null,
        mine: isAdmin || String(f.created_by) === String(userId)
      }));
      posts.sort((a, b) => String(a.department).localeCompare(String(b.department), 'ko'));

      // ② 구 형식: notices/{slot}-{1..5}/ (주차 게시판 — 읽기·삭제만 계속 지원)
      const legacy = [];
      for (let wk = 1; wk <= 5; wk++) {
        const lp = `notices/${slot}-${wk}/`;
        const lnames = await listJson(SUPABASE_URL, svcHeaders, lp);
        if (!lnames.length) continue;
        const metas = await fetchMetas(SUPABASE_URL, svcHeaders, lnames.map(n => `${lp}${n}`));
        metas.forEach(row => {
          if (!row || !row.id) return;
          legacy.push({
            id: row.id, year: row.year, month: row.month, week: row.week,
            title: row.title, content: row.content || '',
            created_by_name: row.created_by_name || '', created_at: row.created_at,
            updated_at: row.updated_at || null,
            mine: isAdmin || String(row.created_by) === String(userId)
          });
        });
      }
      legacy.sort((a, b) => (a.week - b.week) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
      return json(200, { posts, legacy, isAdmin });
    }

    // ===== [월 캘린더] 등록 (여러 달 fan-out) =====
    if (action === 'event-create') {
      const slot = parseMonthSlot(body);
      if (!slot) return json(400, { error: '연도·월을 선택해 주세요.' });
      const department = String(body.department || '').trim().slice(0, 50);
      if (!department) return json(400, { error: '부서명을 입력해 주세요.' });
      const events = normEvents(body.events);
      if (!events) return json(400, { error: '일정 항목이 올바르지 않습니다. (제목 필수, 최대 80건)' });

      const groupId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const created_at = new Date().toISOString();
      const base = {
        group: groupId, regSlot: slot, department,
        created_by: userId, created_by_name: userName, created_at
      };
      const err = await writeFragments(SUPABASE_URL, svcHeaders, base, events, slot);
      if (err) return json(500, { error: '등록 실패: ' + err });
      return json(200, { ok: true, group: groupId });
    }

    // ===== [월 캘린더] 그룹 전체 이벤트 조회 (수정 화면 시드용) =====
    if (action === 'event-get') {
      const id = String(body.id || '');
      if (!isValidEventId(id)) return json(400, { error: '잘못된 id입니다.' });
      const frag = await fetchMeta(SUPABASE_URL, svcHeaders, `events/${id}.json`);
      if (!frag) return json(404, { error: '게시물을 찾을 수 없습니다.' });
      const all = await readGroup(SUPABASE_URL, svcHeaders, frag);
      return json(200, {
        group: frag.group, regSlot: frag.regSlot, department: frag.department || '',
        events: all,
        mine: isAdmin || String(frag.created_by) === String(userId)
      });
    }

    // ===== [월 캘린더] 수정 (그룹 전체 교체) =====
    if (action === 'event-update') {
      const id = String(body.id || '');
      if (!isValidEventId(id)) return json(400, { error: '잘못된 id입니다.' });
      const frag = await fetchMeta(SUPABASE_URL, svcHeaders, `events/${id}.json`);
      if (!frag) return json(404, { error: '게시물을 찾을 수 없습니다.' });
      if (!isAdmin && String(frag.created_by) !== String(userId)) {
        return json(403, { error: '본인이 등록한 안내만 수정할 수 있습니다.' });
      }
      const department = String(body.department || frag.department || '').trim().slice(0, 50);
      if (!department) return json(400, { error: '부서명을 입력해 주세요.' });
      const events = normEvents(body.events);
      if (!events) return json(400, { error: '일정 항목이 올바르지 않습니다. (제목 필수, 최대 80건)' });

      await deleteGroup(SUPABASE_URL, svcHeaders, frag);
      const base = {
        group: frag.group, regSlot: frag.regSlot || `${frag.year}-${String(frag.month).padStart(2, '0')}`,
        department,
        created_by: frag.created_by, created_by_name: frag.created_by_name || '',
        created_at: frag.created_at, updated_at: new Date().toISOString()
      };
      const err = await writeFragments(SUPABASE_URL, svcHeaders, base, events, base.regSlot);
      if (err) return json(500, { error: '수정 실패: ' + err });
      return json(200, { ok: true });
    }

    // ===== [월 캘린더] 삭제 (그룹 전체) =====
    if (action === 'event-delete') {
      const id = String(body.id || '');
      if (!isValidEventId(id)) return json(400, { error: '잘못된 id입니다.' });
      const frag = await fetchMeta(SUPABASE_URL, svcHeaders, `events/${id}.json`);
      if (!frag) return json(404, { error: '이미 삭제된 게시물입니다.' });
      if (!isAdmin && String(frag.created_by) !== String(userId)) {
        return json(403, { error: '본인이 등록한 안내만 삭제할 수 있습니다.' });
      }
      await deleteGroup(SUPABASE_URL, svcHeaders, frag);
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

// ===== [월 캘린더] 초기 시드 =====
// input/teacher/부서별 전달사항/창의인성부 주요 안내사항(8월).pdf 를 이벤트로 반영.
// 배포 후 첫 month-list 요청 때 1회만 기록(마커 파일로 멱등) — 이후엔 일반 게시물과 동일하게 관리자가 수정·삭제 가능.
const SEED_MARKER = 'seed/v1.json';
let _seedReady = false;
const SEED_GROUP = '20260814000000_seedcr'; // isValidEventId 형식 준수
const SEED_EVENTS = [
  { date: '2026-08-14', title: '3학년 봉사활동 동기 부여 및 가치 교육', time: '6교시' },
  { date: '2026-08-18', end: '2026-08-21', title: '학생 주도 동아리 개설 신청 기간(1·2학년)', note: '교사 주도 동아리 운영 희망 교사도 함께 신청' },
  { date: '2026-08-19', title: '1·2학년 학급 특색 활동·사제존중 행복시간·어울림(사이버어울림)·폭력예방 및 신변보호교육', time: '5-6교시' },
  { date: '2026-08-19', title: '3학년 사제존중 행복시간·어울림(사이버어울림)·폭력예방 및 신변보호교육', time: '6교시' },
  { date: '2026-08-21', title: '3학년 봉사활동 참여 태도 교육', time: '6교시' },
  { date: '2026-08-24', title: '개설 동아리 확정(1·2학년)' },
  { date: '2026-08-24', end: '2026-08-28', title: '자율 동아리 2학기 개설 신청 기간', note: '학급 게시 및 리로스쿨 안내' },
  { date: '2026-08-26', title: '장애인식 개선교육(전 학년)', time: '6교시' },
  { date: '2026-08-26', title: '동아리 부서 소개 및 홍보(강당, 1·2학년)', time: '5교시', note: '동아리 담당 교사 임장' },
  { date: '2026-08-28', title: '3학년 교내 생활 속 봉사 실천의 중요성 교육', time: '6교시' },
  { date: '2026-09-09', title: '동아리 조직', time: '5-6교시' },
  { date: '2026-09-16', title: '동아리 부서별 활동' },
  { date: '2026-09-23', title: '동아리 부서별 활동' },
  { date: '2026-09-30', title: '동아리 부서별 활동' },
  { date: '2026-10-14', title: '동아리 부서별 활동' },
  { date: '2026-10-21', title: '동아리 부서별 활동' },
  { date: '2026-11-04', title: '동아리 부서별 활동' },
  { date: '2026-11-11', title: '동아리 부서별 활동' },
  { date: '2026-11-25', title: '동아리 부서별 활동' },
  { date: '2026-12-02', title: '동아리 부서별 활동' },
  { date: '2026-12-16', title: '동아리 부서별 활동' },
  { date: '2026-12-23', title: '대륜제 — 동아리 활동 발표회', time: '2시수' },
  { date: '2026-12-30', title: '동아리 활동 내용 공유 및 성찰' },
  { date: '2027-02-03', title: '동아리 자기평가서 작성' },
  { title: '2학기 창의적 체험활동 운영 계획 확인', note: '확인 링크: trpd.me/26대륜창체' },
  { title: '자율 동아리는 활동 글자 수 부족으로 학교생활기록부 미반영 원칙' },
  { title: '동아리명은 특성이 드러나는 한글 명칭 사용' }
];

async function ensureSeed(SUPABASE_URL, svcHeaders) {
  if (_seedReady) return;
  try {
    const marker = await fetchMeta(SUPABASE_URL, svcHeaders, SEED_MARKER);
    if (marker) { _seedReady = true; return; }
    const events = normEvents(SEED_EVENTS);
    if (events) {
      const base = {
        group: SEED_GROUP, regSlot: '2026-08', department: '창의인성부',
        created_by: 'seed', created_by_name: '창의인성부',
        created_at: new Date().toISOString()
      };
      await writeFragments(SUPABASE_URL, svcHeaders, base, events, '2026-08');
    }
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${SEED_MARKER}`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify({ done: true, at: new Date().toISOString() })
    });
    _seedReady = true;
  } catch (e) { /* 시드 실패는 조회를 막지 않는다 — 다음 요청에서 재시도 */ }
}

// ===== [월 캘린더] 헬퍼 =====

// 연-월 → 정규화 슬러그 "2026-08" (경로 조작 차단: 숫자만 허용)
function parseMonthSlot(body) {
  const y = Number(body.year), mo = Number(body.month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

// 이벤트 id: 2026-08/1737000000000_ab12cd
function isValidEventId(id) {
  return /^\d{4}-\d{2}\/\d+_[a-z0-9]+$/.test(id);
}

// 날짜 문자열 검증: YYYY-MM-DD 실존 날짜
function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  if (y < 2000 || y > 2100 || m < 1 || m > 12) return false;
  return d >= 1 && d <= new Date(y, m, 0).getDate();
}

// 이벤트 배열 정규화 — 실패 시 null
// {date: null|YYYY-MM-DD, end: null|YYYY-MM-DD(>=date), title(필수), time, note}
function normEvents(arr) {
  if (!Array.isArray(arr) || !arr.length || arr.length > 80) return null;
  const out = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title || '').trim().slice(0, 120);
    if (!title) return null;
    let date = raw.date ? String(raw.date).trim() : null;
    let end = raw.end ? String(raw.end).trim() : null;
    if (date && !isValidDate(date)) return null;
    if (!date) end = null;
    if (end && (!isValidDate(end) || end < date)) return null;
    if (end === date) end = null;
    out.push({
      date, end,
      title,
      time: String(raw.time || '').trim().slice(0, 40),
      note: String(raw.note || '').trim().slice(0, 500)
    });
  }
  return out;
}

// 이벤트를 달별로 분류 (날짜 없는 항목·기간 시작일 기준 → 해당 달, 날짜 없으면 등록 달)
function groupByMonth(events, regSlot) {
  const map = {};
  for (const ev of events) {
    const slot = ev.date ? ev.date.slice(0, 7) : regSlot;
    (map[slot] = map[slot] || []).push(ev);
  }
  return map;
}

// 그룹 전체를 달별 조각으로 저장 — 성공 시 null, 실패 시 오류 문자열
async function writeFragments(SUPABASE_URL, svcHeaders, base, events, regSlot) {
  const byMonth = groupByMonth(events, regSlot);
  const months = Object.keys(byMonth).sort();
  for (const slot of months) {
    const meta = {
      ...base,
      id: `${slot}/${base.group}`,
      months, regSlot,
      year: Number(slot.slice(0, 4)), month: Number(slot.slice(5, 7)),
      events: byMonth[slot]
    };
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/events/${meta.id}.json`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify(meta)
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return t.slice(0, 200) || ('HTTP ' + r.status);
    }
  }
  return null;
}

// 조각 하나로 그룹 전체 이벤트 읽기 (달 순서·달 안 순서 유지)
async function readGroup(SUPABASE_URL, svcHeaders, frag) {
  const months = Array.isArray(frag.months) && frag.months.length
    ? frag.months
    : [`${frag.year}-${String(frag.month).padStart(2, '0')}`];
  const all = [];
  for (const slot of months.slice().sort()) {
    const m = await fetchMeta(SUPABASE_URL, svcHeaders, `events/${slot}/${frag.group}.json`);
    if (m && Array.isArray(m.events)) all.push(...m.events);
  }
  return all;
}

// 그룹 전체 조각 삭제
async function deleteGroup(SUPABASE_URL, svcHeaders, frag) {
  const months = Array.isArray(frag.months) && frag.months.length
    ? frag.months
    : [`${frag.year}-${String(frag.month).padStart(2, '0')}`];
  const prefixes = months.map(slot => `events/${slot}/${frag.group}.json`);
  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...svcHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes })
  });
}

// 프리픽스 폴더의 .json 파일명 목록
async function listJson(SUPABASE_URL, svcHeaders, prefix) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...svcHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 200, sortBy: { column: 'name', order: 'asc' } })
  });
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .filter(o => o && o.name && o.name.endsWith('.json'))
    .map(o => o.name);
}

// 메타 JSON 1건
async function fetchMeta(SUPABASE_URL, svcHeaders, path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: svcHeaders });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// 메타 JSON 병렬 다운로드 (10개씩)
async function fetchMetas(SUPABASE_URL, svcHeaders, paths) {
  const rows = [];
  for (let i = 0; i < paths.length; i += 10) {
    const chunk = paths.slice(i, i + 10);
    const got = await Promise.all(chunk.map(p => fetchMeta(SUPABASE_URL, svcHeaders, p)));
    got.forEach(g => { if (g) rows.push(g); });
  }
  return rows;
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
