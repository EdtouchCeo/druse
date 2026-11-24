// 발표 화면(프로젝터): 진행 화면이 보여 주는 장을 꽉 차게 띄운다. 리모컨 버튼은 진행 화면으로 넘긴다.
// 같은 컴퓨터의 창끼리 BroadcastChannel로 이어지므로 서버나 인터넷 연결이 없어도 된다.
import { $, loadLesson, keyAction, presentChannelName } from './common.js';
import { createStage } from './viewer.js';
import { createLabMirror } from './lab.js';
import { renderHostView } from './quiz-view.js';
import { renderFeed } from './talk.js';

const lessonId = new URLSearchParams(location.search).get('l') || '';
const channel = new BroadcastChannel(presentChannelName(lessonId));
let lesson = null;
let stage = null;
let mirror = null;
let last = null;

async function start() {
  try {
    lesson = await loadLesson(lessonId);
  } catch {
    $('#wait').hidden = false;
    $('#wait').textContent = '차시 자료를 찾지 못했습니다. 진행 화면에서 다시 열어 주세요.';
    return;
  }
  document.title = `${lesson.title} · 발표 화면`;
  // 발표 화면에서 영상을 직접 눌러도 재생된다. 진행 화면에 알려 두 화면이 같은 자리를 보게 한다.
  stage = createStage($('#stage'), lesson, {}, { controls: true, sound: true, onMedia: (m) => channel.postMessage({ type: 'media', ...m }) });
  mirror = createLabMirror($('#lab'));
  channel.onmessage = (e) => onMessage(e.data || {});
  channel.postMessage({ type: 'hello' });
  setInterval(() => channel.postMessage({ type: 'ping' }), 3000);
  addEventListener('pagehide', () => channel.postMessage({ type: 'bye' }));
  setTimeout(() => { if (!last) $('#wait').hidden = false; }, 2500);
}

function onMessage(msg) {
  if (msg.type === 'state') {
    last = msg;
    $('#wait').hidden = true;
    $('#quiz').hidden = msg.mode !== 'quiz';
    $('#talk').hidden = msg.mode !== 'talk';
    const lab = msg.mode === 'lab';
    $('#layout').classList.toggle('with-lab', lab);
    $('#lab').hidden = !lab;
    if (msg.mode === 'textbook') stage.showPage(msg.page);
    else stage.showSlide(msg.slide);
    $('#blank').hidden = !msg.blank;
    $('#blank').className = `blank ${msg.blank || ''}`;
  } else if (msg.type === 'talk') {
    const snap = msg.snap;
    $('#talk-topic').textContent = snap.topic ? snap.topic.text : '선생님이 주제를 열면 의견이 여기에 보입니다.';
    $('#talk-count').textContent = `${snap.open ? '열림' : '닫힘'} · 의견 ${snap.messages.length}건`;
    renderFeed($('#talk-list'), { ...snap, messages: snap.messages.slice(-12) }, { big: true });
    $('#talk-spot').hidden = !snap.spotlight;
    if (snap.spotlight) $('#talk-spot').replaceChildren(Object.assign(document.createElement('p'), { textContent: snap.spotlight.text }), Object.assign(document.createElement('strong'), { textContent: snap.spotlight.name }));
  } else if (msg.type === 'quiz') {
    renderHostView($('#quiz'), msg.view, { teacher: false });
  } else if (msg.type === 'ink') {
    stage.ink.apply(msg.ink);
  } else if (msg.type === 'media') {
    stage.media.apply(msg);
  } else if (msg.type === 'lab') {
    mirror.render(msg.snap);
  } else if (msg.type === 'code') {
    $('#code').hidden = !msg.code;
    if (msg.code) {
      $('#code-big').textContent = msg.code;
      $('#code-url').textContent = msg.url;
      $('#code-text').textContent = msg.preview ? '검토용 미리보기입니다. 아래 코드로 들어오세요.' : '아래 주소에서 참여 코드를 넣어 주세요.';
    }
  }
}

async function enterFullscreen() {
  $('#start').hidden = true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* 전체 화면을 거절해도 창 안에서 그대로 보여 준다. */ }
}

$('#start').addEventListener('click', enterFullscreen);

document.addEventListener('keydown', (e) => {
  const action = keyAction(e);
  if (!action) return;
  e.preventDefault();
  // 처음 한 번은 전체 화면으로만 바꾼다. 리모컨의 첫 버튼이 장을 넘기지 않게 한다.
  if (!$('#start').hidden || action === 'full') { enterFullscreen(); return; }
  channel.postMessage({ type: 'key', action });
});

// 화면을 누르면 다음 장, 오른쪽 버튼을 누르면 이전 장으로 간다(실습 칸 안은 제외).
// 영상 위를 누르면 장을 넘기지 않고 영상을 재생하거나 멈춘다.
const onVideo = (e) => e.target instanceof Element && !!e.target.closest('video');
$('#stage').addEventListener('click', (e) => { if (!onVideo(e)) channel.postMessage({ type: 'key', action: 'next' }); });
$('#stage').addEventListener('contextmenu', (e) => { e.preventDefault(); if (!onVideo(e)) channel.postMessage({ type: 'key', action: 'prev' }); });
$('#blank').addEventListener('click', () => channel.postMessage({ type: 'key', action: last?.blank || 'black' }));
$('#code').addEventListener('click', () => { $('#code').hidden = true; });

start();
