'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const SECRET = 'synthetic-sdg-secret-with-more-than-32-characters';
process.env.SDG_SECRET = SECRET;
process.env.SDG_SUPABASE_URL = 'https://sdg.test';
process.env.SDG_SUPABASE_SERVICE_KEY = 'sdg-key';
process.env.SUPABASE_URL = 'https://site.test';
process.env.SUPABASE_SERVICE_KEY = 'site-key';
process.env.SDG_ADMIN_EMAILS = 'Second@Example.test, third@example.test';

const { handler } = require('../netlify/functions/sdg.js');
const { adminEmails, testIdFor, isAdminEmail } = require('../netlify/functions/_lib/sdg-admin.js');
const { validStudentId } = require('../tools/sdg-preview/lib/filter.cjs');

const TOKENS = {
  owner: { id: 'u0', email: 'drhong81@gmail.com', user_metadata: { full_name: '합성 운영자' } },
  second: { id: 'u2', email: 'second@example.test', user_metadata: {} },
  stranger: { id: 'u9', email: 'stranger@example.test', user_metadata: {} },
};
const PLAN = `서비스명: 합성 서비스
기획 의도: 시험용 내용입니다.
서비스 목적: 시험용 내용입니다.
대상 사용자: 시험 사용자
핵심 기능: ${'시험 기능 설명입니다. '.repeat(30)}`;

function fakeBackend() {
  const db = { settings: { open1: false, open2: false }, codes: new Map(), students: new Map(), jobs: new Map(), log: [], calls: [] };
  const key = (id, stage) => `${id}/${stage}`;
  const rpcs = {
    sdg_t_state: () => ({ ...db.settings, codes: [...db.codes.values()], wipeEpoch: 0, queued: 0, running: 0, students: [...db.students.values()].map((s) => ({ id: s.id, name: s.name, stage1: db.jobs.get(key(s.id, 1))?.status || 'none', stage2: db.jobs.get(key(s.id, 2))?.status || 'none', refusals: 0 })) }),
    sdg_t_log: () => db.log,
    sdg_t_settings: (a) => { if (a.p_code !== null) db.settings.entryCode = a.p_code; if (a.p_open1 !== null) db.settings.open1 = a.p_open1; if (a.p_open2 !== null) db.settings.open2 = a.p_open2; return null; },
    sdg_t_reset: (a) => { const j = db.jobs.get(key(a.p_id, a.p_stage)); if (j && ['queued', 'running'].includes(j.status)) return { error: 'busy' }; if (j) j.status = 'none'; return { ok: true }; },
    sdg_t_wipe: () => { db.students.clear(); db.jobs.clear(); db.log = []; db.settings.open1 = false; db.settings.open2 = false; return { ok: true }; },
    sdg_result: () => '<!doctype html><p>결과</p>',
    sdg_login: (a) => (db.codes.has(a.p_code) ? { ok: true } : { error: db.codes.size ? 'code' : 'closed' }),
    sdg_t_code_add: (a) => {
      if (db.codes.has(a.p_code)) return { error: 'exists' };
      if (db.codes.size >= 20) return { error: 'limit' };
      db.codes.set(a.p_code, { code: a.p_code, issuedBy: a.p_by, createdAt: '2026-11-06T10:00:00Z' });
      return { ok: true };
    },
    sdg_t_code_delete: (a) => { db.codes.delete(a.p_code); return null; },
    sdg_can_submit: (a) => (((a.p_stage === 1 ? db.settings.open1 : db.settings.open2)) ? { ok: true } : { error: 'closed' }),
    sdg_note_refusal: () => ({ ok: true }),
    sdg_submit: (a) => { db.jobs.set(key(a.p_id, a.p_stage), { status: 'queued', input_text: a.p_text }); return { ok: true }; },
    sdg_me: (a) => {
      const s = db.students.get(a.p_id);
      if (!s) return { error: 'unknown' };
      const st = (n) => { const status = db.jobs.get(key(a.p_id, n))?.status || 'none'; const open = n === 1 ? db.settings.open1 : db.settings.open2; return { status, open, canSubmit: open && ['none', 'failed', 'refused'].includes(status) }; };
      return { id: s.id, name: s.name, stage1: st(1), stage2: st(2) };
    },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const send = (value, status = 200) => (value === null ? new Response(null, { status: status === 200 ? 204 : status }) : new Response(JSON.stringify(value), { status }));
    db.calls.push({ host: url.host, path: url.pathname, method });
    if (url.host === 'site.test' && url.pathname === '/auth/v1/user') {
      const token = init.headers.Authorization.split(' ')[1];
      return TOKENS[token] ? send(TOKENS[token]) : send({}, 401);
    }
    if (url.host === 'site.test') return send([{ name: '합성 교사' }]);
    assert.equal(url.host, 'sdg.test');
    if (url.pathname.startsWith('/rest/v1/rpc/')) return send(rpcs[url.pathname.split('/').pop()](body));
    if (url.pathname === '/rest/v1/sdg_students') { db.students.set(body.id, body); return send(null, 201); }
    if (url.pathname === '/rest/v1/sdg_log') { db.log.push(body); return send(null, 201); }
    if (url.pathname === '/rest/v1/sdg_jobs') {
      if (method === 'GET') {
        const id = url.searchParams.get('student_id').replace('eq.', '');
        const stage = url.searchParams.get('stage').replace('eq.', '');
        const j = db.jobs.get(key(id, stage));
        return send(j ? [{ status: j.status, input_text: j.input_text }] : []);
      }
      db.jobs.set(key(body.student_id, body.stage), body);
      return send(null, 201);
    }
    if (url.pathname.startsWith('/storage/v1/object/list/')) return send([]);
    throw new Error(`unexpected ${method} ${url}`);
  };
  return db;
}

