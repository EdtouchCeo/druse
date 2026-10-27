/* 업무 양식 AI — 작업 공간 (1단계: 탭·자료·임의 한글·관리자 양식)
 *
 * 화면: 왼쪽 AI 대화, 오른쪽 탭. 한글 탭은 rhwp 편집기 하나를 돌려 쓰고(탭을 바꿀 때 내보내 두었다 다시 연다),
 * PDF·엑셀·파워포인트·붙여넣기 탭은 읽기 전용 미리보기와 자료로만 쓴다.
 * AI는 "고칠 문서"(한글 탭)만 고치고, 나머지 탭 가운데 고른 것을 자료로 함께 보낸다.
 * 교사 문서·대화는 브라우저 메모리에만 있다. 서버(forms-templates)에는 관리자가 올린 양식만 있다.
 */
import { createEditor } from './lib/rhwp-editor/index.js';
import { KIND_OF, KIND_LABEL, readPdf, readSheet, readPptx, readText, readPaste } from './sources.js';
import * as Deck from './deck.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MAP_LIMIT = 30000;     // 고칠 문서 지도 상한(글자)
const SRC_LIMIT = 20000;     // 자료 하나 상한
const SRC_TOTAL = 60000;     // 자료 전체 상한
const HISTORY_TURNS = 6;
const API = '/.netlify/functions/forms-templates';
// 본 사이트(index.html)와 같은 로그인 세션·공개 키
const SESSION_KEY = 'dr_sess_v1';
const SB_URL = 'https://aafpkfcxzdrguuctdwth.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhZnBrZmN4emRyZ3V1Y3Rkd3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MzEwNjYsImV4cCI6MjA5MjMwNzA2Nn0.1VWheZHC2qNwWJhJ6KTFhjfFf9-bAfAdjzja2cD-xmw';

// 사이트별 설정(같은 파일을 daeryun.life 업무 양식 AI와 edtouch.ai 문서작성 AI가 함께 쓴다). 없으면 daeryun 기본값.
//   gate: 교사 확인(본 사이트 세션)을 이 화면이 직접 할지 — edtouch는 앱 라우터가 이미 확인한다
//   serverForms: 관리자 양식(서버) 목록·관리 화면을 쓸지
//   role: AI에게 알려 줄 사용자 설명
//   slideTheme·slideAssets·pptxLib: 새 PPT의 양식(slides.js 테마), 양식 그림 주소, 파워포인트 도구 주소
const CFG = Object.assign({ gate: true, serverForms: true, role: '대륜고등학교 교사',
  slideTheme: 'daeryun', slideAssets: { 'daeryun-logo': 'slides/daeryun-logo.png' }, pptxLib: '../lib/pptxgen.bundle.js' }, window.FORMS_CONFIG || {});
const abs = (u) => new URL(u, document.baseURI).href;
const SLIDE_ASSETS = Object.fromEntries(Object.entries(CFG.slideAssets).map(([k, u]) => [k, abs(u)]));
const isTarget = (t) => !!t && (t.kind === 'hwp' || t.kind === 'slides');
(function injectSlideCss() { const st = document.createElement('style'); st.textContent = window.DrSlides.CSS; document.head.appendChild(st); })();

const state = {
  isAdmin: false, forms: [], editor: null, editorTabId: null, busy: false,
  tabs: [], activeId: null, targetId: null, seq: 0,
  history: [], retries: {}, retrySeq: 0, admin: { editId: null, tabId: null, file: null }
};
const tab = (id) => state.tabs.find((t) => t.id === id) || null;

/* ── 로그인 세션 (본 사이트와 공유) ── */
function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
async function refreshSession() {
  const s = getSession();
  if (!s || !s.refresh_token) return null;
  try {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SB_KEY }, body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.access_token) return null;
    const cur = getSession();
    if (!cur || cur.refresh_token !== s.refresh_token) return cur && cur.token; // 다른 창이 먼저 갱신했다
    cur.token = d.access_token;
    if (d.refresh_token) cur.refresh_token = d.refresh_token;
    cur.expires_at = Date.now() + (d.expires_in || 3600) * 1000;
    localStorage.setItem(SESSION_KEY, JSON.stringify(cur));
    return cur.token;
  } catch (e) { return null; }
}
async function api(action, payload) {
  let s = getSession();
  if (!s || !s.token) { const e = new Error('로그인이 필요합니다.'); e.status = 401; throw e; }
  if (s.expires_at && Date.now() > s.expires_at - 60000) await refreshSession();
  const call = () => fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, payload, { action, token: (getSession() || {}).token })) });
  let r;
  try { r = await call(); } catch (e) { throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'); }
  if (r.status === 401 && await refreshSession()) r = await call();
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error(d.error || '요청을 처리하지 못했습니다(' + r.status + ').'); e.status = r.status; throw e; }
  return d;
}

