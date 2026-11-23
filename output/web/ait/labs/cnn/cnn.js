// 합성곱 신경망 5분 실습 화면. 계산은 cnn-core.js가 하고, 이 파일은 그리기와 조작만 맡는다.
// 학생 정보는 저장하지 않고 서버도 부르지 않는다.
import * as core from './cnn-core.js';

const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return n;
}
// 곱셈 항이 줄 중간에서 끊기지 않게 항마다 묶는다.
const joinTerms = (terms) => terms.flatMap((t, i) => [i ? ' + ' : '', el('span', { class: 't', text: t })]).filter(Boolean);
const fmt = (n) => n.toLocaleString('ko-KR');
// 실습 칸(iframe) 안에서만 스크롤한다. scrollIntoView는 바깥 화면까지 움직인다.
const scrollToEl = (node) => window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 56, behavior: 'smooth' });
const say = (id, text, kind = '') => { const m = $(id); m.textContent = text; m.className = `msg ${kind}`; };

const photo = core.PHOTO.draw();
const run = core.pipeline(photo);
const weights = core.makeWeights();
const results = core.scores(run.features, weights);
const winner = core.best(results);
const block = core.pickPoolBlock(run.c1);
const c1Max = Math.max(...run.c1.flat()) || 1;

// ---------- 단계 이동 ----------
const done = { 1: false, 2: false, 3: false };
function goStep(n, scroll = true) {
  [1, 2, 3].forEach((k) => { $(`#step${k}`).hidden = k !== n; });
  document.querySelectorAll('[data-step]').forEach((b) => {
    const k = Number(b.dataset.step);
    if (k === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    b.disabled = k > 1 && !done[k - 1];
    b.textContent = `${done[k] ? '✓ ' : ''}${k} ${['합성곱', '최대 풀링', '완전 연결'][k - 1]}`;
  });
  $('#wrap').hidden = !done[3];
  if (n === 2) paintPool();
  if (n === 3) paintFeatures();
  if (scroll) window.scrollTo({ top: 0 });
}
document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => goStep(Number(b.dataset.step))));

// ---------- 1단계: 준비 문제 ----------
function matrix(box, m, kernel = false) {
  box.replaceChildren(...m.flat().map((v, i) => el('span', { class: 'cell', 'data-i': String(i), text: kernel && v < 0 ? `−${-v}` : String(v) })));
}
matrix($('#warm-px'), core.WARM.pixels);
matrix($('#warm-k'), core.WARM.kernel, true);
const warmAnswer = core.conv3(core.WARM.pixels, core.WARM.kernel);

function clearLook() { document.querySelectorAll('.look').forEach((n) => n.classList.remove('look')); }
function lookAt(selector) { clearLook(); document.querySelectorAll(selector).forEach((n) => n.classList.add('look')); }

