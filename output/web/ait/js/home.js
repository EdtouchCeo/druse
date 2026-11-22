// 첫 화면: 학생 참여 코드 입력과 선생님 차시 목록.
import { $, el, loadCatalog, normalizeCode, isValidCode, SERVER_MODE } from './common.js';

const input = $('#code');
input.addEventListener('input', () => {
  const v = normalizeCode(input.value);
  if (v !== input.value) input.value = v;
  $('#join-msg').textContent = '';
});
if (new URLSearchParams(location.search).get('join') === 'again') {
  $('#join-msg').textContent = '참여 코드를 다시 넣어 주세요.';
}
$('#join').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeCode(input.value);
  if (!isValidCode(code)) {
    $('#join-msg').textContent = '참여 코드는 영문과 숫자 6자리입니다. 화면의 코드를 다시 확인해 주세요.';
    input.focus();
    return;
  }
  location.href = `/ait/room.html?code=${code}`;
});

async function showCatalog() {
  const box = $('#catalog');
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    const status = Number(String(e.message).split(' ').pop());
    if (SERVER_MODE && status === 401) {
      // 차시 목록은 교사만 본다. 학생은 위의 참여 코드만 쓰면 된다.
      box.replaceChildren(el('p', { class: 'hint' }, '사용 설명서에 교사 계정으로 로그인하면 차시 목록이 보입니다. 학생은 위 칸에 참여 코드를 넣으면 됩니다.'),
        el('p', {}, el('a', { class: 'btn btn-sm', href: `/?gate_return=${encodeURIComponent('/ait/')}#login` }, '교사 로그인')));
      return;
    }
    box.replaceChildren(...[el('p', { class: 'hint' }, !SERVER_MODE
      ? '아직 등록된 차시가 없습니다. 제작 명령으로 차시를 만든 뒤 다시 열어 주세요.'
      : '수업 보관함에 올린 차시가 없습니다. "자료 올리기"에서 PC의 content 폴더를 올려 주세요.'),
    !SERVER_MODE ? null : el('p', {}, el('a', { class: 'btn btn-sm', href: '/ait/upload.html' }, '자료 올리기'))].filter(Boolean));
    return;
  }
  if (SERVER_MODE) box.before(el('p', { class: 'upload-link' }, el('a', { class: 'btn-ghost btn-sm btn', href: '/ait/upload.html' }, '자료 올리기'), ' PC에서 차시를 새로 만들거나 고친 뒤 눌러 보관함에 맞춥니다.'));
  box.replaceChildren(...catalog.courses.map((course) => el('div', { class: 'course' },
    el('h3', {}, course.title),
    el('p', { class: 'hint' }, course.grade || ''),
    ...course.units.map((unit) => el('div', { class: 'unit' },
      el('div', { class: 'unit-title' }, unit.title),
      ...unit.lessons.map((l) => el('div', { class: 'lesson-row' },
        el('span', { class: 'title' }, l.title),
        el('span', { class: 'meta' }, `${l.slides}장 · 교과서 ${l.pages}쪽`),
        l.status === 'approved' ? null : el('span', { class: 'badge draft' }, '검토 전 초안'),
        el('a', { class: 'btn btn-sm', href: `/ait/teach.html?l=${encodeURIComponent(l.id)}` }, '진행 화면 열기'))))))));
}

showCatalog();
