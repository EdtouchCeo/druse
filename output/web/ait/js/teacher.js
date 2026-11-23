// 교사 진행 화면: 슬라이드 넘기기, 교과서·실습 나란히 보기, 발표 화면(프로젝터) 띄우기, 수업 열기와 학생 화면 맞추기.
import { $, el, loadLesson, normalizeCode, isValidCode, toast, isTyping, keyAction, enableDivider, hasTextbook, clampPage, pageUrl, thumbUrl, teacherSession, presentChannelName, PREVIEW_HOST } from './common.js';
import { createStage, onSwipe, openToc } from './viewer.js';
import { openTeacherRoom, TIMING, SERVER } from './sync.js';
import { createLabArea } from './lab.js';
import { createMusic } from './music.js';
import { createQuizHost } from './quiz-host.js';
import { renderHostView } from './quiz-view.js';
import { createTutorPanel } from './tutor.js';
import { createTalkHost } from './talk.js';
import { teacherToken } from './rt.js';

const params = new URLSearchParams(location.search);
const lessonId = params.get('l') || '';
const HEARTBEAT_MS = TIMING.heartbeat;
const ACTIVE_MS = TIMING.active;

const state = { mode: 'slides', slide: 1, page: null, lock: false, preview: false, tutor: true, seq: 0, session: crypto.randomUUID() };
let lesson;
let stage;
let room = null;
let roomCode = null;
let sidePage = null;
let sideTab = 'textbook';
let labPanel = null;
let labSnap = null;
let blank = null; // 'black' | 'white' | null
let quiz = null;
let quizHost = null;
let talk = null;
let tutorPanel = null;
const tutorLogs = [];
const music = createMusic();
const people = new Map();
const present = { channel: null, window: null, connected: false, lastSeen: 0, startedAt: 0 };

function fail(message) {
  document.body.classList.remove('class-body');
  document.body.replaceChildren(el('div', { class: 'center-card' },
    el('img', { src: '/img/teacher/thinking.webp', alt: '' }),
    el('h1', {}, message),
    el('p', {}, el('a', { href: '/ait/' }, 'Dave AIT Class 첫 화면으로'))));
}

async function start() {
  if (!PREVIEW_HOST && !teacherSession()) {
    const back = encodeURIComponent(location.pathname + location.search);
    document.body.replaceChildren(el('div', { class: 'center-card' },
      el('img', { src: '/img/teacher/pointing.webp', alt: '' }),
      el('h1', {}, '관리자 로그인이 필요합니다'),
      el('p', {}, '대륜고 사용 설명서에 사이트 관리자 계정으로 로그인한 뒤 다시 열어 주세요.'),
      el('p', {}, el('a', { class: 'btn', href: `/?gate_return=${back}#login` }, '로그인하러 가기'))));
    return;
  }
  try {
    lesson = await loadLesson(lessonId);
  } catch {
    fail('차시 자료를 찾지 못했습니다');
    return;
  }
  document.title = `${lesson.title} | Dave AIT Class`;
  $('#lesson-name').replaceChildren(lesson.title, el('small', {}, `${lesson.slides.length}장 · 교과서 ${lesson.textbook.first}~${lesson.textbook.last}쪽`));
  const draft = lesson.approval?.status !== 'approved';
  $('#draft-badge').hidden = !draft;
  stage = createStage($('#stage'), lesson);
  state.page = lesson.slides[0].textbook?.page ?? lesson.textbook.first;

  const hasLab = lesson.labs?.length > 0;
  $('[data-mode="lab"]').disabled = !hasLab;
  $('[data-mode="lab"]').title = hasLab ? '학생 화면을 슬라이드와 실습 나란히 보기로 바꿉니다' : '이 차시에는 연결된 실습이 없습니다';
  $('[data-tab="lab"]').disabled = !hasLab;
  $('[data-mode="textbook"]').disabled = !lesson.textbookMeta;
  if (lesson.quiz) {
    try {
      const res = await fetch(`${lesson.base}/${lesson.quiz}`, { cache: 'no-cache' });
      if (res.ok) quiz = await res.json();
    } catch { quiz = null; }
  }
  const quizOk = quiz && (quiz.approval?.status === 'approved' || PREVIEW_HOST);
  $('[data-mode="quiz"]').disabled = !quizOk;
  $('[data-mode="quiz"]').title = !quiz ? '이 차시에는 퀴즈가 없습니다' : quizOk ? `${quiz.questions.length}문항 경쟁 퀴즈` : '승인한 퀴즈만 열 수 있습니다';

  const openBtn = $('#open-room');
  openBtn.hidden = false;
  if (draft && !PREVIEW_HOST) {
    openBtn.disabled = true;
    openBtn.title = '승인한 차시만 학생에게 열 수 있습니다';
  } else if (draft) {
    openBtn.textContent = '검토용으로 열기';
  }
  openBtn.addEventListener('click', () => askCode(draft));

  bindControls();
  enableDivider($('#ws'), $('#divider'), 'ait_split_teacher');
  openPresentChannel();
  const saved = sessionStorage.getItem(`ait_room_${lesson.id}`);
  if (saved) openClass(draft, saved, false);
  render();
}

