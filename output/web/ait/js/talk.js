// 실시간 의견 나눔. 교사가 주제를 열면 학생이 댓글을 올리고 서로 답하며 공감한다.
// 교사 진행 화면이 모든 글을 받아 거르고 번호를 붙인 뒤 학생 화면과 발표 화면에 나눠 준다(서버를 붙이면 이 역할을 서버로 옮긴다).
import { el } from './common.js';
import { checkText, autoName, validName } from './filter.js';

const POST_GAP_MS = 5000;
const MAX_TEXT = 200;
const SHOW_MAX = 150;

const iso = (d) => (d ? new Date(d).toISOString() : '');
const hhmm = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csv = (rows) => {
  const cols = Object.keys(rows[0] || {});
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return `﻿${[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n')}`;
};

// 교사 쪽 엔진
export function createTalkHost({ lesson, room, present, onChange, getSlide, tutorLog }) {
  const key = `ait_talk_topics_${lesson.id}`;
  let topics = [];
  try { topics = JSON.parse(localStorage.getItem(key)) || []; } catch { topics = []; }
  topics = topics.map((t) => ({ ...t, openedAt: null, closedAt: null }));
  const messages = []; // 모든 주제의 글(걸린 글 포함)
  const people = new Map();
  const lastPost = new Map();
  let nextNo = 1;
  let nextMsg = 1;
  let open = false;
  let topicId = null;
  let spotlight = null;
  let className = localStorage.getItem('ait_talk_class') || '';

  const save = () => localStorage.setItem(key, JSON.stringify(topics.map(({ id, text, slide }) => ({ id, text, slide }))));
  const topic = () => topics.find((t) => t.id === topicId) || null;
  const person = (pid, name) => {
    let p = people.get(pid);
    if (!p) {
      p = { pid, no: nextNo, name: autoName(nextNo), locked: false, blocked: false, firstAt: null };
      nextNo += 1;
      people.set(pid, p);
    }
    const checked = validName(name);
    if (!p.locked && checked.ok && checked.name) p.name = checked.name;
    return p;
  };

  function snapshot() {
    const t = topic();
    const shown = messages.filter((m) => m.topicId === topicId && !m.filtered && !m.deleted).slice(-SHOW_MAX);
    const pub = (m) => ({ id: m.id, no: people.get(m.pid)?.no, name: people.get(m.pid)?.name, text: m.text, replyTo: m.replyTo, at: m.at, likes: m.likes.size });
    return {
      open, topic: t ? { id: t.id, text: t.text, slide: t.slide } : null,
      messages: shown.map(pub),
      spotlight: spotlight && shown.find((m) => m.id === spotlight) ? pub(shown.find((m) => m.id === spotlight)) : null,
    };
  }

  function publish() {
    const snap = snapshot();
    room?.send({ type: 'talk', snap });
    present({ type: 'talk', snap });
    onChange();
  }

  function handle(msg) {
    if (!msg || typeof msg.pid !== 'string') return;
    if (msg.type === 'hello') { room.send({ type: 'talk', snap: snapshot() }); return; }
    if (msg.type === 'talk-like') {
      const m = messages.find((x) => x.id === msg.id && !x.deleted);
      if (!m || !open) return;
      if (m.likes.has(msg.pid)) m.likes.delete(msg.pid); else m.likes.add(msg.pid);
      publish();
      return;
    }
    if (msg.type !== 'talk-post') return;
    const reject = (reason) => room.send({ type: 'talk-reject', pid: msg.pid, reason });
    const p = person(msg.pid, msg.name);
    if (!open || !topicId) { reject('선생님이 댓글창을 닫았습니다. 지금은 읽기만 할 수 있습니다.'); return; }
    if (p.blocked) { reject('선생님이 이 기기의 댓글 쓰기를 멈췄습니다.'); return; }
    const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!text) return;
    const gap = Date.now() - (lastPost.get(msg.pid) || 0);
    if (gap < POST_GAP_MS) { reject(`${Math.ceil((POST_GAP_MS - gap) / 1000)}초 뒤에 다시 올릴 수 있습니다.`); return; }
    lastPost.set(msg.pid, Date.now());
    const filtered = !checkText(text).ok;
    const replyTo = messages.some((m) => m.id === msg.replyTo && m.topicId === topicId) ? msg.replyTo : null;
    messages.push({ id: nextMsg, topicId, pid: msg.pid, text, replyTo, at: Date.now(), likes: new Set(), filtered, deleted: false, slide: getSlide() });
    nextMsg += 1;
    p.firstAt = p.firstAt || Date.now();
    room.send({ type: 'talk-name', pid: p.pid, name: p.name, no: p.no, locked: p.locked });
    if (filtered) { reject('바른 말로 다시 써 주세요. 이 글은 다른 친구들에게 보이지 않습니다.'); onChange(); return; }
    publish();
  }

  // 교사 조작
  const api = {
    get open() { return open; },
    get topicId() { return topicId; },
    get className() { return className; },
    setClass(v) { className = v.slice(0, 20); localStorage.setItem('ait_talk_class', className); },
    topics: () => topics,
    feed: () => messages.filter((m) => m.topicId === topicId && !m.deleted && !m.filtered),
    filteredCount: () => messages.filter((m) => m.topicId === topicId && m.filtered).length,
    filteredList: () => messages.filter((m) => m.topicId === topicId && m.filtered),
    person: (pid) => people.get(pid),
    spotlight: () => spotlight,
    addTopic(text, slide) {
      const t = { id: `t${Date.now().toString(36)}`, text: text.trim().slice(0, 140), slide: slide || null, openedAt: null, closedAt: null };
      if (!t.text) return;
      topics.push(t);
      save();
      onChange();
    },
    removeTopic(id) {
      if (id === topicId && open) return;
      topics = topics.filter((t) => t.id !== id);
      save();
      onChange();
    },
    openTopic(id) {
      const prev = topic();
      if (prev && open && prev.id !== id) prev.closedAt = Date.now();
      topicId = id;
      const t = topic();
      t.openedAt = t.openedAt || Date.now();
      t.closedAt = null;
      open = true;
      spotlight = null;
      publish();
    },
    close() {
      const t = topic();
      if (t) t.closedAt = Date.now();
      open = false;
      publish();
    },
    reopen() { if (topic()) { open = true; topic().closedAt = null; publish(); } },
    remove(id) { const m = messages.find((x) => x.id === id); if (m) { m.deleted = true; if (spotlight === id) spotlight = null; publish(); } },
    block(pid) { const p = people.get(pid); if (p) { p.blocked = !p.blocked; room.send({ type: 'talk-reject', pid, reason: p.blocked ? '선생님이 이 기기의 댓글 쓰기를 멈췄습니다.' : '다시 댓글을 쓸 수 있습니다.' }); onChange(); } },
    resetName(pid) {
      const p = people.get(pid);
      if (!p) return;
      p.name = autoName(p.no);
      p.locked = true;
      room.send({ type: 'talk-name', pid, name: p.name, no: p.no, locked: true, reset: true });
      publish();
    },
    toggleSpotlight(id) { spotlight = spotlight === id ? null : id; publish(); },
    publish,
    handle,
    // 대화 기록 내려받기: 한 줄이 댓글 한 건인 표. 대화명을 빼면 참가자 번호만 남는다.
    exportFiles(anonymous) {
      const date = new Date().toISOString().slice(0, 10);
      const nameOf = (pid) => (anonymous ? '' : people.get(pid)?.name || '');
      const tIndex = new Map(topics.map((t, i) => [t.id, i + 1]));
      const msgs = messages.map((m) => {
        const t = topics.find((x) => x.id === m.topicId);
        return {
          수업일자: date, 반: className, 차시: lesson.id, 주제번호: tIndex.get(m.topicId) || '', 장번호: m.slide || '', 댓글번호: m.id, 답한댓글번호: m.replyTo || '',
          참가자번호: people.get(m.pid)?.no, 대화명: nameOf(m.pid), 보낸시각: iso(m.at), 주제를연뒤지난초: t?.openedAt ? Math.round((m.at - t.openedAt) / 1000) : '',
          본문: m.text, 글자수: m.text.length, 공감수: m.likes.size, 걸러짐여부: m.filtered ? 1 : 0, 교사삭제여부: m.deleted ? 1 : 0,
        };
      });
      const tops = topics.filter((t) => t.openedAt).map((t) => {
        const own = messages.filter((m) => m.topicId === t.id && !m.filtered);
        return { 수업일자: date, 반: className, 차시: lesson.id, 주제번호: tIndex.get(t.id), 주제문장: t.text, 묶인장: t.slide || '', 연시각: iso(t.openedAt), 닫은시각: iso(t.closedAt), 댓글수: own.length, 참여학생수: new Set(own.map((m) => m.pid)).size };
      });
      const parts = [...people.values()].map((p) => {
        const own = messages.filter((m) => m.pid === p.pid);
        return { 수업일자: date, 반: className, 차시: lesson.id, 참가자번호: p.no, 대화명: anonymous ? '' : p.name, 처음글쓴시각: iso(p.firstAt), 댓글수: own.filter((m) => !m.filtered).length, 걸린글수: own.filter((m) => m.filtered).length, 받은공감수: own.reduce((s, m) => s + m.likes.size, 0), 막힘여부: p.blocked ? 1 : 0 };
      });
      const tutor = tutorLog().map((t) => ({ 수업일자: date, 반: className, 차시: lesson.id, 참가자번호: people.get(t.pid)?.no || '', 장번호: t.slide, 실습셀: t.cell || '', 힌트단계: t.level, 질문: t.question, 답: t.answer, 다시쓰기여부: t.flagged ? 1 : 0, 시각: iso(t.at) }));
      const tag = `${lesson.lesson}_${date}`;
      const files = [['messages', msgs], ['topics', tops], ['participants', parts], ['tutor_questions', tutor]];
      for (const [name, rows] of files) if (rows.length) download(`${name}_${tag}.csv`, csv(rows), 'text/csv;charset=utf-8');
      download(`talk_${tag}.json`, JSON.stringify({ lesson: lesson.id, class: className, date, anonymous, messages: msgs, topics: tops, participants: parts, tutor_questions: tutor }, null, 1), 'application/json');
      return files.map(([n, r]) => `${n} ${r.length}`).join(', ');
    },
  };
  return api;
}