$('#s1-check').addEventListener('click', () => {
  const raw = $('#warm-in').value.replace(/[−–]/g, '-').replace(/\s|,/g, '');
  const v = Number(raw);
  if (raw === '' || !Number.isFinite(v)) { say('#s1-msg', '연산 결과 칸에 숫자를 적어 주세요.', 'error'); $('#warm-in').focus(); return; }
  if (v === warmAnswer) {
    clearLook();
    say('#s1-msg', `맞습니다. 5×60 = 300에서 주변 네 칸의 30을 빼서 ${warmAnswer}이 됩니다. 가운데 값이 주변보다 강조됩니다. 이제 사진 위에서 필터를 옮겨 보세요.`, 'ok');
    $('#s1-photo').hidden = false;
    done[1] = true;
    goStep(1, false);
    scrollToEl($('#s1-photo'));
    return;
  }
  // 정답은 보여 주지 않고 다시 볼 곳을 표시한다.
  if (v === 300) { lookAt('#warm-k .cell:nth-child(2n)'); say('#s1-msg', '가운데만 계산했습니다. 표시한 −1 칸도 같은 위치의 픽셀값과 곱해 더해야 합니다.', 'error'); }
  else if (v === 420) { lookAt('#warm-k .cell:nth-child(2n)'); say('#s1-msg', '표시한 칸의 가중치는 −1입니다. 곱하면 음수가 되어 빼는 셈입니다.', 'error'); }
  else if (v === 0 || v === 60) { lookAt('#warm-k .cell:nth-child(5)'); say('#s1-msg', '표시한 가운데 가중치 5를 다시 보세요. 가운데 픽셀값에 5를 곱합니다.', 'error'); }
  else { lookAt('#warm-k .cell:not(:nth-child(odd)), #warm-k .cell:nth-child(5)'); say('#s1-msg', '아직 다릅니다. 표시한 칸(0이 아닌 가중치)만 곱한 값이 남습니다. 하나씩 다시 곱해 보세요.', 'error'); }
});
$('#warm-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#s1-check').click(); });
$('#s1-hint').addEventListener('click', () => say('#s1-msg', '힌트: 0을 곱한 칸은 0이 됩니다. 남는 것은 가운데(5×60)와 −1이 있는 네 칸(−1×30)입니다.'));
$('#s1-reset').addEventListener('click', () => {
  $('#warm-in').value = ''; clearLook(); say('#s1-msg', '');
  filled.forEach((row) => row.fill(false)); pos = { ...START }; fillAt(pos.r, pos.c); paintPhoto();
  $('#warm-in').focus();
});

// ---------- 1단계: 사진 위 필터 ----------
const N = core.SIZE;
const filled = Array.from({ length: N }, () => new Array(N).fill(false));
// 왼쪽 귀 둘레에서 특징값이 가장 큰 칸에서 시작한다(윤곽에서 큰 값이 나오는 것을 바로 보게).
const START = (() => {
  let s = { r: 9, c: 9, v: -1 };
  for (let r = 2; r < 13; r += 1) for (let c = 2; c < 16; c += 1) if (run.c1[r][c] > s.v) s = { r, c, v: run.c1[r][c] };
  return { r: s.r, c: s.c };
})();
let pos = { ...START };
const gray = (v) => `rgb(${v},${v},${v})`;

function drawGrid(ctx, n, size) {
  const s = size / n;
  ctx.strokeStyle = 'rgba(148,163,184,.18)';
  ctx.lineWidth = 1;
  for (let i = 1; i < n; i += 1) {
    ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(size, i * s); ctx.stroke();
  }
}
function drawMap(ctx, map, max, size, { known } = {}) {
  const n = map.length;
  const s = size / n;
  ctx.clearRect(0, 0, size, size);
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) {
    if (known && !known(r, c)) { ctx.fillStyle = '#1e2b45'; ctx.fillRect(c * s, r * s, s, s); continue; }
    const v = Math.round(Math.min(1, map[r][c] / max) * 255);
    ctx.fillStyle = gray(v);
    ctx.fillRect(c * s, r * s, s, s);
  }
  drawGrid(ctx, n, size);
}
function outline(ctx, x, y, w, h, color = '#e8a020', width = 3) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.strokeRect(x + width / 2, y + width / 2, w - width, h - width);
}

