// 학생 참여 화면: 참여 코드로 들어와 선생님 화면을 따라가고, 지난 장을 둘러보다 돌아온다.
import { $, el, loadLesson, normalizeCode, isValidCode, isTyping, enableDivider, hasTextbook, clampPage, pageUrl, PREVIEW_HOST } from './common.js';
import { createStage, onSwipe, openToc } from './viewer.js';
import { openRoom } from './sync.js';
import { createLabArea } from './lab.js';
import { createQuizPlayer } from './quiz-player.js';
import { createTutorPanel } from './tutor.js';
import { createTalkPlayer } from './talk.js';

const code = normalizeCode(new URLSearchParams(location.search).get('code'));
const PING_MS = 5000;
const JOIN_TIMEOUT_MS = 4000;

const pid = sessionStorage.getItem('ait_pid') || crypto.randomUUID();
sessionStorage.setItem('ait_pid', pid);

let room;
let lesson = null;
let stage;
let teacher = null; // 선생님이 보낸 마지막 상태
let own = { slide: 1 }; // 학생이 둘러보는 위치
let following = true;
let tbPage = null;
let lastSeq = 0;
let lastSession = null;
let labPanel = null;
let labLoading = null;
let sideView = 'tools';
let quizPlayer = null;
let lastMode = null;
let tutorPanel = null;
let talkFull = null;
let talkSide = null;
let talkSnap = null;
let closed = false;
let pingTimer = null;

function waitScreen(title, text, image) {
  $('#app').hidden = true;
  $('#waiting').hidden = false;
  $('#wait-title').textContent = title;
  $('#wait-text').textContent = text;
  if (image) $('#waiting img').src = image;
}