// 글 목록(학생·발표 화면 공용)
export function renderFeed(list, snap, { me, onReply, onLike, big = false } = {}) {
  const byId = new Map(snap.messages.map((m) => [m.id, m]));
  const keepBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.replaceChildren(...snap.messages.map((m) => {
    const parent = m.replyTo ? byId.get(m.replyTo) : null;
    return el('li', { class: `talk-msg${me && m.no === me ? ' mine' : ''}${big ? ' big' : ''}` },
      parent ? el('p', { class: 'talk-reply-to' }, `${parent.name}에게: ${parent.text.slice(0, 40)}`) : null,
      el('div', { class: 'talk-meta' }, el('strong', {}, m.name), el('span', {}, hhmm(m.at))),
      el('p', { class: 'talk-text' }, m.text),
      onLike || onReply ? el('div', { class: 'talk-tools' },
        onLike ? el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => onLike(m.id) }, `공감 ${m.likes}`) : el('span', { class: 'talk-likes' }, `공감 ${m.likes}`),
        onReply ? el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => onReply(m) }, '답하기') : null) : el('span', { class: 'talk-likes' }, m.likes ? `공감 ${m.likes}` : ''));
  }));
  if (!snap.messages.length) list.append(el('li', { class: 'talk-empty' }, '아직 올라온 의견이 없습니다. 첫 의견을 남겨 보세요.'));
  if (keepBottom) list.scrollTop = list.scrollHeight;
}

