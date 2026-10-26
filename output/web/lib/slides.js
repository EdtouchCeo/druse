/* 슬라이드 덱 렌더러 — 한 정의에서 화면 미리보기(HTML)와 파워포인트(.pptx)를 함께 만든다.
 *
 * 덱: { theme: 'edtouch' | 'daeryun', title, slides: [{ layout, ...내용, notes, source }] }
 * 레이아웃 함수는 도형 목록(사각형·글·그림·표)을 돌려주고, 두 출력기가 같은 목록을 그린다.
 * 좌표 단위는 인치, 화면은 16:9(13.333 × 7.5)이다. 글자 크기는 pt.
 * 글 도형의 path(예: 'bullets.2.title')는 미리보기에서 직접 고친 글을 덱 데이터에 되돌려 쓰는 주소다.
 *
 * 브라우저에서는 window.DrSlides, Node에서는 module.exports로 쓴다.
 */
(function (root) {
  'use strict';
  var W = 13.333, H = 7.5;

  /* ── 테마 ── */
  var THEMES = {
    edtouch: {
      id: 'edtouch', name: 'EdTouch AI',
      font: '맑은 고딕', mono: 'Consolas',
      navy: '1E1E32', ink: '202124', body: '3C4043', gray: '80868B', light: 'C7CBD1',
      card: 'F6F6F9', border: 'E3E3EA', white: 'FFFFFF',
      main: 'EE3B2E', second: 'EC2E7A',
      accents: ['EE3B2E', 'EC2E7A', '4285F4', '34A853', 'F9AB00'],
      tints: ['FDEDEB', 'FDEBF2', 'E9F1FE', 'E7F4EB', 'FEF3DC'],
      logos: { wide: { key: 'edtouch-wide', ratio: 1622 / 7468 }, stack: { key: 'edtouch-stack', ratio: 2732 / 3456 } },
      brand: function (o) { return [img(W - 0.45 - 1.45, 0.42, 1.45, 1.45 * this.logos.wide.ratio, this.logos.wide.key)]; },
      coverMark: function () { var w = 1.25; return [img(W - 0.75 - w, 0.62, w, w * this.logos.stack.ratio, this.logos.stack.key)]; },
      endMark: function () { var w = 1.6; return [img((W - w) / 2, 1.55, w, w * this.logos.stack.ratio, this.logos.stack.key)]; }
    },
    daeryun: {
      id: 'daeryun', name: '대륜고등학교',
      font: '맑은 고딕', mono: 'Consolas',
      navy: '1B2470', ink: '1F2330', body: '3A4150', gray: '7A8193', light: 'C5CAD6',
      card: 'F4F6FA', border: 'DFE3EC', white: 'FFFFFF',
      main: '1E9645', second: 'C9A227',
      accents: ['1E9645', '2F4BB8', 'C9A227', '3A86C8', 'D2553D'],
      tints: ['E6F4EB', 'E8ECFA', 'FAF3DD', 'E6F1FA', 'FBEAE6'],
      logos: { mark: { key: 'daeryun-logo', ratio: 375 / 568 } },
      brand: function () {
        var h = 0.5, w = h / this.logos.mark.ratio;
        return [img(W - 0.45 - w - 1.32, 0.38, w, h, this.logos.mark.key),
          txt(W - 0.45 - 1.25, 0.38, 1.25, h, [[run('대륜고등학교', 11, true, this.navy)]], { valign: 'middle' })];
      },
      coverMark: function () { var h = 1.1, w = h / this.logos.mark.ratio; return [img(W - 0.75 - w, 0.62, w, h, this.logos.mark.key)]; },
      endMark: function () { var h = 1.25, w = h / this.logos.mark.ratio; return [img((W - w) / 2, 1.5, w, h, this.logos.mark.key)]; }
    }
  };

  /* ── 도형 만들기 ── */
  function rect(x, y, w, h, fill, o) { o = o || {}; return { t: 'rect', x: x, y: y, w: w, h: h, fill: fill, line: o.line, lw: o.lw, r: o.r, shape: o.shape }; }
  function oval(x, y, w, h, fill, o) { o = o || {}; return { t: 'rect', x: x, y: y, w: w, h: h, fill: fill, line: o.line, lw: o.lw, shape: 'ellipse' }; }
  function img(x, y, w, h, key) { return { t: 'img', x: x, y: y, w: w, h: h, key: key }; }
  function run(text, size, bold, color, font) { return { text: text == null ? '' : String(text), size: size, bold: !!bold, color: color, font: font }; }
  // paras: [[run, run], [run]] — 바깥 배열이 문단
  function txt(x, y, w, h, paras, o) {
    o = o || {};
    return { t: 'text', x: x, y: y, w: w, h: h, paras: paras, align: o.align || 'left', valign: o.valign || 'top', line: o.line || 1.0, after: o.after || 0, path: o.path };
  }
  // 고칠 수 있는 한 줄 글(한 문단·한 런)
  function edit(x, y, w, h, value, size, bold, color, path, o) {
    o = o || {};
    var t = txt(x, y, w, h, [[run(value, size, bold, color, o.font)]], o);
    t.path = path; return t;
  }
  function table(x, y, colW, rowH, rows, th, o) { o = o || {}; return { t: 'table', x: x, y: y, colW: colW, rowH: rowH, rows: rows, th: th, path: o.path }; }

  function clampList(a, n) { return Array.isArray(a) ? a.slice(0, n) : []; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ── 공통 틀 ── */
  function frame(th) { return [rect(0.12, 0.12, 13.09, 7.26, null, { line: th.border, lw: 1.25, r: 0.2 })]; }
  function pageNo(th, n, total) { return [txt(11.68, 7.06, 1.1, 0.24, [[run(pad2(n) + ' / ' + total, 10, false, th.gray, th.mono)]], { align: 'right' })]; }
  function source(th, s) {
    if (!s.source) return [];
    return [edit(0.55, 7.06, 9.8, 0.24, '출처: ' + s.source, 9, false, th.gray, null)];
  }
  function header(th, s, n, total, defTag, accent) {
    accent = accent || th.main;
    var out = frame(th);
    var badge = rect(0.55, 0.42, 0.42, 0.42, th.navy, { r: 0.1 });
    out.push(badge, txt(0.55, 0.42, 0.42, 0.42, [[run(pad2(n), 14, true, th.white, th.mono)]], { align: 'center', valign: 'middle' }));
    out.push(edit(1.12, 0.45, 7.6, 0.32, s.tag || defTag, 12, true, accent, 'tag'));
    out.push(edit(0.55, 0.86, 10.4, 0.62, s.title || '', 25, true, th.navy, 'title', { valign: 'middle' }));
    out.push(rect(0.55, 1.52, 2.2, 0.045, accent), rect(2.79, 1.52, 0.6, 0.045, th.second));
    return out.concat(th.brand(), pageNo(th, n, total), source(th, s));
  }
  // 아래쪽 강조 상자(핵심 한 줄). 있으면 본문 영역이 줄어든다.
  function note(th, s, label) {
    if (!s.note) return [];
    var y = 6.3, h = 0.6;
    return [rect(0.55, y, 12.23, h, th.tints[0], { r: 0.08 }), rect(0.55, y + 0.1, 0.07, h - 0.2, th.main),
      txt(0.85, y, 1.4, h, [[run(label || 'KEY POINT', 11, true, th.main, th.mono)]], { valign: 'middle' }),
      edit(2.25, y, 10.3, h, s.note, 13.5, false, th.ink, 'note', { valign: 'middle' })];
  }
  function bodyBottom(s) { return s.note ? 6.1 : 6.85; }

  /* ── 레이아웃 ── */
  var LAYOUTS = {};

  LAYOUTS.cover = {
    label: '표지',
    draw: function (th, s) {
      var o = frame(th);
      o.push(rect(0.12, 0.12, 13.09, 0.07, th.main));
      o.push(oval(9.9, 4.3, 4.6, 4.6, th.tints[0]), oval(9.25, 4.95, 1.6, 1.6, null, { line: th.main, lw: 1.5 }), oval(11.95, 3.55, 0.32, 0.32, th.second));
      o = o.concat(th.coverMark());
      o.push(edit(0.95, 0.85, 8.5, 0.32, s.org || '', 12, false, th.gray, 'org'));
      o.push(edit(0.95, 1.45, 8.6, 0.32, s.kicker || '', 13, true, th.main, 'kicker'));
      o.push(edit(0.95, 1.95, 8.8, 2.0, s.title || '', 40, true, th.navy, 'title', { valign: 'middle', line: 1.05 }));
      o.push(rect(0.95, 4.12, 1.6, 0.06, th.main), rect(2.6, 4.12, 0.45, 0.06, th.second));
      o.push(edit(0.95, 4.35, 8.6, 0.9, s.subtitle || '', 17, false, th.body, 'subtitle', { line: 1.15 }));
      if (s.presenter || s.date) {
        o.push(rect(0.95, 5.75, 4.2, 0.95, th.card, { r: 0.08 }), rect(0.95, 5.88, 0.07, 0.69, th.main));
        o.push(edit(1.25, 5.85, 3.8, 0.3, s.date || '', 11, false, th.gray, 'date'));
        o.push(edit(1.25, 6.15, 3.8, 0.42, s.presenter || '', 17, true, th.navy, 'presenter'));
      }
      return o;
    },
    fields: 'org(기관·행사), kicker(짧은 머리말), title(제목, 2줄 이내), subtitle, date, presenter'
  };

  LAYOUTS.agenda = {
    label: '목차',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total, 'AGENDA');
      var items = clampList(s.items, 6), rows = Math.ceil(items.length / 2) || 1, col2 = items.length > 3;
      var n2 = col2 ? rows : items.length || 1, rowH = Math.min(1.25, 4.6 / n2), y0 = 1.95 + Math.max(0, (4.7 - n2 * rowH) / 2) * 0.7;
      items.forEach(function (it, i) {
        var c = col2 ? (i < rows ? 0 : 1) : 0, r = col2 ? (i < rows ? i : i - rows) : i;
        var x = 0.85 + c * 6.2, y = y0 + r * rowH, w = col2 ? 5.6 : 11.6;
        o.push(txt(x, y, 0.8, 0.5, [[run(pad2(i + 1), 22, true, th.accents[i % th.accents.length], th.mono)]], { valign: 'middle' }));
        o.push(edit(x + 0.95, y, w - 1, 0.5, it.title, 17, true, th.navy, 'items.' + i + '.title', { valign: 'middle' }));
        if (it.sub) o.push(edit(x + 0.95, y + 0.5, w - 1, 0.36, it.sub, 12, false, th.gray, 'items.' + i + '.sub'));
        o.push(rect(x, y + rowH - 0.18, w, 0.012, th.border));
      });
      return o;
    },
    fields: 'items[{title, sub}] 3~6개'
  };

  LAYOUTS.section = {
    label: '구역 표지',
    draw: function (th, s, n, total) {
      var o = frame(th);
      o.push(rect(0.12, 0.12, 0.14, 7.26, th.main));
      o = o.concat(th.brand());
      var no = s.no || 1;
      o.push(txt(1.0, 1.55, 4, 1.4, [[run(pad2(no), 80, true, th.tints[0], th.mono)]], { valign: 'bottom' }));
      o.push(txt(1.05, 3.05, 4, 0.3, [[run('SECTION ' + pad2(no), 12, true, th.main, th.mono)]]));
      o.push(edit(1.0, 3.4, 10.8, 0.95, s.title || '', 34, true, th.navy, 'title', { valign: 'middle' }));
      o.push(edit(1.0, 4.4, 10.8, 0.5, s.sub || '', 16, false, th.gray, 'sub'));
      o.push(rect(1.0, 5.15, 1.8, 0.05, th.main));
      return o.concat(pageNo(th, n, total));
    },
    fields: 'no(구역 번호), title, sub'
  };

  LAYOUTS.bullets = {
    label: '글머리',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total, 'KEY CONTENT');
      var items = clampList(s.bullets, 6), top = 1.95, bottom = bodyBottom(s);
      var avail = bottom - top, rowH = Math.min(1.2, avail / Math.max(items.length, 1));
      var y0 = top + Math.max(0, (avail - items.length * rowH) / 2) * 0.6;
      items.forEach(function (b, i) {
        var y = y0 + i * rowH;
        o.push(rect(0.85, y + 0.13, 0.13, 0.13, th.accents[i % 2 ? 1 : 0]));
        o.push(edit(1.2, y, 11.4, 0.42, b.title, 17, true, th.navy, 'bullets.' + i + '.title', { valign: 'middle' }));
        if (b.sub) o.push(edit(1.2, y + 0.42, 11.4, rowH - 0.5, b.sub, 13, false, th.body, 'bullets.' + i + '.sub', { line: 1.1 }));
      });
      return o.concat(note(th, s));
    },
    fields: 'bullets[{title(핵심 한 줄), sub(설명 1~2줄)}] 3~6개, note(핵심 한 줄, 선택)'
  };

  LAYOUTS.cards = {
    label: '카드',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total, 'KEY POINTS');
      var cards = clampList(s.cards, 4), k = Math.max(cards.length, 1), gap = 0.3;
      var w = (12.23 - gap * (k - 1)) / k, top = 1.95, h = bodyBottom(s) - top;
      cards.forEach(function (c, i) {
        var x = 0.55 + i * (w + gap), a = th.accents[i % th.accents.length], t = th.tints[i % th.tints.length];
        o.push(rect(x, top, w, h, th.card, { r: 0.1 }), rect(x, top, w, 0.06, a));
        o.push(oval(x + 0.3, top + 0.35, 0.55, 0.55, t), txt(x + 0.3, top + 0.35, 0.55, 0.55, [[run(pad2(i + 1), 13, true, a, th.mono)]], { align: 'center', valign: 'middle' }));
        o.push(edit(x + 0.3, top + 1.1, w - 0.6, 0.85, c.title, 17, true, th.navy, 'cards.' + i + '.title', { line: 1.05 }));
        o.push(edit(x + 0.3, top + 2.0, w - 0.6, h - 2.2, c.body, 13, false, th.body, 'cards.' + i + '.body', { line: 1.2 }));
      });
      return o.concat(note(th, s, 'SUMMARY'));
    },
    fields: 'cards[{title, body(2~4줄)}] 2~4개, note(선택)'
  };

  LAYOUTS.compare = {
    label: '비교',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total, 'COMPARISON');
      var top = 1.95, h = bodyBottom(s) - top, w = 5.75;
      [['left', 0, 0.55], ['right', 2, 7.03]].forEach(function (p) {
        var side = s[p[0]] || {}, a = th.accents[p[1]], t = th.tints[p[1]], x = p[2];
        o.push(rect(x, top, w, h, t, { r: 0.1 }));
        o.push(rect(x + (w - 2.6) / 2, top + 0.3, 2.6, 0.48, a, { r: 0.24 }));
        o.push(edit(x + (w - 2.6) / 2, top + 0.3, 2.6, 0.48, side.label || '', 14, true, th.white, p[0] + '.label', { align: 'center', valign: 'middle' }));
        clampList(side.items, 5).forEach(function (it, i) {
          var y = top + 1.05 + i * Math.min(0.78, (h - 1.25) / 5);
          o.push(oval(x + 0.4, y + 0.14, 0.12, 0.12, a));
          o.push(edit(x + 0.68, y, w - 1.0, 0.7, it, 14, false, th.ink, p[0] + '.items.' + i, { line: 1.1 }));
        });
      });
      o.push(oval(6.27, top + h / 2 - 0.38, 0.76, 0.76, th.navy), txt(6.27, top + h / 2 - 0.38, 0.76, 0.76, [[run('VS', 14, true, th.white, th.mono)]], { align: 'center', valign: 'middle' }));
      return o.concat(note(th, s, 'INSIGHT'));
    },
    fields: 'left{label, items[] 2~5개}, right{label, items[]}, note(선택)'
  };

  LAYOUTS.table = {
    label: '표',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total, 'TABLE');
      var rows = clampList(s.rows, 8).map(function (r) { return clampList(r, 5).map(function (c) { return c == null ? '' : String(c); }); });
      var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0) || 1;
      rows = rows.map(function (r) { while (r.length < cols) r.push(''); return r; });
      var first = Math.min(3.2, 12.23 / cols * 1.2), rest = (12.23 - first) / Math.max(cols - 1, 1);
      var colW = cols === 1 ? [12.23] : [first].concat(Array(cols - 1).fill(rest));
      var avail = bodyBottom(s) - 2.0, rowH = Math.min(0.62, avail / Math.max(rows.length, 1));
      if (rows.length) o.push(table(0.55, 2.0, colW, rowH, rows, th, { path: 'rows' }));
      return o.concat(note(th, s, 'READING GUIDE'));
    },
    fields: 'rows[[머리글...], [칸...]...] 첫 줄은 머리글, 최대 8줄 5칸, note(선택)'
  };

  LAYOUTS.process = {
    label: '단계',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total, 'PROCESS');
      var steps = clampList(s.steps, 5), k = Math.max(steps.length, 1), gap = 0.45;
      var w = (12.23 - gap * (k - 1)) / k, top = 1.95 + Math.max(0, (bodyBottom(s) - 1.95 - 3.2) / 2) * 0.7;
      steps.forEach(function (st, i) {
        var x = 0.55 + i * (w + gap), a = th.accents[i % th.accents.length], cx = x + w / 2;
        o.push(oval(cx - 0.42, top, 0.84, 0.84, a), txt(cx - 0.42, top, 0.84, 0.84, [[run(pad2(i + 1), 16, true, th.white, th.mono)]], { align: 'center', valign: 'middle' }));
        if (i < k - 1) o.push(txt(x + w, top, gap, 0.84, [[run('›', 26, true, th.light)]], { align: 'center', valign: 'middle' }));
        o.push(edit(x, top + 1.05, w, 0.5, st.title, 16, true, a, 'steps.' + i + '.title', { align: 'center', valign: 'middle' }));
        o.push(edit(x + 0.05, top + 1.6, w - 0.1, Math.min(1.6, bodyBottom(s) - top - 1.7), st.body, 12.5, false, th.body, 'steps.' + i + '.body', { align: 'center', line: 1.2 }));
      });
      return o.concat(note(th, s, 'TIP'));
    },
    fields: 'steps[{title, body}] 3~5개, note(선택)'
  };

  LAYOUTS.stats = {
    label: '수치',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total, 'KEY NUMBERS');
      var st = clampList(s.stats, 4), k = Math.max(st.length, 1), gap = 0.3;
      var w = (12.23 - gap * (k - 1)) / k, top = 2.05, h = Math.min(3.4, bodyBottom(s) - top - 0.1);
      st.forEach(function (it, i) {
        var x = 0.55 + i * (w + gap), a = th.accents[i % th.accents.length];
        o.push(rect(x, top, w, h, th.card, { r: 0.1 }), rect(x, top, w, 0.06, a));
        o.push(edit(x, top + 0.4, w, 0.95, it.value, 36, true, a, 'stats.' + i + '.value', { align: 'center', valign: 'middle', font: th.mono }));
        o.push(edit(x + 0.15, top + 1.45, w - 0.3, 0.45, it.label, 14, true, th.navy, 'stats.' + i + '.label', { align: 'center', valign: 'middle' }));
        o.push(edit(x + 0.2, top + 1.95, w - 0.4, h - 2.1, it.sub || '', 11, false, th.gray, 'stats.' + i + '.sub', { align: 'center', line: 1.15 }));
      });
      return o.concat(note(th, s, 'INSIGHT'));
    },
    fields: 'stats[{value(숫자·짧은 값), label, sub(근거·단위)}] 2~4개, note(선택)'
  };

  LAYOUTS.summary = {
    label: '정리',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total, 'WRAP UP');
      var pts = clampList(s.points, 4), k = Math.max(pts.length, 1), gap = 0.3;
      var w = (12.23 - gap * (k - 1)) / k, top = 2.0, h = s.next ? 3.55 : 4.7;
      pts.forEach(function (p, i) {
        var x = 0.55 + i * (w + gap), a = th.accents[i % th.accents.length];
        o.push(rect(x, top, w, 0.05, a));
        o.push(txt(x, top + 0.2, 1, 0.4, [[run(pad2(i + 1), 15, true, a, th.mono)]]));
        o.push(edit(x, top + 0.65, w, 0.75, p.title, 16, true, th.navy, 'points.' + i + '.title', { line: 1.05 }));
        o.push(edit(x, top + 1.45, w, h - 1.5, p.body, 12.5, false, th.body, 'points.' + i + '.body', { line: 1.2 }));
      });
      if (s.next) {
        o.push(rect(0.55, 5.75, 12.23, 1.0, th.navy, { r: 0.08 }));
        o.push(txt(0.9, 5.75, 1.6, 1.0, [[run('NEXT STEP', 11, true, th.second, th.mono)]], { valign: 'middle' }));
        o.push(edit(2.55, 5.75, 9.9, 1.0, s.next, 15, true, th.white, 'next', { valign: 'middle' }));
      }
      return o;
    },
    fields: 'points[{title, body}] 2~4개, next(다음 행동 한 줄, 선택)'
  };

  LAYOUTS.end = {
    label: '마무리',
    draw: function (th, s) {
      var o = frame(th);
      o.push(oval(11.0, 5.4, 3.6, 3.6, th.tints[0]));
      o = o.concat(th.endMark());
      o.push(edit(1, 3.3, 11.33, 0.9, s.title || '감사합니다', 38, true, th.navy, 'title', { align: 'center', valign: 'middle' }));
      o.push(edit(1, 4.3, 11.33, 0.5, s.sub || '', 15, false, th.gray, 'sub', { align: 'center' }));
      o.push(edit(1, 4.85, 11.33, 0.4, s.contact || '', 12, false, th.gray, 'contact', { align: 'center' }));
      return o;
    },
    fields: 'title(기본 감사합니다), sub, contact'
  };

  function shapesFor(deck, i) {
    var th = THEMES[deck.theme] || THEMES.edtouch, s = deck.slides[i] || {}, L = LAYOUTS[s.layout] || LAYOUTS.bullets;
    return L.draw(th, s, i + 1, deck.slides.length);
  }

  /* ── 화면 미리보기 ── */
  var esc = function (v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function cssBox(sh) { return 'left:' + sh.x + 'in;top:' + sh.y + 'in;width:' + sh.w + 'in;height:' + sh.h + 'in;'; }
  // assets: { key: url } — 그림 주소
  function renderHtml(deck, i, assets, opts) {
    opts = opts || {};
    var th = THEMES[deck.theme] || THEMES.edtouch, html = '';
    shapesFor(deck, i).forEach(function (sh) {
      if (sh.t === 'rect') {
        var st = cssBox(sh) + (sh.fill ? 'background:#' + sh.fill + ';' : '') +
          (sh.line ? 'border:' + (sh.lw || 1) + 'pt solid #' + sh.line + ';' : '') +
          (sh.shape === 'ellipse' ? 'border-radius:50%;' : sh.r ? 'border-radius:' + sh.r + 'in;' : '');
        html += '<div class="sl-s" style="' + st + '"></div>';
      } else if (sh.t === 'img') {
        html += '<img class="sl-s" alt="" src="' + esc((assets || {})[sh.key] || '') + '" style="' + cssBox(sh) + 'object-fit:contain;">';
      } else if (sh.t === 'text') {
        var jc = sh.valign === 'middle' ? 'center' : sh.valign === 'bottom' ? 'flex-end' : 'flex-start';
        var inner = sh.paras.map(function (p, pi) {
          return '<p style="margin:0 0 ' + (pi < sh.paras.length - 1 ? sh.after : 0) + 'pt;text-align:' + sh.align + ';line-height:' + (1.2 * sh.line) + ';">' +
            p.map(function (r) {
              return '<span style="font-size:' + r.size + 'pt;font-weight:' + (r.bold ? 700 : 400) + ';color:#' + (r.color || th.ink) + ';' +
                (r.font === th.mono ? 'font-family:Consolas,monospace;' : '') + '">' + esc(r.text) + '</span>';
            }).join('') + '</p>';
        }).join('');
        var ed = sh.path && opts.editable ? ' contenteditable="plaintext-only" spellcheck="false" data-path="' + esc(sh.path) + '"' : '';
        html += '<div class="sl-s sl-t' + (sh.path ? ' sl-e' : '') + '"' + ed + ' style="' + cssBox(sh) + 'display:flex;flex-direction:column;justify-content:' + jc + ';">' + inner + '</div>';
      } else if (sh.t === 'table') {
        var rowsHtml = sh.rows.map(function (r, ri) {
          return '<tr style="height:' + sh.rowH + 'in">' + r.map(function (c, ci) {
            var head = ri === 0, bg = head ? th.navy : ri % 2 === 0 ? th.card : th.white;
            var color = head ? th.white : ci === 0 ? th.navy : th.body;
            var ed2 = opts.editable ? ' contenteditable="plaintext-only" spellcheck="false" data-path="' + sh.path + '.' + ri + '.' + ci + '"' : '';
            return '<td' + ed2 + ' style="box-sizing:border-box;overflow:hidden;background:#' + bg + ';color:#' + color + ';font-size:' + (head ? 13.5 : 12.5) + 'pt;font-weight:' + (head || ci === 0 ? 700 : 400) + ';padding:0.04in 0.1in 0.04in 0.14in;border:0.5pt solid #' + th.border + ';vertical-align:middle;line-height:1.2;">' + esc(c) + '</td>';
          }).join('') + '</tr>';
        }).join('');
        var tw = sh.colW.reduce(function (a, b) { return a + b; }, 0);
        var cg = '<colgroup>' + sh.colW.map(function (w) { return '<col style="width:' + w + 'in">'; }).join('') + '</colgroup>';
        html += '<table class="sl-s" style="left:' + sh.x + 'in;top:' + sh.y + 'in;width:' + tw + 'in;border-collapse:collapse;table-layout:fixed;">' + cg + rowsHtml + '</table>';
      }
    });
    return '<div class="sl-page" data-theme="' + th.id + '">' + html + '</div>';
  }
  var CSS = '.sl-page{position:relative;width:13.333in;height:7.5in;background:#fff;overflow:hidden;font-family:"맑은 고딕","Malgun Gothic",Pretendard,"Noto Sans KR",sans-serif;word-break:keep-all;overflow-wrap:anywhere;color:#202124}' +
    '.sl-s{position:absolute;box-sizing:border-box;margin:0}.sl-t{overflow:visible}.sl-t p{white-space:pre-line}.sl-e[contenteditable]{outline:none;border-radius:4px;cursor:text}' +
    '.sl-e[contenteditable]:hover{box-shadow:0 0 0 1.5pt rgba(79,70,229,.35)}.sl-e[contenteditable]:focus{box-shadow:0 0 0 2pt rgba(79,70,229,.8);background:rgba(255,255,255,.6)}' +
    '.sl-page td[contenteditable]:focus{outline:2pt solid rgba(79,70,229,.8);outline-offset:-2pt}';

  /* ── 파워포인트 ── */
  // pptx: new PptxGenJS(), assets: { key: { data: 'data:image/png;base64,...' } 또는 { path } }
  function buildPptx(pptx, deck, assets) {
    var th = THEMES[deck.theme] || THEMES.edtouch;
    pptx.defineLayout({ name: 'W16x9', width: W, height: H });
    pptx.layout = 'W16x9';
    pptx.title = deck.title || '';
    deck.slides.forEach(function (s, i) {
      var slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      shapesFor(deck, i).forEach(function (sh) {
        if (sh.t === 'rect') {
          var shape = sh.shape === 'ellipse' ? pptx.ShapeType.ellipse : sh.r ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
          var o = { x: sh.x, y: sh.y, w: sh.w, h: sh.h, line: sh.line ? { color: sh.line, width: sh.lw || 1 } : { type: 'none' } };
          o.fill = sh.fill ? { color: sh.fill } : { type: 'none' };
          if (sh.r && sh.shape !== 'ellipse') o.rectRadius = sh.r;
          slide.addShape(shape, o);
        } else if (sh.t === 'img') {
          var a = (assets || {})[sh.key];
          if (a) slide.addImage(Object.assign({ x: sh.x, y: sh.y, w: sh.w, h: sh.h }, a.data ? { data: a.data } : { path: a.path }));
        } else if (sh.t === 'text') {
          var runs = [];
          sh.paras.forEach(function (p, pi) {
            p.forEach(function (r, ri) {
              var last = ri === p.length - 1, o2 = { fontSize: r.size, bold: r.bold, color: r.color || th.ink, fontFace: r.font || th.font, lang: 'ko-KR' };
              if (last && pi < sh.paras.length - 1) { o2.breakLine = true; o2.paraSpaceAfter = sh.after; }
              runs.push({ text: r.text, options: o2 });
            });
          });
          if (!runs.some(function (r) { return r.text; })) return;
          slide.addText(runs, { x: sh.x, y: sh.y, w: sh.w, h: sh.h, margin: 0, align: sh.align, valign: sh.valign, lineSpacingMultiple: sh.line, fit: 'none', wrap: true });
        } else if (sh.t === 'table') {
          var rows = sh.rows.map(function (r, ri) {
            return r.map(function (c, ci) {
              var head = ri === 0;
              return { text: c, options: { fill: { color: head ? th.navy : ri % 2 === 0 ? th.card : th.white }, color: head ? th.white : ci === 0 ? th.navy : th.body,
                bold: head || ci === 0, fontSize: head ? 13.5 : 12.5, fontFace: th.font, valign: 'middle', lang: 'ko-KR', margin: [0.04, 0.1, 0.04, 0.14] } };
            });
          });
          slide.addTable(rows, { x: sh.x, y: sh.y, colW: sh.colW, rowH: sh.rowH, border: { type: 'solid', pt: 0.5, color: th.border } });
        }
      });
      if (s.notes) slide.addNotes(String(s.notes));
    });
    return pptx;
  }

  // 파워포인트는 기본으로 한글 낱말 중간에서도 줄을 바꾼다(예: "센/다"). 미리보기(keep-all)와 같게
  // 모든 문단에 eaLnBrk="0"(동아시아 낱말 나누지 않기)을 넣는다. data: pptx.write()가 준 ArrayBuffer/Uint8Array
  function finalizePptx(data, JSZip) {
    return JSZip.loadAsync(data).then(function (zip) {
      var names = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); });
      return Promise.all(names.map(function (n) {
        return zip.file(n).async('string').then(function (x) {
          x = x.replace(/<a:pPr(?![^>]*eaLnBrk)/g, '<a:pPr eaLnBrk="0"');
          x = x.replace(/<a:p>(?!<a:pPr)/g, '<a:p><a:pPr eaLnBrk="0"/>');
          zip.file(n, x);
        });
      })).then(function () {
        return zip.generateAsync({ type: typeof window === 'undefined' ? 'nodebuffer' : 'blob', compression: 'DEFLATE',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
      });
    });
  }

  /* ── 덱 다루기(AI 편집용) ── */
  function getPath(obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj); }
  function setPath(obj, path, val) {
    var ks = path.split('.'), o = obj;
    for (var i = 0; i < ks.length - 1; i++) {
      var k = ks[i], nk = ks[i + 1];
      if (o[k] == null) o[k] = /^\d+$/.test(nk) ? [] : {};
      o = o[k];
    }
    o[ks[ks.length - 1]] = val;
  }
  // AI에 줄 덱 지도: 장마다 S3 [cards] 와 고칠 수 있는 칸 주소 = 지금 글
  function mapText(deck) {
    var L = [];
    deck.slides.forEach(function (s, i) {
      L.push('S' + (i + 1) + ' [' + (s.layout || 'bullets') + ']');
      var seen = {};
      shapesFor(deck, i).forEach(function (sh) {
        if (sh.t === 'text' && sh.path && !seen[sh.path]) {
          seen[sh.path] = 1;
          L.push('  S' + (i + 1) + '.' + sh.path + ' = ' + JSON.stringify(getPath(s, sh.path) == null ? '' : getPath(s, sh.path)));
        }
        if (sh.t === 'table') L.push('  S' + (i + 1) + '.rows = ' + JSON.stringify(s.rows || []));
      });
      if (s.notes) L.push('  S' + (i + 1) + '.notes = ' + JSON.stringify(s.notes));
    });
    return L.join('\n');
  }
  function layoutGuide() {
    return Object.keys(LAYOUTS).map(function (k) { return '- ' + k + ' (' + LAYOUTS[k].label + '): ' + LAYOUTS[k].fields; }).join('\n');
  }

  var api = { THEMES: THEMES, LAYOUTS: LAYOUTS, W: W, H: H, shapesFor: shapesFor, renderHtml: renderHtml, CSS: CSS, buildPptx: buildPptx, finalizePptx: finalizePptx,
    getPath: getPath, setPath: setPath, mapText: mapText, layoutGuide: layoutGuide };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DrSlides = api;
})(typeof window !== 'undefined' ? window : this);
