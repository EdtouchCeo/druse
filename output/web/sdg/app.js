import { filesToTiles } from '/sdg/tiles.js';

const $ = (id) => document.getElementById(id);
const API = '/sdg-api';
const LABEL = { queued: '대기 중', running: '만드는 중', done: '완료', failed: '다시 시도', refused: '다시 입력', locked: '잠김' };
const BUSY_MS = 3000; // 생성 중 확인 간격
const IDLE_MS = 10000; // 평소 확인 간격
const LONG_QUEUE_MS = 60000; // 처리 프로그램은 몇 초 안에 작업을 가져가므로 이보다 길면 안내한다.
const LONG_RUN_MS = 180000;
let me = null;
let timer = null;
let currentStage = 1;
let previewShown = null;
let busyFile = false;
const clock = { 1: null, 2: null }; // 현재 상태를 이 화면에서 처음 본 시각

function deviceId() {
  try {
    let id = localStorage.getItem('sdg_device');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('sdg_device', id);
    }
    return id;
  } catch {
    return '';
  }
}

async function api(path, body) {
  const res = await fetch(`${API}/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'), { status: res.status });
  return data;
}

function showLogin() {
  clearTimeout(timer);
  timer = null;
  me = null;
  previewShown = null;
  $('app').hidden = true;
  $('who').hidden = true;
  $('logout').hidden = true;
  $('admin-link').hidden = true;
  $('login').hidden = false;
  $('frame').removeAttribute('src');
}

function stageMessage(stage, st) {
  if (st.status === 'queued') return st.position > 1 ? `대기 중입니다. 앞에 ${st.position - 1}명 있습니다. 창을 닫아도 순서는 유지됩니다.` : '곧 시작합니다. 창을 닫아도 순서는 유지됩니다.';
  if (st.status === 'running') return '화면을 만들고 있습니다. 보통 1분 30초 안에 끝납니다. 창을 닫아도 계속 진행됩니다.';
  if (st.status === 'done') return '완료했습니다. 아래 미리보기를 설계에 참고하세요.';
  if (st.status === 'locked') return '부적절하거나 기획서로 인식되지 않은 입력이 반복되어 잠겼습니다. 선생님께 문의해 주세요.';
  if (st.status === 'refused') return `${st.error || '처리하지 않았습니다.'} 횟수는 줄지 않았습니다. 내용을 확인해 다시 시도해 주세요.`;
  if (st.status === 'failed') return `${st.error || '생성하지 못했습니다.'} 횟수는 줄지 않았습니다.`;
  if (!st.open) return `${stage}차 구현은 선생님이 열면 시작할 수 있습니다.`;
  return '';
}

function showElapsed(stage) {
  const c = clock[stage];
  $(`elapsed-${stage}`).hidden = !c;
  if (!c) return;
  const ms = Date.now() - c.at;
  const seconds = Math.floor(ms / 1000);
  let text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} 지남`;
  if (c.state === 'queued' && ms >= LONG_QUEUE_MS && me && !(me[`stage${stage}`].position > 1)) {
    text += me.test ? '. 대기가 줄지 않으면 처리 프로그램이 켜져 있는지 확인해 주세요.' : '. 시작되지 않으면 선생님께 알려 주세요.';
  }
  if (c.state === 'running' && ms >= LONG_RUN_MS) text += '. 평소보다 오래 걸리고 있습니다.';
  $(`elapsed-${stage}`).textContent = text;
}

function setBuild(stage, state) {
  $(`build-${stage}`).hidden = !state;
  if (state) $(`build-${stage}`).dataset.state = state;
  if (!clock[stage] || clock[stage].state !== state) clock[stage] = ['queued', 'running'].includes(state) ? { state, at: Date.now() } : null;
  showElapsed(stage);
}

function render() {
  for (const stage of [1, 2]) {
    const st = me[`stage${stage}`];
    const working = ['queued', 'running'].includes(st.status);
    $(`badge-${stage}`).textContent = LABEL[st.status] || '';
    $(`badge-${stage}`).classList.toggle('busy', working);
    setBuild(stage, stage === 2 && busyFile ? 'upload' : (working ? st.status : null));
    $(`submit-${stage}`).disabled = !st.canSubmit || (stage === 2 && busyFile);
    if (stage !== 2 || !busyFile) {
      $(`msg-${stage}`).textContent = stageMessage(stage, st);
      $(`msg-${stage}`).classList.toggle('error', ['failed', 'refused', 'locked'].includes(st.status));
    }
    $(`form-${stage}`).hidden = st.status === 'done';
  }
  const st = me[`stage${currentStage}`];
  if (st.status === 'done') {
    $('result').hidden = false;
    $('result-title').textContent = `${currentStage}차 결과 미리보기`;
    if (previewShown !== currentStage) {
      previewShown = currentStage;
      $('frame').src = `${API}/preview/${currentStage}`;
    }
  } else {
    $('result').hidden = true;
    previewShown = null;
    $('frame').removeAttribute('src');
  }
}

function schedule() {
  clearTimeout(timer);
  const busy = me && [me.stage1, me.stage2].some((s) => ['queued', 'running'].includes(s.status));
  timer = setTimeout(refresh, busy ? BUSY_MS : IDLE_MS);
}

async function refresh() {
  try {
    me = await api('me');
    $('login').hidden = true;
    $('app').hidden = false;
    $('who').hidden = false;
    $('logout').hidden = false;
    $('who').textContent = me.test ? `관리자 테스트 ${me.id} ${me.name}` : `${me.id} ${me.name}`;
    $('admin-link').hidden = !me.test;
    render();
    schedule();
  } catch (err) {
    if (err.status === 401) showLogin();
    else schedule();
  }
}

function selectStage(stage) {
  currentStage = stage;
  for (const n of [1, 2]) {
    $(`tab-${n}`).setAttribute('aria-selected', String(n === stage));
    $(`tab-${n}`).tabIndex = n === stage ? 0 : -1;
    $(`panel-${n}`).hidden = n !== stage;
  }
  if (me) render();
}

$('tab-1').addEventListener('click', () => selectStage(1));
$('tab-2').addEventListener('click', () => selectStage(2));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const next = currentStage === 1 ? 2 : 1;
  selectStage(next);
  $(`tab-${next}`).focus();
});

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-msg').textContent = '';
  try {
    await api('login', { id: $('sid').value.trim(), name: $('sname').value.trim(), code: $('scode').value.trim(), device: deviceId() });
    $('scode').value = '';
    await refresh();
  } catch (err) {
    $('login-msg').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('logout', {}).catch(() => {});
  showLogin();
});

