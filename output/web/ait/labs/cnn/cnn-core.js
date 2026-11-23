// 합성곱 신경망 5분 실습의 계산 부분. 화면 없이 계산만 하므로 시험(node)에서도 그대로 불러 쓴다.
// 사진은 인터넷 그림을 쓰지 않고 32×32 회색조로 직접 그린다. 배경은 0(검정), 얼굴은 밝은 값이다.

export const SIZE = 32;

// 39번 슬라이드의 교사 작성 예시와 sharpen 커널. 결과는 180이다.
export const WARM = {
  pixels: [[20, 30, 20], [30, 60, 30], [20, 30, 20]],
  kernel: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]],
};

// 사진에 쓰는 윤곽 찾기 필터: 둘레와 밝기가 같은 곳은 0, 밝기가 바뀌는 곳은 큰 값.
export const EDGE = [[-1, -1, -1], [-1, 8, -1], [-1, -1, -1]];
// 두 번째 합성곱 필터: 주변 특징을 모은다(16으로 나눈다).
export const GATHER = { kernel: [[1, 2, 1], [2, 4, 2], [1, 2, 1]], div: 16 };

export const CLASSES = [
  { id: 'cat', name: '고양이' },
  { id: 'dog', name: '개' },
  { id: 'lion', name: '사자' },
];
// 가중치를 만들 때 세 동물 평균을 30%만 빼서 동물마다 다른 자리를 더 드러낸다.
const CENTER = 0.3;
// 수업용으로 정한 작은 편향.
export const BIAS = { cat: 0.2, dog: 0.1, lion: -0.1 };

// 3×3 두 개를 같은 위치끼리 곱해 더한다.
export function conv3(a, k) {
  let s = 0;
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) s += a[i][j] * k[i][j];
  return s;
}

// (r, c)를 가운데로 하는 3×3 조각. 사진 밖은 0으로 채운다(제로 패딩).
export function patch(img, r, c) {
  const n = img.length;
  const out = [];
  for (let i = -1; i <= 1; i += 1) {
    const row = [];
    for (let j = -1; j <= 1; j += 1) {
      const y = r + i;
      const x = c + j;
      row.push(y >= 0 && y < n && x >= 0 && x < n ? img[y][x] : 0);
    }
    out.push(row);
  }
  return out;
}

export const relu = (v) => (v > 0 ? v : 0);

// 한 칸의 합성곱 값(음수는 0).
export function convAt(img, kernel, r, c, div = 1) {
  return relu(Math.round(conv3(patch(img, r, c), kernel) / div));
}

// 같은 크기를 유지하는 합성곱(제로 패딩) + 음수는 0.
export function convolve(img, kernel, div = 1) {
  return img.map((row, r) => row.map((_, c) => convAt(img, kernel, r, c, div)));
}

// 2×2 최대 풀링: 가로세로가 절반이 된다.
export function maxPool(map) {
  const h = map.length / 2;
  const out = [];
  for (let r = 0; r < h; r += 1) {
    const row = [];
    for (let c = 0; c < h; c += 1) {
      row.push(Math.max(map[2 * r][2 * c], map[2 * r][2 * c + 1], map[2 * r + 1][2 * c], map[2 * r + 1][2 * c + 1]));
    }
    out.push(row);
  }
  return out;
}

// 사진 한 장의 전 과정: 32 → (합성곱) 32 → (풀링) 16 → (합성곱) 16 → (풀링) 8.
export function pipeline(img) {
  const c1 = convolve(img, EDGE);
  const p1 = maxPool(c1);
  const c2 = convolve(p1, GATHER.kernel, GATHER.div);
  const p2 = maxPool(c2);
  const flat = p2.flat();
  const max = Math.max(...flat) || 1;
  // 특징값: 가장 큰 값을 10으로 맞추고 소수 첫째 자리까지.
  const features = flat.map((v) => Math.round((v / max) * 100) / 10);
  return { c1, p1, c2, p2, features };
}

// ---- 그리기 ----
const blank = () => Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
function paint(img, test, v) {
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) if (test(x, y)) img[y][x] = v;
}
const ellipse = (img, cx, cy, rx, ry, v) => paint(img, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, v);
function triangle(img, a, b, c, v) {
  paint(img, (x, y) => {
    const s1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
    const s2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (y - c[1]);
    const s3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1]);
    const neg = s1 < 0 || s2 < 0 || s3 < 0;
    const pos = s1 > 0 || s2 > 0 || s3 > 0;
    return !(neg && pos);
  }, v);
}
const mirror = (p) => [SIZE - p[0], p[1]];
function shift(img, dx, dy) {
  if (!dx && !dy) return img;
  const out = blank();
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const sx = x - dx;
    const sy = y - dy;
    if (sx >= 0 && sx < SIZE && sy >= 0 && sy < SIZE) out[y][x] = img[sy][sx];
  }
  return out;
}

