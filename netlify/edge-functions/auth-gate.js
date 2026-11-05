// 로그인 게이트: 보호 경로는 정적 파일이 나가기 전에 서버에서 쿠키를 검사한다.
// 쿠키 형식과 키 유도는 netlify/functions/_lib/gate-cookie.js와 같아야 한다.
const COOKIE_NAME = '__Host-dr_gate';
const RANK = { member: 1, teacher: 2 };
const VARIANT_PATH = { teacher: '/_gated/teacher/index.html', member: '/_gated/member/index.html' };
const NOINDEX = 'noindex, nofollow, noarchive';

const encoder = new TextEncoder();
const hmacKey = (raw) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const hmac = async (raw, data) => new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(raw), encoder.encode(data)));
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function serviceKey() {
  return String(globalThis.Netlify?.env?.get('SUPABASE_SERVICE_KEY') || '').trim();
}

export async function verifyCookie(value, secret, now = Date.now()) {
  const [v, payload, sig, extra] = String(value || '').split('.');
  if (v !== 'v1' || !payload || !sig || extra !== undefined || !secret) return null;
  const key = await hmac(encoder.encode(secret), 'dr-gate-cookie-v1');
  const expected = b64url(await hmac(key, payload));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i += 1) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const bin = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (!claims || typeof claims.exp !== 'number' || claims.exp * 1000 <= now || !RANK[claims.tier]) return null;
    return claims;
  } catch {
    return null;
  }
}

function readCookie(req) {
  for (const part of String(req.headers.get('cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === COOKIE_NAME) return part.slice(at + 1).trim();
  }
  return '';
}

// 정적 호스팅이 대소문자·중복 슬래시·인코딩을 정규화해 서빙할 수 있으므로 같은 형태로 맞춘 뒤 비교한다.
export function normalizePath(pathname) {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  return decoded.toLowerCase().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);

// 보호 경로의 필요 등급. null이면 공개.
export function requiredTier(p) {
  if (/^\/_timetable_[^/]*$/.test(p) || under(p, '/_gated/member')) return 'member';
  if (p === '/_school_content.html') return null;
  if (p.startsWith('/_')) return 'teacher';
  if (['/record', '/backward', '/schedule', '/evalplan', '/forms', '/bw-api'].some((d) => under(p, d))) return 'teacher';
  if (p === '/build-emb.html' || p === '/build-emb') return 'teacher';
  if (/^\/data\/(law|curr|neis)_[^/]*$/.test(p)) return 'teacher';
  return null;
}

const GATE_SCRIPT = [
  '(function(){var r=location.pathname+location.search+location.hash,u="/?gate_return="+encodeURIComponent(r);',
  'document.getElementById("go").href=u+"#login";',
  'try{var s=JSON.parse(localStorage.getItem("dr_sess_v1"));',
  'if(s&&s.token&&!sessionStorage.getItem("dr_gate_denied"))location.replace(u);}catch(e){}})();',
].join('');

const GATE_STYLE = [
  'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8faff;color:#1f2937;',
  'font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif;padding:16px;box-sizing:border-box}',
  'main{max-width:420px;width:100%;text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:16px;',
  'padding:36px 24px;box-sizing:border-box;word-break:keep-all}',
  'h1{font-size:1.25rem;margin:0 0 10px}p{margin:0 0 24px;color:#6b7280;line-height:1.7;font-size:.95rem}',
  'a{display:inline-block;padding:11px 22px;background:#2a5298;color:#fff;border-radius:10px;font-weight:700;text-decoration:none}',
  'a:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}',
].join('');

function gateResponse(req, need, status = 401) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': NOINDEX, 'X-Content-Type-Options': 'nosniff' };
  const dest = req.headers.get('sec-fetch-dest');
  const wantsPage = dest === 'document' || (!dest && String(req.headers.get('accept') || '').includes('text/html'));
  if (!wantsPage) {
    return new Response(JSON.stringify({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }), {
      status,
      headers: { ...headers, 'Content-Type': 'application/json; charset=UTF-8' },
    });
  }
  const who = need === 'teacher' ? '승인된 교사 계정으로' : '계정으로';
  const message = status === 503 ? '로그인 확인 설정을 점검하고 있습니다. 잠시 후 다시 시도해 주세요.' : `${who} 로그인하면 바로 열립니다.`;
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<meta name="robots" content="${NOINDEX}"><title>로그인 필요 | 대륜고 사용설명서</title><style>${GATE_STYLE}</style></head>`
    + `<body><main><h1>로그인이 필요합니다</h1><p>${message}</p><a id="go" href="/#login">로그인하고 열기</a></main>`
    + `<script>${GATE_SCRIPT}</script></body></html>`;
  return new Response(html, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=UTF-8' } });
}

async function serveVariant(req, context, tier) {
  // 내부 요청도 다시 이 게이트를 지나므로 쿠키를 그대로 넘긴다.
  const res = await fetch(new URL(VARIANT_PATH[tier], req.url), {
    headers: { cookie: req.headers.get('cookie') || '', accept: 'text/html' },
  });
  if (!res.ok) return context.next();
  const headers = new Headers(res.headers);
  for (const name of ['content-encoding', 'content-length', 'etag', 'age', 'cache-status']) headers.delete(name);
  headers.set('Content-Type', 'text/html; charset=UTF-8');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', NOINDEX);
  return new Response(req.method === 'HEAD' ? null : res.body, { status: 200, headers });
}

export default async function authGate(req, context) {
  const url = new URL(req.url);
  const path = normalizePath(url.pathname);
  if (path === null) return new Response('Bad Request', { status: 400 });

  const secret = serviceKey();
  if (path === '/__auth-gate/health') {
    let selfFetch = 0;
    try { selfFetch = (await fetch(new URL('/robots.txt', req.url))).status; } catch { selfFetch = -1; }
    return new Response(JSON.stringify({ configured: Boolean(secret), selfFetch }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': NOINDEX },
    });
  }

  const isHome = path === '/' || path === '/index.html' || path === '/index';
  const need = requiredTier(path);
  if (!isHome && !need) return context.next();

  const claims = await verifyCookie(readCookie(req), secret);
  if (isHome) {
    if (claims && (req.method === 'GET' || req.method === 'HEAD')) return serveVariant(req, context, claims.tier);
    return context.next();
  }
  if (!secret) return gateResponse(req, need, 503);
  if (!claims) return gateResponse(req, need);
  if (RANK[claims.tier] < RANK[need]) return gateResponse(req, need, 403);

  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', NOINDEX);
  out.headers.set('Cache-Control', 'private, no-cache');
  return out;
}