/* ── 표시 도우미 ── */
function cover(kind, html) {
  const c = $('cover');
  if (!kind) { c.hidden = true; return; }
  c.hidden = false; c.className = 'cover' + (kind === 'err' ? ' err' : '');
  c.innerHTML = (kind === 'wait' ? '<div class="spin"></div>' : '') + html;
}
function scrollLog() { const l = $('chat-log'); l.scrollTop = l.scrollHeight; }
function addMsg(cls, html) {
  const empty = $('empty'); if (empty) empty.remove();
  const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html;
  $('chat-log').appendChild(d); scrollLog();
  return d;
}
function note(text) { addMsg('info', esc(text)); }
function bytesToB64(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function baseName(n) { return String(n || '').replace(/\.[^.]+$/, ''); }

/* ── 편집기 ── */
// 편집기는 하나이고 문서 바꾸기·내보내기·되돌리기가 모두 비동기다. 두 작업이 겹치면 한 탭의 내용이 다른 탭에
// 저장될 수 있으므로, 편집기를 건드리는 작업은 모두 lock()으로 한 줄로 세운다(안에서 lock을 다시 부르지 않는다).
let editorChain = Promise.resolve();
function lock(fn) {
  const run = editorChain.then(() => fn());
  editorChain = run.catch(() => {});
  return run;
}
async function ensureEditor() {
  if (state.editor) return state.editor;
  cover('wait', '<div>한글 편집기를 여는 중입니다…</div>');
  disableStudioDrafts();
  state.editor = await createEditor('#editor', { studioUrl: new URL('studio/', document.baseURI).href });
  cover(null);
  watchEditorInput();
  setInterval(() => { if (!state.busy) lock(() => checkDirtyTab(tab(state.editorTabId))); }, 4000);
  return state.editor;
}
// 편집기(같은 오리진 iframe)에서 글을 입력하면 바로 '받지 않은 변경'으로 표시한다(4초 확인을 기다리지 않는다).
function watchEditorInput() {
  const mark = () => { const t = tab(state.editorTabId); if (t && !t.dirty) { t.dirty = true; renderTabs(); updateSaveNote(); } };
  const hook = () => {
    try {
      const w = state.editor.element.contentWindow;
      ['input', 'paste', 'cut', 'drop'].forEach((ev) => w.addEventListener(ev, mark, true));
    } catch (e) { /* 다른 오리진이면 4초 확인만 쓴다 */ }
  };
  hook();
  state.editor.element.addEventListener('load', hook);
}
// 편집기는 기본으로 복구용 사본을 브라우저(IndexedDB)에 자동 저장한다. 학교 공용 PC에 학생 이름이 든 문서가 남지 않도록 끈다.
function disableStudioDrafts() {
  try {
    const s = JSON.parse(localStorage.getItem('rhwp-settings') || '{}') || {};
    s.autosave = Object.assign({}, s.autosave || {}, { recoveryEnabled: false, idleSaveEnabled: false });
    localStorage.setItem('rhwp-settings', JSON.stringify(s));
  } catch (e) {}
}
async function docSha() { try { return (await state.editor.getDocumentState()).documentSha256; } catch (e) { return null; } }
// 한글 탭을 편집기에 올린다(lock 안에서만 부른다). 다른 탭이 올라와 있으면 먼저 그 문서를 내보내 보관한다.
async function loadIntoEditor(t) {
  await ensureEditor();
  if (state.editorTabId === t.id) return;
  const prev = tab(state.editorTabId);
  if (prev) {
    prev.leaveSha = await docSha();
    await checkDirtyTab(prev);
    prev.bytes = await state.editor.exportHwpx();
    prev.loadName = baseName(prev.name) + '.hwpx';
  }
  // 불러오다 실패하면 편집기에 무엇이 남았는지 알 수 없다. 이전 탭으로 착각하지 않도록 먼저 비워 둔다.
  state.editorTabId = null;
  await state.editor.loadFile(t.bytes, t.loadName || t.name, { skipUnsavedGuard: true });
  state.editorTabId = t.id;
  // .hwp는 처음 내보낼 때 지문이 한 번 바뀐다(편집기 동작). 미리 한 번 내보내 두어야 고치지 않은 문서가 '받지 않은 문서'로 잡히지 않는다.
  if (!/\.hwpx$/i.test(t.loadName || t.name)) { try { await state.editor.exportHwpx(); } catch (e) {} }
  const sha = await docSha();
  // 다시 연 문서는 지문이 바뀔 수 있다. 떠날 때와 같은 문서였다면 되돌리기 기준을 새 지문으로 옮긴다.
  const top = t.undo[t.undo.length - 1];
  if (top && t.leaveSha && top.afterSha === t.leaveSha) top.afterSha = sha;
  t.loadSha = sha;
}
async function currentHwpx(t) {
  return lock(() => (state.editorTabId === t.id ? state.editor.exportHwpx() : t.bytes));
}
async function checkDirtyTab(t) {
  if (!t || state.editorTabId !== t.id) return;
  const sha = await docSha();
  if (sha && t.loadSha && sha !== t.loadSha) { if (!t.dirty) { t.dirty = true; renderTabs(); updateSaveNote(); } }
}
function updateSaveNote() {
  const n = state.tabs.filter((t) => t.dirty).length;
  $('save-note').textContent = n ? '받지 않은 문서 ' + n + '개' : '';
}
window.addEventListener('beforeunload', (e) => { if (state.tabs.some((t) => t.dirty)) { e.preventDefault(); e.returnValue = ''; } });

/* ── 탭 ── */
function newTab(o) {
  const t = Object.assign({ id: 't' + (++state.seq), form: null, src: null, srcErr: '', use: o.kind !== 'hwp' && o.kind !== 'slides', undo: [], dirty: false, loadSha: null, viewEl: null }, o);
  state.tabs.push(t);
  return t;
}
let deckSeq = 0;
function newDeckTab(base) {
  const name = (base ? base + ' 발표 자료' : '새 PPT' + (++deckSeq > 1 ? ' ' + deckSeq : ''));
  return newTab({ name, kind: 'slides', deck: Deck.emptyDeck(CFG.slideTheme, '') });
}
function refreshDeck(t) { if (t && t.viewEl && t.viewEl.refresh) t.viewEl.refresh(); }
function renderTabs() {
  $('tabbar').innerHTML = state.tabs.map((t) =>
    `<div class="tab" role="tab" tabindex="0" data-tab="${t.id}" aria-selected="${t.id === state.activeId}" title="${esc(t.name)}">` +
    `<span class="kind">${esc(KIND_LABEL[t.kind] || '')}</span><span class="name">${esc(t.name)}</span>` +
    (t.dirty ? '<span class="dot" title="받지 않은 변경"></span>' : '') +
    `<button class="x" type="button" data-close="${t.id}" aria-label="${esc(t.name)} 닫기"${state.busy && t.id === state.sendTargetId ? ' disabled' : ''}>✕</button></div>`
  ).join('') + '<button class="tab-add" type="button" id="tab-add" title="양식에서 시작하거나 파일 열기">+</button>';
}
$('tabbar').addEventListener('click', (e) => {
  const x = e.target.closest('[data-close]');
  if (x) { e.stopPropagation(); closeTab(x.dataset.close); return; }
  if (e.target.closest('#tab-add')) { showStart(); return; }
  const t = e.target.closest('[data-tab]');
  if (t) activate(t.dataset.tab);
});
$('tabbar').addEventListener('keydown', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(t.dataset.tab); }
});
function showStart() {
  state.activeId = null;
  $('editor').hidden = true; $('viewer').hidden = true; $('start').hidden = false;
  renderTabs(); updateDownload();
}
// 탭을 보여 준다. 한글 탭은 편집기에 올라온 것을 확인한 뒤에만 true를 돌려준다.
async function activate(id, force) {
  const t = tab(id);
  if (!t) return false;
  if (!force && state.busy && t.kind === 'hwp' && state.editorTabId !== t.id) { note('AI가 문서를 고치는 동안에는 다른 한글 문서로 바꿀 수 없습니다. 끝난 뒤 다시 눌러 주세요.'); return false; }
  state.activeId = id;
  $('start').hidden = true;
  if (t.kind === 'hwp') {
    $('viewer').hidden = true; $('editor').hidden = false;
    let ok = true;
    try { await lock(() => (tab(t.id) ? loadIntoEditor(t) : null)); }
    catch (e) { console.error(e); ok = false; }
    if (!tab(t.id)) return false;                       // 그사이 닫힌 탭
    if (!ok || state.editorTabId !== t.id) {
      cover('err', '<div>이 한글 파일을 열지 못했습니다. 한글에서 다시 저장한 뒤 열어 보세요.</div><button class="btn" type="button" id="cover-ok">닫기</button>');
      $('cover-ok').onclick = () => { cover(null); closeTab(t.id, true); };
      return false;
    }
    if (state.activeId !== id) return true;             // 그사이 다른 탭을 눌렀다. 화면은 그 탭이 정한다.
    state.targetId = t.id;
  } else {
    $('editor').hidden = true; $('viewer').hidden = false;
    renderViewer(t);
    if (t.kind === 'slides' && !state.busy) state.targetId = t.id;
  }
  renderTabs(); renderTarget(); renderSources(); updateDownload(); renderEmptyHint();
  if (document.body.dataset.pane === 'chat' && window.matchMedia('(max-width: 900px)').matches) setPane('work');
  return true;
}
async function closeTab(id, force) {
  const t = tab(id); if (!t) return;
  if (state.busy && (id === state.sendTargetId || id === state.editorTabId)) { note('AI가 이 문서를 고치는 중이라 닫을 수 없습니다. 끝난 뒤 닫아 주세요.'); return; }
  if (!force && t.dirty && !confirm('"' + t.name + '"을(를) 아직 받지 않았습니다. 닫으면 고친 내용이 사라집니다. 닫을까요?')) return;
  await lock(() => {
    state.tabs = state.tabs.filter((x) => x.id !== id);
    if (state.editorTabId === id) state.editorTabId = null;
  });
  if (state.targetId === id) state.targetId = (state.tabs.filter(isTarget).pop() || {}).id || null;
  if (state.admin.tabId === id) state.admin.tabId = null;
  if (state.activeId === id) {
    const next = state.tabs[state.tabs.length - 1];
    if (next) await activate(next.id); else showStart();
  }
  renderTabs(); renderTarget(); renderSources(); updateSaveNote(); updateDownload(); refreshUndoButtons();
}