// 고양이: 뾰족한 귀, 동그란 얼굴, 눈, 코, 수염.
export function drawCat({ dx = 0, dy = 0 } = {}) {
  const img = blank();
  const earL = [[6, 14], [8, 2], [15, 9]];
  triangle(img, ...earL, 160);
  triangle(img, ...earL.map(mirror), 160);
  triangle(img, [8.5, 11], [9, 5.5], [12.5, 9.5], 110);
  triangle(img, ...[[8.5, 11], [9, 5.5], [12.5, 9.5]].map(mirror), 110);
  ellipse(img, 16, 18, 11, 10, 160);
  ellipse(img, 11.5, 16, 2, 1.6, 20);
  ellipse(img, 20.5, 16, 2, 1.6, 20);
  triangle(img, [14.5, 20.5], [17.5, 20.5], [16, 22.5], 60);
  for (let x = 1; x <= 9; x += 1) { img[22][x] = 220; img[22][SIZE - x] = 220; }
  return shift(img, dx, dy);
}

// 개: 늘어진 귀, 긴 주둥이, 큰 코.
export function drawDog({ dx = 0, dy = 0 } = {}) {
  const img = blank();
  ellipse(img, 16, 17, 9, 10, 170);
  ellipse(img, 6, 17, 3.5, 8, 100);
  ellipse(img, 26, 17, 3.5, 8, 100);
  ellipse(img, 16, 23, 5, 4, 210);
  ellipse(img, 16, 21, 2.2, 1.5, 20);
  ellipse(img, 12, 14, 1.5, 1.5, 20);
  ellipse(img, 20, 14, 1.5, 1.5, 20);
  return shift(img, dx, dy);
}

// 사자: 얼굴을 둘러싼 갈기, 작고 둥근 귀.
export function drawLion({ dx = 0, dy = 0 } = {}) {
  const img = blank();
  ellipse(img, 16, 17, 15, 14.5, 110);
  ellipse(img, 9, 9.5, 2.5, 2.5, 190);
  ellipse(img, 23, 9.5, 2.5, 2.5, 190);
  ellipse(img, 16, 18, 9, 9, 190);
  ellipse(img, 12.5, 16.5, 1.4, 1.4, 20);
  ellipse(img, 19.5, 16.5, 1.4, 1.4, 20);
  triangle(img, [14.5, 20.5], [17.5, 20.5], [16, 22.5], 60);
  return shift(img, dx, dy);
}

const DRAW = { cat: drawCat, dog: drawDog, lion: drawLion };

// 가중치: 각 동물의 기준 그림을 같은 과정에 넣어 얻은 64개 특징에서 세 동물 평균의 30%를 빼고 크기 1로 맞춘 값(소수 둘째 자리).
// 기준 그림과 같은 자리에 특징이 많을수록 그 동물 점수가 커진다.
export function makeWeights() {
  const t = Object.fromEntries(CLASSES.map(({ id }) => [id, pipeline(DRAW[id]()).features]));
  const mean = t.cat.map((_, i) => CLASSES.reduce((s, { id }) => s + t[id][i], 0) / CLASSES.length);
  const out = {};
  for (const { id } of CLASSES) {
    const d = t[id].map((v, i) => v - CENTER * mean[i]);
    const norm = Math.hypot(...d) || 1;
    out[id] = d.map((v) => Math.round((v / norm) * 100) / 100);
  }
  return out;
}

// 점수 = Σ(특징값 × 가중치) + 편향. 화면에 보이는 반올림 값 그대로 계산한다.
export function scores(features, weights = makeWeights()) {
  return CLASSES.map(({ id, name }) => {
    const sum = features.reduce((s, v, i) => s + v * weights[id][i], 0);
    return { id, name, sum: Math.round(sum * 100) / 100, bias: BIAS[id], score: Math.round((sum + BIAS[id]) * 100) / 100 };
  });
}

export const best = (list) => list.reduce((a, b) => (b.score > a.score ? b : a));

// 실습에 쓰는 고양이 사진: 기준 그림에서 한 칸 옮겨 그린 것(기준과 똑같지는 않다).
export const PHOTO = { draw: () => drawCat({ dx: 1, dy: 1 }) };

// 풀링 연습 칸: 서로 다른 값 네 개가 있는 2×2 영역 가운데 값 차이가 가장 큰 곳(고양이 귀 근처가 나온다).
export function pickPoolBlock(c1) {
  let bestBlock = null;
  for (let r = 0; r < c1.length / 2; r += 1) for (let c = 0; c < c1.length / 2; c += 1) {
    const v = [c1[2 * r][2 * c], c1[2 * r][2 * c + 1], c1[2 * r + 1][2 * c], c1[2 * r + 1][2 * c + 1]];
    if (new Set(v).size < 4 || v.some((x) => x === 0)) continue;
    const spread = Math.max(...v) - Math.min(...v);
    if (!bestBlock || spread > bestBlock.spread) bestBlock = { r, c, values: v, spread };
  }
  return bestBlock;
}
