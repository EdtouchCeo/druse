'use strict';
// Dave AIT Class 합성곱 신경망 5분 실습(output/web/ait/labs/cnn)의 계산이 수업 기준과 맞는지 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'output', 'web', 'ait', 'labs', 'cnn', 'cnn-core.js')).href);

test('CNN 실습: 39번 슬라이드 예시(sharpen 커널)는 180이다', async () => {
  const m = await load();
  assert.equal(m.conv3(m.WARM.pixels, m.WARM.kernel), 180);
});

test('CNN 실습: 32×32 → 풀링 16×16(1,024 → 256개) → 두 번째 풀링 8×8(64개)', async () => {
  const m = await load();
  const p = m.pipeline(m.PHOTO.draw());
  assert.equal(p.c1.length * p.c1[0].length, 1024);
  assert.equal(p.p1.length * p.p1[0].length, 256);
  assert.equal(p.p2.length * p.p2[0].length, 64);
  assert.equal(p.features.length, 64);
});

test('CNN 실습: 풀링 연습 칸의 최댓값이 16×16 맵의 같은 칸에 들어간다', async () => {
  const m = await load();
  const p = m.pipeline(m.PHOTO.draw());
  const b = m.pickPoolBlock(p.c1);
  assert.ok(b, '연습 칸이 있어야 한다');
  assert.equal(new Set(b.values).size, 4);
  assert.equal(p.p1[b.r][b.c], Math.max(...b.values));
});

test('CNN 실습: 고양이 사진은 고양이 점수가 가장 높고, 개·사자 그림도 제 이름이 가장 높다', async () => {
  const m = await load();
  const w = m.makeWeights();
  assert.equal(m.best(m.scores(m.pipeline(m.PHOTO.draw()).features, w)).id, 'cat');
  const draw = { cat: m.drawCat, dog: m.drawDog, lion: m.drawLion };
  for (const [id, fn] of Object.entries(draw)) {
    for (const o of [{}, { dx: 1, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: 2 }, { dx: 2, dy: -1 }]) {
      assert.equal(m.best(m.scores(m.pipeline(fn(o)).features, w)).id, id, `${id} ${JSON.stringify(o)}`);
    }
  }
});

test('CNN 실습: 점수는 화면에 보이는 64개 특징값과 가중치로 다시 계산해도 같다', async () => {
  const m = await load();
  const w = m.makeWeights();
  const f = m.pipeline(m.PHOTO.draw()).features;
  for (const s of m.scores(f, w)) {
    const again = f.reduce((a, v, i) => a + v * w[s.id][i], 0) + m.BIAS[s.id];
    assert.ok(Math.abs(again - s.score) < 0.01);
    assert.equal(w[s.id].length, 64);
  }
});