// 슬라이드·교과서 이미지 저장 막기: 오른쪽 단추 메뉴, 끌어 놓기, 저장·인쇄 단축키.
// 화면 캡처까지 막을 수는 없다. 이미지 주소 자체는 서버(짧은 시간만 열리는 주소)에서 막는다.
function guardImages() {
  const protectedArea = (t) => t instanceof Element && t.closest('#stage, .tb-view, .drawer, .thumb, .qp-img');
  document.addEventListener('contextmenu', (e) => { if (protectedArea(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (e.target instanceof HTMLImageElement) e.preventDefault(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && /^[sp]$/i.test(e.key)) e.preventDefault();
  });
}

function start() {
  guardImages();
  if (!isValidCode(code)) {
    location.replace('/ait/?join=again');
    return;
  }
  $('#code-chip').textContent = code;
  room = openRoom(code);
  room.on(onMessage);
  room.send({ type: 'hello', pid });
  setTimeout(() => {
    if (!teacher) waitScreen('수업을 찾지 못했습니다', '참여 코드를 다시 확인해 주세요. 선생님이 수업을 연 뒤에 들어올 수 있습니다.', '/img/daeryuni/face_surprised.webp');
  }, JOIN_TIMEOUT_MS);
  pingTimer = setInterval(() => room.send({ type: 'ping', pid, slide: own.slide, following }), PING_MS);
  addEventListener('pagehide', () => { if (!closed) room.send({ type: 'bye', pid }); });
}

async function onMessage(msg) {
  if (!msg) return;
  if (msg.type === 'closed') {
    closed = true;
    clearInterval(pingTimer);
    room.close();
    waitScreen('수업이 끝났습니다', '함께해 주어 고맙습니다. 메모는 이 기기에 남아 있습니다.', '/img/daeryuni/pose_thumb.webp');
    return;
  }
  if (['talk', 'talk-reject', 'talk-name'].includes(msg.type)) {
    if (msg.type === 'talk') talkSnap = msg.snap;
    ensureTalkPlayers();
    talkFull.onMessage(msg);
    talkSide.onMessage(msg);
    if (teacher) render();
    return;
  }
  if (['quiz', 'quiz-you', 'quiz-name', 'quiz-got', 'quiz-report', 'kick'].includes(msg.type)) {
    if (!quizPlayer) quizPlayer = createQuizPlayer($('#quiz-player'), { pid, code, send: (m) => room.send(m) });
    quizPlayer.onMessage(msg);
    return;
  }
  if (msg.type !== 'state') return;
  // 선생님 화면을 새로 고치면 순번이 처음부터 다시 시작하므로 세션이 바뀌면 순번을 새로 센다.
  if (msg.session === lastSession && msg.seq <= lastSeq) return;
  lastSession = msg.session;
  lastSeq = msg.seq;
  if (!lesson || lesson.id !== msg.lesson) {
    try {
      lesson = await loadLesson(msg.lesson);
    } catch {
      waitScreen('수업 자료를 불러오지 못했습니다', '잠시 뒤 새로 고침해 주세요.', '/img/daeryuni/face_surprised.webp');
      return;
    }
    if (lesson.approval?.status !== 'approved' && !(msg.preview && PREVIEW_HOST)) {
      waitScreen('아직 공개되지 않은 수업입니다', '선생님이 자료 검토를 마치면 들어올 수 있습니다.', '/img/daeryuni/face_calm.webp');
      return;
    }
    setupLesson(msg.preview);
  }
  teacher = msg;
  if (teacher.lock) following = true;
  if (following) own.slide = teacher.slide;
  render();
}

function setupLesson(preview) {
  document.title = `${lesson.title} | Dave AIT Class`;
  $('#lesson-name').textContent = lesson.title;
  $('#preview-badge').hidden = !preview;
  $('#waiting').hidden = true;
  $('#app').hidden = false;
  stage = createStage($('#stage'), lesson);
  enableDivider($('#ws'), $('#divider'), 'ait_split_student');
  $('#prev').addEventListener('click', () => browse(own.slide - 1));
  $('#next').addEventListener('click', () => browse(own.slide + 1));
  $('#follow').addEventListener('click', followTeacher);
  $('#back').addEventListener('click', followTeacher);
  $('#toc').addEventListener('click', () => openToc(lesson, own.slide, browse));
  // 크게 보기: 슬라이드를 전체 화면으로 띄우고, 휴대폰이면 가로로 돌린다(지원하는 브라우저만).
  $('#big').hidden = !document.fullscreenEnabled;
  $('#big').addEventListener('click', async () => {
    try {
      await $('#stage').requestFullscreen();
      await screen.orientation?.lock?.('landscape');
    } catch { /* 가로 고정을 지원하지 않으면 전체 화면만 쓴다. */ }
  });
  $('#memo-save').addEventListener('click', saveMemo);
  $('#memo').addEventListener('input', () => { $('#memo-saved').textContent = ''; });
  $('#memo-download').addEventListener('click', downloadMemos);
  $('#tb-prev').addEventListener('click', () => showTextbook(tbPage - 1));
  $('#tb-next').addEventListener('click', () => showTextbook(tbPage + 1));
  $('#tb-close').addEventListener('click', () => showSide('tools'));
  $('#lab-close').addEventListener('click', () => showSide('tools'));
  $('#tutor-close').addEventListener('click', () => showSide('tools'));
  onSwipe($('#stage'), () => browse(own.slide + 1), () => browse(own.slide - 1));
  document.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); browse(own.slide + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); browse(own.slide - 1); }
  });
}

function browse(n) {
  if (!teacher || teacher.lock || teacher.mode === 'textbook') return;
  const next = Math.min(lesson.slides.length, Math.max(1, n));
  saveMemo(true);
  own.slide = next;
  following = next === teacher.slide;
  render();
}

function followTeacher() {
  saveMemo(true);
  following = true;
  own.slide = teacher.slide;
  render();
}