// 학생 쪽 댓글창
export function createTalkPlayer(root, { pid, send, compact = false }) {
  let snap = null;
  let me = { name: sessionStorage.getItem('ait_quiz_name') || '', no: null, locked: false };
  let replyTo = null;
  let notice = '';

  const topicEl = el('div', { class: 'talk-topic' });
  const list = el('ol', { class: 'talk-list', 'aria-live': 'polite' });
  const nameInput = el('input', { maxlength: '12', autocomplete: 'off', placeholder: '대화명 (비우면 자동)', 'aria-label': '대화명', value: me.name });
  const text = el('textarea', { rows: compact ? '2' : '3', maxlength: String(MAX_TEXT), 'aria-label': '의견' });
  text.placeholder = '의견을 적어 주세요. 200자 이내';
  const replyBar = el('p', { class: 'talk-replying', hidden: true });
  const sendBtn = el('button', { type: 'button', class: 'btn-sm' }, '올리기');
  const msg = el('p', { class: 'msg error', role: 'alert' });
  const counter = el('span', { class: 'hint' }, `0 / ${MAX_TEXT}`);
  const form = el('div', { class: 'talk-compose' }, replyBar, me.name ? null : nameInput, text, el('div', { class: 'talk-actions' }, counter, el('span', { class: 'grow' }), sendBtn), msg);
  root.replaceChildren(el('div', { class: `talk-box${compact ? ' compact' : ''}` }, topicEl, list, form));

  text.addEventListener('input', () => { counter.textContent = `${text.value.length} / ${MAX_TEXT}`; msg.textContent = ''; });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); post(); } });
  sendBtn.addEventListener('click', post);

  function post() {
    const body = text.value.trim();
    if (!body) { text.focus(); return; }
    if (!checkText(body).ok) { msg.textContent = '바른 말로 다시 써 주세요.'; return; }
    const name = me.name || nameInput.value.trim();
    const checked = validName(name);
    if (!checked.ok) { msg.textContent = checked.message; return; }
    me.name = checked.name || me.name;
    send({ type: 'talk-post', pid, name: me.name, text: body, replyTo });
    text.value = '';
    counter.textContent = `0 / ${MAX_TEXT}`;
    replyTo = null;
    replyBar.hidden = true;
  }

  function paint() {
    if (!snap) return;
    topicEl.replaceChildren(
      el('span', { class: 'talk-label' }, snap.open ? '의견 나눔' : '의견 나눔 (닫힘)'),
      el('strong', {}, snap.topic ? snap.topic.text : '선생님이 주제를 열면 의견을 나눌 수 있습니다.'));
    renderFeed(list, snap, {
      me: me.no,
      onLike: snap.open ? (id) => send({ type: 'talk-like', pid, id }) : null,
      onReply: snap.open ? (m) => { replyTo = m.id; replyBar.hidden = false; replyBar.textContent = `${m.name}에게 답하는 중 · 다시 누르면 취소`; replyBar.onclick = () => { replyTo = null; replyBar.hidden = true; }; text.focus(); } : null,
    });
    form.hidden = !snap.open || !snap.topic;
    if (notice) { msg.textContent = notice; notice = ''; }
  }

  return {
    onMessage(m) {
      if (m.type === 'talk') { snap = m.snap; paint(); return; }
      if (m.pid !== pid) return;
      if (m.type === 'talk-reject') { msg.textContent = m.reason; }
      else if (m.type === 'talk-name') {
        me.no = m.no;
        me.locked = m.locked;
        if (m.reset) { me.name = m.name; msg.textContent = `선생님이 대화명을 "${m.name}"(으)로 바꿨습니다.`; }
        else me.name = m.name;
        nameInput.remove();
        paint();
      }
    },
    get snap() { return snap; },
  };
}
