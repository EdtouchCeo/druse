'use strict';
// 교사 자료 올리기: 교사 PC의 content 폴더를 비공개 보관함(ait-content)에 맞춘다.
// 서비스 키를 PC에 두지 않도록, 교사 로그인 쿠키를 확인한 뒤 파일마다 한 번 쓰는 올리기 주소를 내준다.
//   GET                          보관함 목록(_manifest.json: 경로 → 지문)
//   POST {action:'sign', paths}  올리기 주소(한 번에 100개까지)
//   POST {action:'remove', paths}  보관함에서 지우기
//   POST {action:'manifest', manifest}  올린 뒤 목록 저장
const ait = require('./_lib/ait');

const MANIFEST = '_manifest.json';
const SHA = /^[0-9a-f]{64}$/;

exports.handler = async (event) => {
  const cfg = ait.config();
  if (!cfg) return ait.reply(503, { error: '수업 서버 설정이 준비되지 않았습니다.', code: 'SERVER_CONFIG' });
  if (!ait.teacherClaims(event)) return ait.reply(401, { error: '승인된 교사 계정으로 로그인한 뒤 자료를 올릴 수 있습니다.', code: 'AUTH_REQUIRED' });
  try {
    if (event.httpMethod === 'GET') {
      return ait.reply(200, { manifest: (await ait.downloadJSON(cfg, MANIFEST)) || {} });
    }
    if (event.httpMethod !== 'POST') return ait.reply(405, { error: 'GET 또는 POST 요청만 받습니다.' });
    const body = ait.parseBody(event, 512 * 1024);
    const paths = Array.isArray(body.paths) ? body.paths : [];
    if (body.action === 'sign' || body.action === 'remove') {
      if (!paths.length || paths.length > 100 || !paths.every((p) => ait.safePath(p) && p !== MANIFEST)) {
        throw new ait.HttpError(400, '파일 경로가 맞지 않습니다.', 'BAD_PATH');
      }
      if (body.action === 'remove') {
        await ait.remove(cfg, paths);
        return ait.reply(200, { removed: paths.length });
      }
      const urls = [];
      for (const p of paths) urls.push({ path: p, url: await ait.uploadUrl(cfg, p) });
      return ait.reply(200, { urls });
    }
    if (body.action === 'manifest') {
      const m = body.manifest && typeof body.manifest === 'object' ? body.manifest : null;
      if (!m || !Object.entries(m).every(([p, h]) => ait.safePath(p) && SHA.test(h))) throw new ait.HttpError(400, '목록 형식이 맞지 않습니다.', 'BAD_MANIFEST');
      await ait.upload(cfg, MANIFEST, Buffer.from(JSON.stringify(m)), 'application/json');
      return ait.reply(200, { files: Object.keys(m).length });
    }
    throw new ait.HttpError(400, '알 수 없는 요청입니다.', 'BAD_REQUEST');
  } catch (err) {
    return ait.fail(err);
  }
};
