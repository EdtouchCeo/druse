'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { split, CANARIES, TIMETABLE_CANARY } = require('../scripts/build_auth_gate.cjs');
const cookie = require('../netlify/functions/_lib/gate-cookie.js');

const root = path.join(__dirname, '..');
const SECRET = 'synthetic-service-key';
const source = fs.readFileSync(path.join(root, 'output/web/index.html'), 'utf8');
const edge = () => import('../netlify/edge-functions/auth-gate.js');

function request(pathname, headers = {}) {
  return new Request(`https://daeryun.life${pathname}`, { headers: { 'sec-fetch-dest': 'document', ...headers } });
}
function context() {
  return { nextCalls: 0, async next() { this.nextCalls += 1; return new Response('static-file', { status: 200 }); } };
}
async function run(pathname, { value, headers, secret = SECRET } = {}) {
  const { default: gate } = await edge();
  globalThis.Netlify = { env: { get: () => secret } };
  const ctx = context();
  const cookieHeader = value ? { cookie: `${cookie.COOKIE_NAME}=${value}` } : {};
  const res = await gate(request(pathname, { ...cookieHeader, ...headers }), ctx);
  return { res, ctx };
}
const issued = (tier) => cookie.issue({ sub: 'synthetic-user', tier }, SECRET).value;

test('공개본에는 교사 전용 블록과 시간표 데이터가 없다', () => {
  const out = split(source);
  for (const c of [...CANARIES, TIMETABLE_CANARY]) assert.equal(out.public.includes(c), false, c);
  for (const id of ['teacher-login-required', 'tab-student', 'tab-school', 'tab-register', 'tab-teacher', 'teacher-content']) {
    assert.ok(out.public.includes(`id="${id}"`), id);
  }
  assert.ok(out.public.includes('content="public"'));
});

test('회원본은 시간표만 유지하고 교사본은 전체를 유지한다', () => {
  const out = split(source);
  assert.ok(out.member.includes(TIMETABLE_CANARY));
  for (const c of CANARIES) {
    assert.equal(out.member.includes(c), false, c);
    assert.ok(out.teacher.includes(c), c);
  }
});

test('블록을 도려내도 div 균형이 유지된다', () => {
  const strip = (html) => html.replace(/<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi, '');
  const balance = (html) => (html.match(/<div\b/gi) || []).length - (html.match(/<\/div\s*>/gi) || []).length;
  assert.equal(balance(strip(split(source).public)), balance(strip(source)));
});

test('이미 분리된 파일은 다시 처리하지 않는다', () => {
  assert.throws(() => split(split(source).public), /이미 분리/);
});

test('함수 쿠키와 엣지 검증이 서로 호환되고 위조·만료는 거부한다', async () => {
  const { verifyCookie } = await edge();
  const now = Date.now();
  const { value } = cookie.issue({ sub: 'u', tier: 'teacher' }, SECRET, now);
  assert.equal((await verifyCookie(value, SECRET, now)).tier, 'teacher');
  assert.equal(cookie.verify(value, SECRET, now).tier, 'teacher');
  assert.equal(await verifyCookie(value, 'other-secret', now), null);
  assert.equal(await verifyCookie(value, '', now), null);
  assert.equal(await verifyCookie(value, SECRET, now + (cookie.TTL_SECONDS + 1) * 1000), null);
  const [v, payload, sig] = value.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'u', tier: 'teacher', exp: 9999999999 })).toString('base64url');
  assert.equal(await verifyCookie(`${v}.${forged}.${sig}`, SECRET, now), null);
  assert.equal(await verifyCookie(`${v}.${payload}.`, SECRET, now), null);
  assert.equal(cookie.verify(`${v}.${forged}.${sig}`, SECRET, now), null);
});