function bindControls() {
  $('#prev').addEventListener('click', () => act('prev'));
  $('#next').addEventListener('click', () => act('next'));
  $('#toc').addEventListener('click', () => openToc(lesson, state.slide, (n) => { if (state.mode === 'textbook') setMode('slides'); goSlide(n); }));
  $('#notes-btn').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    $('#notes').hidden = !on;
    renderNotes();
  });
  $('#side-btn').addEventListener('click', (e) => toggleSide(e.currentTarget.getAttribute('aria-pressed') !== 'true'));
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#stage').requestFullscreen?.();
  });
  $('#present').addEventListener('click', openProjector);
  $('#blank').addEventListener('click', () => setBlank(blank ? null : 'black'));
  $('#tb-prev').addEventListener('click', () => showSidePage(sidePage - 1));
  $('#tb-next').addEventListener('click', () => showSidePage(sidePage + 1));
  $('#tb-sync').addEventListener('click', () => showSidePage(currentSlide().textbook?.page));
  document.querySelectorAll('#modebar [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#lock').addEventListener('click', (e) => {
    state.lock = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(state.lock));
    broadcast();
    toast(state.lock ? '학생 화면을 진행 화면에 고정했습니다.' : '학생이 다른 장을 둘러볼 수 있습니다.');
  });
  $('#code-chip').addEventListener('click', showCode);
  $('#tutor-toggle').addEventListener('click', (e) => {
    state.tutor = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(state.tutor));
    e.currentTarget.textContent = state.tutor ? '학생 튜터 켜짐' : '학생 튜터 꺼짐';
    broadcast();
  });
  $('#close-room').addEventListener('click', closeClass);
  onSwipe($('#stage'), () => act('next'), () => act('prev'));
  document.addEventListener('keydown', (e) => {
    if (isTyping(e) || document.querySelector('.drawer, .overlay')) return;
    const action = keyAction(e);
    if (!action) return;
    e.preventDefault();
    act(action);
  });
}

// 키보드, 리모컨, 발표 화면에서 온 동작을 한곳에서 처리한다.
function act(action) {
  if (state.mode === 'quiz' && quizHost) {
    if (action === 'next') quizHost.action('next');
    return;
  }
  if (state.mode === 'talk') return;
  if (action === 'next') step(1);
  else if (action === 'prev') step(-1);
  else if (action === 'first') state.mode === 'textbook' ? goPage(lesson.textbook.first) : goSlide(1);
  else if (action === 'last') state.mode === 'textbook' ? goPage(lesson.textbook.last) : goSlide(lesson.slides.length);
  else if (action === 'black' || action === 'white') setBlank(blank === action ? null : action);
  else if (action === 'full') { if (!present.connected) openProjector(); }
}

const currentSlide = () => lesson.slides[state.slide - 1];

function step(d) {
  if (blank) { setBlank(null); return; } // 가린 화면에서 넘기면 먼저 화면을 다시 보인다.
  if (state.mode === 'textbook') goPage(state.page + d);
  else goSlide(state.slide + d);
}

function goSlide(n) {
  const next = Math.min(lesson.slides.length, Math.max(1, n));
  if (next === state.slide) return;
  state.slide = next;
  const page = currentSlide().textbook?.page;
  if (hasTextbook(lesson, page)) state.page = page;
  render();
  if (talkSideOn()) renderTalkSide();
  broadcast();
}

function goPage(p) {
  const page = clampPage(lesson, p);
  if (page === null || page === state.page) return;
  state.page = page;
  render();
  broadcast();
}

