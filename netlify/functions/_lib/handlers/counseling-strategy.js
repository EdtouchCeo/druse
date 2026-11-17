'use strict';
const C = require('../counseling');
const { getPrivateStrategyAiConfig } = require('../counseling-ai-config');
const S = require('../counseling-private-strategy');

// Native synchronous functions have a 60-second limit. Keep room for the response
// and permit one quality correction plus one transient transport retry at most.
// claude = { call, token, model }가 있으면 서버 AI(Claude)를 먼저 쓴다. Claude가 응답하지 못했고
// Gemini 설정과 시간이 남아 있으면 같은 요청을 Gemini로 한 번 넘긴다. 넘긴 뒤에는 Claude로 돌아가지 않는다.
async function generateStrategy(request, config, callGemini, deadline = Date.now() + 55000, claude = null) {
  const built = S.buildPayload(request, config.model);
  let payload = built.payload, qualityRetries = 0, transportRetries = 0;
  let useClaude = Boolean(claude && claude.call && claude.token);
  const geminiReady = !useClaude || Boolean(config.enabled);
  const retryableQuality = ['STRATEGY_QUALITY', 'STRATEGY_INVALID_OUTPUT', 'STRATEGY_REPETITION', 'STRATEGY_INCOMPLETE', 'STRATEGY_OUTPUT_PRIVATE'];
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) throw new S.StrategyError('AI_TIMEOUT', '전략 응답 시간이 초과되었습니다. 해당 페이지를 다시 시도해 주세요.', 504);
    const viaClaude = useClaude;
    const signal = AbortSignal.timeout(Math.min(viaClaude ? 45000 : attempt === 0 ? 26000 : remaining, remaining));
    let result;
    try {
      result = viaClaude
        ? await claude.call({ token: claude.token, payload, signal })
        : await callGemini({ apiKey: process.env.GEMINI_API_KEY || '', model: config.model, location: 'global', signal, payload });
    } catch {
      // Transport exceptions can contain credential-bearing URLs. Keep them private.
      result = { ok: false, status: signal.aborted ? 504 : 503, data: null };
    }
    if (viaClaude && !result?.ok && geminiReady && deadline - Date.now() >= 15000) {
      useClaude = false; attempt--;
      continue;
    }
    const canRetry = attempt < 2 && deadline - Date.now() >= 8000;
    if (!viaClaude && !result?.ok && [0, 429, 500, 502, 503, 504].includes(result?.status) && canRetry && transportRetries < 1) {
      transportRetries++;
      await new Promise(resolve => setTimeout(resolve, 300));
      continue;
    }
    try { return S.normalizeModelResponse(result, built.context, viaClaude ? claude.model || 'claude' : config.model); }
    catch (error) {
      if (!(error instanceof S.StrategyError) || !retryableQuality.includes(error.code) || !canRetry || qualityRetries >= 1) throw error;
      // Claude 재작성은 시간이 충분할 때만 한다. 부족하면 Gemini로 보완하고, 그것도 없으면 그대로 실패를 알린다.
      if (viaClaude && deadline - Date.now() < 25000) { if (!geminiReady) throw error; useClaude = false; }
      qualityRetries++;
      payload = S.buildRepairPayload(payload, result, error, built.context);
    }
  }
  throw new S.StrategyError('AI_UNAVAILABLE', '전략 응답을 완성하지 못했습니다. 해당 페이지를 다시 시도해 주세요.', 502);
}

// Authentication metadata is used only for access control and never enters the prompt.
// callClaude를 주지 않으면 기존처럼 Gemini만 쓴다. 교사 세션 토큰은 Claude 서버의 승인 확인에만 쓰고 프롬프트에는 넣지 않는다.
function createHandler(callGemini, callClaude) {
  return C.wrap(async event => {
    const deadline = Date.now() + 55000;
    try {
      if (event.httpMethod !== 'POST') C.fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 허용됩니다.');
      if (Object.keys(event.queryStringParameters || {}).length) C.fail(400, 'PRIVATE_STRATEGY_INPUT', '외부 전략 요청에는 추가 조회 값을 넣을 수 없습니다.');
      const request = S.validateRequest(C.body(event, 32768));
      await C.auth(event, { roles: ['teacher'] });
      const config = getPrivateStrategyAiConfig();
      const token = String(event.headers?.authorization || event.headers?.Authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
      const claude = callClaude && config.claude?.enabled && token ? { call: callClaude, token, model: config.claude.model } : null;
      if (!claude && !config.enabled) C.fail(503, 'AI_CONFIG', '외부 전략 AI 연결이 준비되지 않았습니다. 로컬 분석은 계속 사용할 수 있습니다.');
      return C.json(200, await generateStrategy(request, config, callGemini, deadline, claude));
    } catch (error) {
      if (error instanceof S.StrategyError) C.fail(error.status, error.code, error.message);
      throw error;
    }
  });
}
exports.createHandler = createHandler;
exports.generateStrategy = generateStrategy;
exports.handler = createHandler(args => require('../vertex').callGemini(args), args => require('../counseling-claude-relay').callClaudeRelay(args));
