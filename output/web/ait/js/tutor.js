// AI 튜터 칸. 학생에게는 힌트를 한 단계씩, 교사에게는 정답과 해설까지 보여 준다(판단은 서버가 한다).
// 학생은 질문 칸에 이름·연락처를 쓰지 않도록 안내하고, 전화번호·전자우편은 보내기 전에 가린다.
import { el } from './common.js';

const COOLDOWN_MS = 8000;
const LEVEL_NAME = { 1: '되묻기', 2: '개념 짚기', 3: '순서 안내', 4: '닮은 예', 5: '빈칸 남기기' };

const scrub = (t) => String(t || '')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[전자우편 가림]')
  .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호 가림]');

// 답 안의 `코드`와 ```코드 상자```만 서식으로 바꾸고 나머지는 글자로 둔다.
function format(text) {
  const box = el('div', { class: 'tutor-text' });
  const parts = String(text).split(/```(?:\w+)?\n?([\s\S]*?)```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) { box.append(el('pre', {}, part.replace(/\s+$/, ''))); return; }
    const inline = (node, line) => {
      line.split(/(`[^`]+`)/).forEach((seg) => {
        if (/^`[^`]+`$/.test(seg)) node.append(el('code', {}, seg.slice(1, -1)));
        else node.append(document.createTextNode(seg.replace(/\*\*/g, '')));
      });
      return node;
    };
    let ul = null;
    for (const line of part.split('\n')) {
      const t = line.trim();
      if (!t) { ul = null; continue; }
      const item = t.match(/^(?:[*-]|\d+\.)\s+(.*)$/);
      if (item) {
        if (!ul) { ul = el('ul'); box.append(ul); }
        ul.append(inline(el('li'), item[1]));
      } else {
        ul = null;
        box.append(inline(el('p'), t));
      }
    }
  });
  return box;
}