function setMode(mode) {
  if (mode === 'textbook' && !lesson.textbookMeta) return;
  if (mode === 'lab' && !lesson.labs?.length) return;
  if (mode === 'quiz') {
    if (!quiz) return;
    if (!room) { toast('먼저 수업을 열어 참여 코드를 만든 뒤 퀴즈를 시작해 주세요.', '수업 열기', () => $('#open-room').click(), 7000); return; }
    if (!quizHost) startQuiz();
  }
  if (mode === 'talk' && !room) { toast('먼저 수업을 열어 참여 코드를 만든 뒤 참여방을 시작해 주세요.', '수업 열기', () => $('#open-room').click(), 7000); return; }
  state.mode = mode;
  showQuizLayer(mode === 'quiz');
  music.setAway(mode !== 'quiz');
  showTalkLayer(mode === 'talk');
  document.querySelectorAll('#modebar [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  if (mode === 'lab') { toggleSide(true); showTab('lab'); }
  render();
  broadcast();
  toast(mode === 'lab' ? '학생 화면을 슬라이드와 실습 나란히 보기로 바꿨습니다.' : mode === 'textbook' ? '학생 화면에 교과서를 보여 줍니다.' : mode === 'quiz' ? '학생 화면을 퀴즈로 바꿨습니다.' : mode === 'talk' ? '학생 화면을 참여방으로 바꿨습니다.' : '학생 화면에 슬라이드를 보여 줍니다.');
  if (mode === 'quiz') quizHost.publish();
}

function render() {
  if (state.mode === 'textbook') {
    stage.showPage(state.page);
    $('#count').textContent = `교과서 ${state.page}쪽`;
  } else {
    stage.showSlide(state.slide);
    $('#count').textContent = `${state.slide} / ${lesson.slides.length}`;
  }
  renderNotes();
  renderPresenter();
  if (!$('#ws').classList.contains('single')) {
    if (sideTab === 'textbook') showSidePage(currentSlide().textbook?.page);
    else if (sideTab === 'lab' && labPanel) focusLab();
    else if (sideTab === 'tutor') tutorPanel?.refresh();
  }
  sendPresent();
}

function renderNotes() {
  const box = $('#notes');
  if (box.hidden) return;
  const s = currentSlide();
  box.replaceChildren(el('h3', {}, `${s.n}장 발표 노트`), el('p', {}, s.notes || '노트가 없습니다.'));
}

function renderPresenter() {
  const bar = $('#presenter');
  bar.hidden = !present.connected || state.mode === 'quiz' || state.mode === 'talk';
  if (bar.hidden) return;
  const next = lesson.slides[state.slide];
  $('#next-thumb').hidden = !next || state.mode === 'textbook';
  if (next) $('#next-thumb').src = thumbUrl(lesson, next);
  $('#next-title').textContent = state.mode === 'textbook' ? `교과서 ${state.page + 1 <= lesson.textbook.last ? state.page + 1 : state.page}쪽` : next ? `${next.n}. ${next.title}` : '마지막 장입니다';
  $('#blank-state').hidden = !blank;
  $('#blank-state').textContent = blank === 'white' ? '발표 화면을 흰 화면으로 가렸습니다' : '발표 화면을 검은 화면으로 가렸습니다';
}

function toggleSide(on) {
  $('#side-btn').setAttribute('aria-pressed', String(on));
  $('#ws').classList.toggle('single', !on);
  if (on) showTab(sideTab);
}

async function showTab(tab) {
  if (tab === 'lab' && !lesson.labs?.length) tab = 'textbook';
  if (tab === 'tutor') { ensureTutor(); }
  if (tab === 'textbook' && !lesson.textbookMeta) tab = 'lab';
  if (tab === 'talk' && !room) { toast('먼저 수업을 열어 참여 코드를 만든 뒤 참여방을 시작해 주세요.', '수업 열기', () => $('#open-room').click(), 7000); return; }
  sideTab = tab;
  document.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on)); });
  $('#tb-body').hidden = tab !== 'textbook';
  $('#tb-tools').hidden = tab !== 'textbook';
  $('#lab-body').hidden = tab !== 'lab';
  $('#tutor-body').hidden = tab !== 'tutor';
  $('#talk-body').hidden = tab !== 'talk';
  if (tab === 'talk') { renderTalkSide(); return; }
  if (tab === 'textbook') showSidePage(currentSlide().textbook?.page);
  else if (tab === 'lab') await ensureLab();
  else tutorPanel?.refresh();
}

async function ensureLab() {
  if (labPanel) { focusLab(); return; }
  try {
    labPanel = createLabArea($('#lab-pane'), lesson, {
      storagePrefix: 'ait_lab_teacher',
      onChange: (snap) => { labSnap = snap; sendPresent('lab'); },
    });
    await labPanel.ready;
    focusLab();
  } catch {
    $('#lab-pane').replaceChildren(el('p', { class: 'hint' }, '실습 자료를 불러오지 못했습니다.'));
  }
}

function focusLab() {
  const link = currentSlide().lab;
  if (labPanel && link) labPanel.focus(link);
}

function showSidePage(p) {
  const page = clampPage(lesson, p ?? lesson.textbook.first);
  if (page === null) return;
  sidePage = page;
  $('#tb-img').src = pageUrl(lesson, page);
  $('#tb-img').alt = `교과서 ${page}쪽`;
  $('#tb-title').textContent = `${page}쪽`;
}

