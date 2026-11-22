// 교사 화면과 학생 화면을 잇는 통로. 화면 코드는 send(메시지)와 on(받는 함수)만 쓴다.
//   로컬 미리보기(127.0.0.1): 같은 브라우저의 탭끼리 BroadcastChannel로 잇는다.
//   사이트: Supabase 실시간 비공개 채널로 잇는다.
//     ait:<방>              교사 → 학생 모두(지금 장, 퀴즈 화면, 의견 목록)
//     ait:<방>:p:<참가자>   교사 → 그 학생 한 명(내 퀴즈 결과, 대화명, 내보내기)
//     ait:<방>:teacher      학생 → 교사. 학생은 채널에 직접 보내지 못하고 /ait-api/relay가 확인한 뒤 보낸다.
//
// 메시지 종류
//   교사 → 학생: state · closed · kick · quiz · quiz-* · talk · talk-*
//   학생 → 교사: hello · ping · bye · quiz-join · quiz-answer · talk-post · talk-like (tutor-log는 튜터 서버가 보낸다)
import { SERVER_MODE, newCode } from './common.js';
import { createSocket, teacherToken, studentToken } from './rt.js';

export const SERVER = SERVER_MODE;
export const TRANSPORT = SERVER ? 'server' : 'local';
// 서버 연결에서는 Supabase 무료 한도(초당 메시지 100개)를 넘지 않게 간격을 넓힌다.
export const TIMING = SERVER ? { ping: 20000, active: 50000, heartbeat: 8000 } : { ping: 5000, active: 15000, heartbeat: 4000 };
const GAP = { quiz: 800, talk: 600, state: 250 };

