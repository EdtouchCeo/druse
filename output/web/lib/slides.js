/* 슬라이드 덱 렌더러 — 한 정의에서 화면 미리보기(HTML)와 파워포인트(.pptx)를 함께 만든다.
 *
 * 덱: { theme: 'edtouch'(표준) | 'daeryun'(대륜고), title, slides: [{ layout, ...내용, notes, source }] }
 * 레이아웃 함수는 도형 목록(사각형·글·그림·표)을 돌려주고, 두 출력기가 같은 목록을 그린다.
 * 좌표 단위는 인치, 화면은 16:9(13.333 × 7.5)이다. 글자 크기는 pt.
 * 글 도형의 path(예: 'bullets.2.title')는 미리보기에서 직접 고친 글을 덱 데이터에 되돌려 쓰는 주소다.
 *
 * 디자인 기준은 강의 슬라이드 제작 하네스의 제작 지침 §4-B와 대륜고 학생 수업용 디자인을 따른다.
 *   - 밝은 바탕과 파스텔 카드. 어두운 색은 표지·구역 표지·마무리와 장마다 한두 곳의 강조에만 쓴다.
 *   - 글자: 제목 28pt, 카드·항목 제목 19~20pt, 설명 15~17pt, 숫자 강조 40pt, 출처·쪽 번호 10~11pt.
 *   - 머리말(tag)은 AI나 교사가 적었을 때만 보인다. 영어 장식 라벨은 넣지 않는다.
 *   - 표준 양식(열쇠 edtouch)은 로고와 캐릭터를 넣지 않는다. 학교 양식(daeryun)은 교표와 대륜이 캐릭터를 쓴다.
 *   - 캐릭터(테마에 chars가 있을 때): 표지·구역 표지·질문·마무리처럼 장의 역할을 알리는 장에만 둔다.
 *     비율을 지키고 좌우를 뒤집지 않는다. 본문 장은 character 값이 있고 항목이 4개 이하일 때만 오른쪽에 둔다.
 *
 * 브라우저에서는 window.DrSlides, Node에서는 module.exports로 쓴다.
 */
