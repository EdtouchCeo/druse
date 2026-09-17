'use strict';
const C = require('../counseling');
// Retired: free-text case/session prompts cannot meet the private strategy boundary.
// Keep schema/RBAC rejection and existing local-only guards; never read a case or call AI.
function createHandler() {
  return C.wrap(async event => {
    if (event.httpMethod !== 'POST') C.fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 허용됩니다.');
    const body = C.body(event, 5000);
    C.rejectPrivate(body);
    C.onlyKeys(body, ['case_id', 'session_id', 'revision', 'privacy', 'purpose', 'instruction']);
    if (body.privacy !== 'standard' || !['counseling', 'style'].includes(body.purpose) || typeof (body.instruction || '') !== 'string' || (body.instruction || '').length > 1200) C.fail(400, 'BAD_REQUEST', '일반 상담 요청 형식을 확인해 주세요.');
    await C.auth(event, { roles: ['teacher'] });
    C.fail(409, 'LEGACY_AI_DISABLED', '로컬 전략실의 비식별 전략 생성을 사용해 주세요.');
  });
}
exports.handler = createHandler();
exports.createHandler = createHandler;
