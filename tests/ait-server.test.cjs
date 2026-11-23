'use strict';
// Dave AIT Class 서버 함수: 수업 방, 학생 중계, 자료 문지기, 자료 올리기, 학생 튜터 방 확인.
// Supabase는 가짜 fetch로 대신한다(표·보관함·실시간 호출을 기록하고 정해진 답을 준다).
const test = require('node:test');
const assert = require('node:assert/strict');
const gate = require('../netlify/functions/_lib/gate-cookie');
const ait = require('../netlify/functions/_lib/ait');

const KEY = 'test-service-key';
const URL_ = 'https://example.supabase.co';
process.env.SUPABASE_URL = URL_;
process.env.SUPABASE_SERVICE_KEY = KEY;
process.env.GEMINI_API_KEY = 'x';
delete process.env.AIT_DEV_TEACHER;

const ROOM = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const TEACHER = '33333333-3333-4333-8333-333333333333';
const LESSON = { id: 'ai-basics/u2/l01', title: '기계학습과 데이터', approval: { status: 'approved' }, sources: { pptx: {} },
  slides: [{ n: 1, id: 's001', title: '첫 장', text: '데이터 탐색', notes: '정답: 결측값 출처: 교과서' }] };

let calls;
let routes;
function mockFetch() {
  calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
    calls.push({ url: u, method: opts.method || 'GET', body, headers: opts.headers || {} });
    for (const [match, handler] of routes) {
      if (match(u, opts.method || 'GET')) {
        const r = handler(u, body);
        const status = r.status || 200;
        const payload = r.raw !== undefined ? r.raw : JSON.stringify(r.json ?? null);
        return new Response(payload, { status });
      }
    }
    return new Response('not mocked', { status: 500 });
  };
}

const teacherCookie = () => `${gate.COOKIE_NAME}=${gate.issue({ sub: TEACHER, tier: 'teacher', adm: true }, KEY).value}`;
const plainTeacherCookie = () => `${gate.COOKIE_NAME}=${gate.issue({ sub: TEACHER, tier: 'teacher' }, KEY).value}`;
const roomCookie = (claims = {}) => `${ait.ROOM_COOKIE}=${ait.signRoom({ r: ROOM, m: MEMBER, l: 'ai-basics/u2/l01', exp: Math.floor(Date.now() / 1000) + 3600, ...claims }, KEY)}`;
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) });
const json = (res) => JSON.parse(res.body);
const lessonRoute = [(u) => u.includes('/storage/v1/object/ait-content/ai-basics/u2/l01/lesson.json'), () => ({ raw: JSON.stringify(LESSON) })];

test.beforeEach(() => { routes = []; mockFetch(); });

const room = require('../netlify/functions/ait-room').handler;
const relay = require('../netlify/functions/ait-relay').handler;
const asset = require('../netlify/functions/ait-asset').handler;
const upload = require('../netlify/functions/ait-upload').handler;
const tutor = require('../netlify/functions/ait-tutor').handler;

test('room: 교사 쿠키 없이는 열 수 없다', async () => {
  const res = await room(post({ action: 'open', lessonId: 'ai-basics/u2/l01' }));
  assert.equal(res.statusCode, 401);
});

test('room: 승인 안 된 차시는 열지 않는다', async () => {
  routes.push([(u) => u.includes('lesson.json'), () => ({ raw: JSON.stringify({ ...LESSON, approval: { status: 'draft' } }) })]);
  const res = await room(post({ action: 'open', lessonId: 'ai-basics/u2/l01' }, { cookie: teacherCookie() }));
  assert.equal(res.statusCode, 403);
  assert.equal(json(res).code, 'DRAFT');
});

test('room: 열기는 교사 id로 방을 만들고, 코드가 겹치면 다시 뽑는다', async () => {
  let inserts = 0;
  routes.push(lessonRoute);
  routes.push([(u, m) => u.includes('/rest/v1/ait_rooms?or=') && m === 'DELETE', () => ({ json: [] })]);
  routes.push([(u, m) => u.endsWith('/rest/v1/ait_rooms') && m === 'POST', (u, b) => {
    inserts += 1;
    if (inserts === 1) return { status: 409, json: { code: '23505' } };
    return { status: 201, json: [{ id: ROOM, code: b.code, expires_at: b.expires_at }] };
  }]);
  const res = await room(post({ action: 'open', lessonId: 'ai-basics/u2/l01' }, { cookie: teacherCookie() }));
  assert.equal(res.statusCode, 200);
  assert.equal(inserts, 2);
  const ins = calls.filter((c) => c.method === 'POST' && c.url.endsWith('ait_rooms'));
  assert.equal(ins[1].body.teacher_id, TEACHER);
  assert.match(json(res).code, /^[A-Z2-9]{6}$/);
});