export async function api(path, body, headers = {}) {
  let res;
  try {
    res = await fetch(`/ait-api/${path}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('인터넷 연결을 확인해 주세요.'), { code: 'NETWORK' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '수업 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'), { code: data.code, status: res.status });
  return data;
}

function localRoom(code) {
  const channel = new BroadcastChannel(`ait-room-${code}`);
  const handlers = new Set();
  channel.onmessage = (e) => handlers.forEach((fn) => fn(e.data));
  return {
    send(message) { channel.postMessage(message); },
    on(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    close() { channel.close(); handlers.clear(); },
  };
}

// 같은 종류의 방송은 간격 안에서 마지막 것만 보낸다(퀴즈 응답 수처럼 자주 바뀌는 값).
function createThrottle(deliver) {
  const last = new Map();
  const latest = new Map();
  const timers = new Map();
  return (m) => {
    if (m.type === 'closed') { deliver(m); return; }
    const k = m.type;
    const wait = (last.get(k) || 0) + (GAP[k] ?? 250) - Date.now();
    latest.set(k, m);
    if (timers.has(k)) return;
    const fire = () => { timers.delete(k); last.set(k, Date.now()); const x = latest.get(k); latest.delete(k); if (x) deliver(x); };
    if (wait <= 0) fire();
    else timers.set(k, setTimeout(fire, wait));
  };
}

// 교사: 수업 열기(또는 새로 고침 뒤 이어 열기). 돌려주는 roomId를 sessionStorage에 두면 이어 열 수 있다.
export async function openTeacherRoom({ lessonId, roomId, onStatus } = {}) {
  if (!SERVER) {
    const code = roomId || newCode();
    return { code, roomId: code, ...localRoom(code), closeRoom: async () => {} };
  }
  const info = roomId ? await api('room', { action: 'resume', roomId }) : await api('room', { action: 'open', lessonId });
  const id = info.roomId;
  const handlers = new Set();
  const sock = createSocket(teacherToken, { onStatus });
  const unsent = new Map();
  const main = sock.channel(`ait:${id}`, () => {});
  sock.channel(`ait:${id}:teacher`, (m) => handlers.forEach((fn) => fn(m)));
  const flushUnsent = () => main.ready().then(() => { for (const m of unsent.values()) main.send(m); unsent.clear(); }).catch(() => {});
  const deliver = (m) => { if (!main.send(m)) { unsent.set(m.type, m); flushUnsent(); } };
  const throttled = createThrottle(deliver);
  const personal = new Map();
  let saved = { mode: info.state?.mode, tutor: info.state?.tutor };

  const toOne = (m) => {
    let ch = personal.get(m.pid);
    if (!ch) { ch = sock.channel(`ait:${id}:p:${m.pid}`, () => {}); personal.set(m.pid, ch); }
    if (!ch.send(m)) ch.ready().then(() => ch.send(m)).catch(() => {});
  };
  const record = (patch) => api('room', { action: 'state', roomId: id, ...patch }).catch(() => {});

  return {
    code: info.code,
    roomId: id,
    send(m) {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'kick' && m.pid) api('room', { action: 'member', roomId: id, memberId: m.pid, kicked: true }).catch(() => {});
      // 튜터가 퀴즈 중인지, 튜터가 켜졌는지 서버에서 확인할 수 있게 바뀔 때만 적어 둔다.
      if (m.type === 'state' && (m.mode !== saved.mode || m.tutor !== saved.tutor)) { saved = { mode: m.mode, tutor: m.tutor }; record(saved); }
      if (m.pid) toOne(m);
      else throttled(m);
    },
    on(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    close() { handlers.clear(); setTimeout(() => sock.close(), 300); },
    closeRoom: () => api('room', { action: 'close', roomId: id }),
  };
}

// 학생: 참여 코드로 들어오기. pid는 서버가 정한 참가자 번호다.
export async function joinStudentRoom(code, { onStatus } = {}) {
  if (!SERVER) {
    const pid = sessionStorage.getItem('ait_pid') || crypto.randomUUID();
    sessionStorage.setItem('ait_pid', pid);
    return { pid, ...localRoom(code) };
  }
  let token;
  try {
    token = await studentToken();
  } catch {
    throw Object.assign(new Error('수업 서버에 들어가지 못했습니다. 잠시 뒤 다시 시도해 주세요.'), { code: 'ANON' });
  }
  const info = await api('room', { action: 'join', code }, { Authorization: `Bearer ${token}` });
  const handlers = new Set();
  const dispatch = (m) => handlers.forEach((fn) => fn(m));
  const sock = createSocket(studentToken, { onStatus });
  const all = sock.channel(`ait:${info.roomId}`, dispatch);
  const mine = sock.channel(`ait:${info.roomId}:p:${info.memberId}`, dispatch);
  await Promise.race([
    Promise.all([all.ready(), mine.ready()]),
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('수업 화면에 연결하지 못했습니다. 학교 무선망 연결을 확인한 뒤 다시 들어와 주세요.'), { code: 'RT_TIMEOUT' })), 15000)),
  ]);

  let queue = [];
  let timer = null;
  const flush = async () => {
    timer = null;
    const batch = queue.splice(0, 5);
    if (!batch.length) return;
    try {
      await api('relay', { messages: batch });
    } catch (e) {
      if (e.code === 'NO_ROOM_TOKEN') onStatus && onStatus('expired');
    }
    if (queue.length) timer = setTimeout(flush, 150);
  };
  return {
    pid: info.memberId,
    no: info.no,
    lessonId: info.lessonId,
    send(m) {
      if (!m || m.type === 'tutor-log') return; // 튜터 기록은 튜터 서버가 교사에게 보낸다.
      if (m.type === 'bye') {
        navigator.sendBeacon?.('/ait-api/relay', new Blob([JSON.stringify({ messages: [m] })], { type: 'text/plain' }));
        return;
      }
      queue = queue.filter((x) => !(x.type === 'ping' && m.type === 'ping')); // 밀린 ping은 마지막 것만
      queue.push(m);
      if (!timer) timer = setTimeout(flush, 120);
    },
    on(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    close() { handlers.clear(); sock.close(); },
  };
}
