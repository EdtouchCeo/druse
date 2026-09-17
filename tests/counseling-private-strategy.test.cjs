'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const S = require('../netlify/functions/_lib/counseling-private-strategy');
const createHandler = require('../netlify/functions/_lib/handlers/counseling-strategy').createHandler;
const generateStrategy = require('../netlify/functions/_lib/handlers/counseling-strategy').generateStrategy;
const createLegacy = require('../netlify/functions/_lib/handlers/counseling-ai').createHandler;
const originalFetch = global.fetch;
const request = (extra = {}) => ({ version: 1, stage: 'admissions', target: { university_id: 'snu', department_id: 'computer_science', field: 'computing', admission_year: 2028 }, learner: { grade: 1, school_stage: 'high', strengths: ['inquiry', 'coding_debugging'], needs: ['source_evaluation'], interests: ['computing'], subjects: ['수학', '정보'], school_opportunities: ['coding', 'data_comparison'], school_constraints: ['ai_prohibited'] }, ...extra });
const event = body => ({ httpMethod: 'POST', headers: { authorization: 'Bearer SYNTHETIC_AUTH_TOKEN' }, body: JSON.stringify(body), queryStringParameters: {} });
const parse = result => JSON.parse(result.body);
function mockAuth({ role = '교사', approved = true } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/auth/v1/user')) return Response.json({ id: '60000000-0000-4000-8000-000000000001' });
    if (pathname.endsWith('/users')) return Response.json([{ id: '60000000-0000-4000-8000-000000000002', name: 'SYNTHETIC_PRIVATE_TEACHER', email: 'synthetic@example.invalid', role, approved }]);
    if (pathname.endsWith('/counseling_roles')) return Response.json(role === '교사' ? [] : [{ role: 'student' }]);
    throw Error('Unexpected data read: ' + pathname);
  };
  return calls;
}
function modelDocument(context) {
  return {
    title: '대학 학문분야와 연결하는 합성 준비 보고서',
    summary: '공개 대학 자료와 선택된 학습 요약을 연결하여 학습 방법과 판단 기준을 준비하는 합성 검증용 보고서입니다.',
    sections: context.sections.map((section, sectionIndex) => ({
      id: section.id, title: section.title,
      overview: `${sectionIndex + 1}번째 장에서는 공개 자료의 적용 범위와 학습의 목적을 구분하고 각 항목에서 필요한 개념과 수행 방법을 구체적으로 살펴봅니다.`,
      items: Array.from({ length: 3 }, (_, index) => ({
        title: `검증 항목 ${sectionIndex + 1}-${index + 1}`,
        detail: `${sectionIndex + 1}장 ${index + 1}항목은 자료의 주장을 직접 확인하고 근거와 해석을 구분하는 학습을 다룹니다. 먼저 교과서에서 사용하는 핵심 개념을 자신의 말로 풀어 설명하고, 같은 개념이 나타나는 서로 다른 예시를 골라 공통점과 차이점을 비교합니다. 자료에 제시된 조건을 표로 정리한 뒤 조건이 달라졌을 때도 설명이 유지되는지 검토합니다. 단순히 결과가 같다는 이유로 같은 원인이 작용했다고 판단하지 않고, 무엇을 관찰했고 무엇을 추론했는지 나누어 적습니다. 최종 결과물은 질문과 자료 선정 이유, 비교한 조건, 결론의 근거와 한계를 함께 담은 설명 자료로 구성합니다.`,
        reason: `${sectionIndex + 1}장 ${index + 1}항목을 준비하는 이유는 확인한 자료를 자신의 설명으로 바꾸고 적용 조건을 구분하는 능력이 다음 학습의 기반이 되기 때문입니다. 실제 과거 활동이나 성적을 추정하지 않으며, 개념을 설명할 수 있는 범위를 스스로 판단하는 기준으로 활용합니다.`,
        steps: ['핵심 개념을 자신의 말로 설명하고 서로 다른 예시에서 적용되는 조건을 비교합니다.', '자료의 출처와 비교 기준을 정리한 뒤 결론이 성립하지 않는 반례와 한계를 검토합니다.'],
        evidence_refs: ['strength:inquiry'],
      })),
    })),
  };
}
const response = value => ({ ok: true, status: 200, data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] } });
test.beforeEach(() => {
  process.env.COUNSELING_STORAGE = 'supabase';
  process.env.SUPABASE_URL = 'https://auth.synthetic.invalid';
  process.env.SUPABASE_SERVICE_KEY = 'SYNTHETIC_SERVICE_KEY';
  process.env.GEMINI_API_KEY = 'SYNTHETIC_PROVIDER_KEY';
  process.env.LLM_MODEL = 'synthetic-model';
  process.env.COUNSELING_SERVER_AI_ENABLED = 'true';
});
test.afterEach(() => { global.fetch = originalFetch; });