test('room: 학생 참여는 익명 토큰을 확인하고 참여 증표 쿠키를 준다', async () => {
  routes.push([(u) => u.endsWith('/auth/v1/user'), () => ({ json: { id: 'anon-user', is_anonymous: true } })]);
  routes.push([(u) => u.includes('/rest/v1/ait_rooms?code=eq.K7Q2MD'), () => ({ json: [{ id: ROOM, lesson_id: 'ai-basics/u2/l01', expires_at: new Date(Date.now() + 3600e3).toISOString(), state: {} }] })]);
  routes.push([(u) => u.includes('ait_members?room_id') && u.includes('user_id=eq.anon-user'), () => ({ json: [] })]);
  routes.push([(u) => u.includes('ait_members?room_id') && u.includes('order=participant_no.desc'), () => ({ json: [{ participant_no: 4 }] })]);
  routes.push([(u, m) => u.endsWith('/rest/v1/ait_members') && m === 'POST', (u, b) => ({ status: 201, json: [{ id: MEMBER, participant_no: b.participant_no, kicked: false }] })]);
  const res = await room(post({ action: 'join', code: 'k7q2md' }, { authorization: 'Bearer anon-jwt' }));
  assert.equal(res.statusCode, 200);
  const data = json(res);
  assert.equal(data.memberId, MEMBER);
  assert.equal(data.no, 5);
  const cookie = res.headers['Set-Cookie'];
  assert.match(cookie, /^ait_room=r1\./);
  assert.match(cookie, /Path=\/ait-api; HttpOnly; Secure/);
  const claims = ait.verifyRoom(cookie.split(';')[0].split('=')[1], KEY);
  assert.deepEqual([claims.r, claims.m, claims.l], [ROOM, MEMBER, 'ai-basics/u2/l01']);
});

test('room: 내보낸 학생은 다시 들어오지 못한다', async () => {
  routes.push([(u) => u.endsWith('/auth/v1/user'), () => ({ json: { id: 'anon-user' } })]);
  routes.push([(u) => u.includes('ait_rooms?code=eq.'), () => ({ json: [{ id: ROOM, lesson_id: 'ai-basics/u2/l01', expires_at: new Date(Date.now() + 3600e3).toISOString() }] })]);
  routes.push([(u) => u.includes('ait_members?room_id') && u.includes('user_id='), () => ({ json: [{ id: MEMBER, participant_no: 1, kicked: true }] })]);
  const res = await room(post({ action: 'join', code: 'K7Q2MD' }, { authorization: 'Bearer anon-jwt' }));
  assert.equal(res.statusCode, 403);
  assert.equal(json(res).code, 'KICKED');
});

test('room: 남의 방은 닫을 수 없다', async () => {
  routes.push([(u) => u.includes('ait_rooms?id=eq.') && u.includes(`teacher_id=eq.${TEACHER}`), () => ({ json: [] })]);
  const res = await room(post({ action: 'close', roomId: ROOM }, { cookie: teacherCookie() }));
  assert.equal(res.statusCode, 404);
});

test('relay: 증표 없이는 보내지 못하고, 보낸 사람 번호는 서버가 채운다', async () => {
  assert.equal((await relay(post({ message: { type: 'hello' } }))).statusCode, 401);
  routes.push([(u) => u.endsWith('/realtime/v1/api/broadcast'), () => ({ status: 202, raw: '' })]);
  const res = await relay(post({ messages: [{ type: 'quiz-answer', pid: 'someone-else', q: 0, answer: 1 }, { type: 'state', slide: 9 }] }, { cookie: roomCookie() }));
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).sent, 1);
  const sent = calls.find((c) => c.url.endsWith('/api/broadcast')).body.messages;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].topic, `ait:${ROOM}:teacher`);
  assert.equal(sent[0].private, true);
  assert.equal(sent[0].payload.pid, MEMBER);
});