/* ── 미리보기(한글이 아닌 탭) ── */
function renderViewer(t) {
  const v = $('viewer');
  v.innerHTML = '';
  if (!t.viewEl) t.viewEl = t.kind === 'slides' ? buildDeckView(t) : buildView(t);
  v.appendChild(t.viewEl);
  if (t.viewEl.refresh) t.viewEl.refresh();
  v.scrollTop = 0;
}
function buildDeckView(t) {
  return Deck.createDeckView(t, {
    assets: SLIDE_ASSETS,
    isBusy: () => state.busy && state.sendTargetId === t.id,
    onEdit: () => { if (!t.dirty) { t.dirty = true; renderTabs(); updateSaveNote(); } updateDownload(); },
    emptyHtml: () => '<h2>어떤 발표 자료를 만들까요?</h2><p>왼쪽 요청 칸에 주제와 장 수를 적어 보내면 AI가 장 구성을 짜고 내용을 채웁니다. ' +
      '함께 보낼 자료(PDF·한글·엑셀·파워포인트)를 열어 두면 그 내용을 근거로 씁니다.</p><p class="deck-eg">예: 연수 자료 PDF로 10장짜리 교사 연수 PPT 만들어 줘.</p>'
  });
}
function buildView(t) {
  const box = document.createElement('div');
  const head = `<div class="viewer-head">${esc(KIND_LABEL[t.kind])} 자료입니다. 이 파일은 고치지 않고, AI가 한글 문서를 채우거나 PPT를 만들 때 근거로 씁니다.</div>`;
  if (t.srcErr) { box.innerHTML = head + `<div class="viewer-note">${esc(t.srcErr)}</div>`; return box; }
  const s = t.src;
  const noteHtml = s.note ? `<div class="viewer-note">${esc(s.note)}</div>` : '';
  if (t.kind === 'pdf') {
    box.innerHTML = head + noteHtml;
    renderPdfPages(box, s.preview.doc);
  } else if (s.preview.sheets) {
    box.innerHTML = head + noteHtml + s.preview.sheets.map((sh) => {
      const rows = sh.rows.slice(0, 300);
      return `<div class="sheet-wrap"><h3>${esc(sh.name)}${sh.rows.length > 300 ? ' (앞 300줄만 표시)' : ''}</h3><table class="sheet">` +
        rows.map((r) => '<tr>' + r.slice(0, 30).map((c) => `<td title="${esc(c)}">${esc(c)}</td>`).join('') + '</tr>').join('') + '</table></div>';
    }).join('');
  } else if (s.preview.slides) {
    box.innerHTML = head + noteHtml + s.preview.slides.map((sl, i) =>
      `<div class="slide-card"><h3>슬라이드 ${i + 1}</h3>${sl.paras.map((p) => `<p>${esc(p)}</p>`).join('') || '<p>(글 없음)</p>'}${sl.notes ? `<div class="notes">발표자 노트: ${esc(sl.notes)}</div>` : ''}</div>`).join('');
  } else {
    box.innerHTML = head + noteHtml + `<div class="text-view">${esc(s.preview.text || '')}</div>`;
  }
  return box;
}
// PDF 쪽은 화면에 보일 때만 그린다.
function renderPdfPages(box, doc) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(async (en) => {
      if (!en.isIntersecting || en.target.dataset.done) return;
      en.target.dataset.done = '1'; io.unobserve(en.target);
      const page = await doc.getPage(+en.target.dataset.page);
      const width = Math.min(900, ($('viewer').clientWidth || 900) - 40);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = width / vp0.width, dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: scale * dpr });
      const c = en.target.querySelector('canvas');
      c.width = vp.width; c.height = vp.height; c.style.width = (vp.width / dpr) + 'px';
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    });
  }, { root: $('viewer'), rootMargin: '600px' });
  for (let p = 1; p <= doc.numPages; p++) {
    const w = document.createElement('div');
    w.dataset.page = p;
    w.innerHTML = `<div class="pdf-label">${p} / ${doc.numPages}쪽</div><canvas class="pdf-page" width="600" height="800" aria-label="${p}쪽"></canvas>`;
    box.appendChild(w); io.observe(w);
  }
}

/* ── 파일 열기 ── */
async function readSource(t, bytes, clip) {
  try {
    if (t.kind === 'pdf') t.src = await readPdf(bytes);
    else if (t.kind === 'xlsx') t.src = await readSheet(bytes, t.name);
    else if (t.kind === 'pptx') t.src = await readPptx(bytes);
    else if (t.kind === 'text') t.src = readText(bytes);
    else if (t.kind === 'paste') t.src = readPaste(clip);
  } catch (e) {
    console.error(e);
    t.srcErr = '이 파일을 읽지 못했습니다. ' + (t.kind === 'pptx' ? '.ppt 형식이면 파워포인트에서 .pptx로 다시 저장해 주세요.' : '파일이 손상되었거나 암호가 걸려 있는지 확인해 주세요.');
  }
}
async function addFiles(list) {
  const files = Array.from(list || []);
  let last = null;
  for (const f of files) {
    const kind = KIND_OF(f.name);
    if (!kind) { note(f.name + '은(는) 열 수 없는 형식입니다. 한글·PDF·엑셀·파워포인트(.pptx)·글 파일을 올려 주세요.'); continue; }
    if (f.size > 30 * 1024 * 1024) { note(f.name + '은(는) 30MB를 넘어 열지 않았습니다.'); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const t = newTab({ name: f.name, kind, bytes, loadName: f.name });
    if (kind !== 'hwp') { cover('wait', '<div>' + esc(f.name) + '을(를) 읽는 중입니다…</div>'); await readSource(t, bytes); cover(null); }
    last = t;
    if (kind === 'hwp') await activate(t.id); // 한글은 열 때 편집기로 확인하고 hwpx로 바꿔 둔다
  }
  if (last) await activate(last.id);
  renderSources();
}
$('file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
['btn-open', 'btn-open2'].forEach((id) => $(id).addEventListener('click', () => $('file-input').click()));
// 새 한글: 빈 A4 문서(blank.hwpx)를 열고, 열려 있던 문서가 있으면 자료로 고른다.
let hwpSeq = 0;
if ($('btn-new-hwp')) $('btn-new-hwp').addEventListener('click', async () => {
  if (state.busy) return;
  const from = tab(state.targetId);
  try {
    const r = await fetch(abs('blank.hwpx'));
    if (!r.ok) throw new Error('빈 문서를 받지 못했습니다(' + r.status + ').');
    const bytes = new Uint8Array(await r.arrayBuffer());
    const name = '새 한글 문서' + (++hwpSeq > 1 ? ' ' + hwpSeq : '');
    const t = newTab({ name, kind: 'hwp', bytes, loadName: name + '.hwpx' });
    if (from) from.use = true;
    await activate(t.id);
    renderSources(); renderEmpty();
    if (window.matchMedia('(max-width: 900px)').matches) setPane('chat');
    $('prompt').focus();
  } catch (e) {
    console.error(e);
    note('새 한글 문서를 열지 못했습니다. ' + (e.message || ''));
  }
});
// 새 PPT: 빈 PPT 탭을 열고, 열려 있던 한글 문서가 있으면 자료로 고른다.
$('btn-new-deck').addEventListener('click', async () => {
  if (state.busy) return;
  const from = tab(state.targetId);
  const t = newDeckTab(from && from.kind === 'hwp' ? baseName(from.name) : null);
  if (from && from.kind === 'hwp') from.use = true;
  await activate(t.id);
  renderSources(); renderEmpty();
  if (window.matchMedia('(max-width: 900px)').matches) setPane('chat');
  $('prompt').focus();
});
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { dragDepth++; document.body.classList.add('drag-over'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('drag-over'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('drag-over');
  if ($('app').hidden || !$('admin-modal').hidden) return;
  if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});
// 한글·엑셀에서 복사한 표나 글을 붙이면 자료 탭이 된다(입력칸·편집기 안의 붙여넣기는 그대로 둔다).
let pasteSeq = 0;
document.addEventListener('paste', async (e) => {
  const el = e.target;
  if ($('app').hidden || !$('admin-modal').hidden) return;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return;
  const clip = e.clipboardData; if (!clip) return;
  if (clip.files && clip.files.length) { e.preventDefault(); addFiles(clip.files); return; }
  const hasTable = /<table/i.test(clip.getData('text/html') || '');
  if (!hasTable && !(clip.getData('text/plain') || '').trim()) return;
  e.preventDefault();
  const t = newTab({ name: (hasTable ? '붙여넣은 표 ' : '붙여넣은 글 ') + (++pasteSeq), kind: 'paste' });
  await readSource(t, null, clip);
  activate(t.id);
});

/* ── 양식 ── */
async function loadForms() {
  const builtin = (window.DR_FORMS || []).map((f) => ({ id: 'builtin:' + f.id, builtin: true, title: f.title, dept: f.dept, form: f }));
  let server = [];
  if (CFG.serverForms) try { server = ((await api('list')).items || []).map((m) => ({ id: 'srv:' + m.id, builtin: false, title: m.title, dept: m.dept, meta: m })); }
  catch (e) { console.warn(e); }
  // 관리자가 같은 이름으로 다시 올린 양식은 웹 판이 우선한다.
  const names = new Set(server.map((s) => s.title));
  state.forms = builtin.filter((b) => !names.has(b.title)).concat(server);
  renderFormCards();
}
function renderFormCards() {
  document.querySelector('.forms-list').hidden = !state.forms.length && !CFG.serverForms;
  $('form-cards').innerHTML = state.forms.length ? state.forms.map((f) =>
    `<button type="button" class="form-card" data-form="${esc(f.id)}"><b>${esc(f.title)}</b><small>${esc(f.dept || '')}${f.meta && f.meta.year ? ' · ' + esc(f.meta.year) + '학년도' : ''}</small></button>`).join('')
    : '<p class="hint">등록된 양식이 없습니다.</p>';
}
$('form-cards').addEventListener('click', (e) => { const b = e.target.closest('[data-form]'); if (b) openForm(b.dataset.form); });
$('btn-forms').addEventListener('click', showStart);

async function builtinBytes(form) {
  const res = await fetch(form.template, { cache: 'no-cache' });
  if (!res.ok) throw new Error('양식 파일을 받지 못했습니다(' + res.status + ').');
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  for (const name of Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n))) {
    const xml = (await zip.file(name).async('string')).replace(/\{\{([^}]+)\}\}/g, (m, k) => (form.blanks && k in form.blanks ? form.blanks[k] : ''));
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
}
function serverForm(m) {
  return {
    id: m.id, title: m.title, dept: m.dept, guide: m.guide || '', example: m.example || '', suggestions: m.suggestions || [],
    fileName: () => (m.year ? m.year + '학년도 ' : '') + m.title + '.hwpx'
  };
}
async function openForm(id, opts) {
  let f = state.forms.find((x) => x.id === id || x.id === 'builtin:' + id);
  if (!f) {
    // 관리자가 같은 이름으로 다시 올려 기본 양식이 목록에서 빠졌으면, 그 이름의 올린 양식을 연다(예전 링크 보존).
    const b = (window.DR_FORMS || []).find((x) => 'builtin:' + x.id === id || x.id === id);
    if (b) f = state.forms.find((x) => !x.builtin && x.title === b.title);
  }
  if (!f) { note('양식을 찾지 못했습니다. 목록을 새로 고쳐 주세요.'); return null; }
  cover('wait', '<div>' + esc(f.title) + ' 양식을 여는 중입니다…</div>');
  try {
    let bytes, form, loadName;
    if (f.builtin) { form = f.form; bytes = await builtinBytes(form); loadName = form.title + '.hwpx'; }
    else {
      const g = await api('get', { id: f.meta.id });
      const r = await fetch(g.url);
      if (!r.ok) throw new Error('양식 파일을 받지 못했습니다(' + r.status + ').');
      bytes = new Uint8Array(await r.arrayBuffer());
      form = serverForm(g.item); loadName = g.item.title + '.' + (g.item.kind || 'hwpx');
    }
    cover(null);
    const t = newTab({ name: form.title, kind: 'hwp', bytes, loadName, form: (opts && opts.noForm) ? null : form, formRef: f });
    await activate(t.id);
    if (!(opts && opts.quiet)) renderEmpty();
    return t;
  } catch (e) {
    console.error(e);
    cover(null);
    note('양식을 열지 못했습니다. ' + (e.message || ''));
    return null;
  }
}

/* ── 고칠 문서·자료 선택 ── */
function renderTarget() {
  const hw = state.tabs.filter(isTarget);
  const sel = $('target');
  sel.innerHTML = hw.length ? hw.map((t) => `<option value="${t.id}"${t.id === state.targetId ? ' selected' : ''}>${t.kind === 'slides' ? '[PPT] ' : ''}${esc(t.name)}</option>`).join('')
    : '<option value="">없음 (질문만 할 수 있습니다)</option>';
  sel.disabled = !hw.length || state.busy;
  renderEmptyHint();
}
$('target').addEventListener('change', async (e) => {
  if (state.busy) { renderTarget(); return; }
  if (await activate(e.target.value)) state.targetId = e.target.value; else renderTarget();
});
function srcSize(t) { return t.src && t.src.text ? t.src.text.length : 0; }
function renderSources() {
  const others = state.tabs.filter((t) => t.id !== state.targetId);
  $('sources-box').hidden = !others.length;
  $('sources-list').innerHTML = others.map((t) => {
    const info = t.kind === 'hwp' ? '한글 문서' : t.kind === 'slides' ? 'PPT ' + t.deck.slides.length + '장' : t.srcErr ? '읽지 못함' : (srcSize(t).toLocaleString() + '자' + (srcSize(t) > SRC_LIMIT ? ', 앞부분만 보냄' : ''));
    return `<li><label><input type="checkbox" data-use="${t.id}"${t.use && !t.srcErr ? ' checked' : ''}${t.srcErr ? ' disabled' : ''}><span>${esc(t.name)} <small>(${esc(KIND_LABEL[t.kind])}, ${info})</small></span></label></li>`;
  }).join('');
  const n = others.filter((t) => t.use && !t.srcErr).length;
  $('sources-sum').textContent = '함께 보낼 자료 ' + n + '개';
  renderAi();
}
$('sources-list').addEventListener('change', (e) => {
  const c = e.target.closest('[data-use]'); if (!c) return;
  const t = tab(c.dataset.use); if (t) t.use = c.checked;
  renderSources();
});
async function sourceText(t) {
  if (t.kind === 'hwp') {
    const doc = await DrHwpxDoc.open(await currentHwpx(t));
    return doc.toText();
  }
  if (t.kind === 'slides') return Deck.deckText(t.deck);
  return (t.src && t.src.text) || '';
}

/* ── 받기 ── */
function updateDownload() {
  const t = tab(state.activeId);
  const isDeck = !!t && t.kind === 'slides';
  const ok = (isDeck ? t.deck.slides.length > 0 : !!(t && t.kind === 'hwp' && state.editorTabId === t.id)) && !state.busy;
  $('btn-download').disabled = !ok;
  $('btn-download').title = ok ? '' : isDeck ? 'AI가 슬라이드를 만든 뒤에 받을 수 있습니다.' : '한글 문서나 PPT 탭에서 받을 수 있습니다.';
  $('download-menu').querySelectorAll('[data-format]').forEach((b) => { b.hidden = (b.dataset.format === 'pptx') !== isDeck; });
}
$('btn-download').addEventListener('click', () => {
  const m = $('download-menu'); m.hidden = !m.hidden;
  $('btn-download').setAttribute('aria-expanded', String(!m.hidden));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) { $('download-menu').hidden = true; $('btn-download').setAttribute('aria-expanded', 'false'); } });
