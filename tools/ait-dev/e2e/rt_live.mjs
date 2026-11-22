// 실제 Supabase에 익명 로그인 1회와 공개 시험 채널 왕복, 비공개 ait: 채널 거절을 확인한다(서비스 키 불필요).
// 실시간 소켓 규약 실제 시험: 익명 로그인 1회, 공개 시험 채널 주고받기, 비공개 ait: 채널 거절, REST 방송 거절.
import { createSocket, SB_URL, SB_ANON, restBroadcast } from '../../../output/web/ait/js/rt.js';

const results = [];
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` (${d})` : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch(`${SB_URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' }, body: '{"data":{}}' });
const anon = await res.json();
check('anonymous sign-in', res.ok && !!anon.access_token && anon.user?.is_anonymous === true, res.status);
const tok = async () => anon.access_token;

const topic = `rt-test-${Math.random().toString(36).slice(2, 10)}`;
const got = [];
const a = createSocket(tok);
const b = createSocket(tok);
const ca = a.channel(topic, (m) => got.push(['a', m]), { isPrivate: false });
const cb = b.channel(topic, (m) => got.push(['b', m]), { isPrivate: false });
await Promise.all([ca.ready(), cb.ready()]);
check('public join', ca.joined && cb.joined);
ca.send({ hello: 1 });
await wait(1500);
check('b receives a', got.some(([w, m]) => w === 'b' && m.hello === 1), JSON.stringify(got));
check('a does not echo itself', !got.some(([w]) => w === 'a'));

const statuses = [];
const c = createSocket(tok, { onStatus: (s) => statuses.push(s) });
const priv = c.channel(`ait:00000000-0000-0000-0000-000000000000`, () => {});
let denied = false;
try { await priv.ready(); } catch { denied = true; }
check('private ait channel denied for stranger', denied && !priv.joined, statuses.join(','));

let restDenied = false;
try { await restBroadcast(anon.access_token, [{ topic: 'ait:00000000-0000-0000-0000-000000000000', payload: { x: 1 } }]); } catch (e) { restDenied = String(e.message); }
check('REST private broadcast denied for stranger', !!restDenied, restDenied || 'accepted');

a.close(); b.close(); c.close();
console.log(results.join('\n'));
process.exit(0);