(function (root) {
  'use strict';
  var W = 13.333, H = 7.5;
  var X0 = 0.55, CW = 12.23, TOP = 1.85;

  /* ── 테마 ── */
  var THEMES = {
    // 일반 강의·연수용 표준 양식(강의 슬라이드 제작 하네스의 표준 테마). 로고와 캐릭터를 넣지 않는다.
    // 열쇠 이름 'edtouch'는 저장된 덱과 사이트 설정(slideTheme) 때문에 그대로 둔다.
    edtouch: {
      id: 'edtouch', name: '표준',
      font: '맑은 고딕', mono: 'Consolas',
      navy: '1E3373', ink: '222B38', body: '222B38', gray: '5B6470', light: 'B8C7D9',
      card: 'EEF7FB', border: 'D6E4EE', white: 'FFFFFF',
      main: '1D7CC3', second: 'E07312',
      accents: ['1D7CC3', 'E07312', '26408E', '2E9E5B'],
      tints: ['D8ECF8', 'FCE9D6', 'E3EFFB', 'E2F4E8'],
      onDark: 'DCE6F7', onDarkAccent: 'FFE88A',
      brand: function () { return []; }
    },
    // 색은 2026 중3 입학설명회 창의인성부 덱 기준(대륜고 학생 수업용 디자인 §2). 강조색 순환은 블루 → 오렌지 → 네이비 → 그린이다.
    daeryun: {
      id: 'daeryun', name: '대륜고등학교',
      font: '맑은 고딕', mono: 'Consolas',
      navy: '1E3373', ink: '222B38', body: '222B38', gray: '5B6470', light: 'B8C7D9',
      card: 'EEF7FB', border: 'D6E4EE', white: 'FFFFFF',
      main: '1D7CC3', second: 'E07312',
      accents: ['1D7CC3', 'E07312', '26408E', '2E9E5B'],
      tints: ['D8ECF8', 'FCE9D6', 'E3EFFB', 'E2F4E8'],
      onDark: 'DCE6F7', onDarkAccent: 'FFE88A',
      logos: { mark: { key: 'daeryun-logo', ratio: 375 / 568 } },
      // 대륜이 캐릭터(가상 캐릭터, 대륜고 1학년). ratio는 그림의 가로 / 세로.
      chars: {
        greeting: { key: 'dr-char-greeting', ratio: 386 / 760 },
        question: { key: 'dr-char-question', ratio: 443 / 760 },
        think: { key: 'dr-char-think', ratio: 395 / 760 },
        peer: { key: 'dr-char-peer', ratio: 750 / 760 },
        practice: { key: 'dr-char-practice', ratio: 510 / 760 },
        explore: { key: 'dr-char-explore', ratio: 508 / 760 },
        counsel: { key: 'dr-char-counsel', ratio: 900 / 716 },
        good: { key: 'dr-char-good', ratio: 362 / 760 },
        walk: { key: 'dr-char-walk', ratio: 446 / 760 }
      },
      brand: function () {
        var h = 0.5, w = h / this.logos.mark.ratio;
        return [img(W - 0.45 - w - 1.4, 0.36, w, h, this.logos.mark.key),
          txt(W - 0.45 - 1.33, 0.36, 1.33, h, [[run('대륜고등학교', 12, true, this.navy)]], { valign: 'middle' })];
      }
    }
  };
  // 본문 장에 둘 수 있는 캐릭터 장면(값 → 뜻). AI는 이 값만 쓴다.
  var CHARACTER_ROLES = { question: '질문·발문', think: '생각할 시간·성찰', peer: '모둠·짝 활동', practice: '실습·만들기', explore: '조사·탐구', counsel: '상담·피드백', good: '정리·칭찬' };

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
  function table(x, y, colW, rowH, rows, th, o) { o = o || {}; return { t: 'table', x: x, y: y, colW: colW, rowH: rowH, rows: rows, th: th, path: o.path, size: o.size }; }

  function clampList(a, n) { return Array.isArray(a) ? a.slice(0, n) : []; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function acc(th, i) { return th.accents[i % th.accents.length]; }
  function tint(th, i) { return th.tints[i % th.tints.length]; }

  /* ── 캐릭터 ── */
  // 바닥(bottom)에 발을 맞추고 가로는 가운데(cx)에 둔다. 폭이 maxW를 넘는 넓은 그림은 높이를 줄여 비율을 지킨다.
  function character(th, pose, cx, bottom, h, maxW) {
    var c = th.chars && th.chars[pose];
    if (!c) return [];
    var w = h * c.ratio;
    if (maxW && w > maxW) { w = maxW; h = w / c.ratio; }
    return [img(cx - w / 2, bottom - h, w, h, c.key)];
  }
  // 본문 장의 캐릭터: 테마에 캐릭터가 있고 장에 character 값이 있으면 오른쪽 3.1인치를 비운다.
  function sidePose(th, s, fallback) {
    var p = (s.character && CHARACTER_ROLES[s.character] ? s.character : '') || fallback || '';
    return th.chars && th.chars[p] ? p : '';
  }

  /* ── 공통 틀 ── */
  function frame(th) { return [rect(0.12, 0.12, 13.09, 7.26, null, { line: th.border, lw: 1.25, r: 0.2 })]; }
  function pageNo(th, n, total, color) { return [txt(11.68, 7.04, 1.1, 0.26, [[run(pad2(n) + ' / ' + total, 10.5, false, color || th.gray, th.mono)]], { align: 'right' })]; }
  function source(th, s) {
    if (!s.source) return [];
    return [edit(X0, 7.04, 9.8, 0.26, '출처: ' + s.source, 10.5, false, th.gray, null)];
  }
  function header(th, s, n, total, accent) {
    accent = accent || th.main;
    var out = frame(th);
    out.push(rect(X0, 0.42, 0.46, 0.46, th.navy, { r: 0.1 }));
    out.push(txt(X0, 0.42, 0.46, 0.46, [[run(pad2(n), 15, true, th.white, th.mono)]], { align: 'center', valign: 'middle' }));
    // 머리말은 적혀 있을 때만 보인다. 비어 있으면 제목이 그 자리까지 쓴다.
    if (s.tag) out.push(edit(1.16, 0.44, 7.6, 0.4, s.tag, 13, true, accent, 'tag', { valign: 'middle' }));
    out.push(edit(X0, 0.92, 10.6, 0.66, s.title || '', 28, true, th.navy, 'title', { valign: 'middle' }));
    out.push(rect(X0, 1.64, 2.2, 0.05, accent), rect(2.79, 1.64, 0.6, 0.05, th.second));
    return out.concat(th.brand(), pageNo(th, n, total), source(th, s));
  }
  // 아래쪽 핵심 한 줄. 있으면 본문 영역이 줄어든다. 상자에 가두지 않고 큰 글자 한 줄로 둔다.
  function note(th, s, w) {
    if (!s.note) return [];
    var y = 6.2, h = 0.66;
    return [rect(X0, y + 0.08, 0.09, h - 0.16, th.second),
      edit(X0 + 0.28, y, (w || CW) - 0.28, h, s.note, 20, true, th.navy, 'note', { valign: 'middle' })];
  }
  function bodyBottom(s) { return s.note ? 6.05 : 6.8; }
  // 카드 묶음의 높이와 시작 위치. 쓸 수 있는 높이가 maxH보다 크면 maxH로 줄이고 남는 공간의 0.4만큼 내려 가운데쯤에 둔다.
  function block(s, maxH, bottom) {
    var top = TOP + 0.1, avail = (bottom || bodyBottom(s)) - top, h = Math.min(avail, maxH);
    return { top: top + (avail - h) * 0.4, h: h };
  }

  /* ── 레이아웃 ── */
  var LAYOUTS = {};

  LAYOUTS.cover = {
    label: '표지',
    draw: function (th, s) {
      // 왼쪽 네이비 패널에 제목, 오른쪽 연한 패널. 학교 양식은 오른쪽에 교표와 캐릭터를 두고, 표준 양식은 도형만 둔다.
      var LW = 8.5, cx = LW + (W - LW) / 2;
      var o = [rect(0, 0, LW, H, th.navy), rect(LW, 0, W - LW, H, th.card)];
      o.push(edit(0.9, 0.8, 7.0, 0.4, s.org || '', 15, false, th.onDark, 'org', { valign: 'middle' }));
      o.push(edit(0.9, 1.45, 7.0, 0.42, s.kicker || '', 16, true, th.onDarkAccent, 'kicker', { valign: 'middle' }));
      o.push(edit(0.9, 2.0, 7.1, 2.4, s.title || '', 44, true, th.white, 'title', { valign: 'middle', line: 1.08 }));
      o.push(rect(0.9, 4.62, 1.5, 0.07, th.second));
      o.push(edit(0.9, 4.86, 7.1, 0.9, s.subtitle || '', 20, false, th.onDark, 'subtitle', { line: 1.15 }));
      if (s.presenter || s.date) {
        o.push(edit(0.9, 6.0, 7.0, 0.36, s.date || '', 14, false, th.onDark, 'date', { valign: 'middle' }));
        o.push(edit(0.9, 6.38, 7.0, 0.5, s.presenter || '', 19, true, th.white, 'presenter', { valign: 'middle' }));
      }
      if (th.logos) {
        var mh = 0.62, mw = mh / th.logos.mark.ratio;
        o.push(img(cx - (mw + 1.75) / 2, 0.62, mw, mh, th.logos.mark.key));
        o.push(txt(cx - (mw + 1.75) / 2 + mw + 0.15, 0.62, 1.6, mh, [[run('대륜고등학교', 15, true, th.navy)]], { valign: 'middle' }));
      }
      if (th.chars) {
        o.push(oval(cx - 1.75, 6.55, 3.5, 0.5, th.tints[0]));
        return o.concat(character(th, 'greeting', cx, 6.9, 4.9));
      }
      o.push(oval(cx - 1.55, 2.2, 3.1, 3.1, th.tints[0]), oval(cx + 0.35, 1.55, 1.25, 1.25, th.tints[1]), oval(cx - 1.95, 4.75, 0.9, 0.9, th.tints[3]));
      o.push(rect(cx - 0.75, 3.35, 1.5, 0.12, th.main), rect(cx - 0.75, 3.63, 1.05, 0.12, th.second), rect(cx - 0.75, 3.91, 1.3, 0.12, th.navy));
      return o;
    },
    fields: 'org(기관·행사), kicker(짧은 머리말), title(제목, 2줄 이내), subtitle, date, presenter'
  };

  LAYOUTS.agenda = {
    label: '목차',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total);
      var items = clampList(s.items, 6), rows = Math.ceil(items.length / 2) || 1, col2 = items.length > 3;
      var n2 = col2 ? rows : items.length || 1, gap = 0.2, avail = 6.8 - TOP - 0.1;
      var rowH = Math.min(1.45, (avail - gap * (n2 - 1)) / n2), y0 = TOP + 0.1 + Math.max(0, (avail - n2 * rowH - gap * (n2 - 1)) / 2) * 0.5;
      items.forEach(function (it, i) {
        var c = col2 ? (i < rows ? 0 : 1) : 0, r = col2 ? (i < rows ? i : i - rows) : i;
        var w = col2 ? (CW - 0.3) / 2 : CW, x = X0 + c * (w + 0.3), y = y0 + r * (rowH + gap), a = acc(th, i);
        o.push(rect(x, y, w, rowH, tint(th, i), { r: 0.1 }));
        o.push(rect(x + 0.25, y + (rowH - 0.72) / 2, 0.72, 0.72, a, { r: 0.12 }));
        o.push(txt(x + 0.25, y + (rowH - 0.72) / 2, 0.72, 0.72, [[run(pad2(i + 1), 19, true, th.white, th.mono)]], { align: 'center', valign: 'middle' }));
        if (it.sub) {
          o.push(edit(x + 1.2, y + rowH / 2 - 0.5, w - 1.4, 0.5, it.title, 21, true, th.navy, 'items.' + i + '.title', { valign: 'middle' }));
          o.push(edit(x + 1.2, y + rowH / 2, w - 1.4, 0.42, it.sub, 15, false, th.gray, 'items.' + i + '.sub', { valign: 'middle' }));
        } else o.push(edit(x + 1.2, y, w - 1.4, rowH, it.title, 21, true, th.navy, 'items.' + i + '.title', { valign: 'middle' }));
      });
      return o;
    },
    fields: 'items[{title, sub}] 3~6개'
  };

  LAYOUTS.section = {
    label: '구역 표지',
    draw: function (th, s, n, total) {
      // 왼쪽 네이비 띠에 큰 번호, 오른쪽에 제목. 학교 양식은 다음 내용으로 걸어가는 캐릭터를 둔다.
      var no = s.no || 1, BW = 4.2;
      var o = [rect(0, 0, BW, H, th.navy)];
      o.push(txt(0.6, 2.3, BW - 1.2, 1.9, [[run(pad2(no), 110, true, th.white, th.mono)]], { align: 'center', valign: 'middle' }));
      o.push(rect(BW / 2 - 0.7, 4.45, 1.4, 0.07, th.second));
      o.push(rect(BW + 0.75, 2.45, 1.5, 0.07, th.main));
      o.push(edit(BW + 0.75, 2.7, 7.9, 1.15, s.title || '', 36, true, th.navy, 'title', { valign: 'middle', line: 1.08 }));
      o.push(edit(BW + 0.75, 3.95, th.chars ? 5.6 : 7.9, 0.9, s.sub || '', 20, false, th.gray, 'sub', { line: 1.15 }));
      o = o.concat(th.brand());
      if (th.chars) {
        o.push(oval(W - 3.05, 6.5, 2.6, 0.4, th.tints[0]));
        o = o.concat(character(th, 'walk', W - 1.75, 6.85, 3.5));
      }
      return o.concat(pageNo(th, n, total));
    },
    fields: 'no(구역 번호), title, sub'
  };

  // 글머리표 줄을 나열하지 않는다. 항목마다 번호 배지와 파스텔 줄 카드로 그린다.
  LAYOUTS.bullets = {
    label: '항목',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total);
      var items = clampList(s.bullets, 6), pose = items.length <= 4 ? sidePose(th, s) : '';
      var cw = pose ? CW - 3.1 : CW, top = TOP + 0.1, bottom = bodyBottom(s), gap = 0.16, k = Math.max(items.length, 1);
      var rowH = Math.min(1.35, (bottom - top - gap * (k - 1)) / k);
      var y0 = top + Math.max(0, (bottom - top - k * rowH - gap * (k - 1)) / 2) * 0.4;
      items.forEach(function (b, i) {
        var y = y0 + i * (rowH + gap), a = acc(th, i), bs = Math.min(0.62, rowH - 0.2);
        o.push(rect(X0, y, cw, rowH, tint(th, i), { r: 0.1 }));
        o.push(rect(X0 + 0.22, y + (rowH - bs) / 2, bs, bs, a, { r: 0.12 }));
        o.push(txt(X0 + 0.22, y + (rowH - bs) / 2, bs, bs, [[run(String(i + 1), 18, true, th.white, th.mono)]], { align: 'center', valign: 'middle' }));
        var tx = X0 + 0.22 + bs + 0.25, tw = cw - (tx - X0) - 0.2;
        if (b.sub && rowH >= 0.86) {
          o.push(edit(tx, y + 0.06, tw, rowH * 0.46, b.title, 20, true, th.navy, 'bullets.' + i + '.title', { valign: 'middle' }));
          o.push(edit(tx, y + rowH * 0.5, tw, rowH * 0.46, b.sub, 15.5, false, th.body, 'bullets.' + i + '.sub', { line: 1.1 }));
        } else o.push(edit(tx, y, tw, rowH, b.title, 20, true, th.navy, 'bullets.' + i + '.title', { valign: 'middle' }));
      });
      if (pose) {
        o.push(oval(W - 0.45 - 2.9, 6.5, 2.7, 0.4, th.tints[0]));
        o = o.concat(character(th, pose, W - 0.45 - 1.55, 6.8, 3.6, 2.9));
      }
      return o.concat(note(th, s, cw));
    },
    fields: 'bullets[{title(핵심 한 줄), sub(설명 1~2줄)}] 3~6개, note(핵심 한 줄, 선택), character(선택)'
  };

  // 청중에게 던지는 질문 한 개와 생각할 점. 캐릭터가 있는 테마는 손 든 대륜이를 둔다.
  LAYOUTS.question = {
    label: '질문',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total);
      var pose = sidePose(th, s, 'question'), cw = pose ? CW - 3.3 : CW, hints = clampList(s.hints, 3);
      var qh = hints.length ? 2.0 : 3.6, top = TOP + 0.15 + (hints.length ? 0 : 0.5);
      o.push(rect(X0, top, cw, qh, th.tints[0], { r: 0.14 }));
      o.push(rect(X0, top + 0.3, 0.1, qh - 0.6, th.main));
      o.push(edit(X0 + 0.45, top, cw - 0.85, qh, s.question || '', 27, true, th.navy, 'question', { valign: 'middle', line: 1.15 }));
      var y0 = top + qh + 0.28, rowH = Math.min(0.82, (6.8 - y0 - 0.14 * 2) / 3);
      hints.forEach(function (hText, i) {
        var y = y0 + i * (rowH + 0.14), a = acc(th, i + 1);
        o.push(rect(X0, y, cw, rowH, th.white, { line: th.border, lw: 1, r: 0.1 }));
        o.push(oval(X0 + 0.25, y + (rowH - 0.4) / 2, 0.4, 0.4, a));
        o.push(txt(X0 + 0.25, y + (rowH - 0.4) / 2, 0.4, 0.4, [[run(String(i + 1), 14, true, th.white, th.mono)]], { align: 'center', valign: 'middle' }));
        o.push(edit(X0 + 0.85, y, cw - 1.05, rowH, hText, 18, false, th.ink, 'hints.' + i, { valign: 'middle', line: 1.1 }));
      });
      if (pose) {
        o.push(oval(W - 0.45 - 3.0, 6.5, 2.8, 0.42, th.tints[0]));
        o = o.concat(character(th, pose, W - 0.45 - 1.6, 6.8, 4.2, 3.0));
      }
      return o;
    },
    fields: 'question(질문 한 문장), hints[생각할 점] 0~3개, character(선택)'
  };

  LAYOUTS.cards = {
    label: '카드',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total);
      var cards = clampList(s.cards, 4), k = Math.max(cards.length, 1), gap = 0.28;
      var w = (CW - gap * (k - 1)) / k, bl = block(s, 4.1), top = bl.top, h = bl.h;
      cards.forEach(function (c, i) {
        var x = X0 + i * (w + gap), a = acc(th, i);
        o.push(rect(x, top, w, h, tint(th, i), { r: 0.12 }), rect(x, top, w, 0.62, a, { r: 0.12 }), rect(x, top + 0.3, w, 0.32, a));
        o.push(txt(x + 0.25, top, 0.8, 0.62, [[run(pad2(i + 1), 16, true, th.white, th.mono)]], { valign: 'middle' }));
        o.push(edit(x + 0.25, top + 0.78, w - 0.5, 1.05, c.title, 20, true, th.navy, 'cards.' + i + '.title', { line: 1.08, valign: 'middle' }));
        o.push(edit(x + 0.25, top + 1.95, w - 0.5, h - 2.15, c.body, k >= 4 ? 15.5 : 17, false, th.body, 'cards.' + i + '.body', { line: 1.22 }));
      });
      return o.concat(note(th, s));
    },
    fields: 'cards[{title, body(2~4줄)}] 2~4개, note(선택)'
  };

  LAYOUTS.compare = {
    label: '비교',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total);
      var bl = block(s, 4.4), top = bl.top, h = bl.h, w = 5.75;
      [['left', 0, X0], ['right', 1, 7.03]].forEach(function (p) {
        var side = s[p[0]] || {}, a = acc(th, p[1]), x = p[2], items = clampList(side.items, 5);
        o.push(rect(x, top, w, h, tint(th, p[1]), { r: 0.12 }), rect(x, top, w, 0.72, a, { r: 0.12 }), rect(x, top + 0.36, w, 0.36, a));
        o.push(edit(x + 0.2, top, w - 0.4, 0.72, side.label || '', 19, true, th.white, p[0] + '.label', { align: 'center', valign: 'middle' }));
        var rowH = Math.min(0.95, (h - 0.95) / Math.max(items.length, 1));
        items.forEach(function (it, i) {
          var y = top + 0.9 + i * rowH;
          o.push(oval(x + 0.35, y + rowH / 2 - 0.08, 0.16, 0.16, a));
          o.push(edit(x + 0.7, y, w - 1.0, rowH, it, 17, false, th.ink, p[0] + '.items.' + i, { line: 1.12, valign: 'middle' }));
        });
      });
      o.push(oval(6.3, top + h / 2 - 0.36, 0.73, 0.73, th.navy), txt(6.3, top + h / 2 - 0.36, 0.73, 0.73, [[run('↔', 20, true, th.white)]], { align: 'center', valign: 'middle' }));
      return o.concat(note(th, s));
    },
    fields: 'left{label, items[] 2~5개}, right{label, items[]}, note(선택)'
  };

  LAYOUTS.table = {
    label: '표',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total);
      var rows = clampList(s.rows, 8).map(function (r) { return clampList(r, 5).map(function (c) { return c == null ? '' : String(c); }); });
      var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0) || 1;
      rows = rows.map(function (r) { while (r.length < cols) r.push(''); return r; });
      var first = Math.min(3.2, CW / cols * 1.2), rest = (CW - first) / Math.max(cols - 1, 1);
      var colW = cols === 1 ? [CW] : [first].concat(Array(cols - 1).fill(rest));
      var top = TOP + 0.1, avail = bodyBottom(s) - top, rowH = Math.min(1.0, avail / Math.max(rows.length, 1));
      // 5줄·4칸 안쪽이면 강의 거리에서 읽히는 큰 글자를 쓴다.
      var size = rows.length <= 5 && cols <= 4 ? 18 : rows.length <= 6 ? 16 : 14.5;
      if (rows.length) o.push(table(X0, top, colW, rowH, rows, th, { path: 'rows', size: size }));
      return o.concat(note(th, s));
    },
    fields: 'rows[[머리글...], [칸...]...] 첫 줄은 머리글, 최대 8줄 5칸, note(선택)'
  };

  LAYOUTS.process = {
    label: '단계',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total);
      var steps = clampList(s.steps, 5), k = Math.max(steps.length, 1), gap = 0.5;
      var w = (CW - gap * (k - 1)) / k, bl = block(s, 3.7), top = bl.top, h = bl.h;
      steps.forEach(function (st, i) {
        var x = X0 + i * (w + gap), a = acc(th, i);
        o.push(rect(x, top, w, h, tint(th, i), { r: 0.12 }), rect(x, top, w, 0.95, a, { r: 0.12 }), rect(x, top + 0.48, w, 0.47, a));
        o.push(txt(x + 0.18, top + 0.06, 0.6, 0.36, [[run(pad2(i + 1), 13, true, th.white, th.mono)]], { valign: 'middle' }));
        o.push(edit(x + 0.15, top + 0.36, w - 0.3, 0.56, st.title, k >= 5 ? 17 : 19, true, th.white, 'steps.' + i + '.title', { align: 'center', valign: 'middle', line: 1.05 }));
        if (i < k - 1) o.push(txt(x + w, top + h / 2 - 0.4, gap, 0.8, [[run('▶', 18, true, th.light)]], { align: 'center', valign: 'middle' }));
        o.push(edit(x + 0.2, top + 1.15, w - 0.4, h - 1.35, st.body, k >= 5 ? 14.5 : 16, false, th.body, 'steps.' + i + '.body', { line: 1.22 }));
      });
      return o.concat(note(th, s));
    },
    fields: 'steps[{title, body}] 3~5개, note(선택)'
  };

  LAYOUTS.stats = {
    label: '수치',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total);
      var st = clampList(s.stats, 4), k = Math.max(st.length, 1), gap = 0.28;
      var w = (CW - gap * (k - 1)) / k, bl = block(s, 4.0), top = bl.top, h = bl.h;
      st.forEach(function (it, i) {
        var x = X0 + i * (w + gap), a = acc(th, i);
        o.push(rect(x, top, w, h, tint(th, i), { r: 0.12 }), rect(x, top, w, 0.1, a));
        o.push(edit(x + 0.1, top + 0.45, w - 0.2, 1.25, it.value, k >= 4 ? 38 : 44, true, a, 'stats.' + i + '.value', { align: 'center', valign: 'middle', font: th.mono }));
        o.push(edit(x + 0.2, top + 1.8, w - 0.4, 0.9, it.label, 19, true, th.navy, 'stats.' + i + '.label', { align: 'center', valign: 'middle', line: 1.08 }));
        o.push(edit(x + 0.25, top + 2.8, w - 0.5, h - 3.0, it.sub || '', 14.5, false, th.gray, 'stats.' + i + '.sub', { align: 'center', line: 1.2 }));
      });
      return o.concat(note(th, s));
    },
    fields: 'stats[{value(숫자·짧은 값), label, sub(근거·단위)}] 2~4개, note(선택)'
  };

  LAYOUTS.summary = {
    label: '정리',
    draw: function (th, s, n, total) {
      var o = header(th, s, n, total);
      var pts = clampList(s.points, 4), k = Math.max(pts.length, 1), gap = 0.28;
      var w = (CW - gap * (k - 1)) / k, bl = block(s, 3.9, s.next ? 5.55 : 6.8), top = bl.top, h = bl.h;
      pts.forEach(function (p, i) {
        var x = X0 + i * (w + gap), a = acc(th, i);
        o.push(rect(x, top, w, h, tint(th, i), { r: 0.12 }), rect(x, top, w, 0.1, a));
        o.push(oval(x + 0.25, top + 0.35, 0.56, 0.56, a), txt(x + 0.25, top + 0.35, 0.56, 0.56, [[run(String(i + 1), 17, true, th.white, th.mono)]], { align: 'center', valign: 'middle' }));
        o.push(edit(x + 0.25, top + 1.05, w - 0.5, 0.95, p.title, 20, true, th.navy, 'points.' + i + '.title', { line: 1.08 }));
        o.push(edit(x + 0.25, top + 2.05, w - 0.5, h - 2.2, p.body, k >= 4 ? 15 : 16.5, false, th.body, 'points.' + i + '.body', { line: 1.22 }));
      });
      if (s.next) {
        o.push(rect(X0, 5.75, CW, 1.0, th.navy, { r: 0.1 }));
        o.push(txt(0.9, 5.75, 1.7, 1.0, [[run('다음 단계', 14, true, th.onDarkAccent || th.second)]], { valign: 'middle' }));
        o.push(edit(2.6, 5.75, 9.9, 1.0, s.next, 19, true, th.white, 'next', { valign: 'middle' }));
      }
      return o;
    },
    fields: 'points[{title, body}] 2~4개, next(다음 행동 한 줄, 선택)'
  };

  LAYOUTS.end = {
    label: '마무리',
    draw: function (th, s) {
      // 네이비 전면. 학교 양식은 흰 배지 위의 교표와 캐릭터를 둔다.
      var o = [rect(0, 0, W, H, th.navy), oval(8.75, 1.55, 4.4, 4.4, '26408E')];
      if (th.logos) {
        var mh = 0.6, mw = mh / th.logos.mark.ratio;
        o.push(rect(0.9, 0.7, mw + 2.15, mh + 0.3, th.white, { r: 0.12 }), img(1.05, 0.85, mw, mh, th.logos.mark.key));
        o.push(txt(1.05 + mw + 0.12, 0.85, 1.75, mh, [[run('대륜고등학교', 14, true, th.navy)]], { valign: 'middle' }));
      }
      o.push(rect(0.95, 2.6, 1.5, 0.07, th.second));
      o.push(edit(0.95, 2.85, 7.6, 1.2, s.title || '감사합니다', 46, true, th.white, 'title', { valign: 'middle' }));
      o.push(edit(0.95, 4.15, 7.6, 0.7, s.sub || '', 20, false, th.onDark, 'sub', { line: 1.15 }));
      o.push(edit(0.95, 4.95, 7.6, 0.45, s.contact || '', 15, false, th.onDark, 'contact'));
      if (th.chars) return o.concat(character(th, 'good', 10.95, 6.75, 4.7));
      o.push(oval(9.55, 2.35, 2.8, 2.8, '1D7CC3'), oval(11.75, 1.95, 1.0, 1.0, 'E07312'), oval(9.2, 4.9, 0.7, 0.7, '2E9E5B'));
      return o;
    },
    fields: 'title(기본 감사합니다), sub, contact'
  };

  function shapesFor(deck, i) {
    var th = THEMES[deck.theme] || THEMES.edtouch, s = deck.slides[i] || {}, L = LAYOUTS[s.layout] || LAYOUTS.bullets;
    return L.draw(th, s, i + 1, deck.slides.length);
  }
  // 이 덱이 실제로 쓰는 그림 키. 파워포인트로 받을 때 필요한 그림만 불러온다.
  function assetKeys(deck) {
    var keys = {};
    deck.slides.forEach(function (s, i) { shapesFor(deck, i).forEach(function (sh) { if (sh.t === 'img') keys[sh.key] = 1; }); });
    return Object.keys(keys);
  }
  // 캐릭터가 그려지는 장인가(표지·구역 표지·질문·마무리는 테마가 정하고, 항목 장은 character 값으로 정한다).
  function hasCharacter(deck, i) {
    var th = THEMES[deck.theme] || THEMES.edtouch;
    if (!th.chars) return false;
    return shapesFor(deck, i).some(function (sh) { return sh.t === 'img' && /^dr-char-/.test(sh.key); });
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
        var fs = sh.size || 14.5;
        var rowsHtml = sh.rows.map(function (r, ri) {
          return '<tr style="height:' + sh.rowH + 'in">' + r.map(function (c, ci) {
            var head = ri === 0, bg = head ? th.navy : ri % 2 === 0 ? th.card : th.white;
            var color = head ? th.white : ci === 0 ? th.navy : th.body;
            var ed2 = opts.editable ? ' contenteditable="plaintext-only" spellcheck="false" data-path="' + sh.path + '.' + ri + '.' + ci + '"' : '';
            return '<td' + ed2 + ' style="box-sizing:border-box;overflow:hidden;background:#' + bg + ';color:#' + color + ';font-size:' + (head ? fs + 1 : fs) + 'pt;font-weight:' + (head || ci === 0 ? 700 : 400) + ';padding:0.04in 0.1in 0.04in 0.16in;border:0.5pt solid #' + th.border + ';vertical-align:middle;line-height:1.2;">' + esc(c) + '</td>';
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
    '.sl-e[contenteditable]:hover{box-shadow:0 0 0 1.5pt rgba(79,70,229,.35)}.sl-e[contenteditable]:focus{box-shadow:0 0 0 2pt rgba(79,70,229,.8);background:rgba(255,255,255,.18)}' +
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
          var fs = sh.size || 14.5;
          var rows = sh.rows.map(function (r, ri) {
            return r.map(function (c, ci) {
              var head = ri === 0;
              return { text: c, options: { fill: { color: head ? th.navy : ri % 2 === 0 ? th.card : th.white }, color: head ? th.white : ci === 0 ? th.navy : th.body,
                bold: head || ci === 0, fontSize: head ? fs + 1 : fs, fontFace: th.font, valign: 'middle', lang: 'ko-KR', margin: [0.04, 0.1, 0.04, 0.16] } };
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

  var api = { THEMES: THEMES, LAYOUTS: LAYOUTS, CHARACTER_ROLES: CHARACTER_ROLES, W: W, H: H, shapesFor: shapesFor, assetKeys: assetKeys, hasCharacter: hasCharacter,
    renderHtml: renderHtml, CSS: CSS, buildPptx: buildPptx, finalizePptx: finalizePptx,
    getPath: getPath, setPath: setPath, mapText: mapText, layoutGuide: layoutGuide };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DrSlides = api;
})(typeof window !== 'undefined' ? window : this);