// 발표 화면(프로젝터): 같은 컴퓨터의 다른 창이므로 서버 없이 이어진다.
function openPresentChannel() {
  present.channel = new BroadcastChannel(presentChannelName(lesson.id));
  present.channel.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.type === 'hello') {
      present.lastSeen = Date.now();
      if (!present.connected) { present.connected = true; present.startedAt = Date.now(); }
      sendPresent('all');
      updatePresentUi();
    } else if (msg.type === 'ping') {
      present.lastSeen = Date.now();
      if (!present.connected) { present.connected = true; present.startedAt = present.startedAt || Date.now(); updatePresentUi(); }
    } else if (msg.type === 'bye') {
      present.connected = false;
      updatePresentUi();
    } else if (msg.type === 'key') {
      act(msg.action);
    }
  };
  setInterval(() => {
    if (present.connected && Date.now() - present.lastSeen > 8000) { present.connected = false; updatePresentUi(); }
    if (present.connected) $('#timer').textContent = elapsed(Date.now() - present.startedAt);
  }, 1000);
}

const elapsed = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

function updatePresentUi() {
  $('#present-badge').hidden = !present.connected;
  $('#blank').hidden = !present.connected;
  $('#full').hidden = present.connected; // 발표 화면이 있으면 진행 화면은 전체 화면이 필요 없다.
  $('#present').title = present.connected ? '발표 화면을 다시 엽니다' : '프로젝터에 띄울 발표 화면을 엽니다';
  if (!present.connected && blank) blank = null;
  renderPresenter();
}

function sendPresent(what = 'state') {
  if (!present.channel) return;
  if (what === 'state' || what === 'all') present.channel.postMessage({ type: 'state', lesson: lesson.id, mode: state.mode, slide: state.slide, page: state.page, blank });
  if ((what === 'lab' || what === 'all') && labSnap) present.channel.postMessage({ type: 'lab', snap: labSnap });
}

async function openProjector() {
  let features = 'popup,width=1280,height=720';
  // 화면이 둘이면(노트북+프로젝터) 발표 화면을 다른 화면에 연다. 브라우저가 화면 배치 권한을 물을 수 있다.
  if ('getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails();
      const other = details.screens.find((s) => s !== details.currentScreen);
      if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    } catch { /* 권한을 거절하면 같은 화면에 연다. */ }
  }
  present.window = window.open(`/ait/present.html?l=${encodeURIComponent(lesson.id)}`, 'ait-present', features);
  if (!present.window) {
    toast('팝업이 막혀 발표 화면을 열지 못했습니다. 주소창의 팝업 차단을 풀고 다시 눌러 주세요.', null, null, 7000);
    return;
  }
  toast('발표 화면을 프로젝터 쪽으로 옮긴 뒤 그 화면을 한 번 누르면 전체 화면이 됩니다.', null, null, 7000);
}

function setBlank(kind) {
  blank = kind;
  $('#blank').setAttribute('aria-pressed', String(!!blank));
  $('#blank').textContent = blank ? '다시 보이기' : '가리기';
  renderPresenter();
  sendPresent();
}

// 수업 열기: 참여 코드를 만들고 학생 화면에 지금 상태를 보낸다.
// 사이트에서는 서버가 방과 코드를 만들고, 새로 고침 뒤에는 같은 방을 이어 연다.
let opening = false;
async function openClass(draft, savedRoom = null, announce = true, code = '') {
  if (opening || room) return;
  opening = true;
  const btn = $('#open-room');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '여는 중…';
  try {
    room = await openTeacherRoom({ lessonId: lesson.id, roomId: savedRoom, code, onStatus: connectionStatus });
  } catch (e) {
    btn.disabled = false;
    btn.textContent = label;
    if (savedRoom) sessionStorage.removeItem(`ait_room_${lesson.id}`);
    if (!savedRoom || !['CLOSED', 'NO_ROOM'].includes(e.code)) toast(e.message, null, null, 9000);
    // 정한 코드가 맞지 않거나 이미 쓰이면 다시 정하게 한다.
    if (code && ['BAD_CODE', 'CODE_TAKEN'].includes(e.code)) askCode(draft, code, e.message);
    return;
  } finally {
    opening = false;
  }
  roomCode = room.code;
  state.preview = draft;
  sessionStorage.setItem(`ait_room_${lesson.id}`, room.roomId);
  room.on(onMessage);
  $('#open-room').hidden = true;
  $('#code-chip').hidden = false;
  $('#code-chip').textContent = roomCode;
  $('#close-room').hidden = false;
  $('#people').hidden = false;
  updatePeople();
  broadcast();
  setInterval(() => { broadcast(); updatePeople(); }, HEARTBEAT_MS);
  if (announce) showCode();
}

