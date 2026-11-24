// Dave AIT Class 공통 도구: 자료 경로, 불러오기, 화면 요소 만들기.
export const PREVIEW_HOST = ['localhost', '127.0.0.1'].includes(location.hostname);
// 로컬에서 서버 연결을 시험할 때(가짜 Supabase, tools/ait-dev)만 켜는 스위치. 사이트에서는 쓰지 않는다.
export const FAKE_SB = PREVIEW_HOST && localStorage.getItem('ait_fake_sb') === '1';
export const SERVER_MODE = !PREVIEW_HOST || FAKE_SB;
// 사이트에서는 자료가 비공개 보관함에 있어 문지기 함수(/ait-api/asset)를 거친다. 교사는 로그인 쿠키, 학생은 참여 증표로 연다.
export const CONTENT_BASE = SERVER_MODE ? '/ait-api/asset' : '/ait/content';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0·O·1·I는 뺀다.

export async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

export async function loadCatalog() {
  return loadJSON(`${CONTENT_BASE}/catalog.json`);
}

export async function loadLesson(id) {
  if (!/^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/.test(id)) throw new Error('lesson id');
  const lesson = await loadJSON(`${CONTENT_BASE}/${id}/lesson.json`);
  const [course, unit] = id.split('/');
  lesson.base = `${CONTENT_BASE}/${id}`;
  lesson.textbookBase = `${CONTENT_BASE}/${course}/${unit}/textbook`;
  try {
    lesson.textbookMeta = await loadJSON(`${lesson.textbookBase}/textbook.json`);
  } catch {
    lesson.textbookMeta = null; // 교과서가 없는 주제는 연결을 비운다.
  }
  return lesson;
}

export const slideUrl = (lesson, slide) => `${lesson.base}/slides/${slide.id}.webp`;
export const thumbUrl = (lesson, slide) => `${lesson.base}/thumbs/${slide.id}.webp`;
export const pageUrl = (lesson, page) => `${lesson.textbookBase}/p${String(page).padStart(3, '0')}.webp`;

export function hasTextbook(lesson, page) {
  const m = lesson.textbookMeta;
  return !!m && Number.isInteger(page) && page >= m.first && page <= m.last;
}

export function clampPage(lesson, page) {
  const m = lesson.textbookMeta;
  if (!m) return null;
  return Math.min(m.last, Math.max(m.first, page));
}

export function newCode(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export const isValidCode = (code) => new RegExp(`^[${CODE_CHARS}]{6}$`).test(code);

// 사용 설명서의 교사 로그인 흔적. 화면 안내용일 뿐이며 실제 권한 확인은 서버가 맡는다.
export function teacherSession() {
  try {
    const s = JSON.parse(localStorage.getItem('dr_sess_v1'));
    return s && s.token ? s : null;
  } catch {
    return null;
  }
}

// 오래된 브라우저(전자칠판 등)에 없는 기능을 채운다.
for (const proto of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
  if (!proto.replaceChildren) {
    proto.replaceChildren = function replaceChildren(...nodes) {
      while (this.lastChild) this.removeChild(this.lastChild);
      this.append(...nodes);
    };
  }
}

// 기기를 구분하는 임의의 값. randomUUID는 오래된 브라우저와 http 주소에는 없다.
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// 발표용 리모컨(클리커)과 키보드의 버튼을 동작으로 바꾼다.
// 리모컨은 보통 PageDown·PageUp, 화면 가리기는 B나 마침표, 발표 시작은 F5나 Shift+F5를 보낸다.
export function keyAction(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const k = e.key;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) return 'next';
  if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) return 'prev';
  if (['b', 'B', '.'].includes(k)) return 'black';
  if (['w', 'W', ','].includes(k)) return 'white';
  if (k === 'Home') return 'first';
  if (k === 'End') return 'last';
  if (k === 'F5') return 'full';
  return null;
}

export const presentChannelName = (lessonId) => `ait-present-${lessonId}`;

export function isTyping(e) {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function toast(message, actionLabel, onAction, ms = 4000) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const box = el('div', { class: 'toast', role: 'status' }, el('span', { text: message }));
  if (actionLabel) box.append(el('button', { type: 'button', onclick: () => { box.remove(); onAction && onAction(); } }, actionLabel));
  document.body.append(box);
  if (ms) setTimeout(() => box.remove(), ms);
  return box;
}

// 왼쪽과 오른쪽 칸의 경계를 끌어 비율을 바꾼다.
export function enableDivider(workspace, divider, storageKey) {
  const saved = Number(localStorage.getItem(storageKey));
  const apply = (ratio) => {
    const r = Math.min(.8, Math.max(.25, ratio));
    workspace.style.setProperty('--left', `${r}fr`);
    workspace.style.setProperty('--right', `${1 - r}fr`);
    return r;
  };
  apply(saved > 0 ? saved : .6);
  let dragging = false;
  divider.addEventListener('pointerdown', (e) => { dragging = true; divider.classList.add('dragging'); divider.setPointerCapture(e.pointerId); });
  divider.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const box = workspace.getBoundingClientRect();
    const r = apply((e.clientX - box.left) / box.width);
    localStorage.setItem(storageKey, String(r));
  });
  const stop = () => { dragging = false; divider.classList.remove('dragging'); };
  divider.addEventListener('pointerup', stop);
  divider.addEventListener('pointercancel', stop);
  divider.tabIndex = 0;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', '칸 너비 조절');
  divider.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cur = Number(localStorage.getItem(storageKey)) || .6;
    const r = apply(cur + (e.key === 'ArrowLeft' ? -.05 : .05));
    localStorage.setItem(storageKey, String(r));
  });
}
