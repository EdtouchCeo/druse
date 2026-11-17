// lib/slides.js: 두 양식에서 모든 레이아웃이 그려지는지, 디자인 기준(영어 장식 라벨 없음, 작은 글자 없음, 캐릭터 배치)을 지키는지 확인한다.
// 실행: node --test tests/slides-render.test.cjs
const test = require('node:test'), assert = require('node:assert/strict')
const S = require('../output/web/lib/slides.js')
const full = (layout) => ({ layout, title: '제목', tag: '', kicker: '행사', subtitle: '부제', org: '기관', items: [{ title: '가', sub: '나' }, { title: '다', sub: '라' }],
  bullets: [{ title: '가', sub: '나' }, { title: '다', sub: '' }], cards: [{ title: '가', body: '나' }, { title: '다', body: '라' }], steps: [{ title: '가', body: '나' }, { title: '다', body: '라' }],
  stats: [{ value: '12건', label: '가', sub: '나' }], points: [{ title: '가', body: '나' }], rows: [['구분', '값'], ['가', '나']], left: { label: '왼쪽', items: ['가'] }, right: { label: '오른쪽', items: ['나'] },
  question: '질문?', hints: ['생각할 점'], note: '핵심', next: '다음', sub: '설명', no: 1 })
for (const theme of ['edtouch', 'daeryun']) {
  const deck = { theme, slides: Object.keys(S.LAYOUTS).map(full) }
  test(theme + ': 모든 레이아웃이 그려지고 영어 장식 라벨과 10pt 미만 글자가 없다', () => {
    deck.slides.forEach((sl, i) => {
      const shapes = S.shapesFor(deck, i)
      assert.ok(shapes.length > 3, sl.layout)
      for (const sh of shapes.filter((x) => x.t === 'text')) for (const p of sh.paras) for (const r of p) {
        assert.ok(r.size >= 10, sl.layout + ' ' + r.size + 'pt ' + r.text)
        assert.ok(!/^(KEY|AGENDA|SECTION|WRAP|NEXT|SUMMARY|INSIGHT|TIP|READING|PROCESS|COMPARISON|TABLE|VS)\b/.test(r.text), sl.layout + ' ' + r.text)
      }
      // 글과 그림은 화면 안에 있어야 한다(장식 원은 일부러 밖으로 걸친다).
      for (const sh of shapes.filter((x) => x.t === 'text' || x.t === 'img')) assert.ok(sh.x >= -0.01 && sh.y >= -0.01 && sh.x + sh.w <= S.W + 0.01 && sh.y + sh.h <= S.H + 0.01, sl.layout + ' 화면 밖으로 나간 ' + sh.t)
    })
  })
}
test('대륜고 양식: 캐릭터는 표지·구역 표지·질문·마무리와 character를 준 항목 장에만 나온다', () => {
  const deck = { theme: 'daeryun', slides: Object.keys(S.LAYOUTS).map(full) }
  const withChar = deck.slides.filter((sl, i) => S.hasCharacter(deck, i)).map((sl) => sl.layout)
  assert.deepEqual(withChar, ['cover', 'section', 'question', 'end'])
  deck.slides.find((sl) => sl.layout === 'bullets').character = 'peer'
  assert.ok(S.hasCharacter(deck, deck.slides.findIndex((sl) => sl.layout === 'bullets')))
  deck.slides.find((sl) => sl.layout === 'bullets').bullets = Array(5).fill({ title: '가', sub: '' })
  assert.ok(!S.hasCharacter(deck, deck.slides.findIndex((sl) => sl.layout === 'bullets')), '항목 5개면 캐릭터를 두지 않는다')
  assert.ok(S.assetKeys(deck).includes('dr-char-greeting'))
  for (const k of Object.keys(S.CHARACTER_ROLES)) assert.ok(S.THEMES.daeryun.chars[k], k)
  assert.equal(S.hasCharacter({ theme: 'edtouch', slides: [full('cover')] }, 0), false)
})
