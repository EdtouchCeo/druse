'use strict';
// Dave AIT Class 서버 함수 공용 도구: Supabase REST·Storage·Realtime 호출, 학생 참여 증표(쿠키), 응답 모양.
// 표(ait_*)와 자료 보관함(ait-content)은 서비스 키로만 다룬다. 학생 브라우저는 표에 직접 닿지 않는다.
const crypto = require('node:crypto');
const gate = require('./gate-cookie');

const BUCKET = 'ait-content';
const ROOM_COOKIE = 'ait_room';
const TIMEOUT_MS = 8000;
const LESSON_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function config() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && key ? { url, key } : null;
}

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function reply(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function fail(err) {
  if (err instanceof HttpError) return reply(err.status, { error: err.message, code: err.code });
  return reply(503, { error: '수업 서버에 잠시 연결하지 못했습니다. 조금 뒤 다시 시도해 주세요.', code: 'UPSTREAM' });
}

// PostgREST 호출. path는 '/rest/v1/...' 뒤쪽.
async function rest(cfg, path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const e = new HttpError(res.status === 409 ? 409 : 503, '수업 기록을 다루지 못했습니다.', res.status === 409 ? 'CONFLICT' : 'UPSTREAM');
    e.detail = data;
    throw e;
  }
  return data;
}

// Supabase 로그인 토큰의 주인. 학생(익명)과 교사 모두 쓴다.
async function authUser(cfg, event) {
  const token = String(event.headers?.authorization || event.headers?.Authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new HttpError(401, '로그인 정보가 없습니다. 화면을 새로 고쳐 주세요.', 'AUTH_REQUIRED');
  const res = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.key, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 401 || res.status === 403) throw new HttpError(401, '로그인 정보가 만료되었습니다. 화면을 새로 고쳐 주세요.', 'AUTH_REQUIRED');
  if (!res.ok) throw new HttpError(503, '로그인 확인 서버에 연결하지 못했습니다.', 'UPSTREAM');
  const user = await res.json();
  if (!user?.id) throw new HttpError(401, '로그인 정보를 확인하지 못했습니다.', 'AUTH_REQUIRED');
  return user;
}

// 교사 쪽 기능(수업 열기, 자료 보기·올리기, 교사 튜터)은 당분간 사이트 관리자만 쓴다.
// 사용 설명서 로그인 쿠키(서버 서명)의 관리자 표시를 확인한다. sub가 Supabase 사용자 id다.
function teacherClaims(event) {
  const cfg = config();
  if (!cfg) return null;
  const claims = gate.verify(gate.readCookie(event), cfg.key);
  return claims && claims.tier === 'teacher' && claims.adm === true && claims.sub ? claims : null;
}