test('relay: 다른 서명이나 만료된 증표는 거절한다', async () => {
  const forged = `${ait.ROOM_COOKIE}=${ait.signRoom({ r: ROOM, m: MEMBER, l: 'ai-basics/u2/l01', exp: Math.floor(Date.now() / 1000) + 3600 }, 'other-key')}`;
  assert.equal((await relay(post({ message: { type: 'hello' } }, { cookie: forged }))).statusCode, 401);
  assert.equal((await relay(post({ message: { type: 'hello' } }, { cookie: roomCookie({ exp: 10 }) }))).statusCode, 401);
});

test('asset: 학생은 들어온 수업 단원 안의 자료만, 퀴즈 파일은 받지 못한다', async () => {
  const get = (p, cookie) => asset({ httpMethod: 'GET', path: `/ait-api/asset/${p}`, headers: { cookie } });
  assert.equal((await get('ai-basics/u2/l01/slides/s001.webp')).statusCode, 401);
  assert.equal((await get('ai-basics/u3/l01/slides/s001.webp', roomCookie())).statusCode, 403);
  assert.equal((await get('ai-basics/u2/l02/slides/s001.webp', roomCookie())).statusCode, 403);
  assert.equal((await get('ai-basics/u2/l01/quiz.json', roomCookie())).statusCode, 403);
  assert.equal((await get('catalog.json', roomCookie())).statusCode, 403);
  assert.equal((await get('ai-basics/u2/../u3/l01/lesson.json', roomCookie())).statusCode, 400);
});

test('asset: 학생 lesson.json에는 발표 노트가 없고, 교사에게는 있다', async () => {
  routes.push(lessonRoute);
  const s = await asset({ httpMethod: 'GET', path: '/ait-api/asset/ai-basics/u2/l01/lesson.json', headers: { cookie: roomCookie() } });
  assert.equal(s.statusCode, 200);
  assert.equal(JSON.parse(s.body).slides[0].notes, undefined);
  assert.equal(JSON.parse(s.body).sources, undefined);
  const t = await asset({ httpMethod: 'GET', path: '/ait-api/asset/ai-basics/u2/l01/lesson.json', headers: { cookie: teacherCookie() } });
  assert.match(JSON.parse(t.body).slides[0].notes, /정답/);
});

test('asset: 그림은 짧은 주소로 넘긴다', async () => {
  routes.push([(u) => u.includes('/storage/v1/object/sign/ait-content/ai-basics/u2/textbook/p060.webp'), (u, b) => {
    assert.equal(b.expiresIn, 120);
    return { json: { signedURL: '/object/sign/ait-content/ai-basics/u2/textbook/p060.webp?token=abc' } };
  }]);
  const res = await asset({ httpMethod: 'GET', path: '/ait-api/asset/ai-basics/u2/textbook/p060.webp', headers: { cookie: roomCookie() } });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, `${URL_}/storage/v1/object/sign/ait-content/ai-basics/u2/textbook/p060.webp?token=abc`);
});

test('upload: 교사만, 경로 검사', async () => {
  assert.equal((await upload({ httpMethod: 'GET', headers: {} })).statusCode, 401);
  const bad = await upload(post({ action: 'sign', paths: ['../x.webp'] }, { cookie: teacherCookie() }));
  assert.equal(bad.statusCode, 400);
  const manifest = await upload(post({ action: 'sign', paths: ['_manifest.json'] }, { cookie: teacherCookie() }));
  assert.equal(manifest.statusCode, 400);
  routes.push([(u) => u.includes('/storage/v1/object/upload/sign/ait-content/catalog.json'), () => ({ json: { url: '/object/upload/sign/ait-content/catalog.json?token=t' } })]);
  const ok = await upload(post({ action: 'sign', paths: ['catalog.json'] }, { cookie: teacherCookie() }));
  assert.equal(ok.statusCode, 200);
  assert.equal(json(ok).urls[0].url, `${URL_}/storage/v1/object/upload/sign/ait-content/catalog.json?token=t`);
});