$('download-menu').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-format]'); if (!b) return;
  $('download-menu').hidden = true;
  const t = tab(state.activeId); if (!t) return;
  if (t.kind === 'slides') { downloadDeck(t); return; }
  if (state.editorTabId !== t.id) return;
  const fmt = b.dataset.format, btn = $('btn-download');
  btn.disabled = true; btn.textContent = '만드는 중…';
  try {
    // 내보내기와 지문 읽기를 한 번에 묶어, 그사이 편집기 문서가 바뀌지 않게 한다.
    const got = await lock(async () => {
      if (state.editorTabId !== t.id) throw new Error('문서를 다시 열고 있습니다. 잠시 뒤 다시 눌러 주세요.');
      const out = fmt === 'hwp' ? await state.editor.exportHwp() : await state.editor.exportHwpx();
      const hwpx = fmt === 'hwp' ? await state.editor.exportHwpx() : out;
      return { bytes: out, hwpx, sha: await docSha() };
    });
    const bytes = got.bytes;
    let name = baseName(t.name) + '.' + fmt;
    if (t.form && t.form.fileName) {
      try { name = baseName(t.form.fileName(await DrHwpxDoc.open(got.hwpx))) + '.' + fmt; } catch (e2) {}
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: fmt === 'hwp' ? 'application/x-hwp' : 'application/hwp+zip' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    state.editor.notifySaved(name).catch(() => {});
    t.dirty = false; t.loadSha = got.sha;
    renderTabs(); updateSaveNote();
    $('save-note').textContent = name + '을(를) 받았습니다';
  } catch (err) {
    alert('한글 파일을 만들지 못했습니다. ' + (err && err.message ? err.message : ''));
  } finally { btn.textContent = '받기'; updateDownload(); }
});

async function downloadDeck(t) {
  const btn = $('btn-download');
  btn.disabled = true; btn.textContent = '만드는 중…';
  try {
    const blob = await Deck.buildPptxBlob(t.deck, SLIDE_ASSETS, abs(CFG.pptxLib));
    const name = (t.deck.title || t.name).replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) + '.pptx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    t.dirty = false; renderTabs(); updateSaveNote();
    $('save-note').textContent = name + '을(를) 받았습니다';
  } catch (err) {
    console.error(err);
    alert('파워포인트 파일을 만들지 못했습니다. ' + (err && err.message ? err.message : ''));
  } finally { btn.textContent = '받기'; updateDownload(); }
}

