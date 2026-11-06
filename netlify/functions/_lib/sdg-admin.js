'use strict';
// 수행평가 구현 미리보기의 웹 관리 기능. 사이트 Google 로그인으로 확인한 관리자만 쓴다.
//
// 필요한 Netlify 환경변수:
//   SDG_ADMIN_EMAILS : 관리자 이메일(쉼표로 구분). 저장소가 공개라 코드에 적지 않는다.
//   SUPABASE_URL, SUPABASE_SERVICE_KEY : 사이트 로그인 확인용(기존 값)
// 사이트 운영자는 환경변수가 없어도 관리자다.
const OWNER_EMAIL = 'drhong81@gmail.com';
const ADMIN_COOKIE = 'sdg_admin';
const ADMIN_SECONDS = 8 * 60 * 60;
const AUTH_TIMEOUT_MS = 8000;
const BUCKET = 'sdg-uploads';

// 실제 학번(1학년 1~12반)과 겹치지 않는 관리자 테스트용 번호. 입장 화면에서는 쓸 수 없다.
const TEST_PREFIX = '199';

function adminEmails(env = process.env) {
  const listed = String(env.SDG_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return [...new Set([OWNER_EMAIL, ...listed])];
}
const isAdminEmail = (email) => adminEmails().includes(String(email || '').toLowerCase());
const testIdFor = (email) => {
  const index = adminEmails().indexOf(String(email || '').toLowerCase());
  return index < 0 ? null : `${TEST_PREFIX}${String(index + 1).padStart(2, '0')}`;
};
const isTestId = (id) => String(id || '').startsWith(TEST_PREFIX);
// 입장 코드: 소문자와 특수문자를 함께 쓴 3자 이내.
const validEntryCode = (code) => (/^[a-z!@#$%&*?]{2,3}$/.test(code) && /[a-z]/.test(code) && /[^a-z]/.test(code));

// 사이트 로그인 토큰을 확인해 이메일과 이름을 돌려준다. 토큰이 틀리면 null.
async function verifySiteLogin(token) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !key) throw new Error('site auth is not configured');
  const signal = () => AbortSignal.timeout(AUTH_TIMEOUT_MS);
  const res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: key }, signal: signal() });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`auth ${res.status}`);
  const me = await res.json();
  if (!me || !me.id || !me.email) return null;
  let name = me.user_metadata?.full_name || me.user_metadata?.name || '';
  const profile = await fetch(`${url}/rest/v1/users?google_id=eq.${encodeURIComponent(me.id)}&select=name&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: signal(),
  });
  if (profile.ok) {
    const rows = await profile.json();
    if (Array.isArray(rows) && rows[0]?.name) name = rows[0].name;
  }
  return { email: String(me.email).toLowerCase(), name: String(name || '관리자').slice(0, 40) };
}

function createAdmin(h) {
  const { rpc, table, reply, fail, sign, verify, header, cookie, parseBody, config, previewFor, SESSION_COOKIE, SESSION_SECONDS } = h;

  function adminOf(event, secret) {
    const raw = header(event, 'cookie') || '';
    const m = new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([^;]+)`).exec(raw);
    const payload = m ? verify(m[1], secret) : null;
    // 학생 입장 쿠키도 같은 비밀값으로 서명하므로 종류와 현재 명단을 함께 확인한다.
    return payload && payload.kind === 'admin' && isAdminEmail(payload.email) ? payload : null;
  }
  const note = (admin, action, detail = {}) => table('POST', 'sdg_log', { type: 'admin', name: admin.name, detail: { action, ...detail } });

  async function storage(method, path, body) {
    const { url, key } = config();
    const res = await fetch(`${url}/storage/v1/object/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`storage ${res.status}`);
    return res.json();
  }
  async function emptyBucket() {
    const list = (prefix) => storage('POST', `list/${BUCKET}`, { prefix, limit: 1000 });
    for (const student of await list('')) {
      for (const folder of await list(student.name)) {
        const prefix = `${student.name}/${folder.name}`;
        const files = await list(prefix);
        if (files.length) await storage('DELETE', BUCKET, { prefixes: files.map((f) => `${prefix}/${f.name}`) });
      }
    }
  }

  async function startSession(event, secret) {
    const token = String(header(event, 'authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) return fail(401, '사이트에 로그인해 주세요.');
    const who = await verifySiteLogin(token);
    if (!who) return fail(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (!isAdminEmail(who.email)) return fail(403, '이 계정에는 관리 권한이 없습니다.');
    const value = sign({ kind: 'admin', email: who.email, name: who.name, exp: Math.floor(Date.now() / 1000) + ADMIN_SECONDS }, secret);
    return reply(200, { ok: true }, { 'Set-Cookie': cookie(event, ADMIN_COOKIE, value, ADMIN_SECONDS) });
  }

  // 관리자 본인 전용 입장. 입장 코드와 단계 열림 여부를 따지지 않는다.
  async function enterTest(event, admin, secret) {
    const id = testIdFor(admin.email);
    await table('POST', 'sdg_students?on_conflict=id', { id, name: admin.name, last_at: new Date().toISOString() }, 'resolution=merge-duplicates');
    await note(admin, 'test', { id });
    const value = sign({ id, test: true, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }, secret);
    return reply(200, { ok: true, id }, { 'Set-Cookie': cookie(event, SESSION_COOKIE, value, SESSION_SECONDS) });
  }

  async function handle(route, event, secret) {
    const method = event.httpMethod;
    if (route === 'session' && method === 'POST') return startSession(event, secret);
    if (route === 'logout' && method === 'POST') return reply(200, { ok: true }, { 'Set-Cookie': cookie(event, ADMIN_COOKIE, '', 0) });

    const admin = adminOf(event, secret);
    if (!admin) return fail(401, '관리자 로그인이 필요합니다.');

    if (route === 'state' && method === 'GET') {
      const state = await rpc('sdg_t_state', {});
      return reply(200, {
        ...state,
        students: (state.students || []).map((s) => ({ ...s, test: isTestId(s.id) })),
        me: { name: admin.name, email: admin.email, testId: testIdFor(admin.email) },
      });
    }
    if (route === 'log' && method === 'GET') return reply(200, { log: await rpc('sdg_t_log', { p_limit: 500 }) });
    if (route === 'test-enter' && method === 'POST') return enterTest(event, admin, secret);

    if (route === 'settings' && method === 'POST') {
      const body = parseBody(event);
      if (!body) return fail(400, '요청 형식이 잘못되었습니다.');
      if ('entryCode' in body) return fail(400, '화면이 오래되었습니다. 새로고침한 뒤 다시 시도해 주세요.');
      await rpc('sdg_t_settings', {
        p_code: null,
        p_open1: typeof body.open1 === 'boolean' ? body.open1 : null,
        p_open2: typeof body.open2 === 'boolean' ? body.open2 : null,
      });
      await note(admin, 'settings');
      return reply(200, { ok: true });
    }
    if (route === 'code-add' && method === 'POST') {
      const code = typeof parseBody(event)?.code === 'string' ? parseBody(event).code.trim() : '';
      if (!validEntryCode(code)) return fail(400, '입장 코드는 소문자와 특수문자(! @ # $ % & * ?)를 함께 써서 3자 이내로 정해 주세요.');
      const out = await rpc('sdg_t_code_add', { p_code: code, p_by: admin.name });
      if (out?.error === 'exists') return fail(409, '이미 쓰고 있는 코드입니다.');
      if (out?.error === 'limit') return fail(409, '코드는 20개까지 둘 수 있습니다. 쓰지 않는 코드를 삭제해 주세요.');
      await note(admin, 'code-add', { code });
      return reply(200, { ok: true, code });
    }
    if (route === 'code-delete' && method === 'POST') {
      const code = parseBody(event)?.code;
      if (typeof code !== 'string' || !code) return fail(400, '삭제할 코드를 확인해 주세요.');
      await rpc('sdg_t_code_delete', { p_code: code });
      await note(admin, 'code-delete', { code });
      return reply(200, { ok: true });
    }
    if (route === 'reset' && method === 'POST') {
      const body = parseBody(event);
      if (!/^\d{5}$/.test(String(body?.id)) || ![1, 2].includes(body?.stage)) return fail(400, '학생 또는 단계를 확인해 주세요.');
      const out = await rpc('sdg_t_reset', { p_id: String(body.id), p_stage: body.stage });
      if (out?.error) return fail(409, '생성 중에는 다시 열 수 없습니다.');
      await note(admin, 'reset', { id: String(body.id), stage: body.stage });
      return reply(200, { ok: true });
    }
    if (route === 'wipe' && method === 'POST') {
      const body = parseBody(event);
      if (body?.confirm !== '초기화') return fail(400, '확인 문구가 맞지 않습니다.');
      const out = await rpc('sdg_t_wipe', {});
      if (out?.error) return fail(409, '생성 중에는 초기화할 수 없습니다.');
      await emptyBucket().catch((err) => console.error('[sdg wipe bucket]', err.message));
      return reply(200, { ok: true });
    }
    const input = /^input\/(\d{5})\/([12])$/.exec(route);
    if (input && method === 'GET') {
      const rows = await table('GET', `sdg_jobs?student_id=eq.${input[1]}&stage=eq.${input[2]}&select=input_text`);
      return reply(200, { text: rows?.[0]?.input_text ?? null });
    }
    const preview = /^preview\/(\d{5})\/([12])$/.exec(route);
    if (preview && method === 'GET') return previewFor(event, preview[1], Number(preview[2]));
    return fail(404, '없는 경로입니다.');
  }

  return { handle };
}

module.exports = { createAdmin, adminEmails, isAdminEmail, testIdFor, isTestId, validEntryCode, TEST_PREFIX, ADMIN_COOKIE };