function fillAt(r, c) { filled[r][c] = true; }
function paintPhoto() {
  const cat = $('#cat').getContext('2d');
  const size = $('#cat').width;
  const s = size / N;
  drawMap(cat, photo, 255, size);
  outline(cat, (pos.c - 1) * s, (pos.r - 1) * s, 3 * s, 3 * s);
  const fm = $('#fmap').getContext('2d');
  drawMap(fm, run.c1, c1Max, size, { known: (r, c) => filled[r][c] });
  outline(fm, pos.c * s, pos.r * s, s, s);
  const count = filled.flat().filter(Boolean).length;
  $('#fill-count').textContent = `(채운 칸 ${fmt(count)} / 1,024)`;
  // 지금 칸의 계산
  const p = core.patch(photo, pos.r, pos.c);
  const raw = core.conv3(p, core.EDGE);
  const terms = p.flat().map((v, i) => { const k = core.EDGE.flat()[i]; return `${k < 0 ? `(−${-k})` : k}×${v}`; });
  $('#s1-calc').replaceChildren(
    el('p', { class: 'where', text: `필터 위치: ${pos.r + 1}행 ${pos.c + 1}열` }),
    el('div', { class: 'mini' },
      el('figure', {}, el('figcaption', { text: '필터 아래 픽셀값' }), el('div', { class: 'mat sm', 'aria-label': `픽셀값 ${p.flat().join(', ')}` }, ...p.flat().map((v) => el('span', { class: 'cell', text: String(v) })))),
      el('span', { class: 'op', text: '×' }),
      el('figure', {}, el('figcaption', { text: '윤곽 찾기 필터' }), el('div', { class: 'mat sm kernel' }, ...core.EDGE.flat().map((v) => el('span', { class: 'cell', text: v < 0 ? `−${-v}` : String(v) }))))),
    el('p', { class: 'sum' }, ...joinTerms(terms), ' = ', el('strong', { text: String(raw) }),
      raw < 0 ? ' → 음수이므로 0' : '', ` → 특징 맵 ${pos.r + 1}행 ${pos.c + 1}열에 `, el('strong', { text: String(core.relu(raw)) })),
    el('p', { class: 'hint', text: raw === 0 ? '둘레와 밝기가 같은 곳은 0입니다. 윤곽(밝기가 바뀌는 곳)으로 옮겨 보세요.' : raw > 0 ? '밝기가 바뀌는 윤곽에서 큰 값이 나옵니다.' : '주변보다 어두운 곳은 음수가 나와 0이 됩니다.' }),
  );
}
function moveTo(r, c) {
  pos = { r: Math.max(0, Math.min(N - 1, r)), c: Math.max(0, Math.min(N - 1, c)) };
  fillAt(pos.r, pos.c);
  paintPhoto();
}
$('#cat').addEventListener('click', (e) => {
  const box = e.currentTarget.getBoundingClientRect();
  moveTo(Math.floor(((e.clientY - box.top) / box.height) * N), Math.floor(((e.clientX - box.left) / box.width) * N));
});
$('#cat').addEventListener('keydown', (e) => {
  const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (!d) return;
  e.preventDefault();
  moveTo(pos.r + d[0], pos.c + d[1]);
});
$('#sweep').addEventListener('click', () => {
  const btn = $('#sweep');
  btn.disabled = true;
  let i = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stepCells = reduce ? N * N : 24;
  const tick = () => {
    for (let k = 0; k < stepCells && i < N * N; k += 1, i += 1) filled[Math.floor(i / N)][i % N] = true;
    paintPhoto();
    if (i < N * N) requestAnimationFrame(tick);
    else { btn.disabled = false; say('#s1-msg', '특징 맵을 모두 채웠습니다. 고양이 윤곽(귀, 얼굴 둘레, 눈, 코)이 밝게 드러납니다.', 'ok'); }
  };
  tick();
});
$('#to2').addEventListener('click', () => goStep(2));
fillAt(pos.r, pos.c);
paintPhoto();