/* ── AI 연결 표시 ── */
function renderAi() {
  const chip = $('ai-chip'), label = drAi.label();
  chip.classList.toggle('off', !label);
  chip.textContent = label ? 'AI: ' + label : 'AI 설정 필요';
  chip.title = 'AI 연결 방법 바꾸기';
  const n = state.tabs.filter((t) => t.id !== state.targetId && t.use && !t.srcErr).length;
  $('scope').textContent = label
    ? '보낼 때 고칠 문서' + (n ? '와 고른 자료 ' + n + '개' : '') + '의 내용을 함께 보냅니다. ' + drAi.scope()
    : '처음 한 번 AI 설정에서 Gemini 무료 키나 구독 연결을 등록하면 쓸 수 있습니다.';
}
$('ai-chip').addEventListener('click', () => drAi.open());
window.addEventListener('drai-change', renderAi);

/* ── 대화 화면 ── */
function currentForm() { const t = tab(state.targetId); return t && t.form; }
function renderEmpty() {
  const f = currentForm(), tg = tab(state.targetId), deck = tg && tg.kind === 'slides' ? tg.deck : null;
  const sugg = deck ? (deck.slides.length ? ['모든 장의 글을 더 짧게 줄여 줘.', '3번 장을 표로 바꿔 줘.', '발표 노트를 장마다 3문장으로 써 줘.']
      : ['고른 자료로 10장짜리 발표 자료를 만들어 줘.', '학부모 설명회용으로 8장 만들어 줘.'])
    : f && f.suggestions && f.suggestions.length ? f.suggestions
    : (state.targetId ? ['아직 비어 있는 칸을 알려 줘.', '맞춤법과 띄어쓰기를 검토해 줘.', '이 문서 내용으로 PPT 만들어 줘.'] : ['고른 자료를 다섯 줄로 요약해 줘.', '고른 자료로 PPT 만들어 줘.']);
  const lead = deck ? (deck.slides.length ? 'AI가 PPT의 글과 장을 고칩니다. 고친 곳은 여기에 표시되고 한 번에 되돌릴 수 있습니다. 화면의 글을 눌러 직접 고칠 수도 있습니다.'
      : '만들 발표 자료의 주제·대상·장 수를 적어 주세요. AI가 장 구성을 짠 뒤 내용을 채웁니다.')
    : state.targetId ? 'AI가 고칠 문서를 바로 채우고 고칩니다. 고친 곳은 여기에 표시되고 한 번에 되돌릴 수 있습니다.' : '양식에서 시작하거나 한글 파일을 열면 AI가 문서를 채웁니다. PPT를 만들어 달라고 하면 새 PPT 탭이 열립니다.';
  $('chat-log').innerHTML = `<div class="empty" id="empty">
    <h3>하고 싶은 말을 적어 보세요</h3>
    <p>${lead}</p>
    <div class="chips">${sugg.map((s) => `<button type="button" class="chip">${esc(s)}</button>`).join('')}</div></div>`;
  $('prompt').placeholder = deck ? '예: 연수 자료 PDF로 10장짜리 교사 연수 PPT 만들어 줘.' : (f && f.example) || '예: 연수 자료 PDF 내용으로 활동 목적을 써 줘.';
}
function renderEmptyHint() { if ($('empty')) renderEmpty(); }
$('chat-log').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) { const t = $('prompt'); t.value = chip.textContent; t.focus(); t.setSelectionRange(t.value.length, t.value.length); return; }
  const u = e.target.closest('button[data-undo]'); if (u) { undoTurn(u); return; }
  const r = e.target.closest('button[data-retry]');
  if (r) {
    const saved = state.retries[r.dataset.retry];
    if (!saved || state.busy) return;
    delete state.retries[r.dataset.retry]; r.disabled = true;
    $('prompt').value = saved.request;
    send(saved.sourceIds);
  }
});
function changesHtml(changes, problems) {
  let h = '';
  if (changes.length) {
    h += `<details class="changes"${changes.length <= 6 ? ' open' : ''}><summary>고친 곳 ${changes.length}군데</summary><ul>` +
      changes.map((c) => `<li><span class="where">${esc(c.label)}</span>${c.before ? '<del>' + esc(c.before) + '</del> ' : ''}${c.after ? '<ins>' + esc(c.after) + '</ins>' : ''}</li>`).join('') + '</ul></details>';
  }
  if (problems.length) h += '<div class="problems">' + problems.map(esc).join('<br>') + '</div>';
  return h;
}
$('btn-new').addEventListener('click', () => {
  if (state.busy) return;
  state.history = []; state.tabs.forEach((t) => { t.undo = []; });
  renderEmpty();
});