const PROTECTED = [
  '/record/', '/record', '/record/index.html', '/record/assets/x.js', '/backward/', '/schedule/', '/evalplan/', '/forms/',
  '/forms/app.js', '/bw-api/x', '/build-emb.html', '/data/law_search.json', '/data/curr_emb.bin', '/data/neis_struct.json',
  '/_gated/teacher/index.html', '/_gated/member/index.html',
  // 우회 시도
  '/RECORD/', '/Record/index.html', '//record/', '/record//index.html', '/%72ecord/', '/FORMS/APP.JS', '/_GATED/TEACHER/INDEX.HTML',
];
for (const p of PROTECTED) {
  test(`비로그인은 차단: ${p}`, async () => {
    const { res, ctx } = await run(p);
    assert.equal(res.status, 401);
    assert.equal(ctx.nextCalls, 0);
    assert.match(res.headers.get('x-robots-tag'), /noindex/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
}

test('회원은 교사 경로에서 403, 시간표는 통과', async () => {
  const member = issued('member');
  assert.equal((await run('/record/', { value: member })).res.status, 403);
  assert.equal((await run('/_gated/teacher/index.html', { value: member })).res.status, 403);
  assert.equal((await run('/_gated/member/index.html', { value: member })).ctx.nextCalls, 1);
  const tt = await run('/_timetable_data.json', { value: member });
  assert.equal(tt.ctx.nextCalls, 1);
  assert.equal((await run('/_timetable_data.json')).res.status, 401);
});

test('교사는 보호 경로를 통과하고 색인되지 않는다', async () => {
  const { res, ctx } = await run('/record/index.html', { value: issued('teacher') });
  assert.equal(res.status, 200);
  assert.equal(ctx.nextCalls, 1);
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
});

test('공개 경로와 비로그인 홈은 그대로 통과', async () => {
  for (const p of ['/', '/index.html', '/score.html', '/robots.txt', '/_school_content.html', '/data/club_stats_2026_2.js', '/data/univ/a.json']) {
    const { res, ctx } = await run(p);
    assert.equal(res.status, 200, p);
    assert.equal(ctx.nextCalls, 1, p);
  }
});

test('비밀값이 없으면 보호 경로를 닫는다', async () => {
  const { res, ctx } = await run('/record/', { value: issued('teacher'), secret: '' });
  assert.equal(res.status, 503);
  assert.equal(ctx.nextCalls, 0);
});

test('데이터 요청의 차단 응답은 HTML이 아니라 JSON이다', async () => {
  const { res } = await run('/data/law_search.json', { headers: { 'sec-fetch-dest': 'empty' } });
  assert.match(res.headers.get('content-type'), /json/);
  assert.equal(res.status, 401);
});

test('로그인 후 홈은 자기 사이트를 fetch하지 않고 등급별 화면으로 재작성한다', async () => {
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; return new Response('never'); };
  try {
    const teacher = await run('/?gate_return=%2Fsdg%2Fadmin.html', { value: issued('teacher') });
    assert.ok(teacher.res instanceof URL);
    assert.equal(teacher.res.pathname, '/_gated/teacher/index.html');
    assert.equal(teacher.ctx.nextCalls, 0);
    const member = await run('/', { value: issued('member') });
    assert.equal(member.res.pathname, '/_gated/member/index.html');
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('ask·embed 함수는 교사 쿠키 없이 쓸 수 없다', async () => {
  process.env.SUPABASE_SERVICE_KEY = SECRET;
  process.env.GEMINI_API_KEY = 'synthetic';
  for (const name of ['ask', 'embed']) {
    const { handler } = require(`../netlify/functions/${name}.js`);
    const anon = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    assert.equal(anon.statusCode, 401, name);
    const member = await handler({ httpMethod: 'POST', headers: { cookie: `${cookie.COOKIE_NAME}=${issued('member')}` }, body: '{}' });
    assert.equal(member.statusCode, 401, name);
    const teacher = await handler({ httpMethod: 'POST', headers: { cookie: `${cookie.COOKIE_NAME}=${issued('teacher')}` }, body: '{}' });
    assert.notEqual(teacher.statusCode, 401, name);
  }
});

test('세션 함수는 서버 기록으로 등급을 정하고 저장소 값을 믿지 않는다', async () => {
  process.env.SUPABASE_URL = 'https://synthetic.supabase.test';
  process.env.SUPABASE_SERVICE_KEY = SECRET;
  const { handler } = require('../netlify/functions/auth-session.js');
  const realFetch = globalThis.fetch;
  const call = async (profile, me = { id: 'u1', email: 'someone@example.com' }, meStatus = 200) => {
    globalThis.fetch = async (url) => (String(url).includes('/auth/v1/user')
      ? new Response(JSON.stringify(me), { status: meStatus })
      : new Response(JSON.stringify(profile ? [profile] : []), { status: 200 }));
    return handler({ httpMethod: 'POST', headers: { authorization: 'Bearer synthetic' } });
  };
  try {
    const tierOf = (r) => JSON.parse(r.body).tier;
    assert.equal(tierOf(await call({ role: '교사', approved: true })), 'teacher');
    assert.equal(tierOf(await call({ role: '교사', approved: false })), 'member');
    assert.equal(tierOf(await call({ role: '학생', approved: true })), 'member');
    assert.equal(tierOf(await call(null)), 'member');
    assert.equal(tierOf(await call(null, { id: 'a', email: 'DRHONG81@gmail.com' })), 'teacher');
    const expired = await call(null, {}, 401);
    assert.equal(expired.statusCode, 401);
    assert.match(expired.headers['Set-Cookie'], /Max-Age=0/);
    const ok = await call({ role: '교사', approved: true });
    assert.match(ok.headers['Set-Cookie'], /^__Host-dr_gate=.*HttpOnly; Secure; SameSite=Lax/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal((await handler({ httpMethod: 'POST', headers: {} })).statusCode, 401);
  const out = await handler({ httpMethod: 'DELETE', headers: {} });
  assert.match(out.headers['Set-Cookie'], /Max-Age=0/);
});
