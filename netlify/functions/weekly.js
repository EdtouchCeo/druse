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
// input/teacher/부서별 전달사항 폴더의 안내를 이벤트로 반영.
// 시드마다 마커 파일로 멱등(1회 기록) — 이후엔 일반 게시물과 동일하게 관리자가 수정·삭제 가능.
// 새 부서 안내 시드 추가 시: SEEDS 배열에 {marker: 'seed/vN.json', group(숫자_영숫자 형식), department, regSlot, events} 추가.
let _seedReady = false;
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

// 교무부 안내 (2026-08 전달)
const SEED_EVENTS_KM = [
  { date: '2026-08-13', title: '2학기 3학년 순환수업 운영 시작', time: '7교시', note: '월~금 7교시에 오후 수업을 순차 배정하여 운영. 수능 이후 3학년 학사일정 운영에 따름' },
  { date: '2026-08-14', title: '3학년 학생부 정정 협의 마감', note: '정정 필요 학생은 협의 후 학업성적관리위원회를 거쳐 학생부 정정 예정' },
  { date: '2026-08-21', title: '교원 장기재직휴가 사용 신청서 제출 마감', note: '정규직 교원만 가능. 절차: 수요조사 → 승인 여부 심의 → 승인 결정 후 통보 → 교육청 보고' },
  { date: '2026-08-21', title: '3학년 학교생활기록부 영역별 마감(수시 대비)' },
  { date: '2026-08-28', title: '부서별 학교생활기록부 점검 및 확인 마감(3학년)' },
  { date: '2026-08-31', title: '수시전형 대입자료 생성 기준일' },
  { date: '2026-09-02', title: '금요일 수업으로 운영(요일 수업 변경)', note: '2학기 요일별 수업일수 확보' },
  { date: '2026-10-19', title: '화요일 수업으로 운영(요일 수업 변경)', note: '2학기 요일별 수업일수 확보' },
  { title: '교원 장기재직휴가 신설 안내(정규직 교원)', note: '10년 이상 20년 미만 5일·20년 이상 7일(공무원연금법상 재직기간 기준). 일 단위·연속 사용 원칙, 필요시 1회 분할. 10~20년 구간의 5일은 재직 20년 도달 시 미사용분 자동 소멸. 학사일정 제한·학기별 현원 10% 이내 등 첨부 파일 참조' },
  { title: '2학기 학급 시간표 확인 및 교실 게시', note: '2·3학년 선택과목 이동수업 학생 현황을 출석부와 비교 확인' },
  { title: '방학 중 전출·전입생 확인(담임)', note: '학적 담당 실무원 메신저 안내에 따라 담임 업무 및 부서별 협조(교과서 배부·동아리 편성·이동수업 배정 등)' },
  { title: '1학기 출결 마감 및 나이스 1학기 전환 예정', note: '전입생 학적 자료(전입자료) 도착 후 진행' }
];

// 연구부 안내 (2026-08 전달)
const SEED_EVENTS_YG = [
  { date: '2026-08-14', title: '신임교사 연수 자료 수정본 제출 마감(관련 부서)', time: '오전까지', note: '1학기 자료 기준으로 수정하여 제출. 수정할 내용이 없으면 "없음" 또는 "1학기 자료로 대체" 메시지 회신' },
  { date: '2026-08-19', end: '2026-08-20', title: '2026년 신임교사 연수', time: '16:20~18:10', note: '대상: 신임교사 2명 / 연수자: 교감·교무·연구·학생·진학·창의인성·보건 교사 / 장소: 1층 교육과정 회의실. 세부 일정 추후 안내' },
  { date: '2026-08-21', title: '보충(부)교재 사용 신청서 제출 마감(출력물, 김해영 선생님)', note: '교과부장 서명까지 받은 출력물 제출(나머지 서명은 연구부 진행). 3학년은 수능완성 교재 별도 신청 불요' },
  { date: '2026-08-21', title: '2학기 교수학습 평가계획서·성취수준/평가기준 파일 제출 마감(김해영 선생님)', note: '퇴근 전까지. 2학기 평가계획서 작성 시 유의사항 필독' },
  { date: '2026-08-21', title: '학기수준 성취기준/평가기준 출력물 제출 마감(최병권 선생님)', note: '퇴근 전까지. 파란색 부분만 교과 특성에 맞게 재구성 — 검은색 공통 양식은 수정 금지' },
  { date: '2026-08-28', title: '2학기 과목별 수행평가 점검표 제출 마감(김해영 선생님)', note: '퇴근 전까지, 교과별 작성. 학업성적관리위원회 심의 자료 — "양호"·"해당사항 없음" 대신 연구부 자체 수정사항 안내 내용을 토대로 작성' },
  { title: '보충(부)교재 신청 유의사항', note: '① 신청 교재는 모든 학생 구입 권장 ② 교육비 지원 대상자(기초생활 등) 무료 제공 가능 ③ 수업 내 학습 활동지로 제공 가능하면 신청 지양 ④ 1학년: 디지털 교과서(교육자료 전환)로 대체 가능하면 신청 지양 ⑤ 학교운영위원회 심의 대상 — 구체적 내용·방법 기재' },
  { title: '수행평가 점수 배정 유의(단계형 운영 교과)', note: '단계별 운영 교과는 단계별 기본점수·미응시 점수 반드시 표기(2026-1학기 1학년 영어·3학년 국어 참조). 최저점수와 기본점수(백지 제출·미응시·부정행위)의 점수 차를 충분히 둘 것 — 1학기처럼 -1점 차는 지적 대상. 기본점수는 결시생 인정점 부여 시 참고점수임을 고려' },
  { title: '정기시험 범위와 성취기준 일치 유의', note: '시험 범위 내 성취기준 포함 여부는 감사·민원 사유. 평가계획서의 성취기준과 제출한 성취기준/평가기준 파일의 불일치 사례 주의. 정기시험 실시 여부(1회/2회/미실시) 문의는 연구부로' },
  { title: '성취기준·최소 성취수준 보장지도 참고 사이트', note: '국가교육과정정보센터 ncic.re.kr(교육과정 자료실), 대구 고교학점제 톡톡 sites.google.com/dge.go.kr/hakjeomje' }
];