/* ── 요청 보내기 ── */
const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: '교사에게 보여 줄 답' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['set', 'fill_rows', 'add_row', 'insert_after', 'delete'] },
          target: { type: 'string' }, text: { type: 'string' }, cells: { type: 'array', items: { type: 'string' } }
        },
        required: ['op', 'target', 'text', 'cells']
      }
    }
  },
  required: ['reply', 'edits']
};
const GENERIC_GUIDE = [
  '이 문서는 교사가 직접 연 한글 문서다. 별도 작성 기준이 없다.',
  '- 표의 머리글 칸(항목 이름)과 문서 제목의 형식은 바꾸지 않는다.',
  '- 교사가 요청한 곳만 고친다. 공문서는 개조식 문장(~함, ~하고자 함)을 우선한다.'
].join('\n');
function today() {
  const d = new Date(), w = '일월화수목금토'[d.getDay()];
  return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + w + ')';
}
function buildPrompt(o) {
  const L = [];
  L.push('너는 ' + CFG.role + '가 학교 업무 문서(한글 문서)를 작성하도록 돕는 AI 도우미다.');
  L.push('교사의 요청에 따라 문서를 고치거나 질문에 답한다. 오늘은 ' + today() + '이다.');
  if (o.target) {
    L.push('');
    L.push('[고칠 문서] ' + o.target.name + (o.form && o.form.dept ? ' (' + o.form.dept + ')' : ''));
    L.push('[작성 기준]');
    L.push(o.form && o.form.guide ? o.form.guide : GENERIC_GUIDE);
    L.push('');
    L.push('[문서 현재 내용] 줄마다 위치 아이디 [행 이름] = 지금 들어 있는 글(JSON 문자열, \\n은 칸 안의 줄바꿈)');
    L.push(o.map);
  } else {
    L.push('');
    L.push('[고칠 문서] 없음. 이번에는 문서를 고치지 않고 자료를 바탕으로 질문에 답한다. edits는 빈 배열로 둔다.');
  }
  if (o.sources.length) {
    L.push('');
    L.push('[자료] 교사가 함께 보낸 파일이다. 문서를 채우거나 답할 근거로만 쓰고, 자료에 없는 사실은 지어내지 않는다.');
    o.sources.forEach((s) => { L.push('--- ' + s.name + ' (' + s.kind + ')' + (s.cut ? ', 앞부분만' : '') + ' ---'); L.push(s.text); });
  }
  const hist = state.history.slice(-HISTORY_TURNS);
  if (hist.length) {
    L.push(''); L.push('[지난 대화]');
    hist.forEach((h) => { L.push('교사: ' + h.user); L.push('도우미: ' + h.reply + (h.changes.length ? ' (고친 곳: ' + h.changes.join(', ') + ')' : '')); });
  }
  L.push(''); L.push('[이번 요청]'); L.push(o.request);
  if (o.target) {
    L.push('');
    L.push('[고치는 방법] 고칠 것은 edits 배열에 넣는다.');
    L.push('- set: target(칸 T1:r8c1 또는 문단 P1)의 글을 text로 통째로 바꾼다. 칸 안의 여러 줄은 \\n으로 나눈다. 칸의 줄 가운데 바꾸지 않을 줄도 그대로 다시 적는다.');
    L.push('- fill_rows: target 줄(예: T1:r3)부터 아래로 같은 모양의 줄들을 cells 목록으로 한 칸에 하나씩 왼쪽→오른쪽, 위→아래 순서로 채운다. 목록이 길면 줄이 자동으로 늘고, 남는 칸은 비워진다. 명단처럼 여러 줄에 걸친 값은 set 여러 개 대신 fill_rows 한 번으로 쓴다.');
    L.push('- add_row: target 행(예: T1:r6) 바로 아래에 같은 모양의 행을 하나 더 만든다. cells에 새 행의 칸 내용을 왼쪽부터 차례로 넣는다.');
    L.push('- insert_after: 문단 P 바로 아래에 text로 새 문단을 넣는다. delete: 문단 P를 지운다. 표 칸에는 쓰지 않는다.');
    L.push('- 아이디는 위 [문서 현재 내용]에 있는 것만 쓴다. 같은 응답 안에서는 행을 추가해도 위 지도의 아이디를 그대로 쓴다. 지도는 요청마다 새로 만들어지므로 지난 대화에 나온 아이디를 다시 쓰지 말고 [행 이름]으로 칸을 찾는다.');
    L.push('- "수정 불가"라고 표시된 곳과 양식의 머리글 칸(학년-반-번호, 성명 같은 항목 이름)은 고치지 않는다.');
    L.push('- 쓰지 않는 필드는 빈 문자열("")이나 빈 배열([])로 둔다.');
  }
  L.push('[지켜야 할 것]');
  L.push('- 교사가 알려 주지 않았고 자료에도 없는 학생 이름, 학번, 날짜, 시간, 장소, 숫자는 지어내지 않는다. 모르면 그 칸은 비워 두고 reply에서 물어본다.');
  L.push('- 요청과 관계없는 곳은 고치지 않는다. 질문만 했으면 edits는 빈 배열로 둔다.');
  L.push('- reply는 교사에게 보여 줄 답이다. 존댓말로 무엇을 고쳤는지와 교사가 확인하거나 더 알려 줘야 할 것을 쓴다. 고친 것이 없으면 질문에 대한 답을 쓴다.');
  return L.join('\n');
}
function setBusy(v) {
  state.busy = v;
  if (!v) state.sendTargetId = null;
  $('btn-send').disabled = v; $('busy-bar').hidden = !v;
  $('btn-send').textContent = v ? '작업 중…' : '보내기';
  $('target').disabled = v || !state.tabs.some(isTarget);
  renderTabs(); updateDownload();
  state.tabs.forEach((t) => { if (t.kind === 'slides' && t.id === state.activeId) refreshDeck(t); });
}
// 자료를 상한에 맞춰 모은다. 고칠 문서와 읽지 못한 파일은 빼고, 잘리거나 못 보낸 것은 따로 알린다.
async function collectSources(ids) {
  const pool = ids ? ids.map(tab).filter(Boolean) : state.tabs.filter((t) => t.use);
  const list = pool.filter((t) => t.id !== state.targetId && !t.srcErr);
  const out = []; let total = 0;
  for (const t of list) {
    let text = (await sourceText(t)).trim();
    if (!text) continue;
    let cut = false;
    if (text.length > SRC_LIMIT) { text = text.slice(0, SRC_LIMIT); cut = true; }
    if (total + text.length > SRC_TOTAL) { text = text.slice(0, Math.max(0, SRC_TOTAL - total)); cut = true; }
    if (!text) { out.push({ id: t.id, name: t.name, kind: KIND_LABEL[t.kind], text: '', skipped: true }); continue; }
    total += text.length;
    out.push({ id: t.id, name: t.name, kind: KIND_LABEL[t.kind], text, cut });
  }
  return out;
}
async function send(sourceIds) {
  if (state.busy) return;
  const request = $('prompt').value.trim();
  if (!request) { $('prompt').focus(); return; }
  if (!drAi.has()) { drAi.open(); return; }
  let target = tab(state.targetId);
  // 한글 문서를 고치다가 PPT를 만들어 달라고 하면 새 PPT 탭을 열고, 그 한글 문서를 자료로 쓴다.
  if ((!target || target.kind !== 'slides') && Deck.isDeckRequest(request)) {
    const from = target;
    const t2 = newDeckTab(from ? baseName(from.name) : null);
    if (from) from.use = true;
    await activate(t2.id);
    note('새 PPT 탭을 만들었습니다.' + (from ? ' "' + from.name + '"을(를) 자료로 씁니다.' : ''));
    target = t2;
  } else if (target && target.kind === 'hwp' && Deck.mentionsDeck(request)) {
    // 한글 문서를 보고 있다가 "PPT 3번 장 …"처럼 이미 만든 PPT를 고치라고 하면 가장 최근 PPT를 고친다.
    const last = state.tabs.filter((x) => x.kind === 'slides' && x.deck.slides.length).pop();
    if (last) { await activate(last.id); state.targetId = last.id; note('"' + last.name + '"을(를) 고칩니다.'); target = last; }
  }
  state.sendTargetId = target ? target.id : null;
  setBusy(true);
  const retryId = 'r' + (++state.retrySeq);
  let before = null, wait = null;
  try {
    const all = await collectSources(sourceIds);
    const sources = all.filter((s) => !s.skipped), skipped = all.filter((s) => s.skipped);
    state.retries[retryId] = { request, sourceIds: all.map((s) => s.id) };
    const retryBtn = '<br><button class="btn small" type="button" data-retry="' + retryId + '">다시 보내기</button>';
    addMsg('me', esc(request) + (sources.length ? '<div class="files">자료: ' + esc(sources.map((s) => s.name).join(', ')) + '</div>' : ''));
    $('prompt').value = '';
    const cuts = sources.filter((s) => s.cut).map((s) => s.name);
    if (cuts.length) note('자료가 길어 앞부분만 보냅니다: ' + cuts.join(', ') + '. 필요한 부분이 뒤에 있으면 그 내용을 요청 칸에 적어 주세요.');
    if (skipped.length) note('자료가 너무 많아 보내지 못한 파일: ' + skipped.map((s) => s.name).join(', ') + '. 필요하면 다른 자료의 선택을 풀고 다시 보내 주세요.');
    wait = addMsg('ai wait', '<span class="spin"></span><span>문서를 읽는 중…</span>');
    const say = (t) => { wait.lastElementChild.textContent = t; };
    if (target && target.kind === 'slides') { await sendSlides(target, request, sources, wait, say, retryId); return; }

    let doc = null, shaBefore = null, map = '';
    if (target) {
      if (!(await activate(target.id, true))) throw new Error('고칠 문서를 열지 못해 요청을 보내지 않았습니다.');
      const got = await lock(async () => {
        if (state.editorTabId !== target.id) throw new Error('고칠 문서를 열지 못해 요청을 보내지 않았습니다.');
        // .hwp로 연 문서는 처음 내보낼 때 지문이 바뀐다. 내보낸 뒤의 지문을 기준으로 삼아야 넣기 직전 확인이 헛걸리지 않는다.
        const bytes = await state.editor.exportHwpx();
        return { sha: await docSha(), bytes };
      });
      shaBefore = got.sha; before = got.bytes;
      doc = await DrHwpxDoc.open(before);
      const mi = doc.mapInfo(MAP_LIMIT);
      map = mi.text;
      if (mi.truncated) note('문서가 길어 뒤의 ' + mi.truncated + '줄은 AI에게 보내지 않았습니다. 그 부분은 편집기에서 직접 고쳐 주세요.');
    }
    const out = await drAi.call(buildPrompt({ target, form: target && target.form, map, request, sources }), SCHEMA, say);
    const reply = String((out && out.reply) || '').trim() || '요청을 처리했습니다.';
    const edits = target && Array.isArray(out && out.edits) ? out.edits : [];
    let res = { changes: [], problems: [] }, applied = null;
    if (edits.length) {
      say('문서에 넣는 중…');
      res = doc.apply(edits, { keepOnePage: target.form && target.form.keepOnePage });
      if (res.changes.length) {
        const packed = await DrHwpxDoc.pack(doc);
        // 넣기 직전 확인부터 넣은 뒤 지문 읽기까지 한 번에 묶는다. 실패하면 원래 문서로 되돌린다.
        applied = await lock(async () => {
          if (!tab(target.id) || state.editorTabId !== target.id || (await docSha()) !== shaBefore) return { changed: true };
          const pagesBefore = await state.editor.pageCount();
          try {
            await state.editor.loadFile(packed, baseName(target.name) + '.hwpx', { skipUnsavedGuard: true });
          } catch (err) {
            try { await state.editor.loadFile(before, baseName(target.name) + '.hwpx', { skipUnsavedGuard: true }); } catch (e2) { state.editorTabId = null; }
            throw err;
          }
          const pagesAfter = await state.editor.pageCount();
          const hwpx = target.form && target.form.check ? await state.editor.exportHwpx() : null;
          return { pagesBefore, pagesAfter, hwpx, sha: await docSha() };
        });
        if (applied.changed) {
          wait.remove();
          addMsg('err', 'AI가 답을 만드는 동안 문서가 바뀌어 고친 내용을 넣지 않았습니다. 같은 요청을 다시 보내 주세요.' + retryBtn);
          return;
        }
        if (applied.pagesAfter > applied.pagesBefore) res.problems.push('문서가 ' + applied.pagesBefore + '쪽에서 ' + applied.pagesAfter + '쪽으로 늘었습니다. 한 쪽으로 맞춰야 하면 글을 줄여 달라고 요청해 주세요.');
      }
    }
    let notes = [];
    if (applied && applied.hwpx) {
      try { notes = target.form.check(await DrHwpxDoc.open(applied.hwpx)); } catch (e) { console.warn(e); }
    }
    wait.remove();
    const turn = addMsg('ai', (target && res.changes.length ? '<div class="doc-tag">' + esc(target.name) + '</div>' : '') +
      '<div class="reply">' + esc(reply) + '</div>' + changesHtml(res.changes, res.problems) +
      (notes.length ? '<div class="checks">문서 확인: ' + notes.map(esc).join(' · ') + '</div>' : ''));
    if (applied) {
      target.undo.push({ turnEl: turn, before, afterSha: applied.sha });
      target.loadSha = applied.sha; target.dirty = true;
      refreshUndoButtons(); renderTabs(); updateSaveNote();
    }
    state.history.push({ user: request, reply: reply + (notes.length ? ' [문서 확인: ' + notes.join(' · ') + ']' : ''), changes: res.changes.map((c) => c.label) });
    delete state.retries[retryId];
    scrollLog();
  } catch (e) {
    console.error(e);
    if (wait) wait.remove();
    const m = e && e.message ? e.message : String(e);
    addMsg('err', esc(m) + '<br><button class="btn small" type="button" data-retry="' + retryId + '">다시 보내기</button>');
    if (!state.retries[retryId]) state.retries[retryId] = { request, sourceIds: null };
    if (/^먼저 AI 설정/.test(m)) drAi.open();
  } finally { setBusy(false); }
}
// PPT 탭: 비어 있으면 새로 만들고(장 구성 → 6장씩 채우기), 있으면 장·칸 주소로 고친다.
async function sendSlides(target, request, sources, wait, say, retryId) {
  const ctx = { role: CFG.role, today: today(), request, sources, name: baseName(target.name), history: state.history.slice(-HISTORY_TURNS) };
  const before = Deck.clone(target.deck);
  const call = (prompt, schema) => drAi.call(prompt, schema, say);
  let reply = '', res = { changes: [], problems: [] };
  if (!target.deck.slides.length) {
    say('PPT를 만드는 중…');
    const r = await Deck.generateDeck(target, ctx, call, say, () => { refreshDeck(target); renderSources(); });
    reply = r.reply || target.deck.slides.length + '장을 만들었습니다.';
    res.problems = r.problems;
    res.changes = [{ label: '새 PPT', before: '', after: (target.deck.title ? target.deck.title + ', ' : '') + target.deck.slides.length + '장' }];
    target.cur = 0;
  } else {
    const out = await call(Deck.editPrompt(ctx, target.deck), Deck.EDIT_SCHEMA);
    reply = String((out && out.reply) || '').trim() || '요청을 처리했습니다.';
    const edits = Array.isArray(out && out.edits) ? out.edits : [];
    if (edits.length) { say('PPT에 넣는 중…'); res = Deck.applyDeckEdits(target.deck, edits); }
  }
  const afterJson = JSON.stringify(target.deck), changed = afterJson !== JSON.stringify(before);
  const notes = changed ? Deck.checkDeck(target.deck) : [];
  wait.remove();
  const turn = addMsg('ai', (changed ? '<div class="doc-tag">' + esc(target.name) + '</div>' : '') +
    '<div class="reply">' + esc(reply) + '</div>' + changesHtml(changed ? res.changes : [], res.problems) +
    (notes.length ? '<div class="checks">PPT 확인: ' + notes.map(esc).join(' · ') + '</div>' : ''));
  if (changed) {
    target.undo.push({ turnEl: turn, before, afterJson });
    target.dirty = true;
    refreshUndoButtons(); renderTabs(); updateSaveNote(); refreshDeck(target); renderSources(); renderEmptyHint();
  }
  state.history.push({ user: request, reply: reply + (notes.length ? ' [PPT 확인: ' + notes.join(' · ') + ']' : ''), changes: res.changes.map((c) => c.label) });
  delete state.retries[retryId];
  scrollLog();
}
$('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });

/* ── 되돌리기: 문서마다 가장 최근에 AI가 고친 것부터 하나씩 ── */
function refreshUndoButtons() {
  document.querySelectorAll('.turn-actions').forEach((n) => n.remove());
  state.tabs.forEach((t) => {
    const last = t.undo[t.undo.length - 1];
    if (!last || !last.turnEl.isConnected) return;
    const bar = document.createElement('div'); bar.className = 'turn-actions';
    bar.innerHTML = `<button class="btn small" type="button" data-undo="${t.id}">되돌리기</button><span>이번에 AI가 고친 곳을 모두 원래대로 돌립니다.</span>`;
    last.turnEl.appendChild(bar);
  });
}
async function undoTurn(btn) {
  if (state.busy) return;
  const t = tab(btn.dataset.undo); if (!t) return;
  const last = t.undo[t.undo.length - 1]; if (!last) return;
  if (t.kind === 'slides') {
    if (JSON.stringify(t.deck) !== last.afterJson &&
        !confirm('AI가 고친 뒤 화면에서 직접 고친 내용이 있습니다. 되돌리면 그 내용도 함께 사라집니다. 되돌릴까요?')) return;
    t.deck = Deck.clone(last.before); t.cur = 0; t.undo.pop(); t.dirty = true;
    const n = document.createElement('div'); n.className = 'undone'; n.textContent = '되돌렸습니다.';
    last.turnEl.appendChild(n);
    refreshUndoButtons(); refreshDeck(t); renderTabs(); updateSaveNote(); updateDownload(); renderSources(); renderEmptyHint();
    return;
  }
  state.sendTargetId = t.id;
  setBusy(true); btn.disabled = true;
  try {
    if (!(await activate(t.id, true))) throw new Error('문서를 열지 못했습니다.');
    const done = await lock(async () => {
      if (state.editorTabId !== t.id) throw new Error('문서를 열지 못했습니다.');
      const now = await docSha();
      if (now && last.afterSha && now !== last.afterSha &&
          !confirm('AI가 고친 뒤 문서에서 직접 고친 내용이 있습니다. 되돌리면 그 내용도 함께 사라집니다. 되돌릴까요?')) return false;
      await state.editor.loadFile(last.before, baseName(t.name) + '.hwpx', { skipUnsavedGuard: true });
      t.loadSha = await docSha();
      return true;
    });
    if (!done) return;
    t.undo.pop();
    const n = document.createElement('div'); n.className = 'undone'; n.textContent = '되돌렸습니다.';
    last.turnEl.appendChild(n);
    refreshUndoButtons();
  } catch (e) {
    addMsg('err', '되돌리지 못했습니다. ' + esc(e && e.message ? e.message : ''));
  } finally { btn.disabled = false; setBusy(false); }
}

/* ── 관리자: 양식 올리기·고치기·지우기 ── */
const adminMsg = (kind, text) => { const m = $('tpl-msg'); m.className = 'admin-msg ' + (kind || ''); m.textContent = text || ''; };
function openAdmin() { $('admin-modal').hidden = false; renderTplList(); }
function closeAdmin() { $('admin-modal').hidden = true; }
$('btn-admin').addEventListener('click', openAdmin);
$('admin-modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeAdmin(); });
$('admin-modal').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAdmin(); });
function renderTplList() {
  $('tpl-list').innerHTML = state.forms.map((f) => f.builtin
    ? `<li><span class="t"><b>${esc(f.title)}</b><br><small>${esc(f.dept || '')} · 기본 양식(저장소 파일이라 여기서는 고칠 수 없습니다. 같은 이름으로 올리면 올린 판이 대신 쓰입니다)</small></span></li>`
    : `<li><span class="t"><b>${esc(f.title)}</b><br><small>${esc(f.dept || '')}${f.meta.year ? ' · ' + esc(f.meta.year) + '학년도' : ''} · ${esc(f.meta.fileName || '')}</small></span>` +
      `<button class="btn small" type="button" data-edit="${esc(f.meta.id)}">고치기</button><button class="btn small danger" type="button" data-del="${esc(f.meta.id)}">지우기</button></li>`
  ).join('') || '<li>등록된 양식이 없습니다.</li>';
}
function resetTplForm() {
  state.admin = { editId: null, tabId: null, file: null };
  ['tpl-title', 'tpl-dept', 'tpl-year', 'tpl-guide', 'tpl-sugg', 'tpl-example'].forEach((id) => { $(id).value = ''; });
  $('tpl-file').value = '';
  $('tpl-form-title').textContent = '새 양식 올리기';
  $('tpl-reset').hidden = true;
  adminMsg('', '');
}
$('tpl-reset').addEventListener('click', resetTplForm);
$('tpl-list').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
  if (ed) {
    const f = state.forms.find((x) => x.meta && x.meta.id === ed.dataset.edit); if (!f) return;
    const m = f.meta;
    resetTplForm();
    state.admin.editId = m.id;
    $('tpl-title').value = m.title || ''; $('tpl-dept').value = m.dept || ''; $('tpl-year').value = m.year || '';
    $('tpl-guide').value = m.guide || ''; $('tpl-sugg').value = (m.suggestions || []).join('\n'); $('tpl-example').value = m.example || '';
    $('tpl-form-title').textContent = '"' + m.title + '" 고치기 (파일을 고르지 않으면 정보만 바뀝니다)';
    $('tpl-reset').hidden = false;
    const t = await openForm(f.id, { quiet: true, noForm: true });
    if (t) state.admin.tabId = t.id;
  } else if (del) {
    const f = state.forms.find((x) => x.meta && x.meta.id === del.dataset.del); if (!f) return;
    if (!confirm('"' + f.title + '" 양식을 지울까요? 교사 목록에서 바로 사라집니다.')) return;
    try { await api('delete', { id: f.meta.id }); await loadForms(); renderTplList(); adminMsg('ok', '지웠습니다.'); if (state.admin.editId === f.meta.id) resetTplForm(); }
    catch (err) { adminMsg('err', err.message); }
  }
});
$('tpl-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (!/\.(hwp|hwpx)$/i.test(f.name)) { adminMsg('err', '한글 파일(.hwp·.hwpx)만 올릴 수 있습니다.'); e.target.value = ''; return; }
  if (f.size > 4 * 1024 * 1024) { adminMsg('err', '4MB 이하 파일만 올릴 수 있습니다.'); e.target.value = ''; return; }
  const bytes = new Uint8Array(await f.arrayBuffer());
  state.admin.file = { name: f.name, bytes, kind: /\.hwpx$/i.test(f.name) ? 'hwpx' : 'hwp' };
  if (!$('tpl-title').value.trim()) $('tpl-title').value = baseName(f.name).replace(/\(.*?\)/g, '').trim();
  const t = newTab({ name: f.name, kind: 'hwp', bytes: bytes.slice(0), loadName: f.name });
  await activate(t.id);
  state.admin.tabId = t.id;
  adminMsg('', '오른쪽 탭에 열었습니다. 작성 기준을 쓰거나 초안 만들기를 눌러 주세요.');
});
$('tpl-draft').addEventListener('click', async () => {
  const t = tab(state.admin.tabId);
  if (!t) { adminMsg('err', '먼저 양식 파일을 고르거나 목록에서 고칠 양식을 눌러 주세요.'); return; }
  if (state.busy) { adminMsg('err', 'AI가 다른 작업을 하는 중입니다. 끝난 뒤 다시 눌러 주세요.'); return; }
  if (!drAi.has()) { drAi.open(); return; }
  if ($('tpl-guide').value.trim() && !confirm('지금 적힌 작성 기준을 AI 초안으로 바꿀까요?')) return;
  const btn = $('tpl-draft'); btn.disabled = true; btn.textContent = '초안 만드는 중…';
  state.sendTargetId = t.id; setBusy(true);
  try {
    if (!(await activate(t.id, true))) throw new Error('양식 파일을 열지 못했습니다.');
    const doc = await DrHwpxDoc.open(await currentHwpx(t));
    const p = [
      '너는 학교 업무 양식의 작성 기준을 정리하는 도우미다. 아래는 한글 양식의 칸 지도다(위치 아이디 [행 이름] = 지금 글).',
      '교사가 이 양식을 AI와 함께 채울 때 AI가 따를 작성 기준을 한국어로 쓴다.',
      '- guide: 칸(또는 행 이름)마다 무엇을 어떤 형식으로 쓰는지 한 줄씩. 표의 반복 줄(명단 등)은 fill_rows로 채운다는 점과 cells 순서를 적는다. 날짜·번호 형식은 양식에 이미 있는 예시를 따른다. 확인할 수 없는 학교 규칙은 지어내지 않는다.',
      '- suggestions: 교사가 누를 예시 요청 3~4개(실제 학생 이름·날짜 같은 구체 값은 넣지 않는다).',
      '- example: 요청 칸에 보일 입력 예시 한 문장.',
      '양식 이름: ' + ($('tpl-title').value.trim() || t.name),
      '[칸 지도]', doc.mapInfo(MAP_LIMIT).text
    ].join('\n');
    const out = await drAi.call(p, { type: 'object', properties: { guide: { type: 'string' }, suggestions: { type: 'array', items: { type: 'string' } }, example: { type: 'string' } }, required: ['guide', 'suggestions', 'example'] }, (m) => adminMsg('', m));
    $('tpl-guide').value = String(out.guide || '').trim();
    if (!$('tpl-sugg').value.trim()) $('tpl-sugg').value = (out.suggestions || []).join('\n');
    if (!$('tpl-example').value.trim()) $('tpl-example').value = String(out.example || '');
    adminMsg('ok', '초안을 넣었습니다. 학교 규칙에 맞게 고친 뒤 저장해 주세요.');
  } catch (err) { adminMsg('err', err.message || String(err)); }
  finally { btn.disabled = false; btn.textContent = '작성 기준 초안 만들기'; setBusy(false); }
});
$('tpl-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const meta = { title: $('tpl-title').value, dept: $('tpl-dept').value, year: $('tpl-year').value, guide: $('tpl-guide').value, suggestions: $('tpl-sugg').value, example: $('tpl-example').value };
  if (!meta.title.trim()) { adminMsg('err', '양식 이름을 입력해 주세요.'); $('tpl-title').focus(); return; }
  if (!state.admin.editId && !state.admin.file) { adminMsg('err', '양식 파일을 골라 주세요.'); return; }
  const payload = { meta };
  if (state.admin.editId) payload.id = state.admin.editId;
  if (state.admin.file) { payload.data = bytesToB64(state.admin.file.bytes); payload.kind = state.admin.file.kind; payload.fileName = state.admin.file.name; }
  const btn = $('tpl-save'); btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const r = await api('save', payload);
    await loadForms(); renderTplList();
    adminMsg('ok', '"' + r.item.title + '"을(를) 저장했습니다. 교사 목록에 바로 보입니다.');
    state.admin.editId = r.item.id; state.admin.file = null; $('tpl-file').value = '';
    $('tpl-form-title').textContent = '"' + r.item.title + '" 고치기'; $('tpl-reset').hidden = false;
  } catch (err) { adminMsg('err', err.message); }
  finally { btn.disabled = false; btn.textContent = '저장'; }
});