async function closeClass() {
  if (!room) return;
  if (!confirm('수업을 닫으면 학생 화면이 모두 종료됩니다. 닫을까요?')) return;
  room.send({ type: 'closed' });
  try {
    await room.closeRoom();
  } catch (e) {
    toast(`수업 닫기를 서버에 알리지 못했습니다. ${e.message}`, null, null, 8000);
    return;
  }
  room.close();
  sessionStorage.removeItem(`ait_room_${lesson.id}`);
  location.reload();
}

// 실시간 연결 상태를 참여 코드 옆에 알린다.
function connectionStatus(s) {
  const chip = $('#code-chip');
  const bad = s === 'reconnecting' || s === 'no-token' || s === 'denied';
  chip.classList.toggle('offline', bad);
  chip.title = s === 'denied' ? '실시간 연결 권한을 받지 못했습니다. 사용 설명서에 다시 로그인한 뒤 새로 고쳐 주세요.'
    : s === 'no-token' ? '로그인 정보가 만료되었습니다. 사용 설명서에 다시 로그인해 주세요.'
      : bad ? '연결이 끊겨 다시 잇는 중입니다.' : '학생 기기와 연결되어 있습니다.';
  if (s === 'denied' || s === 'no-token') toast(chip.title, null, null, 9000);
}

function broadcast() {
  if (!room) return;
  state.seq += 1;
  room.send({ type: 'state', lesson: lesson.id, mode: state.mode, slide: state.slide, page: state.page, lock: state.lock, preview: state.preview, tutor: state.tutor, seq: state.seq, session: state.session });
}

function onMessage(msg) {
  if (!msg || typeof msg.pid !== 'string') return;
  if (quizHost && (msg.type.startsWith('quiz-') || (msg.type === 'hello' && state.mode === 'quiz'))) quizHost.handle(msg);
  if (msg.type.startsWith('talk-') || (msg.type === 'hello' && talk)) ensureTalk().handle(msg);
  if (msg.type === 'tutor-log') { tutorLogs.push({ ...msg, at: Date.now() }); drawTalk(); }
  if (msg.type === 'hello' || msg.type === 'ping') {
    people.set(msg.pid, { last: Date.now(), slide: msg.slide, following: msg.following !== false });
    if (msg.type === 'hello') broadcast();
  } else if (msg.type === 'bye') {
    people.delete(msg.pid);
  }
  updatePeople();
}

function updatePeople() {
  const now = Date.now();
  for (const [pid, p] of people) if (now - p.last > ACTIVE_MS) people.delete(pid);
  const total = people.size;
  const away = [...people.values()].filter((p) => !p.following).length;
  $('#people').textContent = total ? `참여 ${total}명${away ? ` · 둘러보는 중 ${away}명` : ''}` : '참여 0명';
}

// 수업 열기 전에 참여 코드를 정한다. 비우면 서버가 만든다. 마지막에 쓴 코드를 기억해 다음 반에서도 쓰기 쉽게 한다.
const CODE_KEY = 'ait_last_code';
function askCode(draft, value = null, error = '') {
  if (room || document.querySelector('.open-dialog')) return;
  let last = '';
  try { last = localStorage.getItem(CODE_KEY) || ''; } catch { last = ''; }
  const input = el('input', {
    id: 'open-code', maxlength: '6', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    placeholder: '비우면 자동', value: value ?? last, 'aria-describedby': 'open-code-help open-code-msg',
  });
  const msg = el('p', { class: 'msg error', id: 'open-code-msg', role: 'alert' }, error);
  const close = () => box.remove();
  const submit = (e) => {
    e.preventDefault();
    const code = normalizeCode(input.value);
    if (code && !isValidCode(code)) {
      msg.textContent = '영문과 숫자 6자리로 정해 주세요. 헷갈리는 0, 1, I, O는 쓸 수 없습니다.';
      input.focus();
      return;
    }
    try { if (code) localStorage.setItem(CODE_KEY, code); } catch { /* 저장소를 막은 브라우저 */ }
    close();
    openClass(draft, null, true, code);
  };
  const box = el('div', { class: 'open-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'open-code-title' },
    el('form', { class: 'open-card', onsubmit: submit },
      el('h2', { id: 'open-code-title' }, draft ? '검토용으로 수업 열기' : '수업 열기'),
      el('label', { for: 'open-code' }, '참여 코드'),
      input,
      el('p', { class: 'hint', id: 'open-code-help' }, '영문과 숫자 6자리로 직접 정할 수 있습니다(예: DAVE22). 비워 두면 자동으로 만듭니다. 헷갈리는 0, 1, I, O는 쓸 수 없습니다.'),
      msg,
      el('div', { class: 'open-actions' },
        el('button', { type: 'button', class: 'btn-ghost', onclick: close }, '취소'),
        el('button', { type: 'submit', class: 'btn' }, '수업 열기'))));
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  input.addEventListener('input', () => { const v = normalizeCode(input.value); if (v !== input.value) input.value = v; msg.textContent = ''; });
  document.body.append(box);
  input.focus();
  input.select();
}

function showCode() {
  const url = `${location.host}/ait/`;
  const close = () => box.remove();
  const box = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': '참여 코드', onclick: close },
    el('div', {},
      el('img', { src: '/img/teacher/presenter.webp', alt: '' }),
      el('p', {}, state.preview ? '검토용 미리보기입니다. 아래 코드로 들어오세요.' : '아래 주소에서 참여 코드를 넣어 주세요.'),
      el('div', { class: 'url' }, url),
      el('div', { class: 'big-code' }, roomCode),
      el('p', {}, '화면을 누르면 수업으로 돌아갑니다.')));
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); });
  box.tabIndex = -1;
  document.body.append(box);
  box.focus();
  // 발표 화면에도 같은 코드를 크게 띄운다.
  present.channel?.postMessage({ type: 'code', code: roomCode, url, preview: state.preview });
  box.addEventListener('click', () => present.channel?.postMessage({ type: 'code', code: null }));
}

