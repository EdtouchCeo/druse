// Supabase 실시간(Realtime Broadcast) 연결과 로그인 토큰.
// 라이브러리 없이 Phoenix 소켓 규약(vsn 1.0.0)을 직접 쓴다. 채널은 모두 비공개(private)이고,
// 누가 어느 채널을 듣고 보낼 수 있는지는 Supabase의 realtime.messages 정책이 정한다.
import { FAKE_SB } from './common.js';

export const SB_URL = FAKE_SB ? `${location.origin}/fake-sb` : 'https://aafpkfcxzdrguuctdwth.supabase.co';
// 공개용(anon) 키. 사용 설명서 첫 화면에도 들어 있는 값이며 표 권한은 RLS가 막는다.
export const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhZnBrZmN4emRyZ3V1Y3Rkd3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MzEwNjYsImV4cCI6MjA5MjMwNzA2Nn0.1VWheZHC2qNwWJhJ6KTFhjfFf9-bAfAdjzja2cD-xmw';

const HEARTBEAT_MS = 25000;
const RETRY_MS = [1000, 2000, 4000, 8000, 15000];
const TEACHER_KEY = 'dr_sess_v1';
const STUDENT_KEY = 'ait_anon_v1';

// 쿠키·저장소를 막은 브라우저에서는 localStorage가 오류를 낸다. 그때는 이 탭의 기억으로 대신한다.
const memory = new Map();
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return memory.get(k) ?? null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { memory.set(k, v); } },
};

