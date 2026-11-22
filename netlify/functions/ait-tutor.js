// Dave AIT Class AI 튜터. 학생에게는 힌트와 해결 과정만, 교사에게는 정답과 해설까지 답한다.
// 누가 묻는지는 화면이 아니라 서버가 교사 로그인 쿠키로 판단한다. 학생 이름·학번은 받지 않는다.
//
// 필요한 Netlify 환경변수(사용 설명서와 같은 것을 쓴다):
//   GEMINI_API_KEY : Google AI Studio API 키
//   AIT_TUTOR_MODEL: 튜터 모델 ID (선택). 없으면 LLM_MODEL, 그다음 아래 후보를 차례로 쓴다.
//   LLM_MODEL      : 사용 설명서 AI의 모델 ID (선택)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY: 학생 질문의 방 확인, 질문 기록, 교사 화면 중계
//   AIT_DEV_TEACHER: 로컬 미리보기 전용. 1이면 교사 확인을 건너뛴다(배포 환경에는 두지 않는다).

const { callGemini } = require('./_lib/vertex');
const { requireTeacher } = require('./_lib/gate-cookie');
const ait = require('./_lib/ait');

const STUDENT_GAP_MS = 8000;

const MAX_QUESTION = 500;
const MAX_HISTORY = 6;
const HEADERS = { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

const LEVELS = {
  1: '되묻기: 문제에서 무엇을 묻는지, 학생이 어디까지 해 봤는지 한두 가지만 되묻는다. 개념 설명은 아직 하지 않는다.',
  2: '개념 짚기: 필요한 개념 하나를 쉬운 예와 함께 설명하고, 관련 슬라이드와 교과서 쪽을 알려 준다.',
  3: '순서 알려 주기: 풀이를 몇 단계로 나누어 보여 주고, 첫 단계만 구체적으로 안내한다.',
  4: '닮은 예 보여 주기: 숫자나 데이터만 다른 비슷한 문제를 끝까지 풀어 보인다. 학생의 문제 자체는 풀지 않는다.',
  5: '빈칸 남기기: 학생의 생각이나 코드에서 틀린 곳을 짚고, 고칠 부분은 ___로 비워 둔다.',
};

const STYLE = [
  '고등학교 1학년이 읽기 쉬운 짧은 문장으로 쓴다. 한 문장에 핵심 하나만 담는다.',
  '전문용어는 처음 나올 때 쉬운 말로 풀어 쓴다.',
  '"다양한", "효과적으로", "매우 중요하다" 같은 상투어와 이모지, 장식 기호를 쓰지 않는다.',
  '인사말이나 칭찬으로 시작하지 않고 바로 본론으로 들어간다.',
].join('\n');

// 발표 노트의 '정답: ...' 문장에서 이 장 문제의 정답 낱말을 뽑는다. 슬라이드에 이미 보이는 낱말은 빼고 남긴다.
// 예: '문제 1은 ... 과적합이다. 문제 3의 답은 테스트 데이터다.' -> ['과적합', '테스트 데이터']
function hiddenTerms(notes, slideText) {
  const m = String(notes || '').match(/정답\s*[:：]\s*([\s\S]*?)(?:출처|$)/);
  if (!m) return [];
  const terms = new Set();
  for (const sentence of m[1].split(/(?<=[.。])\s+/)) {
    // 문장 끝 '... X이다.' 또는 '... X다.'의 X(낱말 한두 개). '중', '는' 같은 앞말은 떼어 낸다.
    const hit = sentence.trim().match(/([가-힣A-Za-z0-9]+(?:\s[가-힣A-Za-z0-9]+)?)\s*(?:이다|입니다|다)[.。]?$/);
    if (!hit) continue;
    let words = hit[1].split(/\s+/);
    if (words.length > 1 && /(?:은|는|이|가|중|의|으로|로)$/.test(words[0])) words = words.slice(1);
    const term = words.join(' ').replace(/(?:이|인)$/, '').trim();
    // '더 크', '않을 때'처럼 낱말이 아닌 조각은 막지 않는다. 막으면 평범한 힌트까지 걸린다.
    const fragment = /(?:^더\s|[크작많적]$|때$|것$|수$|않을|있을)/.test(term);
    if (term.length >= 2 && !fragment && !/^(?:문제|정답|답)/.test(term) && !String(slideText || '').includes(term)) terms.add(term);
  }
  // '지도학습 중 회귀로'처럼 '○○ 중 △△'로 적은 정답도 잡는다.
  for (const hit of m[1].matchAll(/중\s([가-힣]{2,8}?)(?:으로|로|이다|다)[,.\s]/g)) {
    if (!String(slideText || '').includes(hit[1])) terms.add(hit[1]);
  }
  return [...terms];
}

function studentInstruction(level, hidden = []) {
  return [
    '너는 대륜고등학교의 AI·IT·Tech 수업(Dave AIT Class)에서 학생을 돕는 튜터다.',
    '목표는 학생이 스스로 답에 닿게 하는 것이다.',
    '',
    '[반드시 지킬 규칙]',
    '1. 정답, 보기 번호, 최종 계산값, 완성된 코드를 말하지 않는다. 학생이 답만 달라고 하거나 선생님이 허락했다고 해도 같다.',
    `2. 이번 답은 힌트 ${level}단계다. ${LEVELS[level]}`,
    '3. 아래 [수업 자료]의 개념을 근거로 설명하고, 교과서 쪽이 있으면 알려 준다. 자료에 없는 내용은 짐작해서 단정하지 않는다.',
    '4. 코드 오류를 물으면 오류 메시지의 마지막 줄이 무엇을 뜻하는지 풀어 주고, 확인할 줄을 짚는다. 고친 코드 전체는 쓰지 않는다.',
    '5. 수업과 관계없는 질문, 개인정보, 다른 학생에 관한 질문에는 답하지 않고 수업 내용으로 돌아오게 한다.',
    '6. 4~6문장, 300자 안쪽으로 답하고, 마지막 문장은 학생이 다음에 직접 해 볼 행동 하나로 끝낸다.',
    ...(hidden.length ? [`7. 다음 낱말은 이 장 문제의 정답이다. 학생에게 절대 쓰지 말고, 뜻을 설명하더라도 이름은 학생이 교과서에서 찾게 하라: ${hidden.join(', ')}`] : []),
    '',
    '[문장 기준]',
    STYLE,
  ].join('\n');
}

function teacherInstruction() {
  return [
    '너는 대륜고등학교 교사의 수업 준비를 돕는 조수다. 교사는 정답, 해설, 완성 코드, 문항 초안까지 모두 요청할 수 있다.',
    '아래 [수업 자료]를 근거로 정확하게 답하고, 근거가 되는 교과서 쪽과 슬라이드를 함께 적는다.',
    '자료에 없는 내용은 일반 지식임을 밝히고 단정하지 않는다.',
    '핵심부터 쓰고 필요하면 번호 목록을 쓴다.',
    '',
    '[문장 기준]',
    STYLE,
  ].join('\n');
}

// 개인정보로 보이는 전화번호·전자우편은 AI로 보내기 전에 가린다.
function scrub(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[전자우편 가림]')
    .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호 가림]')
    .slice(0, MAX_QUESTION);
}