// 퀴즈
function startQuiz() {
  quizHost = createQuizHost({
    lesson, quiz, room, music,
    code: roomCode,
    url: `${location.host}/ait/`,
    render: (view) => renderHostView($('#quiz-host'), view, { teacher: true, onAction: quizAction }),
    present: (view) => present.channel?.postMessage({ type: 'quiz', view }),
    onGotoSlide: (n) => { setMode('slides'); goSlide(n); toast('해설을 마치면 위쪽의 퀴즈 버튼으로 돌아옵니다.'); },
  });
  quizHost.begin();
}

function quizAction(name, arg) {
  if (name === 'people') { openPeople(); return; }
  if (name === 'leave') {
    const waiting = quizHost.people().filter((p) => !p.kicked).length;
    if (waiting && !confirm(`학생 ${waiting}명이 대기실에 들어와 있습니다. 퀴즈를 닫고 슬라이드로 돌아갈까요?`)) return;
    quizHost.end();
    quizHost = null;
    setMode('slides');
    return;
  }
  if (name === 'finish') {
    if (!confirm('퀴즈를 마치고 슬라이드로 돌아갈까요? 결과를 내려받지 않았다면 먼저 내려받아 주세요.')) return;
    quizHost.end();
    quizHost = null;
    setMode('slides');
    return;
  }
  quizHost.action(name, arg);
}

function showQuizLayer(on) {
  $('#quiz-host').hidden = !on;
  $('#stage').hidden = on;
  document.querySelector('.pane .controls').hidden = on;
  if (on) { $('#notes').hidden = true; $('#presenter').hidden = true; $('#notes-btn').setAttribute('aria-pressed', 'false'); }
  else renderPresenter();
}

// 참가자 목록: 장난스러운 대화명을 초기화하거나 내보낸다.
function openPeople() {
  const list = el('ul', { class: 'people-list' });
  const draw = () => {
    list.replaceChildren(...quizHost.people().filter((p) => !p.kicked).map((p) => el('li', {},
      el('span', { class: 'no' }, `${p.no}`),
      el('span', { class: 'name' }, p.name, p.nameLocked ? el('small', {}, ' 고정') : null),
      el('span', { class: 'score' }, `${p.score.toLocaleString()}점`),
      el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => { quizHost.resetName(p.pid, true); draw(); } }, '대화명 초기화'),
      el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => { quizHost.kick(p.pid); draw(); } }, '내보내기'))));
    if (!list.childElementCount) list.append(el('li', { class: 'hint' }, '들어온 학생이 없습니다.'));
  };
  draw();
  const panel = el('div', { class: 'drawer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '참가자' },
    el('h2', {}, '참가자', el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: close }, '닫기')),
    el('p', { class: 'hint' }, '대화명을 초기화하면 "대륜이 번호"로 바뀌고 학생이 다시 바꾸지 못합니다.'),
    el('p', {}, el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: () => { if (confirm('모든 학생의 대화명을 초기화할까요?')) { quizHost.resetAllNames(); draw(); } } }, '모두 초기화')),
    list);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const drawer = el('div', { class: 'drawer', onclick: (e) => { if (e.target === drawer) close(); } }, panel);
  document.addEventListener('keydown', onKey);
  document.body.append(drawer);
  panel.querySelector('button').focus();
  function close() { drawer.remove(); document.removeEventListener('keydown', onKey); }
}