function jwtExp(token) {
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (p.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

// AbortSignal.timeout은 오래된 브라우저(전자칠판 등)에 없다.
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  if (typeof AbortController === 'undefined') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function authPost(path, body) {
  const res = await fetch(`${SB_URL}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: timeoutSignal(12000),
  });
  if (!res.ok) { const e = new Error(`auth ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

// 교사: 사용 설명서 로그인 세션(dr_sess_v1)을 같이 쓴다. 만료가 가까우면 새로 받아 같은 자리에 저장한다.
let teacherRefreshing = null;
export async function teacherToken() {
  const s = store.get(TEACHER_KEY);
  if (!s?.token) return null;
  const exp = s.expires_at || jwtExp(s.token);
  if (exp - Date.now() > 90 * 1000) return s.token;
  if (!s.refresh_token) return null;
  if (!teacherRefreshing) teacherRefreshing = (async () => {
    try {
      const d = await authPost('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      // 다른 탭이 먼저 새로 받았으면 그 값을 쓴다.
      const now = store.get(TEACHER_KEY);
      if (now?.token && now.token !== s.token) return now.token;
      Object.assign(s, { token: d.access_token, refresh_token: d.refresh_token || s.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000 });
      store.set(TEACHER_KEY, s);
      return s.token;
    } catch {
      return null;
    } finally {
      setTimeout(() => { teacherRefreshing = null; }, 0);
    }
  })();
  return teacherRefreshing;
}

// 학생: 학번·이름 없이 익명 로그인. 같은 기기는 같은 익명 계정을 이어 쓴다.
let studentRefreshing = null;
export async function studentToken() {
  const s = store.get(STUDENT_KEY);
  if (s?.token && s.expires_at - Date.now() > 90 * 1000) return s.token;
  if (!studentRefreshing) studentRefreshing = (async () => {
    try {
      let d = null;
      if (s?.refresh_token) d = await authPost('token?grant_type=refresh_token', { refresh_token: s.refresh_token }).catch(() => null);
      if (!d) d = await authPost('signup', { data: {} });
      const next = { token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000 };
      store.set(STUDENT_KEY, next);
      return next.token;
    } finally {
      setTimeout(() => { studentRefreshing = null; }, 0);
    }
  })();
  return studentRefreshing;
}

// 소켓 하나에 채널 여러 개. 끊기면 다시 붙고, 붙으면 채널에 다시 들어간다.
export function createSocket(getToken, { onStatus } = {}) {
  let ws = null;
  let ref = 0;
  let retry = 0;
  let closed = false;
  let heartbeat = null;
  let tokenTimer = null;
  let token = null;
  const channels = new Map(); // topic -> { handler, joined, joinRef, waiters }
  const pending = new Map(); // ref -> { resolve, reject }
  const nextRef = () => String(++ref);
  const status = (s) => onStatus && onStatus(s);

  function raw(msg) {
    if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return true; }
    return false;
  }

  function request(msg) {
    const r = nextRef();
    return new Promise((resolve, reject) => {
      pending.set(r, { resolve, reject });
      if (!raw({ ...msg, ref: r })) { pending.delete(r); reject(new Error('socket')); return; }
      setTimeout(() => { if (pending.delete(r)) reject(new Error('timeout')); }, 10000);
    });
  }

  async function join(topic) {
    const ch = channels.get(topic);
    if (!ch || ws?.readyState !== WebSocket.OPEN) return;
    ch.joined = false;
    ch.joinRef = nextRef();
    try {
      const reply = await request({
        topic: `realtime:${topic}`, event: 'phx_join', join_ref: ch.joinRef,
        payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '', enabled: false }, postgres_changes: [], private: ch.isPrivate }, access_token: token },
      });
      if (reply.status !== 'ok') throw Object.assign(new Error('join'), { reply });
      ch.joined = true;
      ch.failures = 0;
      ch.waiters.splice(0).forEach((w) => w.resolve());
      status('connected');
    } catch (e) {
      ch.failures = (ch.failures || 0) + 1;
      // 권한이 없으면(내보내짐, 수업 닫힘) 계속 두드리지 않는다.
      if (ch.failures >= 3) { ch.waiters.splice(0).forEach((w) => w.reject(e)); status('denied'); return; }
      setTimeout(() => join(topic), RETRY_MS[Math.min(ch.failures, RETRY_MS.length - 1)]);
    }
  }

  async function connect() {
    if (closed) return;
    try { token = await getToken(); } catch { token = null; }
    if (!token) { status('no-token'); setTimeout(connect, RETRY_MS[Math.min(retry++, RETRY_MS.length - 1)]); return; }
    status(retry ? 'reconnecting' : 'connecting');
    ws = new WebSocket(`${SB_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${SB_ANON}&vsn=1.0.0`);
    ws.onopen = () => {
      retry = 0;
      clearInterval(heartbeat);
      heartbeat = setInterval(() => raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() }), HEARTBEAT_MS);
      for (const topic of channels.keys()) join(topic);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.event === 'phx_reply' && pending.has(m.ref)) {
        const p = pending.get(m.ref);
        pending.delete(m.ref);
        p.resolve(m.payload || {});
        return;
      }
      const topic = String(m.topic || '').replace(/^realtime:/, '');
      const ch = channels.get(topic);
      if (!ch) return;
      if (m.event === 'broadcast' && m.payload?.event === 'm') ch.handler(m.payload.payload);
      else if (m.event === 'phx_error' || m.event === 'phx_close') { ch.joined = false; if (!closed) setTimeout(() => join(topic), 1000); }
    };
    ws.onclose = () => {
      clearInterval(heartbeat);
      for (const ch of channels.values()) ch.joined = false;
      pending.forEach((p) => p.reject(new Error('closed')));
      pending.clear();
      if (closed) return;
      status('reconnecting');
      setTimeout(connect, RETRY_MS[Math.min(retry++, RETRY_MS.length - 1)]);
    };
  }

  // 토큰은 1시간이면 만료된다. 미리 새로 받아 채널에 알린다.
  tokenTimer = setInterval(async () => {
    const t = await getToken().catch(() => null);
    if (!t || t === token) return;
    token = t;
    for (const [topic, ch] of channels) if (ch.joined) raw({ topic: `realtime:${topic}`, event: 'access_token', payload: { access_token: t }, ref: nextRef(), join_ref: ch.joinRef });
  }, 60 * 1000);

  connect();

  return {
    // isPrivate=false는 연결 시험용이다. 수업 채널은 늘 비공개로 쓴다.
    channel(topic, handler, { isPrivate = true } = {}) {
      const ch = { handler, joined: false, joinRef: null, waiters: [], failures: 0, isPrivate };
      channels.set(topic, ch);
      join(topic);
      return {
        ready: () => (ch.joined ? Promise.resolve() : new Promise((resolve, reject) => ch.waiters.push({ resolve, reject }))),
        send(payload) {
          if (!ch.joined) return false;
          return raw({ topic: `realtime:${topic}`, event: 'broadcast', payload: { type: 'broadcast', event: 'm', payload }, ref: nextRef(), join_ref: ch.joinRef });
        },
        get joined() { return ch.joined; },
      };
    },
    token: () => token,
    close() {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(tokenTimer);
      try { ws?.close(); } catch { /* 이미 닫힘 */ }
    },
  };
}