function call(route, { method = 'POST', body, cookie, headers = {} } = {}) {
  return handler({
    path: `/sdg-api/${route}`,
    httpMethod: method,
    headers: { 'content-type': 'application/json', host: 'daeryun.life', 'x-forwarded-proto': 'https', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? (method === 'POST' ? '{}' : undefined) : JSON.stringify(body),
  });
}
const cookieOf = (res) => res.headers['Set-Cookie'].split(';')[0];
async function adminCookie(token = 'owner') {
  const res = await call('admin/session', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);
  return cookieOf(res);
}

test('관리자 명단은 운영자와 환경변수의 이메일이고 시험 번호는 학번으로 쓸 수 없다', () => {
  assert.deepEqual(adminEmails(), ['drhong81@gmail.com', 'second@example.test', 'third@example.test']);
  assert.equal(isAdminEmail('SECOND@example.test'), true);
  assert.equal(isAdminEmail('stranger@example.test'), false);
  for (const email of adminEmails()) assert.equal(validStudentId(testIdFor(email)), false, email);
  assert.deepEqual(adminEmails().map(testIdFor), ['19901', '19902', '19903']);
});

test('로그인 없이는 어떤 관리 기능도 쓸 수 없다', async () => {
  const db = fakeBackend();
  for (const [route, method] of [['admin/state', 'GET'], ['admin/log', 'GET'], ['admin/settings', 'POST'], ['admin/code-add', 'POST'], ['admin/code-delete', 'POST'], ['admin/reset', 'POST'], ['admin/wipe', 'POST'], ['admin/test-enter', 'POST'], ['admin/input/10301', 'GET'], ['admin/preview/10301/1', 'GET']]) {
    const res = await call(route, { method, body: method === 'POST' ? { confirm: '초기화', entryCode: 'X' } : undefined });
    assert.equal(res.statusCode, 401, route);
  }
  assert.equal(db.calls.length, 0);
});

test('등록되지 않은 계정과 틀린 토큰은 거부된다', async () => {
  fakeBackend();
  assert.equal((await call('admin/session', { headers: { authorization: 'Bearer stranger' } })).statusCode, 403);
  assert.equal((await call('admin/session', { headers: { authorization: 'Bearer forged' } })).statusCode, 401);
  assert.equal((await call('admin/session')).statusCode, 401);
});

test('학생 쿠키를 관리자 쿠키로 바꿔 써도 통과하지 못한다', async () => {
  const db = fakeBackend();
  db.codes.set('ABC', { code: 'ABC', issuedBy: '합성 교사' });
  const login = await call('login', { body: { id: '10301', name: '합성학생', code: 'ABC' } });
  const value = cookieOf(login).split('=')[1];
  assert.equal((await call('admin/state', { method: 'GET', cookie: `sdg_admin=${value}` })).statusCode, 401);
});

test('명단에서 빠지면 발급된 관리자 쿠키도 바로 무효가 된다', async () => {
  fakeBackend();
  const cookie = await adminCookie('second');
  assert.equal((await call('admin/state', { method: 'GET', cookie })).statusCode, 200);
  const saved = process.env.SDG_ADMIN_EMAILS;
  process.env.SDG_ADMIN_EMAILS = 'third@example.test';
  try {
    assert.equal((await call('admin/state', { method: 'GET', cookie })).statusCode, 401);
  } finally {
    process.env.SDG_ADMIN_EMAILS = saved;
  }
});

test('관리자는 입장 코드를 발급하고 그 코드로 학생이 입장한다', async () => {
  const db = fakeBackend();
  const cookie = await adminCookie();
  assert.equal((await call('login', { body: { id: '10301', name: '합성학생', code: 'k!m' } })).statusCode, 403);
  assert.equal((await call('admin/code-add', { body: { code: 'k!m' }, cookie })).statusCode, 200);
  assert.equal((await call('admin/settings', { body: { open1: true }, cookie })).statusCode, 200);
  const state = JSON.parse((await call('admin/state', { method: 'GET', cookie })).body);
  assert.deepEqual(state.codes.map((c) => [c.code, c.issuedBy]), [['k!m', '합성 교사']]);
  assert.equal(state.open1, true);
  assert.equal((await call('login', { body: { id: '10301', name: '합성학생', code: 'k!m' } })).statusCode, 200);
});

test('코드 여러 개가 함께 쓰이고 발급 교사가 남으며 삭제한 코드만 막힌다', async () => {
  const db = fakeBackend();
  const cookie = await adminCookie();
  const add = (code) => call('admin/code-add', { body: { code }, cookie });
  const enter = (code) => call('login', { body: { id: '10301', name: '합성학생', code } });
  assert.equal((await add('k!m')).statusCode, 200);
  assert.equal((await add('a?b')).statusCode, 200);
  assert.equal((await add('k!m')).statusCode, 409);
  assert.equal((await add('ABC')).statusCode, 400);
  assert.equal(db.codes.get('a?b').issuedBy, '합성 교사');
  assert.equal((await enter('k!m')).statusCode, 200);
  assert.equal((await enter('a?b')).statusCode, 200);
  assert.equal((await call('admin/code-delete', { body: { code: 'k!m' }, cookie })).statusCode, 200);
  assert.equal((await enter('k!m')).statusCode, 403);
  assert.equal((await enter('a?b')).statusCode, 200);
  assert.deepEqual(db.log.slice(-1).map((e) => [e.type, e.detail.action, e.detail.code]), [['admin', 'code-delete', 'k!m']]);
  assert.equal((await call('admin/settings', { body: { entryCode: 'x!' }, cookie })).statusCode, 400);
});

test('입장 코드는 소문자와 특수문자를 함께 쓴 3자 이내만 저장된다', async () => {
  const { validEntryCode } = require('../netlify/functions/_lib/sdg-admin.js');
  for (const code of ['k!', '!k', 'k!m', '@ab', 'ab?']) assert.equal(validEntryCode(code), true, code);
  for (const code of ['', 'a', '!', 'abc', '!@#', 'ABC', 'A!b', 'k1!', 'k!mn', 'k m', '가!a', 'K7P2QX']) assert.equal(validEntryCode(code), false, code);
});

test('관리자 테스트는 코드와 단계가 닫혀 있어도 제출되지만 일반 학생은 막힌다', async () => {
  const db = fakeBackend();
  const admin = await adminCookie('second');
  const entered = await call('admin/test-enter', { cookie: admin });
  assert.equal(JSON.parse(entered.body).id, '19902');
  const session = cookieOf(entered);
  assert.match(session, /^sdg_session=/);

  const me = JSON.parse((await call('me', { method: 'GET', cookie: session })).body);
  assert.equal(me.test, true);
  assert.equal(me.stage1.open, true);
  assert.equal(me.stage1.canSubmit, true);

  assert.equal((await call('submit/1', { body: { text: PLAN }, cookie: session })).statusCode, 202);
  assert.equal(db.jobs.get('19902/1').status, 'queued');
  assert.equal((await call('submit/1', { body: { text: PLAN }, cookie: session })).statusCode, 409);

  db.codes.set('ABC', { code: 'ABC', issuedBy: '합성 교사' });
  const studentLogin = await call('login', { body: { id: '10301', name: '합성학생', code: 'ABC' } });
  db.students.set('10301', { id: '10301', name: '합성학생' });
  const student = cookieOf(studentLogin);
  assert.equal(JSON.parse((await call('me', { method: 'GET', cookie: student })).body).test, undefined);
  assert.equal((await call('submit/1', { body: { text: PLAN }, cookie: student })).statusCode, 403);
});

test('테스트 기록을 지우면 다시 시험할 수 있다', async () => {
  const db = fakeBackend();
  const admin = await adminCookie();
  const session = cookieOf(await call('admin/test-enter', { cookie: admin }));
  await call('submit/1', { body: { text: PLAN }, cookie: session });
  db.jobs.get('19901/1').status = 'done';
  assert.equal((await call('submit/1', { body: { text: PLAN }, cookie: session })).statusCode, 409);
  assert.equal((await call('admin/reset', { body: { id: '19901', stage: 1 }, cookie: admin })).statusCode, 200);
  assert.equal((await call('submit/1', { body: { text: PLAN }, cookie: session })).statusCode, 202);
});

test('전체 초기화는 확인 문구가 있어야 하고 다른 사이트 요청은 거부한다', async () => {
  fakeBackend();
  const cookie = await adminCookie();
  assert.equal((await call('admin/wipe', { body: { confirm: '아니오' }, cookie })).statusCode, 400);
  assert.equal((await call('admin/wipe', { body: { confirm: '초기화' }, cookie, headers: { origin: 'https://evil.test' } })).statusCode, 403);
  assert.equal((await call('admin/wipe', { body: { confirm: '초기화' }, cookie })).statusCode, 200);
});

test('2차는 프롬프트로 제출하고 관리자는 단계별 입력을 본다', async () => {
  const db = fakeBackend();
  db.codes.set('k!m', { code: 'k!m', issuedBy: '합성 교사' });
  db.settings.open2 = true;
  const login = await call('login', { body: { id: '10301', name: '합성학생', code: 'k!m' } });
  db.students.set('10301', { id: '10301', name: '합성학생' });
  const student = cookieOf(login);
  const send = (text) => call('submit/2', { body: { text }, cookie: student });
  assert.equal((await send('짧은 글')).statusCode, 400);
  assert.equal((await call('submit/2', { body: { prefix: '10301/aa', count: 1 }, cookie: student })).statusCode, 400);
  assert.equal(db.jobs.size, 0);
  const prompt = `[만들 형태] 잔반을 줄이는 서비스를 단일 HTML로 만들어 줘. ${'메뉴별 잔반량을 계산해 표로 보여 줘. '.repeat(3)}`;
  assert.equal((await send(prompt)).statusCode, 202);
  assert.equal(db.jobs.get('10301/2').input_text, prompt.trim());
  assert.equal((await call('prepare/2', { body: { count: 1 }, cookie: student })).statusCode, 404);
  const cookie = await adminCookie();
  const seen = await call('admin/input/10301/2', { method: 'GET', cookie });
  assert.equal(JSON.parse(seen.body).text, prompt.trim());
  assert.equal(JSON.parse((await call('admin/input/10301/1', { method: 'GET', cookie })).body).text, null);
  assert.equal((await call('admin/input/10301/2', { method: 'GET' })).statusCode, 401);
});

test('프롬프트 검사는 빈 항목을 허용하고 금칙어와 길이만 막는다', () => {
  const { validatePrompt } = require('../tools/sdg-preview/lib/filter.cjs');
  const body = '메뉴별 잔반량을 계산해 표로 보여 주는 단일 HTML 웹페이지를 만들어 주세요. 기능은 알아서 정해 주세요.';
  assert.equal(validatePrompt(body).text, body);
  assert.ok(validatePrompt('짧은 글').error);
  assert.ok(validatePrompt(null).error);
  assert.ok(validatePrompt('가'.repeat(6001)).error);
  assert.equal(validatePrompt(`${body} 씨발`).banned, true);
});

test('관리자 미리보기는 화면 안 틀에서만 열린다', async () => {
  fakeBackend();
  const cookie = await adminCookie();
  assert.equal((await call('admin/preview/10301/1', { method: 'GET', cookie })).statusCode, 403);
  const framed = await call('admin/preview/10301/1', { method: 'GET', cookie, headers: { 'sec-fetch-dest': 'iframe' } });
  assert.equal(framed.statusCode, 200);
  assert.match(framed.headers['Content-Security-Policy'], /sandbox/);
});