test('closed request preserves only controlled vocabulary and accepts mixed competency facets', () => {
  const input = request(); input.learner.needs.push('inquiry');
  const result = S.validateRequest(input);
  assert.deepEqual(result, input);
  assert.equal(S.makeContext(input).publicContext.target.official_department_verified, false);
  assert.equal(S.makeContext(input).publicContext.target.reference_only, false);
  input.target.admission_year = 2029;
  assert.equal(S.makeContext(input).publicContext.target.reference_only, true);
  const empty = request(); empty.learner.strengths = []; empty.learner.needs = [];
  assert.doesNotThrow(() => S.validateRequest(empty));
});

test('private strategy uses Gemini 3 thinking settings while retaining explicit older model support', () => {
  const input = require('./fixtures/counseling-private-strategy-request.json');
  const current = S.buildPayload(input).payload.generationConfig;
  assert.deepEqual(current.thinkingConfig, { thinkingLevel: 'low' });
  assert.ok(!Object.hasOwn(current, 'temperature'));
  assert.deepEqual(S.buildPayload(input, 'gemini-2.5-flash').payload.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test('nested names, raw excerpts, identifiers, arbitrary fields and oversized code arrays fail without echo', async () => {
  const mutations = [
    value => { value.context = 'SYNTHETIC_PRIVATE'; },
    value => { value.case_id = '60000000-0000-4000-8000-000000000003'; },
    value => { value.target.department_name = 'SYNTHETIC_PRIVATE'; },
    value => { value.target.department_id = 'SYNTHETIC_PRIVATE'; },
    value => { value.target.university_id = '서울대학교'; },
    value => { value.target.field = 'health'; },
    value => { value.learner.school_name = '합성학교'; },
    value => { value.learner.strengths = ['직접 입력한 비공개 관찰']; },
    value => { value.learner.subjects = ['수학 담당 교사 합성명']; },
    value => { value.learner.school_opportunities = ['PERSONAL_ACTIVITY']; },
    value => { value.learner.school_constraints = ['AI는 마음대로']; },
    value => { value.learner.school_constraints = null; },
    value => { value.learner.school_opportunities = ''; },
    value => { value.learner.grade = '1'; },
    value => { value.learner.interests = Array(6).fill('computing'); },
    value => { value.learner.subjects = ['수학', '수학']; },
    value => { value.learner.strengths = Object.keys(S.taxonomy.competencies).slice(0, 13); },
    value => { value.target.admission_year = '2028'; },
    value => { value.section_id = 'PRIVATE_SECTION'; },
    value => { value.section_id = 'inquiry_question'; },
    value => { value.learner = []; },
    value => { delete value.target.department_id; },
    value => { Object.defineProperty(value.learner, '__proto__', { value: { name: 'SYNTHETIC_PRIVATE' }, enumerable: true }); },
  ];
  for (const mutate of mutations) {
    const calls = mockAuth(); let providerCalls = 0;
    const value = request(); mutate(value);
    const result = await createHandler(async () => { providerCalls++; })(event(value));
    assert.equal(result.statusCode, 400);
    assert.equal(providerCalls, 0); assert.equal(calls.length, 0);
    assert.ok(!result.body.includes('SYNTHETIC_PRIVATE'));
  }
});

test('teacher authentication happens without case/assignment/student reads and never reaches the provider body', async () => {
  const calls = mockAuth(); let sent;
  const input = request({ section_id: 'target_basis' });
  const context = S.makeContext(input);
  const result = await createHandler(async args => { sent = args; return response(modelDocument(context)); })(event(input));
  assert.equal(result.statusCode, 200);
  const report = parse(result); assert.equal(report.sections.length, 1);
  assert.equal(report.stage, 'admissions'); assert.equal(report.sources[0].id, context.sources[0].id);
  assert.equal(sent.location, 'global'); assert.equal(sent.model, 'gemini-3.6-flash');
  assert.ok(calls.every(call => /\/(?:user|users|counseling_roles)$/.test(new URL(call.url).pathname)));
  const payload = JSON.stringify(sent.payload);
  for (const forbidden of ['SYNTHETIC_AUTH_TOKEN', 'SYNTHETIC_PRIVATE_TEACHER', 'SYNTHETIC_SERVICE_KEY', 'SYNTHETIC_PROVIDER_KEY', '60000000-', '대륜', 'OneDrive', 'case_id', 'session_id', 'student_id']) assert.ok(!payload.includes(forbidden), forbidden);
  assert.ok(payload.includes('AI 활용 금지'));
  assert.ok(payload.includes('기초 개념 학습'));
  assert.ok(payload.includes('코드 구현과 오류 수정'));
});

test('missing, student and unapproved authentication cannot make an external request', async () => {
  for (const options of [{ missing: true }, { role: '학생' }, { approved: false }]) {
    mockAuth(options); let count = 0;
    const value = event(request()); if (options.missing) value.headers = {};
    const result = await createHandler(async () => { count++; })(value);
    assert.equal(result.statusCode, options.missing ? 401 : 403); assert.equal(count, 0);
  }
});

test('privacy boundary rejects URL metadata, excess body and disabled provider before AI', async () => {
  mockAuth(); let calls = 0; const handler = createHandler(async () => { calls++; });
  const withQuery = event(request()); withQuery.queryStringParameters = { student: 'SYNTHETIC_PRIVATE' };
  assert.equal((await handler(withQuery)).statusCode, 400);
  const large = event(request()); large.body = ' '.repeat(32769);
  assert.equal((await handler(large)).statusCode, 413);
  process.env.COUNSELING_SERVER_AI_ENABLED = 'false';
  assert.equal((await handler(event(request()))).statusCode, 503);
  assert.equal(calls, 0);
});

test('all five sections are required in order and quality failures never become complete reports', () => {
  const context = S.makeContext(request());
  const valid = modelDocument(context);
  assert.equal(S.normalizeModelResponse(response(valid), context, 'synthetic').sections.length, 5);
  const changes = [
    value => { value.sections.pop(); },
    value => { value.sections.reverse(); },
    value => { value.sections[0].items = value.sections[0].items.slice(0, 2); },
    value => { value.sections[0].items[0].detail = '요약'; },
    value => { value.sections[0].items[0].reason = '필요함'; },
    value => { value.sections[0].items[0].steps = ['확인']; },
    value => { value.sections[1].items[0].detail = value.sections[0].items[0].detail; },
    value => { value.sections[0].items[0].evidence_refs = ['local:student:001']; },
    value => { value.sections[0].items[0].evidence_refs = ['need:leadership']; },
    value => { value.sources = [{ url: 'https://forged.invalid' }]; },
    value => { value.sections[0].items[0].detail += 'synthetic@example.invalid'; },
    value => { value.sections[0].overview += '<script>alert(1)</script>'; },
    value => { value.sections[0].items[0].detail += '합성고등학교'; },
  ];
  for (const change of changes) { const value = structuredClone(valid); change(value); assert.throws(() => S.normalizeModelResponse(response(value), context, 'synthetic'), error => error.status === 502); }
  const truncated = response(valid); truncated.data.candidates[0].finishReason = 'MAX_TOKENS';
  assert.throws(() => S.normalizeModelResponse(truncated, context, 'synthetic'), error => error.code === 'STRATEGY_INCOMPLETE');
  assert.throws(() => S.normalizeModelResponse({ ok: false, status: 429 }, context, 'synthetic'), error => error.status === 429);
});

test('one corrective retry gives precise quality feedback without relaxing the gate or exposing metadata', async () => {
  const input = request({ section_id: 'target_basis' }), context = S.makeContext(input), valid = modelDocument(context);
  const short = structuredClone(valid); short.sections[0].items[0].reason = '짧은 이유입니다.';
  short.private_metadata = 'SYNTHETIC_PRIVATE_METADATA';
  short.sections[0].items[0].evidence_refs.push('SYNTHETIC_FORGED_REF');
  const sent = [];
  const result = await generateStrategy(input, { model: 'gemini-3.6-flash' }, async args => { sent.push(args); return response(sent.length === 1 ? short : valid); });
  assert.equal(result.sections.length, 1); assert.equal(sent.length, 2);
  assert.equal(sent[0].signal instanceof AbortSignal, true);
  const repair = JSON.stringify(sent[1].payload);
  assert.ok(repair.includes('sections[0].items[0].reason'));
  assert.ok(repair.includes('100~160')); assert.ok(repair.includes(valid.sections[0].items[0].detail));
  for (const value of ['SYNTHETIC_PRIVATE_METADATA', 'SYNTHETIC_FORGED_REF', 'SYNTHETIC_SERVICE_KEY', 'SYNTHETIC_AUTH_TOKEN']) assert.ok(!repair.includes(value), value);
  let count = 0;
  await assert.rejects(generateStrategy(input, { model: 'gemini-3.6-flash' }, async () => { count++; return response(short); }), error => error.status === 502);
  assert.equal(count, 2);
});

test('unsafe generated text is omitted completely from the corrective retry draft', async () => {
  const input = request({ section_id: 'target_basis' }), context = S.makeContext(input), valid = modelDocument(context);
  const unsafe = structuredClone(valid); unsafe.sections[0].items[0].detail += ' 합성고등학교 synthetic@example.invalid';
  const sent = [];
  await generateStrategy(input, { model: 'gemini-3.6-flash' }, async args => { sent.push(args); return response(sent.length === 1 ? unsafe : valid); });
  const retry = JSON.stringify(sent[1].payload);
  assert.ok(!retry.includes('합성고등학교')); assert.ok(!retry.includes('synthetic@example.invalid'));
  assert.ok(!retry.includes('앞서 생성된 공개 자료 기반 초안'));
});

test('transient provider retries use the same public payload and never copy error details', async () => {
  const input = request({ section_id: 'target_basis' }), context = S.makeContext(input), valid = modelDocument(context);
  for (const status of [429, 503, 504]) {
    const sent = [];
    const result = await generateStrategy(input, { model: 'gemini-3.6-flash' }, async args => { sent.push(args); return sent.length === 1 ? { ok: false, status, data: { error: { message: 'SYNTHETIC_PRIVATE_PROVIDER_ERROR' } } } : response(valid); });
    assert.equal(result.sections.length, 1); assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].payload, sent[1].payload); assert.ok(!JSON.stringify(sent[1].payload).includes('SYNTHETIC_PRIVATE_PROVIDER_ERROR'));
  }
  let count = 0;
  await assert.rejects(generateStrategy(input, { model: 'gemini-3.6-flash' }, async () => { count++; return { ok: false, status: 404 }; }), error => error.code === 'AI_UNAVAILABLE');
  assert.equal(count, 1);
});

test('deadline and separate retry budgets prevent repeated transport attempts or retries without enough time', async () => {
  const input = request({ section_id: 'target_basis' }); let count = 0;
  const unavailable = async () => { count++; return { ok: false, status: 503 }; };
  await assert.rejects(generateStrategy(input, { model: 'gemini-3.6-flash' }, unavailable), error => error.status === 502);
  assert.equal(count, 2); count = 0;
  await assert.rejects(generateStrategy(input, { model: 'gemini-3.6-flash' }, unavailable, Date.now() + 7000));
  assert.equal(count, 1); count = 0;
  await assert.rejects(generateStrategy(input, { model: 'gemini-3.6-flash' }, unavailable, Date.now() - 1), error => error.code === 'AI_TIMEOUT');
  assert.equal(count, 0);
});

test('quality correction and one transient failure can recover together within a maximum of three calls', async () => {
  const input = request({ section_id: 'target_basis' }), context = S.makeContext(input), valid = modelDocument(context);
  const short = structuredClone(valid); short.sections[0].items[0].reason = '너무 짧은 이유';
  for (const ordering of ['quality-first', 'transport-first']) {
    const sent = [];
    const first = ordering === 'quality-first' ? response(short) : { ok: false, status: 503 };
    const second = ordering === 'quality-first' ? { ok: false, status: 503 } : response(short);
    const report = await generateStrategy(input, { model: 'gemini-3.6-flash' }, async args => { sent.push(args); return [first, second, response(valid)][sent.length - 1]; });
    assert.equal(sent.length, 3); assert.equal(report.sections.length, 1);
    if (ordering === 'quality-first') assert.deepEqual(sent[1].payload, sent[2].payload);
    else assert.deepEqual(sent[0].payload, sent[1].payload);
  }
  let count = 0;
  await assert.rejects(generateStrategy(input, { model: 'gemini-3.6-flash' }, async () => { count++; return count === 1 ? response(short) : { ok: false, status: 503 }; }));
  assert.equal(count, 3);
});

test('public catalogue has seventeen universities, official URLs and no school/private provenance', () => {
  assert.equal(S.catalogue.universities.length, 17);
  const body = JSON.stringify(S.catalogue);
  assert.ok(!/대륜|OneDrive|source_path|student_id|teacher_id|source_pdf|html_element_id/.test(body));
  for (const university of S.catalogue.universities) {
    assert.ok(university.sources.length); assert.ok(university.routes.length);
    assert.equal(university.official_department_verified, false);
    assert.ok(university.sources.every(source => source.url.startsWith('https://')));
    assert.ok(university.routes.every(route => /종합/.test(route.track_type) || (university.id === 'unist' && route.round === '수시' && /서류/.test(route.track_type))));
  }
  const snu = S.catalogue.universities.find(item => item.id === 'snu');
  assert.ok(!snu.shared_rules.some(rule => rule.id === 'document-evaluation'));
});

test('signed prior strategy links actual recommendations, rejects forged/stale context and never forwards its token', async () => {
  const input = request({ section_id: 'academic_preparation' });
  const context = S.makeContext(input);
  const document = S.normalizeModelResponse(response(modelDocument(context)), context, 'synthetic');
  assert.ok(document.context_token.startsWith('v1.'));
  const next = { ...input, stage: 'inquiry', section_id: 'concept_learning', context_token: document.context_token };
  const payload = S.buildPayload(next).payload;
  assert.ok(payload.contents[0].parts[0].text.includes(document.sections[0].items[0].detail));
  assert.ok(!JSON.stringify(payload).includes(document.context_token));
  assert.ok(!JSON.stringify(payload).includes('SYNTHETIC_SERVICE_KEY'));
  const changed = structuredClone(next); changed.learner.grade = 2;
  assert.throws(() => S.buildPayload(changed), error => error.code === 'STRATEGY_CONTEXT_STALE');
  const differentTarget = structuredClone(next); differentTarget.target.university_id = 'ku';
  assert.throws(() => S.buildPayload(differentTarget), error => error.code === 'STRATEGY_CONTEXT_STALE');
  const tampered = { ...next, context_token: next.context_token.slice(0, -5) + 'AAAAA' };
  mockAuth(); let calls = 0;
  const result = await createHandler(async () => { calls++; })(event(tampered));
  assert.equal(result.statusCode, 400); assert.equal(calls, 0);
  assert.throws(() => S.validateRequest({ ...next, preparation_context: { detail: 'private text' } }));
  assert.throws(() => S.validateRequest({ ...input, context_token: document.context_token }));
});

test('stage linking fails explicitly when no server signing credential is available', () => {
  const keys = ['COUNSELING_STRATEGY_SIGNING_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'VERTEX_SA_KEY'];
  const values = keys.map(key => process.env[key]);
  try {
    keys.forEach(key => { delete process.env[key]; });
    const context = S.makeContext(request({ section_id: 'academic_preparation' }));
    assert.throws(() => S.normalizeModelResponse(response(modelDocument(context)), context, 'synthetic'), error => error.status === 503 && error.code === 'STRATEGY_CONTEXT_CONFIG');
  } finally { keys.forEach((key, index) => { if (values[index] === undefined) delete process.env[key]; else process.env[key] = values[index]; }); }
});

test('Vertex fallback receives precisely the same constructed public payload', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const payload = S.buildPayload(request({ section_id: 'target_basis' })).payload;
  const calls = [];
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, require: name => { assert.equal(name, 'crypto'); return crypto; }, Buffer, URL, Date, process: { env: { VERTEX_PROJECT: 'synthetic-project', VERTEX_SA_KEY: JSON.stringify({ client_email: 'synthetic@example.invalid', private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }) } }, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'SYNTHETIC_TOKEN', expires_in: 3600 });
    if (url.includes('aiplatform.googleapis.com')) return Response.json({ error: 'synthetic unavailable' }, { status: 503 });
    return Response.json({ candidates: [] });
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../netlify/functions/_lib/vertex.js'), 'utf8'), sandbox);
  const result = await module.exports.callGemini({ apiKey: 'SYNTHETIC_KEY', model: 'synthetic-model', location: 'global', payload });
  assert.equal(result.via, 'key');
  const generationCalls = calls.filter(call => !call.url.includes('oauth2.googleapis.com'));
  assert.equal(generationCalls.length, 2);
  assert.equal(generationCalls[0].options.body, generationCalls[1].options.body);
  assert.equal(generationCalls[0].options.body, JSON.stringify(payload));
  assert.equal(new URL(generationCalls[0].url).hostname, 'aiplatform.googleapis.com');
  assert.ok(generationCalls[0].url.includes('/locations/global/'));
  // Failure at the explicit global model must not bench an unrelated legacy regional call.
  await module.exports.callGemini({ apiKey: 'SYNTHETIC_KEY', model: 'synthetic-model', payload });
  const vertexCalls = calls.filter(call => call.url.includes('aiplatform.googleapis.com'));
  assert.equal(vertexCalls.length, 2);
  assert.equal(new URL(vertexCalls[1].url).hostname, 'us-central1-aiplatform.googleapis.com');
  assert.ok(vertexCalls[1].url.includes('/locations/us-central1/'));
});