export function createTutorPanel(container, { role = 'student', getContext, onExchange, isBlocked, getToken }) {
  let thread = []; // { who: 'student' | 'tutor', text }
  let level = 1;
  let busy = false;
  let lastAsk = 0;

  const list = el('ol', { class: 'tutor-list', 'aria-live': 'polite' });
  const input = el('textarea', { class: 'tutor-input', rows: '3', maxlength: '500', 'aria-label': '튜터에게 질문' });
  input.placeholder = role === 'teacher' ? '예: 26장 생각해 보기의 정답과 해설을 정리해 줘' : '예: 과적합이 왜 문제인지 모르겠어요';
  const sendBtn = el('button', { type: 'button', class: 'btn-sm' }, '보내기');
  const moreBtn = el('button', { type: 'button', class: 'btn-ghost btn-sm', hidden: role === 'teacher' }, '힌트 더 받기');
  const newBtn = el('button', { type: 'button', class: 'btn-ghost btn-sm' }, '새 질문');
  const status = el('p', { class: 'tutor-status', 'aria-live': 'polite' });
  const where = el('p', { class: 'tutor-where' });
  const quick = role === 'teacher'
    ? ['이 장의 핵심을 세 줄로 정리해 줘', '이 장으로 확인 문항 3개를 만들어 줘', '학생이 자주 헷갈릴 부분은?']
    : ['이 장이 무슨 뜻인지 모르겠어요', '이 오류가 왜 났나요?', '어디서부터 생각하면 될까요?'];
  const chips = el('div', { class: 'tutor-quick' }, ...quick.map((q) => el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => { input.value = q; send(); } }, q)));

  container.replaceChildren(
    el('div', { class: 'tutor-head' },
      el('img', { src: role === 'teacher' ? '/img/teacher/idea.webp' : '/img/daeryuni/face_thinking.webp', alt: '' }),
      el('div', {},
        el('h2', {}, role === 'teacher' ? 'AI 튜터 (교사용: 정답과 해설 포함)' : 'AI 튜터'),
        el('p', { class: 'hint' }, role === 'teacher' ? '정답, 해설, 완성 코드, 문항 초안까지 답합니다. AI의 답은 초안이므로 확인한 뒤 쓰세요.' : '정답 대신 스스로 풀 수 있게 힌트를 드립니다. 다시 물을수록 힌트가 쉬워집니다.'))),
    where,
    list,
    chips,
    input,
    el('div', { class: 'tutor-actions' }, newBtn, moreBtn, el('span', { class: 'grow' }), sendBtn),
    status,
    el('p', { class: 'hint tutor-privacy' }, role === 'teacher' ? '질문은 EdTouch 서버를 거쳐 Anthropic(Claude)으로 보내 처리합니다. 연결되지 않으면 Google Gemini가 대신 답합니다.' : '질문은 AI 서비스(Anthropic Claude, 연결되지 않으면 Google Gemini)로 보내 답을 만듭니다. 이름이나 연락처는 쓰지 마세요.'),
  );

  const paintWhere = () => {
    const c = getContext();
    where.textContent = [`${c.slideN}장 ${c.slideTitle || ''}`.trim(), c.page ? `교과서 ${c.page}쪽` : '', c.cell ? `실습 셀 ${c.cell.n}${c.cell.error ? ' (오류 있음)' : ''}` : ''].filter(Boolean).join(' · ');
  };

  function add(who, text, extra) {
    thread.push({ who, text });
    const item = el('li', { class: `tutor-msg ${who}` },
      who === 'tutor' ? el('img', { src: role === 'teacher' ? '/img/teacher/thinking.webp' : '/img/daeryuni/face_smile.webp', alt: '' }) : null,
      el('div', { class: 'tutor-bubble' }, extra ? el('span', { class: 'tutor-level' }, extra) : null, who === 'tutor' ? format(text) : el('p', {}, text)));
    list.append(item);
    item.scrollIntoView({ block: 'nearest' });
  }

  async function send(more = false) {
    if (busy) return;
    const blocked = isBlocked && isBlocked();
    if (blocked) { status.textContent = blocked; return; }
    const wait = COOLDOWN_MS - (Date.now() - lastAsk);
    if (role === 'student' && wait > 0) { status.textContent = `${Math.ceil(wait / 1000)}초 뒤에 다시 물을 수 있습니다.`; return; }
    let question = scrub(input.value.trim());
    if (more) question = '조금 더 쉬운 힌트를 주세요.';
    if (!question) { input.focus(); return; }
    if (role === 'student' && thread.some((m) => m.who === 'student')) level = Math.min(5, level + 1);
    busy = true;
    lastAsk = Date.now();
    sendBtn.disabled = true;
    moreBtn.disabled = true;
    add('student', question);
    input.value = '';
    status.textContent = '튜터가 생각하는 중입니다.';
    const context = getContext();
    try {
      // 교사 질문에는 세션 토큰을 붙인다. 서버 AI(Claude)가 승인 교사인지 확인하는 데만 쓴다.
      const token = getToken ? await getToken().catch(() => null) : null;
      const res = await fetch('/ait-api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ role, question, level, context, history: thread.slice(0, -1).slice(-6) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '튜터가 답하지 못했습니다. 잠시 뒤 다시 물어보세요.');
      add('tutor', data.answer, role === 'student' ? `힌트 ${data.level}단계 · ${LEVEL_NAME[data.level]}` : null);
      status.textContent = role === 'teacher' && data.via ? (data.via === 'claude' ? 'Claude가 답했습니다.' : 'Claude에 연결하지 못해 Gemini가 답했습니다.') : '';
      onExchange && onExchange({ question, answer: data.answer, level: data.level, flagged: !!data.flagged, context });
    } catch (e) {
      thread.pop();
      list.lastChild?.remove();
      input.value = question === '조금 더 쉬운 힌트를 주세요.' ? '' : question;
      status.textContent = e.message;
      if (role === 'student' && level > 1 && thread.some((m) => m.who === 'student')) level -= 1;
    } finally {
      busy = false;
      sendBtn.disabled = false;
      moreBtn.disabled = false;
    }
  }

  sendBtn.addEventListener('click', () => send());
  moreBtn.addEventListener('click', () => send(true));
  newBtn.addEventListener('click', () => { thread = []; level = 1; list.replaceChildren(); status.textContent = '새 질문을 시작합니다.'; input.focus(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  paintWhere();
  return { refresh: paintWhere, focus: () => input.focus() };
}
