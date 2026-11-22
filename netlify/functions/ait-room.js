'use strict';
// Dave AIT Class 수업 방: 교사가 열고 닫고, 학생이 참여 코드로 들어온다.
//   교사(사용 설명서 교사 로그인 쿠키): open · resume · close · state · member
//   학생(Supabase 익명 로그인 토큰): join
// 학생에게는 참여 증표 쿠키(ait_room, /ait-api 아래에서만 보냄)를 준다. 자료, 중계, 튜터가 이 증표로 방을 확인한다.
const ait = require('./_lib/ait');

const MAX_MEMBERS = 80;
const ROOM_HOURS = 8;
const TOKEN_HOURS = 6;
const MODES = ['slides', 'textbook', 'lab', 'quiz', 'talk'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const q = encodeURIComponent;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return ait.reply(405, { error: 'POST 요청만 받습니다.' });
  const cfg = ait.config();
  if (!cfg) return ait.reply(503, { error: '수업 서버 설정이 준비되지 않았습니다.', code: 'SERVER_CONFIG' });
  try {
    const body = ait.parseBody(event);
    if (body.action === 'join') return await join(cfg, event, body);
    const teacher = ait.teacherClaims(event);
    if (!teacher) return ait.reply(401, { error: '승인된 교사 계정으로 로그인한 뒤 수업을 열 수 있습니다.', code: 'AUTH_REQUIRED' });
    switch (body.action) {
      case 'open': return await open(cfg, teacher, body);
      case 'resume': return await resume(cfg, teacher, body);
      case 'close': return await close(cfg, teacher, body);
      case 'state': return await setState(cfg, teacher, body);
      case 'member': return await member(cfg, teacher, body);
      default: return ait.reply(400, { error: '알 수 없는 요청입니다.', code: 'BAD_REQUEST' });
    }
  } catch (err) {
    return ait.fail(err);
  }
};

async function ownRoom(cfg, teacher, roomId) {
  if (!UUID.test(String(roomId || ''))) throw new ait.HttpError(400, '방 정보가 맞지 않습니다.', 'BAD_REQUEST');
  const rows = await ait.rest(cfg, `ait_rooms?id=eq.${q(roomId)}&teacher_id=eq.${q(teacher.sub)}&select=id,code,lesson_id,state,closed_at,expires_at&limit=1`);
  const room = rows?.[0];
  if (!room) throw new ait.HttpError(404, '이 수업을 찾지 못했습니다.', 'NO_ROOM');
  return room;
}

async function open(cfg, teacher, body) {
  const lessonId = String(body.lessonId || '');
  if (!ait.LESSON_RE.test(lessonId)) throw new ait.HttpError(400, '차시 정보가 맞지 않습니다.', 'BAD_REQUEST');
  const lesson = await ait.downloadJSON(cfg, `${lessonId}/lesson.json`);
  if (!lesson) throw new ait.HttpError(404, '이 차시 자료가 수업 보관함에 없습니다. "자료 올리기"로 먼저 올려 주세요.', 'NO_LESSON');
  if (lesson.approval?.status !== 'approved') throw new ait.HttpError(403, '승인한 차시만 학생에게 열 수 있습니다.', 'DRAFT');
  // 지난 방 정리(닫히거나 끝난 지 하루 지난 방과 그 기록). 실패해도 수업 열기는 계속한다.
  const old = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await ait.rest(cfg, `ait_rooms?or=(closed_at.lt.${q(old)},expires_at.lt.${q(old)})`, { method: 'DELETE' }).catch(() => {});
  const expires = new Date(Date.now() + ROOM_HOURS * 3600 * 1000).toISOString();
  for (let i = 0; i < 6; i += 1) {
    const code = ait.newCode();
    try {
      const rows = await ait.rest(cfg, 'ait_rooms', {
        method: 'POST', prefer: 'return=representation',
        body: { code, lesson_id: lessonId, teacher_id: teacher.sub, state: { mode: 'slides', tutor: true }, expires_at: expires },
      });
      const room = rows[0];
      return ait.reply(200, { roomId: room.id, code: room.code, expiresAt: room.expires_at });
    } catch (err) {
      if (err.code !== 'CONFLICT') throw err; // 열린 방끼리 코드가 겹치면 다시 뽑는다.
    }
  }
  throw new ait.HttpError(503, '참여 코드를 만들지 못했습니다. 다시 눌러 주세요.', 'CODE');
}

async function resume(cfg, teacher, body) {
  const room = await ownRoom(cfg, teacher, body.roomId);
  if (room.closed_at || Date.parse(room.expires_at) <= Date.now()) throw new ait.HttpError(410, '이미 닫힌 수업입니다.', 'CLOSED');
  return ait.reply(200, { roomId: room.id, code: room.code, lessonId: room.lesson_id, expiresAt: room.expires_at, state: room.state });
}