// 2026-08-28 부서별 전달사항 사진 5장 — 9~10월 후속 일정
// 같은 부서의 기존 v1~v3 시드는 이미 라이브에 기록될 수 있으므로 새 그룹으로만 추가한다.
const SEED_EVENTS_KM2 = [
  { date: '2026-08-31', title: '3학년 수시 대입전형자료 출결 마감', note: '나이스 출결부 제출 및 학교생활기록부 항목별 조회' },
  { date: '2026-08-31', title: '모의수능·학력평가·영어듣기 대비 방송 1차 점검', time: '7교시 후' },
  { date: '2026-09-01', end: '2026-10-24', title: '2027학년도 검인정 교과용 도서 전시 및 선정', note: '선정 교과목 확정 → 전시본 검토 → 도서 선정 → 학교운영위원회 → 학교장' },
  { date: '2026-09-01', title: '모의수능·학력평가·영어듣기 대비 방송 2차 점검', time: '7교시 후' },
  { date: '2026-09-07', title: '모의수능·학력평가·영어듣기 대비 방송 3차 점검', time: '7교시 후' },
  { date: '2026-09-14', title: '105주년 개교기념식(다목적 강당)', time: '7교시', note: '전체 학생 및 교직원 참석' },
  { date: '2026-09-15', title: '개교기념일 재량휴업' },
  { date: '2026-09-23', title: '월간 명상의 시간(강당)', time: '6교시' },
  { date: '2026-09-23', title: '직원회의', time: '7교시', note: '3학년 순환수업 미배정' },
  { date: '2026-10-15', title: '2학기 학교생활기록부 기재 관리 연수', time: '정기시험 후 예정' },
  { title: '2학기 담임 장학사 변경', note: '기획조정과 구소영 장학사' }
];

const SEED_EVENTS_YG2 = [
  { date: '2026-09-01', title: '2학기 중간(기말)시험 출제 안내' },
  { date: '2026-09-07', end: '2026-09-11', title: '2학기 중간(기말)시험 원안 제출', note: '3학년은 수시모집 원서 접수 기간과 중복되어 9월 17일까지 제출. 나이스 성적 기능 개선 기간을 고려해 가급적 9월 11일 제출' },
  { date: '2026-09-07', title: '영어듣기평가 학사 유의사항 방송 안내', time: '아침조회', note: '학년부장에게 일정 공유 요청' },
  { date: '2026-09-08', title: '1학년 영어듣기평가', time: '5교시' },
  { date: '2026-09-09', title: '2학년 영어듣기평가', time: '5교시' },
  { date: '2026-09-10', title: '3학년 영어듣기평가', time: '5교시', note: '분리고사실 운영. 전염병 관련 환자 발생 시 2학년 분리고사실도 별도 운영 예정' },
  { date: '2026-09-11', title: '수업연구(2학년 3반, PBL실)', time: '6교시' },
  { date: '2026-09-11', title: '수업연구 협의회(2층 회의실)', time: '7교시' },
  { date: '2026-09-22', title: '예체능 수업연구(1학년 7반, 음악실)', time: '5교시' },
  { date: '2026-09-22', title: '수업연구 협의회(2층 회의실)', time: '6교시' },
  { date: '2026-09-23', title: '중간(기말)시험 감독교사 유의사항 안내(통합교육실)', time: '7교시' },
  { date: '2026-09-30', title: '중간(기말)시험 학생 유의사항 방송 안내', time: '6교시' },
  { date: '2026-10-01', end: '2026-10-07', title: '2학기 중간(기말)시험', note: '3학년은 시험 교과목이 3개이므로 10월 1일 1교시 정상수업 후 귀가' }
];

