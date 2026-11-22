'use strict';
// 수업 자료 보관함(비공개 ait-content) 문지기. 주소: /ait-api/asset/<과목>/<단원>/...
//   교사(로그인 쿠키): 모든 자료.
//   학생(참여 증표 쿠키): 들어온 수업의 단원 안에서 그 차시, 교과서, 실습만. 퀴즈 파일과 차시 목록은 받지 못한다.
// 그림은 2분 뒤 만료되는 주소로 넘기고(브라우저가 바로 받는다), JSON·CSV 같은 글 자료는 여기서 읽어 준다.
// 학생이 받는 lesson.json에서는 발표 노트(정답이 들어 있음)를 뺀다.
const ait = require('./_lib/ait');

const TEXT_TYPES = { json: 'application/json; charset=UTF-8', csv: 'text/csv; charset=UTF-8', txt: 'text/plain; charset=UTF-8', ipynb: 'application/json; charset=UTF-8' };

function assetPath(event) {
  const p = String(event.path || '');
  const m = p.match(/\/(?:ait-api\/asset|\.netlify\/functions\/ait-asset)\/(.+)$/);
  if (!m) return null;
  let path;
  try { path = decodeURIComponent(m[1]); } catch { return null; }
  return ait.safePath(path) ? path : null;
}

function studentMay(me, path) {
  const [course, unit] = me.l.split('/');
  const unitDir = `${course}/${unit}/`;
  if (!path.startsWith(unitDir)) return false;
  const rest = path.slice(unitDir.length);
  if (rest.startsWith('textbook/') || rest.startsWith('labs/')) return true;
  if (!path.startsWith(`${me.l}/`)) return false;
  const name = path.slice(me.l.length + 1);
  return name !== 'quiz.json' && name !== 'labs.json';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') return ait.reply(405, { error: 'GET 요청만 받습니다.' });
  const cfg = ait.config();
  if (!cfg) return ait.reply(503, { error: '수업 서버 설정이 준비되지 않았습니다.', code: 'SERVER_CONFIG' });
  const path = assetPath(event);
  if (!path) return ait.reply(400, { error: '자료 주소가 맞지 않습니다.', code: 'BAD_PATH' });
  const teacher = ait.teacherClaims(event);
  const student = teacher ? null : ait.studentClaims(event);
  if (!teacher && !student) return ait.reply(401, { error: '수업 중에만 볼 수 있는 자료입니다.', code: 'AUTH_REQUIRED' });
  if (student && !studentMay(student, path)) return ait.reply(403, { error: '이 수업에서 볼 수 없는 자료입니다.', code: 'FORBIDDEN' });
  const cache = teacher ? 'private, no-cache' : 'private, max-age=60';
  try {
    const ext = path.split('.').pop().toLowerCase();
    if (TEXT_TYPES[ext]) {
      const buf = await ait.download(cfg, path);
      if (!buf) return ait.reply(404, { error: '자료를 찾지 못했습니다.', code: 'NOT_FOUND' });
      let body = buf.toString('utf8');
      if (student && path.endsWith('/lesson.json')) {
        const lesson = JSON.parse(body);
        lesson.slides = (lesson.slides || []).map(({ notes, ...s }) => s);
        delete lesson.sources;
        body = JSON.stringify(lesson);
      }
      return { statusCode: 200, headers: { 'Content-Type': TEXT_TYPES[ext], 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' }, body };
    }
    const url = await ait.signedUrl(cfg, path, 120);
    if (!url) return ait.reply(404, { error: '자료를 찾지 못했습니다.', code: 'NOT_FOUND' });
    return { statusCode: 302, headers: { Location: url, 'Cache-Control': cache, 'Referrer-Policy': 'no-referrer' }, body: '' };
  } catch (err) {
    return ait.fail(err);
  }
};

exports.studentMay = studentMay;