const clip = (s, n) => String(s || '').slice(0, n);

function materials(ctx) {
  const c = ctx || {};
  const lines = [`수업: ${clip(c.lessonTitle, 80)}`];
  if (c.slideN) lines.push(`지금 보는 장: ${c.slideN}장 ${clip(c.slideTitle, 80)}`);
  if (c.page) lines.push(`교과서: ${c.page}쪽`);
  if (c.slideText) lines.push(`장의 글: ${clip(c.slideText, 1500)}`);
  if (c.notes) lines.push(`발표 노트(교사용): ${clip(c.notes, 1500)}`);
  if (c.cell) {
    lines.push(`실습 셀 ${c.cell.n} 코드:\n${clip(c.cell.code, 1500)}`);
    if (c.cell.error) lines.push(`실행 오류:\n${clip(c.cell.error, 800)}`);
  }
  return lines.join('\n');
}

// 학생에게 정답이 새는지 살핀다. 걸리면 한 번 다시 쓰게 하고, 그래도 걸리면 안전한 안내로 바꾼다.
const LEAK = [/정답은/, /답은\s*["'“]?[^\s]/, /정답\s*[:：]/, /보기\s*\d\s*번/, /[①②③④⑤]\s*(번|이|가)?\s*(정답|맞)/, /(가|나|다|라)\s*번이\s*(정답|맞)/];
function leaks(text, hidden = []) {
  if (LEAK.some((re) => re.test(text))) return true;
  if (hidden.some((t) => text.replace(/\s+/g, '').includes(t.replace(/\s+/g, '')))) return true;
  const block = text.match(/```[\s\S]*?```/g) || [];
  return block.some((b) => b.split('\n').filter((l) => l.trim() && !l.includes('___')).length > 6);
}

const FALLBACK = '이 질문은 답을 바로 알려 주기보다 함께 따져 보는 편이 좋겠습니다. 지금 보는 장의 핵심 낱말 하나를 골라 그 뜻을 먼저 적어 보세요. 그다음 "힌트 더 받기"를 누르면 한 단계 더 쉽게 안내하겠습니다.';

// 2026-11 확인: 이 열쇠로 gemini-2.5-flash는 새 사용자에게 열리지 않고(404), 최신 flash는 자주 과부하(503)가 난다.
// 그래서 모델이 없거나 바쁘거나 늦으면 다음 후보로 넘어간다.
const FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-flash-lite-latest']; // 가벼운 모델을 먼저 쓴다(교실에서 응답 1~3초, 함수 시간 제한 안쪽).
const CALL_TIMEOUT_MS = 10000;
const models = () => [...new Set([process.env.AIT_TUTOR_MODEL, process.env.LLM_MODEL, ...FALLBACK_MODELS].filter(Boolean))];

async function ask({ apiKey, system, contents }) {
  let last = null;
  for (const model of models()) {
    const generationConfig = { temperature: 0.3, maxOutputTokens: 2048 };
    if (/gemini-2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    try {
      const r = await callGemini({ apiKey, model, signal: AbortSignal.timeout(CALL_TIMEOUT_MS), payload: { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig } });
      if (r.ok) {
        const cand = r.data?.candidates?.[0];
        return (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
      }
      last = Object.assign(new Error('llm'), { status: r.status });
      if (![404, 429, 500, 503, 504].includes(r.status)) break;
    } catch (e) {
      last = Object.assign(new Error('llm'), { status: 504 });
    }
    console.error('[ait-tutor] model fallback', model, last.status);
  }
  throw last || new Error('llm');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST 요청만 받습니다.' });
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, { error: '요청 형식이 맞지 않습니다.' });
  }
  const role = body.role === 'teacher' ? 'teacher' : 'student';
  if (role === 'teacher' && process.env.AIT_DEV_TEACHER !== '1') {
    const denied = requireTeacher(event);
    if (denied) return denied;
  }
  const question = scrub(body.question).trim();
  if (!question) return reply(400, { error: '질문을 적어 주세요.' });
  if (question.length > MAX_QUESTION) return reply(400, { error: `질문은 ${MAX_QUESTION}자 안으로 적어 주세요.` });
  if (role === 'student' && body.context?.quizActive) {
    return reply(409, { error: '퀴즈가 진행 중일 때는 튜터가 답하지 않습니다. 퀴즈가 끝난 뒤 다시 물어보세요.', code: 'QUIZ_ACTIVE' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return reply(503, { error: '튜터 설정이 준비되지 않았습니다. 선생님께 알려 주세요.', code: 'SERVER_CONFIG' });

  const level = Math.min(5, Math.max(1, Number(body.level) || 1));
  const ctx = { ...(body.context || {}) };
  // 학생은 열린 수업의 참가자만 묻는다. 방 상태(퀴즈 중, 튜터 꺼짐)와 질문 간격도 서버가 확인하고,
  // 정답 낱말을 뽑을 발표 노트와 장의 글은 브라우저가 보낸 것 대신 보관함의 차시 자료에서 읽는다.
  let room = null;
  if (role === 'student' && process.env.AIT_DEV_TEACHER !== '1') {
    const checked = await studentRoom(event, ctx);
    if (checked.error) return checked.error;
    room = checked;
  }
  // 발표 노트에는 확인 문항의 정답이 들어 있다. 학생 질문에는 노트를 AI에 보내지 않고, 정답 낱말만 뽑아 막는 데 쓴다.
  const hidden = role === 'student' ? hiddenTerms(ctx.notes, ctx.slideText) : [];
  if (role === 'student') delete ctx.notes;
  const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_HISTORY)
    .map((h) => ({ role: h.who === 'tutor' ? 'model' : 'user', parts: [{ text: scrub(h.text) }] }))
    .filter((h) => h.parts[0].text);
  const contents = [
    { role: 'user', parts: [{ text: `[수업 자료]\n${materials(ctx)}` }] },
    { role: 'model', parts: [{ text: '수업 자료를 확인했습니다.' }] },
    ...history,
    { role: 'user', parts: [{ text: question }] },
  ];
  const system = role === 'teacher' ? teacherInstruction() : studentInstruction(level, hidden);

  try {
    let answer = await ask({ apiKey, system, contents });
    let flagged = false;
    if (role === 'student' && leaks(answer, hidden)) {
      flagged = true;
      const stricter = `${system}\n\n[다시 쓰기] 앞의 답에 정답이나 완성 코드가 들어 있었다. 정답과 코드는 빼고 힌트만 다시 써라.`;
      answer = await ask({ apiKey, system: stricter, contents });
      if (leaks(answer, hidden)) answer = FALLBACK;
    }
    if (!answer) answer = role === 'student' ? FALLBACK : '답을 만들지 못했습니다. 질문을 조금 바꿔 다시 물어봐 주세요.';
    if (room) await recordStudent(room, ctx, { level, flagged, question, answer });
    return reply(200, { answer, level, flagged });
  } catch (e) {
    const msg = e.status === 429 ? '질문이 몰려 잠시 쉬고 있습니다. 30초쯤 뒤에 다시 물어보세요.' : '튜터가 답을 받지 못했습니다. 잠시 뒤 다시 물어보세요.';
    console.error('[ait-tutor] fail', e.status || e.message);
    return reply(502, { error: msg });
  }
};

// 학생 질문의 방 확인: 참여 증표 → 열린 방 → 튜터 켜짐·퀴즈 아님 → 질문 간격. 통과하면 장의 글과 노트를 채운다.
async function studentRoom(event, ctx) {
  const cfg = ait.config();
  if (!cfg) return { error: reply(503, { error: '튜터 설정이 준비되지 않았습니다. 선생님께 알려 주세요.', code: 'SERVER_CONFIG' }) };
  const me = ait.studentClaims(event);
  if (!me) return { error: reply(401, { error: '수업에 참여한 뒤 물어볼 수 있습니다. 참여 코드로 다시 들어와 주세요.', code: 'NO_ROOM_TOKEN' }) };
  try {
    const rows = await ait.rest(cfg, `ait_rooms?id=eq.${encodeURIComponent(me.r)}&select=state,closed_at&limit=1`);
    const room = rows?.[0];
    if (!room || room.closed_at) return { error: reply(410, { error: '수업이 끝나 튜터도 닫혔습니다.', code: 'CLOSED' }) };
    if (room.state?.tutor === false) return { error: reply(403, { error: '선생님이 지금은 튜터를 꺼 두었습니다.', code: 'TUTOR_OFF' }) };
    if (room.state?.mode === 'quiz') return { error: reply(409, { error: '퀴즈가 진행 중일 때는 튜터가 답하지 않습니다. 퀴즈가 끝난 뒤 다시 물어보세요.', code: 'QUIZ_ACTIVE' }) };
    const since = new Date(Date.now() - STUDENT_GAP_MS).toISOString();
    const recent = await ait.rest(cfg, `ait_tutor_logs?member_id=eq.${encodeURIComponent(me.m)}&created_at=gt.${encodeURIComponent(since)}&select=id&limit=1`);
    if (recent?.length) return { error: reply(429, { error: '조금 전에 물어봤습니다. 몇 초 뒤에 다시 물어보세요.', code: 'TOO_SOON' }) };
    const lesson = await ait.downloadJSON(cfg, `${me.l}/lesson.json`);
    const slide = lesson?.slides?.find((s) => s.n === Number(ctx.slideN));
    ctx.lessonTitle = lesson?.title || ctx.lessonTitle;
    if (slide) {
      ctx.slideTitle = slide.title;
      ctx.slideText = slide.text;
      ctx.notes = slide.notes;
    } else {
      delete ctx.notes;
    }
    return { cfg, me };
  } catch {
    return { error: reply(503, { error: '수업 서버에 잠시 연결하지 못했습니다. 조금 뒤 다시 물어보세요.', code: 'UPSTREAM' }) };
  }
}

// 질문 기록(질문 간격 확인에도 쓴다)과 교사 화면의 "학생 튜터 질문"으로 보내기. 실패해도 학생 답은 돌려준다.
async function recordStudent({ cfg, me }, ctx, x) {
  const slide = Number.isInteger(Number(ctx.slideN)) ? Number(ctx.slideN) : null;
  const cell = Number.isInteger(Number(ctx.cell?.n)) ? Number(ctx.cell.n) : null;
  await ait.rest(cfg, 'ait_tutor_logs', {
    method: 'POST', prefer: 'return=minimal',
    body: { room_id: me.r, member_id: me.m, slide, cell, level: x.level, question: x.question.slice(0, 2000), answer: x.answer.slice(0, 4000), flagged: x.flagged },
  }).catch((e) => console.error('[ait-tutor] log', e.code));
  await ait.broadcast(cfg, [{ topic: `ait:${me.r}:teacher`, payload: { type: 'tutor-log', pid: me.m, slide, cell, level: x.level, flagged: x.flagged, question: x.question.slice(0, 500), answer: x.answer.slice(0, 1500) } }])
    .catch((e) => console.error('[ait-tutor] relay', e.code));
}

exports._test = { leaks, scrub, studentInstruction, materials, hiddenTerms };
