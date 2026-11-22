'use strict';
// 학생 → 교사 중계. 학생은 실시간 채널에 직접 보낼 수 없으므로(권한 정책) 이 함수를 거친다.
// 참여 증표 쿠키로 방과 참가자를 확인하고, 보낸 사람 번호(pid)는 서버가 채운다(남의 이름으로 보내기 방지).
// 비속어 검사와 도배 막기, 채점은 교사 화면이 맡는다. 여기서는 종류와 크기만 거른다.
const ait = require('./_lib/ait');

const TYPES = new Set(['hello', 'ping', 'bye', 'quiz-join', 'quiz-answer', 'talk-post', 'talk-like']);
const MAX_BYTES = 2048;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return ait.reply(405, { error: 'POST 요청만 받습니다.' });
  const cfg = ait.config();
  if (!cfg) return ait.reply(503, { error: '수업 서버 설정이 준비되지 않았습니다.', code: 'SERVER_CONFIG' });
  const me = ait.studentClaims(event);
  if (!me) return ait.reply(401, { error: '수업 참여 정보가 없거나 만료되었습니다. 참여 코드로 다시 들어와 주세요.', code: 'NO_ROOM_TOKEN' });
  try {
    const body = ait.parseBody(event);
    const list = (Array.isArray(body.messages) ? body.messages : [body.message]).filter(Boolean).slice(0, 5);
    const out = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || !TYPES.has(raw.type)) continue;
      const msg = { ...raw, pid: me.m };
      if (Buffer.byteLength(JSON.stringify(msg)) > MAX_BYTES) continue;
      out.push({ topic: `ait:${me.r}:teacher`, payload: msg });
    }
    if (!out.length) return ait.reply(400, { error: '보낼 수 없는 내용입니다.', code: 'BAD_MESSAGE' });
    await ait.broadcast(cfg, out);
    return ait.reply(200, { ok: true, sent: out.length });
  } catch (err) {
    return ait.fail(err);
  }
};