test('native secure strategy entry preserves POST and bearer authorization boundaries', async () => {
  const entry = (await import('../netlify/functions/counseling-strategy.mjs')).default;
  global.fetch = async () => { throw Error('unauthenticated native request must not fetch'); };
  const result = await entry(new Request('https://synthetic.invalid/.netlify/functions/counseling-strategy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request()) }));
  assert.equal(result.status, 401); assert.equal((await result.json()).error.code, 'AUTH_REQUIRED');
  const get = await entry(new Request('https://synthetic.invalid/.netlify/functions/counseling-strategy'));
  assert.equal(get.status, 405);
});

test('retired free-text endpoint keeps RBAC and rejects without reading cases or sending prompts', async () => {
  const calls = mockAuth(); let count = 0;
  const handler = createLegacy(async () => { count++; });
  const result = await handler(event({ case_id: '60000000-0000-4000-8000-000000000003', session_id: '60000000-0000-4000-8000-000000000004', revision: 1, privacy: 'standard', purpose: 'counseling', instruction: 'SYNTHETIC_PRIVATE_FREE_TEXT' }));
  assert.equal(result.statusCode, 409); assert.equal(parse(result).error.code, 'LEGACY_AI_DISABLED');
  assert.equal(count, 0); assert.ok(!calls.some(call => /cases|students|assignments/.test(call.url)));
  assert.ok(!result.body.includes('SYNTHETIC_PRIVATE_FREE_TEXT'));
});
