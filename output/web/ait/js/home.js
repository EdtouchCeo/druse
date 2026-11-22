// 첫 화면: 학생 참여 코드 입력과 선생님 차시 목록.
import { $, el, loadCatalog, normalizeCode, isValidCode } from './common.js';

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
  } catch {
    box.replaceChildren(el('p', { class: 'hint' }, '아직 등록된 차시가 없습니다. 제작 명령으로 차시를 만든 뒤 다시 열어 주세요.'));
    return;
  }
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