// AI 튜터(교사용): 정답과 해설까지 답한다. 실제 판단은 서버가 교사 로그인으로 한다.
function ensureTutor() {
  if (tutorPanel) return;
  tutorPanel = createTutorPanel($('#tutor-pane'), {
    role: 'teacher',
    getToken: teacherToken,
    getContext: () => {
      const s = currentSlide();
      return { lessonTitle: lesson.title, slideN: s.n, slideTitle: s.title, slideText: s.text, notes: s.notes, page: s.textbook?.page, cell: labPanel?.cellContext() || null };
    },
  });
}

// 참여방
function ensureTalk() {
  if (!talk) {
    talk = createTalkHost({
      lesson, room,
      present: (m) => present.channel?.postMessage(m),
      onChange: drawTalk,
      getSlide: () => state.slide,
      tutorLog: () => tutorLogs,
    });
  }
  return talk;
}

function showTalkLayer(on) {
  $('#talk-host').hidden = !on;
  if (on) {
    ensureTalk();
    $('#stage').hidden = true;
    document.querySelector('.pane .controls').hidden = true;
    $('#notes').hidden = true;
    $('#presenter').hidden = true;
    renderTalk();
    talk.publish();
  } else if (state.mode !== 'quiz') {
    $('#stage').hidden = false;
    document.querySelector('.pane .controls').hidden = false;
  }
}

// 진행 화면과 오른쪽 칸 가운데 보이는 쪽을 다시 그린다.
function drawTalk() {
  if (state.mode === 'talk') renderTalk();
  if (talkSideOn()) renderTalkSide();
}
const talkSideOn = () => sideTab === 'talk' && !$('#ws').classList.contains('single') && !$('#talk-body').hidden;

// 주제 칸: 댓글이 올라와 다시 그려도 적던 주제와 커서가 남도록 글을 따로 들고 있는다.
let topicDraft = '';
function talkTopics(t, where) {
  const topicInput = el('input', { class: 'talk-topic-input', maxlength: '140', placeholder: '예: 과적합을 일상의 예로 설명해 보면?', 'aria-label': '새 주제' });
  topicInput.value = topicDraft;
  topicInput.dataset.where = where;
  topicInput.addEventListener('input', () => { topicDraft = topicInput.value; });
  const bind = el('input', { type: 'checkbox' });
  const addTopic = () => { if (topicInput.value.trim()) { const text = topicInput.value; topicDraft = ''; t.addTopic(text, bind.checked ? state.slide : null); } };
  topicInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) addTopic(); });
  return el('section', { class: 'panel' },
    el('h2', {}, '주제'),
    el('div', { class: 'talk-add' }, topicInput, el('button', { type: 'button', class: 'btn-sm', onclick: addTopic }, '추가')),
    el('label', { class: 'check' }, bind, `지금 장(${state.slide}장)에 묶기`),
    el('ol', { class: 'topic-list' }, ...t.topics().map((x, i) => el('li', { class: x.id === t.topicId ? 'on' : '' },
      el('span', { class: 'n' }, `${i + 1}`),
      el('span', { class: 'txt' }, x.text, x.slide ? el('small', {}, ` · ${x.slide}장`) : null),
      x.id === t.topicId && t.open ? el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => t.close() }, '닫기')
        : el('button', { type: 'button', class: 'btn-xs', onclick: () => t.openTopic(x.id) }, x.openedAt ? '다시 열기' : '열기'),
      x.id === t.topicId && t.open ? null : el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => t.removeTopic(x.id) }, '지우기')))),
    t.topics().length ? null : el('p', { class: 'hint' }, '주제를 여러 개 만들어 두고 수업 중에 하나씩 엽니다.'));
}