$('plan').addEventListener('input', () => { $('plan-count').textContent = $('plan').value.length.toLocaleString(); });

function showError(stage, message) {
  $(`msg-${stage}`).textContent = message;
  $(`msg-${stage}`).classList.add('error');
}

$('form-1').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('submit-1').disabled = true;
  $('msg-1').classList.remove('error');
  $('msg-1').textContent = '기획서를 보내는 중입니다.';
  setBuild(1, 'upload');
  try {
    await api('submit/1', { text: $('plan').value });
    await refresh();
  } catch (err) {
    await refresh();
    showError(1, err.message);
  }
});

async function uploadTile(url, blob) {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: blob });
  if (!res.ok) throw new Error('파일을 올리지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
}

$('form-2').addEventListener('submit', async (e) => {
  e.preventDefault();
  busyFile = true;
  $('submit-2').disabled = true;
  $('msg-2').classList.remove('error');
  setBuild(2, 'upload');
  try {
    const tiles = await filesToTiles($('files').files, (text) => { $('msg-2').textContent = text; });
    $('msg-2').textContent = '파일을 올리는 중입니다.';
    const { prefix, urls } = await api('prepare/2', { count: tiles.length });
    await Promise.all(tiles.map((blob, i) => uploadTile(urls[i], blob)));
    await api('submit/2', { prefix, count: tiles.length });
    busyFile = false;
    await refresh();
  } catch (err) {
    busyFile = false;
    await refresh();
    showError(2, err.message);
  }
});

$('files').addEventListener('change', () => {
  const names = [...$('files').files].map((f) => f.name);
  $('file-info').textContent = names.length ? `선택: ${names.join(', ')}` : 'PNG는 화면 순서대로 고르세요. 데스크톱 화면 기준으로 읽습니다.';
});

setInterval(() => { showElapsed(1); showElapsed(2); }, 1000);
selectStage(1);
refresh();
