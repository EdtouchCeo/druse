// 수행평가 구현 미리보기 웹 관리 화면. 권한은 서버(/sdg-api/admin/*)가 확인한다.
const API = '/sdg-api/admin';
const POLL_MS = 10000;
const RETRY_KEY = 'sdg_admin_login_retry';
const $ = (id) => document.getElementById(id);
const LABEL = { none: '-', queued: '대기', running: '생성 중', done: '완료', failed: '실패', refused: '거절', locked: '잠김' };
const RESULT = { done: '완료', refused: '거절', api: '오류', rate: '한도', credit: '크레딧 소진', auth: '키 오류', invalid: '형식 오류', script: '코드 오류', download: '이미지 오류' };
// 혼동하기 쉬운 i, l, o는 뺀다. 서버의 validEntryCode와 규칙이 같아야 한다.
const CODE_LETTERS = 'abcdefghjkmnpqrstuvwxyz';
const CODE_SYMBOLS = '!@#$%&*?';
const CODE_RULE = '입장 코드는 소문자와 특수문자(! @ # $ % & * ?)를 함께 써서 3자 이내로 정해 주세요.';
const validCode = (code) => (/^[a-z!@#$%&*?]{2,3}$/.test(code) && /[a-z]/.test(code) && /[^a-z]/.test(code));
let me = null;
let timer = null;
let shownCodes = null;

async function api(path, body, headers = {}) {
  const res = await fetch(`${API}/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '요청을 처리하지 못했습니다.'), { status: res.status });
  return data;
}

function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  Object.assign(node, attrs);
  return node;
}

function siteToken() {
  try {
    const session = JSON.parse(localStorage.getItem('dr_sess_v1'));
    return session && session.token ? session.token : null;
  } catch {
    return null;
  }
}

function showSignin(title, text, withLink = true) {
  clearTimeout(timer);
  $('panel').hidden = true;
  $('signin').hidden = false;
  $('signin-title').textContent = title;
  $('signin-text').textContent = text;
  $('signin-link').hidden = !withLink;
}

// 사이트 로그인 토큰으로 관리자 세션을 만든다. 토큰이 만료되었으면 첫 페이지에서 한 번 갱신하고 돌아온다.
async function startSession() {
  const token = siteToken();
  if (!token) {
    showSignin('로그인이 필요합니다', '관리자로 등록된 사이트 계정으로 로그인해 주세요.');
    return false;
  }
  try {
    await api('session', {}, { Authorization: `Bearer ${token}` });
    sessionStorage.removeItem(RETRY_KEY);
    return true;
  } catch (err) {
    if (err.status === 403) {
      showSignin('관리 권한이 없습니다', '이 계정은 관리자로 등록되어 있지 않습니다. 사이트 운영자에게 문의해 주세요.', false);
    } else if (err.status === 401 && !sessionStorage.getItem(RETRY_KEY)) {
      sessionStorage.setItem(RETRY_KEY, '1');
      location.replace($('signin-link').getAttribute('href').replace('#login', ''));
    } else if (err.status === 401) {
      sessionStorage.removeItem(RETRY_KEY);
      showSignin('다시 로그인해 주세요', '로그인이 만료되었습니다.');
    } else {
      showSignin('연결하지 못했습니다', err.message, false);
    }
    return false;
  }
}

function openView(title) {
  $('view').hidden = false;
  $('view-title').textContent = title;
  $('view-text').hidden = true;
  $('frame').hidden = true;
  $('frame').removeAttribute('src');
}
function showResult(s, stage) {
  openView(`${s.id} ${s.name} ${stage}차 결과`);
  $('frame').hidden = false;
  $('frame').src = `${API}/preview/${s.id}/${stage}`;
  $('view').scrollIntoView();
}
async function showInput(s, stage) {
  const { text } = await api(`input/${s.id}/${stage}`);
  openView(`${s.id} ${s.name} ${stage === 1 ? '기획서' : '구현 프롬프트'} 입력`);
  $('view-text').hidden = false;
  $('view-text').textContent = text || '저장된 입력이 없습니다.';
  $('view').scrollIntoView();
}
async function reset(s, stage) {
  if (!window.confirm(`${s.id} ${s.name}의 ${stage}차 기회를 다시 열까요? 기존 결과는 지워집니다.`)) return;
  try {
    await api('reset', { id: s.id, stage });
    $('row-msg').textContent = `${s.id} ${stage}차를 다시 열었습니다.`;
    await refresh();
  } catch (err) {
    $('row-msg').textContent = err.message;
  }
}

function stageCell(s, stage) {
  const status = s[`stage${stage}`];
  const td = el('td');
  td.append(el('span', LABEL[status] || status, { className: `state ${status}` }));
  const action = (label, fn) => td.append(el('button', label, { type: 'button', className: 'link', onclick: fn }));
  if (status === 'done') action('보기', () => showResult(s, stage));
  if (status !== 'none') action('입력', () => showInput(s, stage));
  if (!['none', 'queued', 'running'].includes(status)) action('다시 열기', () => reset(s, stage));
  return td;
}

function renderRows(students) {
  $('rows').replaceChildren(...students.map((s) => {
    const tr = el('tr');
    const notes = [];
    if (s.test) notes.push('관리자 테스트');
    if (s.deviceChanges) notes.push(`다른 PC 입장 ${s.deviceChanges}회`);
    if (s.nameChanges) notes.push(`이름 변경 ${s.nameChanges}회`);
    tr.append(el('td', s.id), el('td', s.name), stageCell(s, 1), stageCell(s, 2), el('td', String(s.refusals)), el('td', notes.join(', ')));
    return tr;
  }));
  const real = students.filter((s) => !s.test).length;
  $('count').textContent = `학생 ${real}명`;
}

function describe(e) {
  const d = e.detail || {};
  if (e.type === 'login') {
    const extra = [d.device_changed ? '다른 PC' : '', d.previous_name ? `이전 이름 ${d.previous_name}` : ''].filter(Boolean).join(', ');
    return extra ? `입장 (${extra})` : '입장';
  }
  if (e.type === 'submit') return `${d.stage}차 제출 (${d.chars ? `${d.chars}자` : `이미지 ${d.images}장`})`;
  if (e.type === 'generate') return `${d.stage}차 ${RESULT[d.result] || d.result} (${Math.round((d.ms || 0) / 1000)}초, ${d.worker || ''})`;
  if (e.type === 'blocked') return `${d.stage}차 입력 차단`;
  if (e.type === 'reset') return `${d.stage}차 다시 열기`;
  if (e.type === 'settings') return `설정 변경: 1차 ${d.open1 ? '열림' : '닫힘'}, 2차 ${d.open2 ? '열림' : '닫힘'}${d.codeChanged ? ', 입장 코드 변경' : ''}`;
  if (e.type === 'admin') {
    if (d.action === 'test') return `관리자 테스트 입장 (${d.id})`;
    if (d.action === 'reset') return `관리자가 ${d.id} ${d.stage}차 다시 열기`;
    if (d.action === 'code-add') return `입장 코드 발급 (${d.code})`;
    if (d.action === 'code-delete') return `입장 코드 삭제 (${d.code})`;
    return '관리자 설정 변경';
  }
  return e.type;
}

async function removeCode(code) {
  if (!window.confirm(`코드 ${code}를 삭제할까요? 새 입장만 막히고, 이미 입장한 학생은 입장 후 8시간까지 이용합니다.`)) return;
  $('code-msg').textContent = '';
  try {
    await api('code-delete', { code });
  } catch (err) {
    $('code-msg').textContent = err.message;
  }
  await refresh();
}

function renderCodes(codes) {
  // 주기적으로 새로 그려도 삭제 버튼의 포커스를 잃지 않게 바뀔 때만 그린다.
  const key = JSON.stringify(codes);
  if (key === shownCodes) return;
  shownCodes = key;
  $('code-table').hidden = codes.length === 0;
  $('code-empty').hidden = codes.length > 0;
  $('codes').replaceChildren(...codes.map((c) => {
    const tr = el('tr');
    const action = el('td');
    action.append(el('button', '삭제', { type: 'button', className: 'link', ariaLabel: `코드 ${c.code} 삭제`, onclick: () => removeCode(c.code) }));
    tr.append(
      el('td', c.code, { className: 'code-value' }),
      el('td', c.issuedBy || '-'),
      el('td', new Date(c.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
      action,
    );
    return tr;
  }));
}

async function refresh() {
  clearTimeout(timer);
  try {
    const data = await api('state');
    const { log } = await api('log');
    me = data.me;
    $('alert').hidden = true;
    $('signin').hidden = true;
    $('panel').hidden = false;
    $('who').hidden = false;
    $('who').textContent = `${me.name} (${me.email})`;
    $('test-id').textContent = me.testId;
    renderCodes(data.codes);
    $('worker-state').hidden = data.workerOnline === undefined;
    $('worker-state').classList.toggle('off', data.workerOnline === false);
    $('worker-state').textContent = data.workerOnline
      ? '처리 프로그램: 작동 중'
      : '처리 프로그램: 꺼짐. 생성이 진행되지 않습니다. 처리 프로그램 PC에서 start.bat을 실행해 주세요.';
    $('open1').checked = data.open1;
    $('open2').checked = data.open2;
    const waiting = data.queued > 0 ? ' 대기가 줄지 않으면 처리 프로그램이 켜져 있는지 확인해 주세요.' : '';
    $('stats').textContent = `전체 대기 ${data.queued}건, 생성 중 ${data.running}건.${waiting}`;
    renderRows(data.students);
    $('log').replaceChildren(...log.map((e) => {
      const tr = el('tr');
      tr.append(el('td', new Date(e.at).toLocaleTimeString('ko-KR')), el('td', e.student_id || ''), el('td', e.name || ''), el('td', describe(e)));
      return tr;
    }));
  } catch (err) {
    if (err.status === 401) {
      if (await startSession()) return refresh();
      return undefined;
    }
    $('alert').hidden = false;
    $('alert').textContent = err.message;
  }
  timer = setTimeout(() => { if (document.hidden) timer = setTimeout(refresh, POLL_MS); else refresh(); }, POLL_MS);
  return undefined;
}

async function saveSetting(body, msgId = 'row-msg') {
  try {
    await api('settings', body);
  } catch (err) {
    $(msgId).textContent = err.message;
  }
  await refresh();
}

// 소문자 2자와 특수문자 1자를 섞는다.
function newCode() {
  const [a, b, c, at] = crypto.getRandomValues(new Uint8Array(4));
  const chars = [CODE_LETTERS[a % CODE_LETTERS.length], CODE_LETTERS[b % CODE_LETTERS.length]];
  chars.splice(at % 3, 0, CODE_SYMBOLS[c % CODE_SYMBOLS.length]);
  return chars.join('');
}

$('save-code').addEventListener('click', async () => {
  const code = $('code').value.trim();
  if (!validCode(code)) {
    $('code-msg').textContent = CODE_RULE;
    return;
  }
  $('code-msg').textContent = '';
  try {
    await api('code-add', { code });
    $('code').value = '';
  } catch (err) {
    $('code-msg').textContent = err.message;
  }
  await refresh();
});
$('issue-code').addEventListener('click', async () => {
  $('code-msg').textContent = '';
  // 우연히 쓰고 있는 코드와 겹치면 다시 만든다.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await api('code-add', { code: newCode() });
      break;
    } catch (err) {
      if (attempt === 5 || !err.message.includes('이미')) {
        $('code-msg').textContent = err.message;
        break;
      }
    }
  }
  await refresh();
});
$('open1').addEventListener('change', () => saveSetting({ open1: $('open1').checked }));
$('open2').addEventListener('change', () => saveSetting({ open2: $('open2').checked }));

$('test-enter').addEventListener('click', async () => {
  try {
    await api('test-enter', {});
    location.assign('/sdg/');
  } catch (err) {
    $('test-msg').textContent = err.message;
  }
});
$('test-reset').addEventListener('click', async () => {
  if (!me || !window.confirm(`시험 번호 ${me.testId}의 1차·2차 기록을 지울까요?`)) return;
  try {
    for (const stage of [1, 2]) await api('reset', { id: me.testId, stage });
    $('test-msg').textContent = '테스트 기록을 지웠습니다. 다시 시험할 수 있습니다.';
    await refresh();
  } catch (err) {
    $('test-msg').textContent = err.message;
  }
});
$('wipe').addEventListener('click', async () => {
  try {
    await api('wipe', { confirm: $('wipe-confirm').value.trim() });
    $('wipe-msg').textContent = '초기화했습니다. 다른 PC의 기록도 30초 안에 지워집니다.';
    $('wipe-confirm').value = '';
    $('view').hidden = true;
    await refresh();
  } catch (err) {
    $('wipe-msg').textContent = err.message;
  }
});

refresh();
