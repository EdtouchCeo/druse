// 로컬 시험용 가짜 Supabase: Dave AIT Class 서버 연결을 교실 없이 끝까지 돌려 보기 위한 것(배포하지 않음).
// 흉내 내는 것: 익명 로그인·토큰, ait_ 표 몇 개(PostgREST 일부 문법), 비공개 보관함, 실시간 Broadcast(웹소켓·REST).
// 실시간 채널 권한은 2026-11-23 실제 프로젝트에 적용된 정책과 같게 둔다.
//   ait:<방>            교사 받기·보내기, 학생 받기
//   ait:<방>:teacher    교사 받기·보내기, 학생 불가
//   ait:<방>:p:<본인>   교사 받기·보내기, 그 학생 받기
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const makeJwt = (sub, extra = {}) => `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ sub, exp: Math.floor(Date.now() / 1000) + 3600, ...extra })}.fake`;
const jwtSub = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString()).sub; } catch { return null; } };

function createFake({ contentRoot, serviceKey, approveAll = false, log = () => {} }) {
  const db = { ait_rooms: [], ait_members: [], ait_tutor_logs: [] };
  const uploads = new Map();
  const sockets = new Set();
  const users = new Set();
  const stats = { broadcasts: 0, delivered: 0, denied: [] };

  // ---------- 표 ----------
  function matches(row, params) {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'or'].includes(k)) continue;
      const [op, ...rest] = v.split('.');
      const val = rest.join('.');
      const cell = row[k];
      if (op === 'eq' && String(cell) !== val) return false;
      if (op === 'is' && val === 'null' && cell !== null && cell !== undefined) return false;
      if (op === 'gt' && !(cell > val)) return false;
      if (op === 'lt' && !(cell < val)) return false;
    }
    return true;
  }
  function table(name, method, params, body) {
    const rows = db[name];
    if (!rows) return { status: 404, json: { message: 'no table' } };
    if (method === 'GET') {
      let out = rows.filter((r) => matches(r, params));
      const order = params.get('order');
      if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
      if (params.get('limit')) out = out.slice(0, Number(params.get('limit')));
      return { json: out };
    }
    if (method === 'POST') {
      const now = new Date().toISOString();
      const row = { id: crypto.randomUUID(), created_at: now, ...body };
      if (name === 'ait_rooms') {
        Object.assign(row, { closed_at: null, state: body.state || {}, expires_at: body.expires_at || new Date(Date.now() + 8 * 3600e3).toISOString() });
        if (rows.some((r) => r.code === row.code && !r.closed_at)) return { status: 409, json: { code: '23505' } };
      }
      if (name === 'ait_members') {
        Object.assign(row, { kicked: false, name_locked: false, joined_at: now });
        if (rows.some((r) => r.room_id === row.room_id && (r.user_id === row.user_id || r.participant_no === row.participant_no))) return { status: 409, json: { code: '23505' } };
      }
      if (name === 'ait_tutor_logs') row.id = rows.length + 1;
      rows.push(row);
      return { status: 201, json: [row] };
    }
    if (method === 'PATCH') {
      const hit = rows.filter((r) => matches(r, params));
      hit.forEach((r) => Object.assign(r, body));
      return { status: 200, json: hit };
    }
    if (method === 'DELETE') return { status: 200, json: [] };
    return { status: 405, json: {} };
  }

  // ---------- 실시간 권한 ----------
  function allowed(uid, topic, action) {
    const m = topic.match(/^ait:([0-9a-f-]{36})(?::(teacher)|:p:([0-9a-f-]{36}))?$/);
    if (!m) return false;
    const [, roomId, teacherCh, memberId] = m;
    const room = db.ait_rooms.find((r) => r.id === roomId);
    if (!room) return false;
    if (room.teacher_id === uid) return action === 'receive' || !room.closed_at;
    if (action !== 'receive' || teacherCh) return false;
    const me = db.ait_members.find((x) => x.room_id === roomId && x.user_id === uid && !x.kicked);
    if (!me) return false;
    return !memberId || memberId === me.id;
  }
  function deliver(topic, payload, except) {
    stats.broadcasts += 1;
    for (const s of sockets) {
      if (s === except) continue;
      const ch = s.channels.get(topic);
      if (!ch) continue;
      stats.delivered += 1;
      s.send({ topic: `realtime:${topic}`, event: 'broadcast', payload: { type: 'broadcast', event: 'm', payload }, ref: null, join_ref: ch.joinRef });
    }
  }

  // ---------- 웹소켓(텍스트 프레임만) ----------
  function upgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = {
      channels: new Map(),
      uid: null,
      send(obj) {
        const data = Buffer.from(JSON.stringify(obj));
        let head;
        if (data.length < 126) head = Buffer.from([0x81, data.length]);
        else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
        else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
        try { socket.write(Buffer.concat([head, data])); } catch { /* 닫힘 */ }
      },
    };
    sockets.add(conn);
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = buf[1] & 0x80;
        const need = off + (masked ? 4 : 0) + len;
        if (buf.length < need) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        const payload = Buffer.from(buf.subarray(off + (masked ? 4 : 0), need));
        if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
        buf = buf.subarray(need);
        if (op === 8) { socket.end(); return; }
        if (op === 1) onFrame(conn, payload.toString('utf8'));
      }
    });
    const drop = () => sockets.delete(conn);
    socket.on('close', drop);
    socket.on('error', drop);
  }

  function onFrame(conn, text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    const topic = String(m.topic || '').replace(/^realtime:/, '');
    const reply = (status, response = {}) => conn.send({ topic: m.topic, event: 'phx_reply', payload: { status, response }, ref: m.ref, join_ref: m.join_ref });
    if (m.event === 'heartbeat') { reply('ok'); return; }
    if (m.event === 'phx_join') {
      const uid = jwtSub(m.payload?.access_token);
      const priv = m.payload?.config?.private;
      if (priv && !allowed(uid, topic, 'receive')) {
        stats.denied.push(topic);
        reply('error', { reason: 'Unauthorized: You do not have permissions to read from this Channel topic' });
        return;
      }
      conn.uid = uid;
      conn.channels.set(topic, { joinRef: m.join_ref, priv });
      reply('ok', { postgres_changes: [] });
      return;
    }
    if (m.event === 'access_token') { conn.uid = jwtSub(m.payload?.access_token) || conn.uid; return; }
    if (m.event === 'broadcast') {
      const ch = conn.channels.get(topic);
      if (!ch) return;
      if (ch.priv && !allowed(conn.uid, topic, 'send')) { stats.denied.push(`send ${topic}`); return; }
      deliver(topic, m.payload?.payload, conn);
    }
  }

  // ---------- HTTP ----------
  async function http(req, res, sub) {
    const url = new URL(sub, 'http://x');
    const p = url.pathname;
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    let raw = Buffer.alloc(0);
    for await (const c of req) raw = Buffer.concat([raw, c]);
    const body = raw.length && /json|text/.test(req.headers['content-type'] || '') ? (() => { try { return JSON.parse(raw.toString()); } catch { return null; } })() : raw;
    const send = (status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); res.end(); return; }
    const service = auth === serviceKey;
    log(`${req.method} ${p}`);

    if (p === '/auth/v1/signup') {
      const id = crypto.randomUUID();
      users.add(id);
      send(200, { access_token: makeJwt(id, { is_anonymous: true }), refresh_token: `r.${id}`, expires_in: 3600, user: { id, is_anonymous: true } });
      return;
    }
    if (p === '/auth/v1/token') {
      const id = String(body?.refresh_token || '').slice(2);
      if (!id) { send(400, { error: 'bad' }); return; }
      send(200, { access_token: makeJwt(id), refresh_token: `r.${id}`, expires_in: 3600 });
      return;
    }
    if (p === '/auth/v1/user') {
      const sub2 = jwtSub(req.headers['authorization']?.replace(/^Bearer\s+/i, ''));
      if (!sub2) { send(401, { msg: 'bad jwt' }); return; }
      send(200, { id: sub2 });
      return;
    }
    if (p.startsWith('/rest/v1/')) {
      if (!service) { send(401, { message: 'service only' }); return; }
      const r = table(p.slice(9), req.method, url.searchParams, body);
      send(r.status || 200, r.json);
      return;
    }
    if (p === '/realtime/v1/api/broadcast') {
      if (!service) { send(401, {}); return; }
      for (const m of body.messages || []) deliver(m.topic, m.payload, null);
      send(202);
      return;
    }
    const obj = p.match(/^\/storage\/v1\/object\/(sign\/|upload\/sign\/|public-fake\/)?ait-content\/(.+)$/);
    if (obj) {
      const kind = obj[1] || '';
      const rel = decodeURIComponent(obj[2]);
      const file = path.join(contentRoot, rel);
      if (!file.startsWith(contentRoot)) { send(400, {}); return; }
      if (kind === 'sign/') { if (!service) { send(401, {}); return; } send(fs.existsSync(file) || uploads.has(rel) ? 200 : 404, { signedURL: `/object/public-fake/ait-content/${obj[2]}?token=t` }); return; }
      if (kind === 'upload/sign/') {
        if (req.method === 'PUT') { uploads.set(rel, raw); send(200, { Key: rel }); return; }
        if (!service) { send(401, {}); return; }
        send(200, { url: `/object/upload/sign/ait-content/${obj[2]}?token=u` });
        return;
      }
      if (kind === '' && !service) { send(401, {}); return; }
      if (req.method === 'POST' && kind === '') { uploads.set(rel, raw); send(200, {}); return; }
      let data = uploads.get(rel) || (fs.existsSync(file) ? fs.readFileSync(file) : null);
      if (!data) { send(404, { error: 'not found' }); return; }
      if (approveAll && rel.endsWith('/lesson.json')) {
        const j = JSON.parse(data.toString('utf8'));
        j.approval = { status: 'approved', by: 'local-test', at: null };
        data = Buffer.from(JSON.stringify(j));
      }
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': rel.endsWith('.webp') ? 'image/webp' : 'application/octet-stream' });
      res.end(data);
      return;
    }
    send(404, { error: `fake: ${p}` });
  }

  return { http, upgrade, db, stats, makeJwt, uploads };
}

module.exports = { createFake, makeJwt };