const SEED_EVENTS_SAFE = [
  { date: '2026-09-01', title: '2026 학생생활규정 제·개정 공포' },
  { title: '학교폭력 사안 처리 진행 중', note: '1·2학년 각 1건. 개인 식별정보는 게시하지 않음' },
  { title: '교복 관련 업무 진행', note: '정장형 동복·하복·생활복 관련' }
];

const SEED_EVENTS_ADMISSION = [
  { date: '2026-08-24', end: '2026-09-04', title: '대학수학능력시험 원서 접수', time: '마감일 17:00까지' },
  { date: '2026-08-28', title: '2027학년도 학교장추천전형 대상자 선정위원회(회의실)', time: '15:30~' },
  { date: '2026-08-31', end: '2026-09-11', title: '2027학년도 대입 수시전형 상담(진학지도실)' },
  { date: '2026-09-02', title: '2027학년도 수능 9월 모의평가(3학년)·2026학년도 9월 전국연합학력평가(1·2학년)', note: '졸업생 24명 시험 장소: 5층 진로활동실' },
  { date: '2026-09-07', end: '2026-09-11', title: '2027학년도 대입 수시전형 원서 접수' },
  { date: '2026-09-19', title: '2027학년도 수시모집 면접 프로그램(1차)', time: '오전', note: '세부 모집은 추후 안내' }
];

const SEED_EVENTS_INFO = [
  { date: '2026-08-24', end: '2026-09-04', title: '수시모집 대입전형자료 생성 및 온라인 제공', note: '최신 학적 자료로 생성 후 교무·진로·창체 부서 확인 및 담임 완료 회신' },
  { date: '2026-08-24', end: '2026-09-15', title: '3학년 온라인 원서 관련 자료 입력' },
  { date: '2026-09-18', title: '개인정보 내부 관리계획 제출' }
];

const SEED_EVENTS_CREATIVE2 = [
  { title: '1·2학년 창체 동아리 조직 보충 안내', note: '9월 9일 5-6교시, 29개 동아리 개설(학생 주도 20개·교사 주도 9개). 일정은 기존 창의인성부 안내에 반영됨' },
  { date: '2026-09-14', end: '2026-09-18', title: '(조)부모와 함께하는 가족체험 역사기행 참가 가족 모집', note: '1학년 가족 최대 40명 예정' },
  { date: '2026-09-23', title: '가족체험 역사기행 참가 가족 확정 및 안내', note: '조부모와 함께 참여하는 가족 우선 선발' },
  { date: '2026-10-12', end: '2026-10-16', title: '가족체험 역사기행 사전 과제', time: '온라인' },
  { date: '2026-10-17', title: '(조)부모와 함께하는 가족체험 역사기행', time: '08:00~18:00', note: '인솔 교사 4~5명 필요. 창의인성부 외 희망 교사 모집 예정' },
  { title: '11월 동아리 외부 체험활동의 날 폐지', note: '간부워크숍 결정사항' }
];

const SEED_EVENTS_ARTS = [
  { date: '2026-09-05', title: '교육감배 학교스포츠클럽 축구 출전(성광중학교 운동장)', time: '09:00' },
  { date: '2026-09-05', title: '교육감배 학교스포츠클럽 배드민턴 출전(경상중학교 체육관)', time: '09:00' },
  { date: '2026-09-07', title: '전국 고등 축구 스플릿 리그 대구·경북 경기(진보생활체육공원)', time: '14:00' },
  { date: '2026-09-09', end: '2026-10-30', title: '2학기 교내 학급 스포츠클럽 리그', note: '농구·탁구' },
  { date: '2026-09-12', title: '교육감배 학교스포츠클럽 육상 출전(대구스타디움)', time: '10:00' },
  { date: '2026-09-16', title: '전국 고등 축구 스플릿 리그 대구·경북 경기(강변축구장)', time: '16:00', note: '대구공고전' },
  { date: '2026-09-21', title: '전국 고등 축구 스플릿 리그 대구·경북 경기(진보생활체육공원)', time: '12:15' }
];

