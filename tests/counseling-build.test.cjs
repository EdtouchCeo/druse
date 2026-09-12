'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugins/counseling-verify');
const { createStrictFetch, requireWrite, verifyDeployStore, createPostBuild, STORE_NAME, SUCCESS } = plugin._test;

function memoryStore({ badRead = false, cleanupFails = false, collision = false } = {}) {
  let value = null;
  let serial = 0;
  const calls = [];
  return {
    calls,
    async set(key, data, options) {
      calls.push({ method: 'set', key, data, options });
      assert.match(key, /^counseling-smoke\/[0-9a-f-]{36}$/);
      assert.equal(Buffer.byteLength(data), 1024);
      if (collision || (options.onlyIfNew && value) || (options.onlyIfMatch && options.onlyIfMatch !== value?.etag)) return { modified: false };
      value = { data, metadata: structuredClone(options.metadata), etag: `"${++serial}"` };
      return { modified: true, etag: value.etag };
    },
    async getWithMetadata(key, options) {
      calls.push({ method: 'get', key, options });
      assert.deepEqual(options, { type: 'text', consistency: 'strong' });
      return badRead && value ? { ...value, data: 'wrong synthetic value' } : structuredClone(value);
    },
    async delete(key) {
      calls.push({ method: 'delete', key });
      if (cleanupFails) throw new Error('secret signed URL must not appear');
      value = null;
    },
  };
}

test('strict fetch permits only success and operation-specific 412/404', async () => {
  for (const status of [200, 201, 204, 302, 400, 401, 403, 404, 412, 429, 500, 503]) {
    for (const [method, headers] of [['GET', {}], ['HEAD', {}], ['DELETE', {}], ['PUT', {}], ['PUT', { 'if-match': 'old' }], ['PUT', { 'if-none-match': '*' }]]) {
      let received;
      const strict = createStrictFetch(async (input, init) => {
        received = init;
        return new Response(status === 204 ? null : 'synthetic', { status });
      });
      const allowed = [200, 201, 204].includes(status) || (status === 404 && ['GET', 'HEAD'].includes(method)) || (status === 412 && method === 'PUT' && Object.keys(headers).length);
      const pending = strict('https://synthetic.invalid', { method, headers });
      if (allowed) assert.equal((await pending).status, status);
      else await assert.rejects(pending, new RegExp(`HTTP ${status}`));
      assert.equal(received.redirect, 'error');
      assert.ok(received.signal instanceof AbortSignal);
    }
  }
  await assert.rejects(createStrictFetch(async () => { throw new Error('sensitive URL'); })('https://synthetic.invalid'), error => !error.message.includes('sensitive'));
});

test('claimed writes require a true result and a nonempty ETag', () => {
  requireWrite({ modified: true, etag: 'synthetic-etag' }, 'create');
  for (const result of [null, {}, { modified: false }, { modified: true, etag: '' }, { modified: true, etag: ' ' }]) {
    assert.throws(() => requireWrite(result, 'create'), /failed \(create\)/);
  }
});

test('smoke checks one unique key, 1KB values, strong reads, stale CAS and deletion', async () => {
  const store = memoryStore();
  await verifyDeployStore(store);
  assert.deepEqual(store.calls.map(call => call.method), ['set', 'get', 'set', 'set', 'get', 'delete', 'get']);
  assert.equal(new Set(store.calls.map(call => call.key)).size, 1);
  const another = memoryStore();
  await verifyDeployStore(another);
  assert.notEqual(store.calls[0].key, another.calls[0].key);
});

test('smoke cleans failed reads, rejects cleanup failures and preserves collisions', async () => {
  const broken = memoryStore({ badRead: true });
  await assert.rejects(verifyDeployStore(broken), /initial strong read/);
  assert.ok(broken.calls.some(call => call.method === 'delete'));
  await assert.rejects(verifyDeployStore(memoryStore({ cleanupFails: true })), error => error.message.endsWith('(cleanup)') && !error.message.includes('secret'));
  const occupied = memoryStore({ collision: true });
  await assert.rejects(verifyDeployStore(occupied), /failed \(create\)/);
  assert.deepEqual(occupied.calls.map(call => call.method), ['set']);
});

test('post-build opens only a deploy store and emits exactly the scoped success marker', async () => {
  const logs = [];
  const handler = createPostBuild({
    getDeployStore(options) {
      assert.equal(options.name, STORE_NAME);
      assert.equal(options.consistency, 'strong');
      assert.equal(typeof options.fetch, 'function');
      assert.equal(options.token, undefined);
      assert.equal(options.siteID, undefined);
      return memoryStore();
    },
    log: message => logs.push(message),
  });
  await handler({ utils: { build: { failBuild: () => assert.fail('unexpected build failure') } } });
  assert.deepEqual(logs, [SUCCESS]);
  assert.deepEqual(Object.keys(plugin), ['onPostBuild']);
});

test('post-build fails deployment without logging raw SDK errors or success', async () => {
  const failures = [];
  const logs = [];
  const handler = createPostBuild({ getDeployStore() { throw new Error('token=SECRET and synthetic-key'); }, log: value => logs.push(value) });
  await assert.rejects(handler({ utils: { build: { failBuild: message => failures.push(message) } } }), /failed \(configuration\)/);
  assert.deepEqual(failures, ['temporary deploy-store CAS smoke failed (configuration)']);
  assert.deepEqual(logs, []);
});

test('installed SDK uses deploy namespace and CAS headers through strict fetch', async () => {
  const { getDeployStore } = require('@netlify/blobs');
  const deployID = 'a'.repeat(24);
  let saved = null;
  let version = 0;
  const requests = [];
  const fakeFetch = async (input, init) => {
    const url = new URL(input);
    assert.ok(url.pathname.includes('/deploy:' + deployID + ':' + STORE_NAME + '/counseling-smoke/'));
    assert.ok(!url.pathname.includes('/site:'));
    requests.push(init.method.toUpperCase());
    const headers = new Headers(init.headers);
    if (init.method === 'put') {
      if ((headers.get('if-none-match') === '*' && saved) || (headers.has('if-match') && headers.get('if-match') !== saved?.etag)) return new Response(null, { status: 412 });
      saved = { data: init.body, metadata: headers.get('x-amz-meta-user'), etag: `"${++version}"` };
      return new Response(null, { status: 200, headers: { etag: saved.etag } });
    }
    if (init.method === 'delete') { saved = null; return new Response(null, { status: 204 }); }
    if (!saved) return new Response(null, { status: 404 });
    return new Response(saved.data, { headers: { etag: saved.etag, 'x-amz-meta-user': saved.metadata } });
  };
  const store = getDeployStore({ name: STORE_NAME, siteID: 'synthetic-site', token: 'synthetic-token',
    deployID, region: 'us-east-1', consistency: 'strong',
    edgeURL: 'https://synthetic.invalid', uncachedEdgeURL: 'https://synthetic.invalid', fetch: createStrictFetch(fakeFetch) });
  await verifyDeployStore(store);
  assert.equal(saved, null);
  assert.deepEqual(requests, ['PUT', 'GET', 'PUT', 'PUT', 'GET', 'DELETE', 'GET']);
});
