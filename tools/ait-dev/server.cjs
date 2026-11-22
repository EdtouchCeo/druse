// Dave AIT Class 로컬 미리보기 서버: output/web을 보여 주고, /ait-api/tutor를 튜터 서버 함수로 잇는다.
// 사용: node tools/ait-dev/server.cjs [포트]
//   AIT_ENV_FILE=<.env 경로>  : GEMINI_API_KEY 등을 읽을 파일(값은 화면에 출력하지 않는다)
// 로컬 전용이므로 127.0.0.1에서만 열고, 교사 확인은 건너뛴다(AIT_DEV_TEACHER=1).
//   AIT_FAKE_SB=1 : 가짜 Supabase(fake-supabase.cjs)를 함께 띄워 서버 연결(수업 방·중계·자료·튜터 방 확인)을 끝까지 시험한다.
//                   브라우저에서 localStorage.ait_fake_sb = '1'을 넣어야 화면이 이 연결을 쓴다. 이때는 교사 확인을 건너뛰지 않는다.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../output/web');
const PORT = Number(process.argv[2] || 8765);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.csv': 'text/csv; charset=utf-8' };

if (process.env.AIT_ENV_FILE && fs.existsSync(process.env.AIT_ENV_FILE)) {
  for (const line of fs.readFileSync(process.env.AIT_ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const FAKE = process.env.AIT_FAKE_SB === '1';
let fake = null;
if (FAKE) {
  process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}/fake-sb`;
  process.env.SUPABASE_SERVICE_KEY = 'dev-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  fake = require('./fake-supabase.cjs').createFake({ contentRoot: path.join(ROOT, 'ait', 'content'), serviceKey: 'dev-service-key', approveAll: true });
} else {
  process.env.AIT_DEV_TEACHER = '1';
}
const tutor = require('../../netlify/functions/ait-tutor.js');
const FUNCTIONS = FAKE ? {
  room: require('../../netlify/functions/ait-room.js'),
  relay: require('../../netlify/functions/ait-relay.js'),
  upload: require('../../netlify/functions/ait-upload.js'),
  asset: require('../../netlify/functions/ait-asset.js'),
} : {};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (fake && url.pathname === '/fake-sb/__state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ db: fake.db, stats: fake.stats, uploads: [...fake.uploads.keys()] }));
    return;
  }
  if (fake && url.pathname.startsWith('/fake-sb/')) { await fake.http(req, res, req.url.slice('/fake-sb'.length)); return; }
  const fn = url.pathname === '/ait-api/tutor' ? tutor
    : url.pathname.startsWith('/ait-api/asset/') ? FUNCTIONS.asset
      : FUNCTIONS[url.pathname.replace('/ait-api/', '')];
  if (url.pathname.startsWith('/ait-api/') && fn) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const out = await fn.handler({ httpMethod: req.method, headers: req.headers, body, path: url.pathname });
    res.writeHead(out.statusCode, out.headers || {});
    res.end(out.body);
    return;
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('찾을 수 없습니다'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
if (fake) server.on('upgrade', (req, socket) => { if (req.url.startsWith('/fake-sb/realtime/v1/websocket')) fake.upgrade(req, socket); else socket.destroy(); });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dave AIT Class 미리보기: http://127.0.0.1:${PORT}/ait/  (튜터 열쇠 ${process.env.GEMINI_API_KEY ? '있음' : '없음'}${FAKE ? ', 가짜 Supabase 켜짐' : ''})`);
});