// 학생 참여 증표: { r: 방 id, m: 참가자 id, l: 차시 id, exp }. 서비스 키에서 따로 유도한 열쇠로 서명한다.
function roomKey(serviceKey) {
  return crypto.createHmac('sha256', String(serviceKey)).update('ait-room-v1').digest();
}
function signRoom(claims, serviceKey) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', roomKey(serviceKey)).update(payload).digest('base64url');
  return `r1.${payload}.${sig}`;
}
function verifyRoom(value, serviceKey, now = Date.now()) {
  const [v, payload, sig, extra] = String(value || '').split('.');
  if (v !== 'r1' || !payload || !sig || extra !== undefined || !serviceKey) return null;
  const expected = Buffer.from(crypto.createHmac('sha256', roomKey(serviceKey)).update(payload).digest('base64url'));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!c || typeof c.exp !== 'number' || c.exp * 1000 <= now || !c.r || !c.m || !LESSON_RE.test(c.l || '')) return null;
    return c;
  } catch {
    return null;
  }
}
function readRoomCookie(event) {
  const raw = String(event.headers?.cookie || event.headers?.Cookie || '');
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === ROOM_COOKIE) return part.slice(at + 1).trim();
  }
  return '';
}
function studentClaims(event) {
  const cfg = config();
  return cfg ? verifyRoom(readRoomCookie(event), cfg.key) : null;
}
function roomCookieHeader(value, maxAge) {
  return `${ROOM_COOKIE}=${value}; Path=/ait-api; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

// 교사 세션 토큰 보관(학생 튜터가 서버 AI(Claude)를 부를 때 쓴다). 방 기록에는 암호문만 둔다.
// 열쇠는 서비스 키에서 따로 유도하고, 토큰은 1시간이면 만료된다.
const bearer = (event) => String(event.headers?.authorization || event.headers?.Authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
function aiKey(serviceKey) {
  return crypto.createHmac('sha256', String(serviceKey)).update('ait-ai-token-v1').digest();
}
function sealToken(token, serviceKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aiKey(serviceKey), iv);
  const body = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return `a1.${iv.toString('base64url')}.${body.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}
function openToken(value, serviceKey) {
  const [v, iv, body, tag, extra] = String(value || '').split('.');
  if (v !== 'a1' || !iv || !body || !tag || extra !== undefined || !serviceKey) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', aiKey(serviceKey), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
function jwtExpMs(token) {
  try { return (JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')).exp || 0) * 1000; } catch { return 0; }
}

// Realtime REST 방송(서비스 키). 비공개 채널로 보낸다.
async function broadcast(cfg, messages) {
  if (!messages.length) return;
  const res = await fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages.map((m) => ({ topic: m.topic, event: m.event || 'm', payload: m.payload, private: true })) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 202) throw new HttpError(503, '실시간 연결로 보내지 못했습니다.', 'UPSTREAM');
}

// 보관함: 경로 검사, 내려받기, 짧은 주소 발급, 올리기 주소 발급.
const safePath = (p) => typeof p === 'string' && p.length < 300 && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(p) && !p.split('/').some((s) => s === '..' || s === '.');
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function download(cfg, path) {
  const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${encPath(path)}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new HttpError(503, '자료를 불러오지 못했습니다.', 'UPSTREAM');
  return Buffer.from(await res.arrayBuffer());
}
async function downloadJSON(cfg, path) {
  const buf = await download(cfg, path);
  if (!buf) return null;
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}
async function signedUrl(cfg, path, expiresIn = 120) {
  const res = await fetch(`${cfg.url}/storage/v1/object/sign/${BUCKET}/${encPath(path)}`, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new HttpError(503, '자료 주소를 만들지 못했습니다.', 'UPSTREAM');
  const data = await res.json();
  const rel = data.signedURL || data.signedUrl;
  return rel ? `${cfg.url}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}` : null;
}
async function uploadUrl(cfg, path) {
  const res = await fetch(`${cfg.url}/storage/v1/object/upload/sign/${BUCKET}/${encPath(path)}`, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'x-upsert': 'true' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(503, '올리기 주소를 만들지 못했습니다.', 'UPSTREAM');
  const data = await res.json();
  return `${cfg.url}/storage/v1${data.url.startsWith('/') ? '' : '/'}${data.url}`;
}
async function upload(cfg, path, buf, contentType) {
  const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${encPath(path)}`, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'no-cache' },
    body: buf,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(503, '자료를 저장하지 못했습니다.', 'UPSTREAM');
}
async function remove(cfg, paths) {
  if (!paths.length) return;
  const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(503, '자료를 지우지 못했습니다.', 'UPSTREAM');
}

function newCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

function parseBody(event, limit = 64 * 1024) {
  if (event.body && event.body.length > limit) throw new HttpError(413, '보낸 내용이 너무 깁니다.', 'TOO_LARGE');
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
    return JSON.parse(raw || '{}');
  } catch {
    throw new HttpError(400, '요청 형식이 맞지 않습니다.', 'BAD_REQUEST');
  }
}

module.exports = {
  BUCKET, LESSON_RE, ROOM_COOKIE, HttpError, config, reply, fail, rest, authUser, teacherClaims,
  signRoom, verifyRoom, studentClaims, roomCookieHeader, broadcast, safePath, download, downloadJSON,
  signedUrl, uploadUrl, upload, remove, newCode, parseBody, bearer, sealToken, openToken, jwtExpMs,
};
