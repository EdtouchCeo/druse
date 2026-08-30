const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { handler } = require('../netlify/functions/pdf-auth.js');

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const event = (token = 'test-token') => ({
  httpMethod: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

async function run() {
  let calls = 0;
  global.fetch = async () => { calls += 1; return response(500, {}); };
  let result = await handler(event(''));
  assert.equal(result.statusCode, 401);
  assert.equal(calls, 0);
  assert.equal(result.headers['Cache-Control'], 'no-store');

  global.fetch = async () => response(401, {});
  result = await handler(event());
  assert.equal(result.statusCode, 401);

  const teacherReplies = [
    response(200, { id: 'teacher-1', email: 'teacher@example.com' }),
    response(200, [{ role: '교사', approved: true }]),
  ];
  global.fetch = async () => teacherReplies.shift();
  result = await handler(event());
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });

  const deniedReplies = [
    response(200, { id: 'teacher-2', email: 'teacher2@example.com' }),
    response(200, [{ role: '교사', approved: false }]),
  ];
  global.fetch = async () => deniedReplies.shift();
  result = await handler(event());
  assert.equal(result.statusCode, 403);

  global.fetch = async () => { throw new Error('network'); };
  result = await handler(event());
  assert.equal(result.statusCode, 503);
  console.log('pdf-auth smoke PASS: 401 / approved teacher / 403 / 503 / no-store');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