function render() {
  const quizMode = teacher.mode === 'quiz';
  const talkMode = teacher.mode === 'talk';
  $('#quiz-player').hidden = !quizMode;
  $('#talk-full').hidden = !talkMode;
  $('#ws').hidden = quizMode || talkMode;
  if (talkMode) { ensureTalkPlayers(); $('#follow-banner').hidden = true; $('#mode-banner').hidden = true; return; }
  if (quizMode) {
    $('#follow-banner').hidden = true;
    $('#mode-banner').hidden = true;
    if (!quizPlayer) quizPlayer = createQuizPlayer($('#quiz-player'), { pid, code, send: (m) => room.send(m) });
    return;
  }
  const textbookMode = teacher.mode === 'textbook';
  const free = !teacher.lock && !textbookMode;
  if (textbookMode) {
    stage.showPage(teacher.page);
    $('#count').textContent = `교과서 ${teacher.page}쪽`;
  } else {
    stage.showSlide(own.slide);
    $('#count').textContent = `${own.slide} / ${lesson.slides.length}${following ? '' : ' · 둘러보는 중'}`;
  }
  $('#stage').classList.toggle('focus-ring', following && !textbookMode);
  $('#follow-banner').hidden = following || textbookMode;
  $('#follow-text').textContent = own.slide < teacher.slide ? '지난 장을 보는 중입니다' : '앞 장을 미리 보는 중입니다';
  $('#back').hidden = following || textbookMode;
  $('#prev').disabled = !free;
  $('#next').disabled = !free;
  $('#toc').disabled = !free;
  const labMode = teacher.mode === 'lab';
  const banner = $('#mode-banner');
  banner.hidden = !(teacher.lock || textbookMode || labMode);
  banner.textContent = textbookMode ? `선생님이 교과서 ${teacher.page}쪽을 보여 주고 있습니다.`
    : labMode ? '실습 시간입니다. 실습 칸의 셀을 위에서부터 차례로 실행해 보세요.'
      : '선생님이 화면을 고정했습니다. 함께 봅니다.';
  if (labMode && sideView !== 'lab') showSide('lab');
  // 실습 시간이 끝나면 연결 자료와 메모로 돌아간다.
  if (lastMode === 'lab' && !labMode && sideView === 'lab') showSide('tools');
  lastMode = teacher.mode;
  $('#lab-close').hidden = labMode;
  renderSide();
  if (sideView === 'lab') focusLab();
  if (sideView === 'tutor') tutorPanel?.refresh();
}

function renderSide() {
  const slide = lesson.slides[own.slide - 1];
  const page = slide.textbook?.page;
  const links = $('#links');
  links.replaceChildren();
  if (hasTextbook(lesson, page)) {
    links.append(el('button', { type: 'button', class: 'btn-ghost', onclick: () => showTextbook(page) }, `교과서 ${page}쪽 펼치기`));
  }
  if (slide.lab) {
    const cells = slide.lab.cells.map((id) => id.replace('c', '셀 ')).join(', ');
    links.append(el('button', { type: 'button', class: 'btn-ghost', onclick: () => showSide('lab') }, `실습 ${cells} 열기`));
  } else if (lesson.labs?.length) {
    links.append(el('button', { type: 'button', class: 'btn-ghost', onclick: () => showSide('lab') }, '실습 열기'));
  }
  if (teacher.tutor !== false) links.append(el('button', { type: 'button', class: 'btn-ghost', onclick: () => showSide('tutor') }, 'AI 튜터에게 묻기'));
  if (!links.childElementCount) links.append(el('p', { class: 'hint' }, '이 장에 연결된 자료가 없습니다.'));
  $('#talk-panel').hidden = !(talkSnap && talkSnap.open && talkSnap.topic);
  if (sideView === 'tutor' && teacher.tutor === false) showSide('tools');
  $('#memo-where').textContent = `${slide.n}장`;
  const memo = $('#memo');
  if (memo.dataset.slide !== slide.id) {
    memo.dataset.slide = slide.id;
    memo.value = localStorage.getItem(memoKey(slide.id)) || '';
    $('#memo-saved').textContent = '';
  }
}