// ---------- 2단계: 최대 풀링 ----------
let picked = null;
let poolDone = false;
let secondShown = false;
const blockIdx = [[0, 0], [0, 1], [1, 0], [1, 1]];
function paintPool() {
  const size = $('#pmap-in').width;
  const s = size / N;
  const a = $('#pmap-in').getContext('2d');
  drawMap(a, run.c1, c1Max, size);
  if (poolDone) {
    a.fillStyle = 'rgba(232,160,32,.55)';
    a.fillRect(block.c * 2 * s, block.r * 2 * s, 2 * s, 2 * s);
  }
  outline(a, block.c * 2 * s - 2, block.r * 2 * s - 2, 2 * s + 4, 2 * s + 4);
  const b = $('#pmap-out').getContext('2d');
  const t = size / (N / 2);
  const p1Max = Math.max(...run.p1.flat()) || 1;
  drawMap(b, run.p1, p1Max, size, { known: (r, c) => poolDone && (poolFillAll || (r === block.r && c === block.c)) });
  if (poolDone) { b.fillStyle = 'rgba(232,160,32,.55)'; b.fillRect(block.c * t, block.r * t, t, t); }
  outline(b, block.c * t - 2, block.r * t - 2, t + 4, t + 4);
}
let poolFillAll = false;
function paintPick() {
  $('#pool-pick').replaceChildren(...block.values.map((v, i) => el('button', {
    type: 'button', class: `pick btn-ghost${picked === i ? ' chosen' : ''}`, 'aria-pressed': String(picked === i),
    'aria-label': `${blockIdx[i][0] + 1}행 ${blockIdx[i][1] + 1}열 값 ${v}`,
    onclick: () => { picked = i; say('#s2-msg', ''); clearLook(); paintPick(); $('#pool-pick').querySelectorAll('button')[i].focus(); },
  }, String(v))));
}
// 네 칸은 2×2 배치이므로 화살표 키로 옮겨 다닌다.
$('#pool-pick').addEventListener('keydown', (e) => {
  const btns = [...$('#pool-pick').querySelectorAll('button')];
  const i = btns.indexOf(document.activeElement);
  if (i < 0) return;
  const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }[e.key];
  if (move === undefined) return;
  e.preventDefault();
  btns[(i + move + 4) % 4].focus();
});
paintPick();
$('#s2-check').addEventListener('click', () => {
  if (picked === null) { say('#s2-msg', '네 값 가운데 하나를 먼저 고르세요.', 'error'); return; }
  const max = Math.max(...block.values);
  if (block.values[picked] !== max) {
    lookAt('#pool-pick .pick');
    say('#s2-msg', `${block.values[picked]}보다 큰 값이 네 칸 안에 있습니다. 표시한 네 값을 다시 비교해 보세요.`, 'error');
    return;
  }
  clearLook();
  poolDone = true;
  say('#s2-msg', `맞습니다. ${max}이 풀링 결과 16×16 맵의 ${block.r + 1}행 ${block.c + 1}열에 들어갑니다. 같은 색으로 표시한 네 칸이 한 칸이 되었습니다.`, 'ok');
  paintPool();
  // 나머지 칸도 같은 방식으로 채운다.
  setTimeout(() => { poolFillAll = true; paintPool(); $('#s2-more').hidden = false; }, 700);
});
$('#s2-hint').addEventListener('click', () => say('#s2-msg', '힌트: 최대 풀링은 네 값을 더하거나 평균 내지 않습니다. 가장 큰 수 하나만 남깁니다.'));
$('#s2-reset').addEventListener('click', () => {
  picked = null; poolDone = false; poolFillAll = false; clearLook(); say('#s2-msg', '');
  $('#s2-more').hidden = true; $('#second-box').hidden = true; secondShown = false;
  paintPick(); paintPool();
});
$('#second').addEventListener('click', () => {
  secondShown = true;
  $('#second-box').hidden = false;
  const ctx = $('#p2map').getContext('2d');
  drawMap(ctx, run.p2, Math.max(...run.p2.flat()) || 1, $('#p2map').width);
  done[2] = true;
  goStep(2, false);
  scrollToEl($('#second-box'));
});
$('#to3').addEventListener('click', () => goStep(3));

// ---------- 3단계: 완전 연결 ----------
let prediction = null;
let finalPick = null;
let computed = false;
function paintFeatures() {
  if ($('#feat').childElementCount) return;
  $('#feat').append(...run.features.map((v, i) => {
    const cell = el('span', { class: 'fcell', title: `${i + 1}번째 특징값`, text: v.toFixed(1) });
    cell.style.setProperty('--a', String(Math.min(1, v / 10)));
    return cell;
  }));
}
$('#flatten').addEventListener('click', () => {
  $('#strip').hidden = false;
  $('#strip').replaceChildren(...run.features.map((v, i) => el('li', {}, el('small', { text: `x${i + 1}` }), v.toFixed(1))));
  $('#flatten').disabled = true;
  $('#flatten').textContent = '64개를 한 줄로 펼쳤습니다';
});
function choices(box, onPick, current) {
  box.replaceChildren(...core.CLASSES.map((c) => el('button', {
    type: 'button', class: `btn-ghost btn-sm choice${current === c.id ? ' chosen' : ''}`, 'aria-pressed': String(current === c.id),
    onclick: () => onPick(c.id),
  }, c.name)));
}
const paintPredict = () => choices($('#predict-choices'), (id) => {
  if (computed) return;
  prediction = id; $('#compute').disabled = false; paintPredict();
}, prediction);
const paintFinal = () => choices($('#final-choices'), (id) => { finalPick = id; say('#s3-msg', ''); clearLook(); paintFinal(); }, finalPick);
paintPredict();

