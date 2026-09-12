'use strict';

// Build credentials can write only deploy stores. This checks that temporary
// scope and the SDK CAS contract; it does not verify site-wide runtime writes.
// https://docs.netlify.com/build/data-and-storage/netlify-blobs/#deploy-specific-stores
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const STORE_NAME = 'daeryun-counseling-deploy-checks';
const SUCCESS = 'temporary deploy-store CAS smoke passed';

class SmokeError extends Error {
  constructor(stage) {
    super(`temporary deploy-store CAS smoke failed (${stage})`);
  }
}

function createStrictFetch(fetchImpl) {
  return async (input, init = {}) => {
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || input?.headers);
    const conditional = method === 'PUT' && (headers.has('if-match') || headers.get('if-none-match') === '*');
    const timeout = AbortSignal.timeout(15000);
    const upstreamSignal = init.signal || input?.signal;
    let response;
    try {
      response = await fetchImpl(input, {
        ...init, redirect: 'error',
        signal: upstreamSignal ? AbortSignal.any([upstreamSignal, timeout]) : timeout,
      });
    } catch {
      // Fetch/SDK errors may include signed URLs or request headers.
      throw new SmokeError('transport');
    }
    const allowed = [200, 201, 204].includes(response.status)
      || (response.status === 412 && conditional)
      || (response.status === 404 && ['GET', 'HEAD'].includes(method));
    if (!allowed) {
      const status = Number.isInteger(response.status) ? response.status : 0;
      throw new SmokeError(`HTTP ${status}`);
    }
    return response;
  };
}

function requireWrite(result, stage) {
  if (result?.modified !== true || typeof result.etag !== 'string' || !result.etag.trim()) {
    throw new SmokeError(stage);
  }
}

async function verifyDeployStore(store) {
  const key = `counseling-smoke/${randomUUID()}`;
  const before = 'synthetic temporary deploy-store CAS fixture; version=1;'.padEnd(1024, '.');
  const after = 'synthetic temporary deploy-store CAS fixture; version=2;'.padEnd(1024, '.');
  const metadata = { synthetic: true, scope: 'temporary-deploy-store', version: 1 };
  const nextMetadata = { ...metadata, version: 2 };
  const readOptions = { type: 'text', consistency: 'strong' };
  let cleanup = true;
  let failure;
  try {
    const created = await store.set(key, before, { onlyIfNew: true, metadata });
    // An improbable UUID collision belongs to somebody else; never delete it.
    if (created?.modified === false) cleanup = false;
    requireWrite(created, 'create');
    const first = await store.getWithMetadata(key, readOptions);
    if (first?.data !== before || first.etag !== created.etag || !isDeepStrictEqual(first.metadata, metadata)) {
      throw new SmokeError('initial strong read');
    }
    const updated = await store.set(key, after, { onlyIfMatch: first.etag, metadata: nextMetadata });
    requireWrite(updated, 'update');
    if (updated.etag === first.etag) throw new SmokeError('unchanged update ETag');
    const stale = await store.set(key, before, { onlyIfMatch: first.etag, metadata });
    if (stale?.modified !== false) throw new SmokeError('stale CAS accepted');
    const current = await store.getWithMetadata(key, readOptions);
    if (current?.data !== after || current.etag !== updated.etag || !isDeepStrictEqual(current.metadata, nextMetadata)) {
      throw new SmokeError('post-conflict strong read');
    }
  } catch (error) {
    failure = error instanceof SmokeError ? error : new SmokeError('SDK operation');
  } finally {
    if (cleanup) {
      try {
        await store.delete(key);
        if (await store.getWithMetadata(key, readOptions) !== null) throw new SmokeError('cleanup read');
      } catch {
        failure = new SmokeError(failure ? 'operation and cleanup' : 'cleanup');
      }
    }
  }
  if (failure) throw failure;
}

function createPostBuild(dependencies = {}) {
  return async ({ utils }) => {
    try {
      const getDeployStore = dependencies.getDeployStore || require('@netlify/blobs').getDeployStore;
      const store = getDeployStore({
        name: STORE_NAME, consistency: 'strong',
        fetch: createStrictFetch(dependencies.fetch || globalThis.fetch),
      });
      await verifyDeployStore(store);
    } catch (error) {
      const safe = error instanceof SmokeError ? error : new SmokeError('configuration');
      utils.build.failBuild(safe.message);
      throw safe; // Also fail if a host implementation returns from failBuild.
    }
    (dependencies.log || console.log)(SUCCESS);
  };
}

module.exports = { onPostBuild: createPostBuild() };
// Keep test helpers out of Netlify's enumerable lifecycle hook discovery.
Object.defineProperty(module.exports, '_test', {
  value: Object.freeze({ createStrictFetch, requireWrite, verifyDeployStore, createPostBuild, STORE_NAME, SUCCESS }),
});