function showSide(view) {
  sideView = view;
  $('#tools').hidden = view !== 'tools';
  $('#tb-pane').hidden = view !== 'textbook';
  $('#lab-view').hidden = view !== 'lab';
  $('#tutor-view').hidden = view !== 'tutor';
  if (view === 'lab') ensureLab();
  if (view === 'tutor') ensureTutor();
}

async function ensureLab() {
  if (labPanel) { focusLab(); return; }
  if (labLoading || !lesson.labs?.length) return;
  const area = createLabArea($('#lab-pane'), lesson, { storagePrefix: 'ait_lab' });
  labLoading = area.ready.then(() => {
    labPanel = area;
    focusLab();
  }).catch(() => {
    $('#lab-pane').replaceChildren(el('p', { class: 'hint' }, '실습 자료를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.'));
    labLoading = null;
  });
}

function ensureTalkPlayers() {
  if (talkFull) return;
  const send = (m) => room.send(m);
  talkFull = createTalkPlayer($('#talk-full'), { pid, send });
  talkSide = createTalkPlayer($('#talk-side'), { pid, send, compact: true });
}

// AI 튜터(학생용): 힌트만 준다. 질문과 답은 선생님 화면의 질문 모음에 남는다.
function ensureTutor() {
  if (tutorPanel) { tutorPanel.refresh(); return; }
  tutorPanel = createTutorPanel($('#tutor-pane'), {
    role: 'student',
    getContext: () => {
      const s = lesson.slides[own.slide - 1];
      // notes는 서버가 정답 낱말을 막는 데만 쓰고 AI에는 보내지 않는다.
      return { lessonTitle: lesson.title, slideN: s.n, slideTitle: s.title, slideText: s.text, notes: s.notes, page: s.textbook?.page, cell: labPanel?.cellContext() || null, quizActive: teacher?.mode === 'quiz' };
    },
    isBlocked: () => (teacher?.tutor === false ? '선생님이 지금은 튜터를 꺼 두었습니다.' : teacher?.mode === 'quiz' ? '퀴즈가 끝난 뒤에 물어보세요.' : ''),
    onExchange: (x) => room.send({ type: 'tutor-log', pid, slide: x.context.slideN, cell: x.context.cell?.n || null, level: x.level, flagged: x.flagged, question: x.question, answer: x.answer }),
  });
}

function focusLab() {
  const link = lesson.slides[own.slide - 1]?.lab;
  if (labPanel && link) labPanel.focus(link);
}

function showTextbook(p) {
  const page = clampPage(lesson, p);
  if (page === null) return;
  tbPage = page;
  showSide('textbook');
  $('#tb-img').src = pageUrl(lesson, page);
  $('#tb-img').alt = `교과서 ${page}쪽`;
  $('#tb-title').textContent = `교과서 ${page}쪽`;
}

const memoKey = (sid) => `ait_memo_${lesson.id}_${sid}`;

function saveMemo(silent) {
  const memo = $('#memo');
  if (!memo.dataset.slide) return;
  const key = memoKey(memo.dataset.slide);
  if (memo.value.trim()) localStorage.setItem(key, memo.value);
  else localStorage.removeItem(key);
  if (silent !== true) $('#memo-saved').textContent = '저장했습니다';
}

function downloadMemos() {
  saveMemo(true);
  const lines = [`${lesson.title} 메모`, ''];
  for (const s of lesson.slides) {
    const text = localStorage.getItem(memoKey(s.id));
    if (text) lines.push(`[${s.n}장 ${s.title || ''}]`, text, '');
  }
  if (lines.length === 2) lines.push('저장한 메모가 없습니다.');
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const a = el('a', { href: url, download: `${lesson.title}_메모.txt` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

start();