/* ── 좁은 화면 ── */
function setPane(p) {
  document.body.dataset.pane = p;
  $('pane-chat').setAttribute('aria-selected', String(p === 'chat'));
  $('pane-work').setAttribute('aria-selected', String(p === 'work'));
}
$('pane-chat').addEventListener('click', () => setPane('chat'));
$('pane-work').addEventListener('click', () => setPane('work'));

/* ── 시작: 교사 확인 → 화면 ── */
function showGate(e) {
  $('gate').hidden = false; $('app').hidden = true;
  if (e && e.status === 403) { $('gate-title').textContent = '교사 전용 메뉴입니다'; $('gate-text').textContent = e.message; }
  else if (e && e.status && e.status !== 401) { $('gate-title').textContent = '확인하지 못했습니다'; $('gate-text').textContent = e.message + ' 잠시 뒤 새로 고쳐 주세요.'; }
}
async function boot() {
  if (CFG.gate) {
    try {
      const me = await api('me');
      state.isAdmin = !!me.isAdmin && CFG.serverForms;
    } catch (e) { showGate(e); return; }
  }
  $('app').hidden = false;
  ['btn-forms', 'btn-open'].forEach((id) => { $(id).hidden = false; });
  $('btn-admin').hidden = !state.isAdmin;
  renderTabs(); renderTarget(); renderSources(); renderAi(); renderEmpty(); updateDownload();
  await loadForms();
  const q = new URLSearchParams(location.search);
  if (q.get('form')) await openForm(q.get('form'));
  if (q.get('admin') === '1' && state.isAdmin) openAdmin();
}
boot();

// 시험용(화면 동작에는 쓰지 않음)
window.__drForms = { state, buildPrompt, send, addFiles, openForm, activate, Deck };