async function close(cfg, teacher, body) {
  const room = await ownRoom(cfg, teacher, body.roomId);
  if (!room.closed_at) {
    await ait.rest(cfg, `ait_rooms?id=eq.${q(room.id)}`, { method: 'PATCH', body: { closed_at: new Date().toISOString() } });
  }
  await ait.broadcast(cfg, [{ topic: `ait:${room.id}`, payload: { type: 'closed' } }]).catch(() => {});
  return ait.reply(200, { ok: true });
}

// 튜터가 지금 수업 모드와 튜터 켜짐을 확인할 수 있게 방에 적어 둔다.
async function setState(cfg, teacher, body) {
  const room = await ownRoom(cfg, teacher, body.roomId);
  const state = { ...(room.state || {}) };
  if (MODES.includes(body.mode)) state.mode = body.mode;
  if (typeof body.tutor === 'boolean') state.tutor = body.tutor;
  await ait.rest(cfg, `ait_rooms?id=eq.${q(room.id)}`, { method: 'PATCH', body: { state } });
  return ait.reply(200, { state });
}

// 내보내기(다시 들어오지 못함)와 되돌리기, 대화명 기록.
async function member(cfg, teacher, body) {
  const room = await ownRoom(cfg, teacher, body.roomId);
  if (!UUID.test(String(body.memberId || ''))) throw new ait.HttpError(400, '참가자 정보가 맞지 않습니다.', 'BAD_REQUEST');
  const patch = {};
  if (typeof body.kicked === 'boolean') patch.kicked = body.kicked;
  if (typeof body.nameLocked === 'boolean') patch.name_locked = body.nameLocked;
  if (typeof body.nickname === 'string' && body.nickname.trim()) patch.nickname = body.nickname.trim().slice(0, 12);
  if (!Object.keys(patch).length) throw new ait.HttpError(400, '바꿀 내용이 없습니다.', 'BAD_REQUEST');
  await ait.rest(cfg, `ait_members?id=eq.${q(body.memberId)}&room_id=eq.${q(room.id)}`, { method: 'PATCH', body: patch });
  return ait.reply(200, { ok: true });
}

async function join(cfg, event, body) {
  const code = String(body.code || '').toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new ait.HttpError(400, '참여 코드는 영문과 숫자 6자리입니다.', 'BAD_CODE');
  const user = await ait.authUser(cfg, event);
  const now = new Date().toISOString();
  const rooms = await ait.rest(cfg, `ait_rooms?code=eq.${q(code)}&closed_at=is.null&expires_at=gt.${q(now)}&select=id,lesson_id,expires_at,state&limit=1`);
  const room = rooms?.[0];
  if (!room) throw new ait.HttpError(404, '열려 있는 수업을 찾지 못했습니다. 참여 코드를 다시 확인해 주세요.', 'NO_ROOM');

  let me = (await ait.rest(cfg, `ait_members?room_id=eq.${q(room.id)}&user_id=eq.${q(user.id)}&select=id,participant_no,kicked&limit=1`))?.[0];
  if (me?.kicked) throw new ait.HttpError(403, '선생님이 이 기기의 참여를 멈췄습니다.', 'KICKED');
  for (let i = 0; !me && i < 6; i += 1) {
    const last = await ait.rest(cfg, `ait_members?room_id=eq.${q(room.id)}&select=participant_no&order=participant_no.desc&limit=1`);
    const no = (last?.[0]?.participant_no || 0) + 1;
    if (no > MAX_MEMBERS) throw new ait.HttpError(403, `한 수업에는 ${MAX_MEMBERS}명까지 들어올 수 있습니다.`, 'FULL');
    try {
      const rows = await ait.rest(cfg, 'ait_members', {
        method: 'POST', prefer: 'return=representation',
        body: { room_id: room.id, user_id: user.id, participant_no: no, nickname: `참가자 ${no}` },
      });
      me = rows[0];
    } catch (err) {
      if (err.code !== 'CONFLICT') throw err; // 같은 번호를 동시에 받으면 다음 번호로 다시 시도한다.
      me = (await ait.rest(cfg, `ait_members?room_id=eq.${q(room.id)}&user_id=eq.${q(user.id)}&select=id,participant_no,kicked&limit=1`))?.[0];
    }
  }
  if (!me) throw new ait.HttpError(503, '수업에 들어가지 못했습니다. 다시 시도해 주세요.', 'JOIN');

  const exp = Math.min(Date.parse(room.expires_at), Date.now() + TOKEN_HOURS * 3600 * 1000);
  const token = ait.signRoom({ r: room.id, m: me.id, l: room.lesson_id, exp: Math.floor(exp / 1000) }, cfg.key);
  return ait.reply(200, { roomId: room.id, memberId: me.id, no: me.participant_no, lessonId: room.lesson_id, expiresAt: room.expires_at },
    { 'Set-Cookie': ait.roomCookieHeader(token, (exp - Date.now()) / 1000) });
}