const SEED_EVENTS_SUPPORT = [
  { date: '2026-09-09', title: '2026학년도 대륜동창 장학금 전달식(회의실 예정)', time: '15:30', note: '전달식 참여 인원 약 12명' },
  { title: '학교발전기금 장학금 수여(10월 예정)', note: '학교발전기금 장학금 약 1,200만원. 학년별 4명에게 각 100만원 지급 예정' }
];

const SEED_EVENTS_CAREER = [
  { date: '2026-10-15', title: '학생부 기반 면접 및 학교생활기록부 디자인 캠프', note: '2학년 희망자 40명, 외부 강사 초빙' },
  { date: '2026-10-16', title: '학생부 기반 면접 및 학교생활기록부 디자인 캠프', note: '2학년 희망자 40명, 외부 강사 초빙' },
  { date: '2026-10-17', title: '학생부 기반 면접 및 학교생활기록부 디자인 캠프', note: '2학년 희망자 40명, 외부 강사 초빙' },
  { date: '2026-10-19', title: '학생부 기반 면접 및 학교생활기록부 디자인 캠프', note: '2학년 희망자 40명, 외부 강사 초빙' }
];

const SEED_EVENTS_ADMIN = [
  { date: '2026-08-31', end: '2026-09-02', title: '안현조 선생님 출장' },
  { date: '2026-09-02', title: '정수기·온수기 정기 수질검사' },
  { date: '2026-09-15', title: '재량휴업일 근무', note: '이희용 시설부장' },
  { title: '개교기념 물품 구매', note: '스텐컵·4포트 허브' }
];

const SEEDS = [
  { marker: 'seed/v1.json', group: '20260814000000_seedcr', department: '창의인성부', regSlot: '2026-08', events: SEED_EVENTS },
  { marker: 'seed/v2.json', group: '20260814000001_seedkm', department: '교무부', regSlot: '2026-08', events: SEED_EVENTS_KM },
  { marker: 'seed/v3.json', group: '20260814000002_seedyg', department: '연구부', regSlot: '2026-08', events: SEED_EVENTS_YG },
  { marker: 'seed/v4.json', group: '20260828000000_seedkm2', department: '교무부', regSlot: '2026-09', events: SEED_EVENTS_KM2 },
  { marker: 'seed/v5.json', group: '20260828000001_seedyg2', department: '연구부', regSlot: '2026-09', events: SEED_EVENTS_YG2 },
  { marker: 'seed/v6.json', group: '20260828000002_seedsafe', department: '학생안전부', regSlot: '2026-09', events: SEED_EVENTS_SAFE },
  { marker: 'seed/v7.json', group: '20260828000003_seedadm', department: '진학부', regSlot: '2026-09', events: SEED_EVENTS_ADMISSION },
  { marker: 'seed/v8.json', group: '20260828000004_seedinfo', department: '정보과학부', regSlot: '2026-09', events: SEED_EVENTS_INFO },
  { marker: 'seed/v9.json', group: '20260828000005_seedcr2', department: '창의인성부', regSlot: '2026-09', events: SEED_EVENTS_CREATIVE2 },
  { marker: 'seed/v10.json', group: '20260828000006_seedarts', department: '예체능부', regSlot: '2026-09', events: SEED_EVENTS_ARTS },
  { marker: 'seed/v11.json', group: '20260828000007_seedsupp', department: '학부모·학술지원부', regSlot: '2026-09', events: SEED_EVENTS_SUPPORT },
  { marker: 'seed/v12.json', group: '20260828000008_seedcareer', department: '진로상담부', regSlot: '2026-10', events: SEED_EVENTS_CAREER },
  { marker: 'seed/v13.json', group: '20260828000009_seedadmin', department: '행정실', regSlot: '2026-09', events: SEED_EVENTS_ADMIN }
];

async function ensureSeed(SUPABASE_URL, svcHeaders) {
  if (_seedReady) return;
  try {
    for (const s of SEEDS) {
      const marker = await fetchMeta(SUPABASE_URL, svcHeaders, s.marker);
      if (marker) continue;
      const events = normEvents(s.events);
      if (events) {
        const base = {
          group: s.group, regSlot: s.regSlot, department: s.department,
          created_by: 'seed', created_by_name: s.department,
          created_at: new Date().toISOString()
        };
        await writeFragments(SUPABASE_URL, svcHeaders, base, events, s.regSlot);
      }
      await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${s.marker}`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', 'x-upsert': 'true' },
        body: JSON.stringify({ done: true, at: new Date().toISOString() })
      });
    }
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