$('#compute').addEventListener('click', () => {
  computed = true;
  $('#compute').disabled = true;
  document.querySelectorAll('#predict-choices button').forEach((b) => { b.disabled = b.getAttribute('aria-pressed') !== 'true'; });
  const max = Math.max(...results.map((r) => Math.abs(r.score)), 1);
  $('#scores').hidden = false;
  $('#scores').replaceChildren(...results.map((r) => {
    const w = weights[r.id];
    const bar = el('span', { class: 'bar' });
    const row = el('div', { class: 'score-row', 'data-id': r.id },
      el('span', { class: 'name', text: r.name }),
      el('span', { class: 'track' }, bar),
      el('strong', { class: 'val', text: r.score.toFixed(2) }));
    requestAnimationFrame(() => { bar.style.width = `${Math.max(0, (r.score / max) * 100)}%`; });
    const terms = run.features.map((v, i) => `${v.toFixed(1)}×${w[i] < 0 ? `(${w[i].toFixed(2)})` : w[i].toFixed(2)}`);
    return el('div', { class: 'score' }, row,
      el('details', {}, el('summary', { text: `${r.name} 점수 계산 펼쳐 보기` }),
        el('p', { class: 'formula' }, ...joinTerms(terms), el('br'), `= ${r.sum.toFixed(2)} (곱의 합) + ${r.bias.toFixed(1)} (편향) = `, el('strong', { text: r.score.toFixed(2) }))));
  }));
  $('#final').hidden = false;
  paintFinal();
  const name = core.CLASSES.find((c) => c.id === prediction).name;
  say('#s3-msg', `점수가 나왔습니다. 예상한 답은 ${name}였습니다. 이제 완전 연결 계층이 고른 답을 골라 보세요.`);
});
$('#s3-check').addEventListener('click', () => {
  if (!computed) { say('#s3-msg', '먼저 점수를 계산하세요.', 'error'); return; }
  if (!finalPick) { say('#s3-msg', '고양이, 개, 사자 가운데 하나를 고르세요.', 'error'); return; }
  if (finalPick !== winner.id) {
    lookAt('#scores .score-row');
    say('#s3-msg', '세 막대와 점수를 다시 비교해 보세요. 완전 연결 계층은 점수만 보고 답을 고릅니다.', 'error');
    return;
  }
  clearLook();
  const same = prediction === winner.id;
  say('#s3-msg', `맞습니다. ${winner.name} 점수(${winner.score.toFixed(2)})가 가장 높아 ${winner.name}로 분류했습니다. ${same ? '처음 예상과 같습니다.' : '처음 예상과는 달랐습니다. 무엇이 점수를 바꿨는지 계산을 펼쳐 보세요.'}`, 'ok');
  done[3] = true;
  goStep(3, false);
  $('#final').hidden = false;
  $('#scores').hidden = false;
  $('#wrap').hidden = false;
  $('#why').focus();
});
$('#s3-hint').addEventListener('click', () => say('#s3-msg', '힌트: 완전 연결 계층은 64개 특징값에 가중치를 곱해 더한 점수를 비교해, 가장 높은 점수를 답으로 고릅니다.'));
$('#s3-reset').addEventListener('click', () => {
  prediction = null; finalPick = null; computed = false; done[3] = false;
  $('#scores').hidden = true; $('#final').hidden = true; $('#wrap').hidden = true; $('#why').value = '';
  $('#compute').disabled = true; clearLook(); say('#s3-msg', '');
  paintPredict();
});
