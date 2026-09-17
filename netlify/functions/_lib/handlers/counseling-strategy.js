'use strict';
const C = require('../counseling');
const { getPrivateStrategyAiConfig } = require('../counseling-ai-config');
const S = require('../counseling-private-strategy');

// Native synchronous functions have a 60-second limit. Keep room for the response
// and permit one quality correction plus one transient transport retry at most.
async function generateStrategy(request, config, callGemini, deadline = Date.now() + 55000) {
  const built = S.buildPayload(request, config.model);
  let payload = built.payload, qualityRetries = 0, transportRetries = 0;
  const retryableQuality = ['STRATEGY_QUALITY', 'STRATEGY_INVALID_OUTPUT', 'STRATEGY_REPETITION', 'STRATEGY_INCOMPLETE', 'STRATEGY_OUTPUT_PRIVATE'];
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) throw new S.StrategyError('AI_TIMEOUT', '전략 응답 시간이 초과되었습니다. 해당 페이지를 다시 시도해 주세요.', 504);
    const signal = AbortSignal.timeout(Math.min(attempt === 0 ? 26000 : remaining, remaining));
    let result;
    try {
      result = await callGemini({ apiKey: process.env.GEMINI_API_KEY || '', model: config.model, location: 'global', signal, payload });
    } catch {
      // Transport exceptions can contain credential-bearing URLs. Keep them private.
      result = { ok: false, status: signal.aborted ? 504 : 503, data: null };
    }
    const canRetry = attempt < 2 && deadline - Date.now() >= 8000;
    if (!result?.ok && [0, 429, 500, 502, 503, 504].includes(result?.status) && canRetry && transportRetries < 1) {
      transportRetries++;
      await new Promise(resolve => setTimeout(resolve, 300));
      continue;
    }
    try { return S.normalizeModelResponse(result, built.context, config.model); }
    catch (error) {
      if (!(error instanceof S.StrategyError) || !retryableQuality.includes(error.code) || !canRetry || qualityRetries >= 1) throw error;
      qualityRetries++;
      payload = S.buildRepairPayload(payload, result, error, built.context);
    }
  }
  throw new S.StrategyError('AI_UNAVAILABLE', '전략 응답을 완성하지 못했습니다. 해당 페이지를 다시 시도해 주세요.', 502);
}

// Authentication metadata is used only for access control and never enters the prompt.
function createHandler(callGemini) {
  return C.wrap(async event => {
    const deadline = Date.now() + 55000;
    try {
      if (event.httpMethod !== 'POST') C.fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 허용됩니다.');
      if (Object.keys(event.queryStringParameters || {}).length) C.fail(400, 'PRIVATE_STRATEGY_INPUT', '외부 전략 요청에는 추가 조회 값을 넣을 수 없습니다.');
      const request = S.validateRequest(C.body(event, 32768));
      await C.auth(event, { roles: ['teacher'] });
      const config = getPrivateStrategyAiConfig();
      if (!config.enabled) C.fail(503, 'AI_CONFIG', '외부 전략 AI 연결이 준비되지 않았습니다. 로컬 분석은 계속 사용할 수 있습니다.');
      return C.json(200, await generateStrategy(request, config, callGemini, deadline));
    } catch (error) {
      if (error instanceof S.StrategyError) C.fail(error.status, error.code, error.message);
      throw error;
    }
  });
}
exports.createHandler = createHandler;
exports.generateStrategy = generateStrategy;
exports.handler = createHandler(args => require('../vertex').callGemini(args));