// 지금 주제와 올라온 의견
function talkFeed(t) {
  const current = t.topics().find((x) => x.id === t.topicId);
  const feed = t.feed();
  return [
    el('div', { class: 'talk-host-head' },
      el('div', {}, el('span', { class: 'talk-label' }, t.open ? '열림' : '닫힘'), el('h2', {}, current ? current.text : '주제를 골라 열어 주세요')),
      current ? (t.open ? el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: () => t.close() }, '댓글창 닫기') : el('button', { type: 'button', class: 'btn-gold btn-sm', onclick: () => t.reopen() }, '댓글창 다시 열기')) : null),
    el('p', { class: 'hint' }, `의견 ${feed.length}건${t.filteredCount() ? ` · 걸러진 글 ${t.filteredCount()}건(학생에게 보이지 않음)` : ''}`),
    el('ol', { class: 'talk-list host' }, ...feed.slice().reverse().map((m) => {
      const p = t.person(m.pid);
      return el('li', { class: `talk-msg${t.spotlight() === m.id ? ' spot' : ''}` },
        el('div', { class: 'talk-meta' }, el('strong', {}, `${p?.name || ''}`), el('small', {}, ` #${p?.no} · ${new Date(m.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}${m.replyTo ? ` · ${m.replyTo}번 글에 답함` : ''}`), el('span', { class: 'talk-likes' }, `공감 ${m.likes.size}`)),
        el('p', { class: 'talk-text' }, m.text),
        el('div', { class: 'talk-tools' },
          el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => t.toggleSpotlight(m.id) }, t.spotlight() === m.id ? '크게 띄우기 끄기' : '크게 띄우기'),
          el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => t.remove(m.id) }, '지우기'),
          el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => t.resetName(m.pid) }, '대화명 초기화'),
          el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => t.block(m.pid) }, p?.blocked ? '쓰기 다시 허용' : '글쓴이 쓰기 막기')));
    })),
    t.filteredCount() ? el('details', { class: 'talk-filtered' }, el('summary', {}, `걸러진 글 ${t.filteredCount()}건 보기`),
      el('ol', {}, ...t.filteredList().map((m) => el('li', {}, `#${t.person(m.pid)?.no} ${m.text}`,
        el('button', { type: 'button', class: 'btn-ghost btn-xs', onclick: () => t.block(m.pid) }, t.person(m.pid)?.blocked ? '쓰기 다시 허용' : '쓰기 막기'))))) : null,
  ].filter(Boolean);
}

// 다시 그린 뒤에도 주제 입력칸의 커서를 돌려놓는다.
function keepTopicFocus(box, where, draw) {
  const active = document.activeElement;
  const had = active?.classList?.contains('talk-topic-input') && active.dataset.where === where;
  const caret = had ? [active.selectionStart, active.selectionEnd] : null;
  draw();
  if (!had) return;
  const input = box.querySelector('.talk-topic-input');
  input.focus();
  try { input.setSelectionRange(caret[0], caret[1]); } catch (e) { /* 커서를 못 옮겨도 글은 남는다 */ }
}

function renderTalk() {
  const t = ensureTalk();
  const box = $('#talk-host');
  const classInput = el('input', { maxlength: '20', value: t.className, placeholder: '예: 1-3', 'aria-label': '반' });
  classInput.addEventListener('change', () => t.setClass(classInput.value));
  const anon = el('input', { type: 'checkbox', id: 'talk-anon' });
  const bySlide = new Map();
  tutorLogs.forEach((l) => bySlide.set(l.slide, (bySlide.get(l.slide) || 0) + 1));
  const hot = [...bySlide.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  keepTopicFocus(box, 'main', () => box.replaceChildren(
    el('div', { class: 'talk-side-col' },
      talkTopics(t, 'main'),
      el('section', { class: 'panel' },
        el('h2', {}, '학생 튜터 질문 ', el('small', {}, `${tutorLogs.length}건`)),
        hot.length ? el('p', { class: 'hint' }, `질문이 많은 장: ${hot.map(([s, n]) => `${s}장 ${n}건`).join(', ')}`) : el('p', { class: 'hint' }, '아직 질문이 없습니다.'),
        el('ol', { class: 'tutor-log' }, ...tutorLogs.slice(-5).reverse().map((l) => el('li', {}, el('small', {}, `${l.slide}장 · 힌트 ${l.level}단계${l.flagged ? ' · 다시 쓰기' : ''}`), el('p', {}, l.question))))),
      el('section', { class: 'panel' },
        el('h2', {}, '대화 저장'),
        el('label', {}, '반', classInput),
        el('label', { class: 'check' }, anon, '대화명 빼고 저장(참가자 번호만)'),
        el('button', { type: 'button', class: 'btn-sm', onclick: () => toast(`내려받았습니다: ${t.exportFiles(anon.checked)}`) }, '분석용 파일 내려받기'),
        el('p', { class: 'hint' }, '댓글, 주제, 참가자, 튜터 질문을 한 줄에 한 건씩 CSV로 저장하고 같은 내용을 JSON으로 함께 저장합니다.'))),
    el('div', { class: 'talk-main-col' }, ...talkFeed(t))));
}

// 오른쪽 칸의 참여방: 슬라이드를 띄운 채로 주제를 열고 올라오는 의견을 본다.
function renderTalkSide() {
  const t = ensureTalk();
  const box = $('#talk-side-pane');
  keepTopicFocus(box, 'side', () => box.replaceChildren(
    el('section', { class: 'panel talk-side-feed' }, ...talkFeed(t)),
    talkTopics(t, 'side'),
    el('p', { class: 'hint' }, '대화 저장과 학생 튜터 질문은 위쪽 수업 모드의 참여방에서 봅니다.')));
}

start();