test('tutor: 학생은 증표가 있어야 하고, 튜터가 꺼졌거나 방금 물었으면 막는다', async () => {
  const ask = (cookie) => tutor(post({ role: 'student', question: '힌트 주세요', context: { slideN: 1 } }, { cookie }));
  assert.equal((await ask()).statusCode, 401);
  routes.push([(u) => u.includes('ait_rooms?id=eq.'), () => ({ json: [{ state: { tutor: false }, closed_at: null }] })]);
  assert.equal(json(await ask(roomCookie())).code, 'TUTOR_OFF');
  routes = [];
  routes.push([(u) => u.includes('ait_rooms?id=eq.'), () => ({ json: [{ state: { tutor: true, mode: 'quiz' }, closed_at: null }] })]);
  assert.equal(json(await ask(roomCookie())).code, 'QUIZ_ACTIVE');
  routes = [];
  routes.push([(u) => u.includes('ait_rooms?id=eq.'), () => ({ json: [{ state: { tutor: true, mode: 'slides' }, closed_at: null }] })]);
  routes.push([(u) => u.includes('ait_tutor_logs?member_id'), () => ({ json: [{ id: 1 }] })]);
  assert.equal((await ask(roomCookie())).statusCode, 429);
});

test('tutor: 정답 낱말 막기는 띄어쓰기가 달라도 걸린다', () => {
  const { leaks } = require('../netlify/functions/ait-tutor')._test;
  assert.equal(leaks('이건 결 측 값 이야기예요', ['결측값']), true);
  assert.equal(leaks('표를 다시 보세요', ['결측값']), false);
});

test('관리자가 아닌 교사는 수업 열기, 자료 보기·올리기, 교사 튜터를 쓰지 못한다', async () => {
  routes.push(lessonRoute);
  const c = plainTeacherCookie();
  assert.equal((await room(post({ action: 'open', lessonId: 'ai-basics/u2/l01' }, { cookie: c }))).statusCode, 401);
  assert.equal((await asset({ httpMethod: 'GET', path: '/ait-api/asset/ai-basics/u2/l01/lesson.json', headers: { cookie: c } })).statusCode, 401);
  assert.equal((await upload({ httpMethod: 'GET', headers: { cookie: c } })).statusCode, 401);
  assert.equal((await tutor(post({ role: 'teacher', question: '정답 알려줘' }, { cookie: c }))).statusCode, 401);
  assert.equal(calls.filter((x) => x.url.includes('lesson.json')).length, 0);
});

test('room: 교사가 참여 코드를 정할 수 있고, 맞지 않거나 겹치면 알려 준다', async () => {
  routes.push(lessonRoute);
  routes.push([(u, m) => u.includes('/rest/v1/ait_rooms?or=') && m === 'DELETE', () => ({ json: [] })]);
  routes.push([(u, m) => u.includes('ait_rooms?closed_at=is.null&expires_at=lt.') && m === 'PATCH', () => ({ json: [] })]);
  let leftover = [{ id: ROOM }];
  routes.push([(u, m) => u.includes('ait_rooms?code=eq.DAVE22') && m === 'GET', () => ({ json: leftover })]);
  routes.push([(u, m) => u.includes(`ait_rooms?id=eq.${ROOM}`) && m === 'PATCH', () => ({ json: [] })]);
  routes.push([(u) => u.endsWith('/realtime/v1/api/broadcast'), () => ({ status: 202, raw: '' })]);
  let taken = false;
  routes.push([(u, m) => u.endsWith('/rest/v1/ait_rooms') && m === 'POST', (u, b) => (taken ? { status: 409, json: {} } : { status: 201, json: [{ id: 'new-room', code: b.code, expires_at: b.expires_at }] })]);
  const open = (code) => room(post({ action: 'open', lessonId: 'ai-basics/u2/l01', code }, { cookie: teacherCookie() }));

  const ok = await open('dave22');
  assert.equal(ok.statusCode, 200);
  assert.equal(json(ok).code, 'DAVE22');
  // 같은 코드로 열어 둔 내 지난 수업은 닫고 학생에게 알린다.
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes(`ait_rooms?id=eq.${ROOM}`) && c.body.closed_at));
  assert.ok(calls.some((c) => c.url.endsWith('/api/broadcast') && c.body.messages[0].topic === `ait:${ROOM}` && c.body.messages[0].payload.type === 'closed'));

  for (const bad of ['DAVE2', 'DAVE220', 'DAVE01', 'IOTA22', 'DA-E22']) {
    const res = await open(bad);
    assert.equal(res.statusCode, 400, bad);
    assert.equal(json(res).code, 'BAD_CODE', bad);
  }
  leftover = [];
  taken = true;
  const busy = await open('DAVE22');
  assert.equal(busy.statusCode, 409);
  assert.equal(json(busy).code, 'CODE_TAKEN');
  const posts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/rest/v1/ait_rooms'));
  assert.equal(posts.at(-1).body.code, 'DAVE22', '정한 코드는 다른 코드로 바꿔 뽑지 않는다');
});
