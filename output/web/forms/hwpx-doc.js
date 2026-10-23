/* 업무 양식 AI — HWPX 문서 모델 (window.DrHwpxDoc)
 *
 * 편집기(rhwp)가 내보낸 .hwpx의 본문 XML을 읽어
 *   1) AI에게 보여 줄 위치 지도(문단 P1…, 표 칸 T1:r3c1…)를 만들고
 *   2) AI가 돌려준 편집 명령(set·add_row·insert_after·delete)을 XML에 적용한 뒤
 *   3) 다시 .hwpx 바이트로 묶는다.
 * 위치 아이디는 편집 전 문서 기준으로 한 번 정하고, 명령을 적용하기 전에 모두 요소로 풀어 둔다.
 * 그래서 행을 추가해도 같은 응답 안의 다른 아이디가 밀리지 않는다.
 *
 * ⚠ 글을 바꾼 문단은 줄 배치 캐시(<hp:linesegarray>)를 지운다. 남기면 한글이 옛 줄 위치로 그려 글자가 겹친다.
 */
(function () {
  'use strict';

  // 문단 안에 있어도 글 교체를 막지 않는 요소: 글, 구역 설정, 단 설정류 컨트롤
  var SAFE_CTRL_CHILD = { colPr: 1, pageHiding: 1, pageNum: 1, pageNumCtrl: 1, newNum: 1 };

  function kids(el, name) {
    var out = [];
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (!name || n.localName === name)) out.push(n);
    return out;
  }
  function kid(el, name) { return kids(el, name)[0] || null; }
  function attrInt(el, name, def) { var v = el ? parseInt(el.getAttribute(name), 10) : NaN; return isNaN(v) ? def : v; }

  function paraText(p) {
    var s = '';
    kids(p, 'run').forEach(function (r) { kids(r, 't').forEach(function (t) { s += t.textContent; }); });
    return s;
  }
  // 글을 바꾸면 깨지는 요소(표·그림·글상자·필드 등)가 있으면 그 문단은 고치지 않는다.
  function paraBlocked(p) {
    var runs = kids(p, 'run');
    for (var i = 0; i < runs.length; i++) {
      var cs = kids(runs[i]);
      for (var j = 0; j < cs.length; j++) {
        var c = cs[j], n = c.localName;
        // 글 조각 안의 탭·줄바꿈 같은 요소는 AI에게 보이지 않고 바꾸면 사라지므로 그 문단은 고치지 않는다.
        if (n === 't') { if (kids(c).length) return true; continue; }
        if (n === 'secPr') continue;
        if (n === 'ctrl') {
          var inner = kids(c);
          if (inner.every(function (x) { return SAFE_CTRL_CHILD[x.localName]; })) continue;
        }
        return true;
      }
    }
    return false;
  }
  // 구역·단 설정을 품은 문단은 지우면 쪽 설정이 사라진다.
  function paraHoldsSection(p) {
    return kids(p, 'run').some(function (r) {
      return kids(r).some(function (c) { return c.localName === 'secPr' || (c.localName === 'ctrl' && kids(c).some(function (x) { return x.localName === 'colPr'; })); });
    });
  }
  function paraTables(p) {
    var out = [];
    kids(p, 'run').forEach(function (r) { kids(r, 'tbl').forEach(function (t) { out.push(t); }); });
    return out;
  }
  function dropLineseg(p) { kids(p, 'linesegarray').forEach(function (x) { p.removeChild(x); }); }

  // 문단 글을 text로 통째로 바꾼다. 첫 글자 서식(run)을 유지하고 나머지 글 조각은 지운다.
  function setParaText(p, text) {
    var doc = p.ownerDocument, runs = kids(p, 'run'), target = null;
    runs.forEach(function (r) {
      var ts = kids(r, 't');
      if (ts.length && !target) target = r;
      ts.forEach(function (t) { r.removeChild(t); });
    });
    if (!target) target = runs[0] || null;
    if (!target) {
      target = doc.createElementNS(p.namespaceURI, (p.prefix ? p.prefix + ':' : '') + 'run');
      target.setAttribute('charPrIDRef', '0');
      var ls = kid(p, 'linesegarray');
      p.insertBefore(target, ls);
    }
    if (text !== '') {
      var t = doc.createElementNS(p.namespaceURI, (p.prefix ? p.prefix + ':' : '') + 't');
      t.textContent = text;
      target.appendChild(t);
    }
    // 글이 빠져 빈 껍데기가 된 다른 조각은 지운다(대상 조각은 남겨 서식을 유지한다).
    kids(p, 'run').forEach(function (r) { if (r !== target && !kids(r).length) p.removeChild(r); });
    dropLineseg(p);
  }
  // 새 문단을 만들 때 쓰는 복제본: 구역·단 설정 같은 컨트롤은 빼고 글 서식만 남긴다.
  function cleanClone(p) {
    var c = p.cloneNode(true);
    kids(c, 'run').forEach(function (r) { kids(r).forEach(function (x) { if (x.localName !== 't') r.removeChild(x); }); });
    return c;
  }

  function cellParas(tc) { var sub = kid(tc, 'subList'); return sub ? kids(sub, 'p') : []; }
  function cellAddr(tc) { var a = kid(tc, 'cellAddr'); return { row: attrInt(a, 'rowAddr', 0), col: attrInt(a, 'colAddr', 0) }; }
  function cellSpan(tc) { var s = kid(tc, 'cellSpan'); return { rows: attrInt(s, 'rowSpan', 1), cols: attrInt(s, 'colSpan', 1) }; }
  function cellText(tc) { return cellParas(tc).map(paraText).join('\n'); }

  function setCellText(tc, text) {
    var paras = cellParas(tc), lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var sub = kid(tc, 'subList');
    for (var i = 0; i < lines.length; i++) {
      if (i < paras.length) { setParaText(paras[i], lines[i]); continue; }
      var prev = paras[paras.length - 1], np = cleanClone(prev);
      setParaText(np, lines[i]);
      sub.insertBefore(np, prev.nextSibling);
      paras.push(np);
    }
    for (var k = paras.length - 1; k >= lines.length; k--) sub.removeChild(paras[k]);
  }

  /* ── 문서 모델 ── */
  function Doc(sections) {
    // sections: [{ name, xml }]
    var self = this;
    this.sections = sections.map(function (s) {
      var decl = (s.xml.match(/^\s*<\?xml[^>]*\?>/) || [''])[0];
      var d = new DOMParser().parseFromString(s.xml, 'application/xml');
      if (d.getElementsByTagName('parsererror').length) throw new Error('문서 본문(' + s.name + ')을 읽지 못했습니다.');
      return { name: s.name, doc: d, decl: decl };
    });
    this.items = {};     // id → { kind:'p'|'cell', el, label, readonly, table }
    this.tables = {};    // id → { el, trs }
    this.order = [];     // 지도 출력 순서: { id } 또는 { table }
    var pn = 0, tn = 0;

    function addTable(tbl) {
      var tid = 'T' + (++tn), trs = kids(tbl, 'tr');
      self.tables[tid] = { el: tbl, id: tid };
      self.order.push({ table: tid });
      var nested = [];
      // 행 머리(0열 칸)를 찾아 칸 이름으로 쓴다.
      var heads = [];
      trs.forEach(function (tr) {
        kids(tr, 'tc').forEach(function (tc) {
          var a = cellAddr(tc), sp = cellSpan(tc);
          if (a.col === 0) heads.push({ from: a.row, to: a.row + sp.rows - 1, text: cellText(tc).split('\n')[0].trim() });
        });
      });
      function rowHead(row) { for (var i = 0; i < heads.length; i++) if (row >= heads[i].from && row <= heads[i].to) return heads[i].text; return ''; }
      trs.forEach(function (tr) {
        kids(tr, 'tc').forEach(function (tc) {
          var a = cellAddr(tc), sp = cellSpan(tc), paras = cellParas(tc);
          var blocked = !paras.length || paras.some(paraBlocked);
          paras.forEach(function (p) { paraTables(p).forEach(function (t) { nested.push(t); }); });
          var head = a.col > 0 ? rowHead(a.row) : '';
          var where = (a.row + 1) + '행 ' + (a.col + 1) + '열';
          var id = tid + ':r' + a.row + 'c' + a.col;
          self.items[id] = {
            kind: 'cell', el: tc, table: tid, row: a.row, col: a.col, rows: sp.rows, cols: sp.cols, head: head,
            readonly: blocked, label: head ? head + ' (' + where + ')' : '표 ' + where
          };
          self.order.push({ id: id });
        });
      });
      nested.forEach(addTable);
    }

    this.sections.forEach(function (sec) {
      kids(sec.doc.documentElement, 'p').forEach(function (p) {
        var tbls = paraTables(p);
        var text = paraText(p);
        if (!tbls.length || text) {
          var id = 'P' + (++pn);
          self.items[id] = { kind: 'p', el: p, readonly: paraBlocked(p), label: '본문 ' + pn + '번째 문단', section: sec };
          self.order.push({ id: id });
        }
        tbls.forEach(addTable);
      });
    });
  }

  Doc.prototype.text = function (id) {
    var it = this.items[id];
    return it.kind === 'p' ? paraText(it.el) : cellText(it.el);
  };

  // AI에게 보여 줄 위치 지도
  Doc.prototype.toPrompt = function () {
    var self = this, lines = [];
    this.order.forEach(function (o) {
      if (o.table) {
        var t = self.tables[o.table].el;
        lines.push('[표 ' + o.table + '] ' + attrInt(t, 'rowCnt', 0) + '행 × ' + attrInt(t, 'colCnt', 0) + '열 (행 r·열 c는 0부터)');
        return;
      }
      var it = self.items[o.id], meta = [];
      if (it.kind === 'cell') {
        if (it.cols > 1) meta.push('가로 ' + it.cols + '칸 병합');
        if (it.rows > 1) meta.push('세로 ' + it.rows + '칸 병합');
      }
      if (it.readonly) meta.push('수정 불가');
      // 행 머리 이름을 함께 보여 준다. 행을 늘리면 아래 칸의 아이디가 밀리므로 AI는 이 이름으로 칸을 찾는다.
      lines.push((it.kind === 'cell' ? '  ' : '') + o.id + (it.head ? ' [' + it.head + ']' : '') + (meta.length ? ' (' + meta.join(', ') + ')' : '') + ' = ' + JSON.stringify(self.text(o.id)));
    });
    return lines.join('\n');
  };

  /* 편집 적용
   *  edits: [{ op:'set'|'fill_rows'|'add_row'|'insert_after'|'delete', target, text, cells }]
   *  opts.keepOnePage: { tallHeight, minHeight } — 행을 늘린 만큼 키 큰 행을 줄여 한 쪽을 유지(양식별 설정)
   *  반환: { changes:[{label, before, after}], problems:[문장] }
   */
  Doc.prototype.apply = function (edits, opts) {
    opts = opts || {};
    var self = this, changes = [], problems = [], plan = [];
    (edits || []).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      var op = String(e.op || ''), target = String(e.target || '').trim(), text = e.text == null ? '' : String(e.text);
      if (op === 'fill_rows') {
        var fm = target.match(/^(T\d+):r(\d+)(?:c\d+)?$/);
        var ftb = fm && self.tables[fm[1]];
        var fsrc = ftb && kids(ftb.el, 'tr')[+fm[2]];
        if (!fsrc) { problems.push('채울 줄의 위치(' + target + ')를 문서에서 찾지 못했습니다.'); return; }
        plan.push({ op: op, table: fm[1], row: +fm[2], src: fsrc, cells: Array.isArray(e.cells) ? e.cells.map(String) : [] });
        return;
      }
      if (op === 'add_row') {
        var m = target.match(/^(T\d+):r(\d+)(?:c\d+)?$/);
        var tb = m && self.tables[m[1]];
        var srcTr = tb && kids(tb.el, 'tr')[+m[2]];
        if (!srcTr) { problems.push('추가할 행의 위치(' + target + ')를 문서에서 찾지 못했습니다.'); return; }
        // 원래 행 요소를 지금 잡아 둔다. 같은 응답의 다른 행 추가로 번호가 밀려도 이 요소를 기준으로 복제한다.
        plan.push({ op: op, table: m[1], row: +m[2], src: srcTr, cells: Array.isArray(e.cells) ? e.cells.map(String) : [] });
        return;
      }
      var it = self.items[target];
      if (!it) { problems.push('문서에 없는 위치(' + (target || '빈 값') + ')를 가리킨 수정 1건은 적용하지 않았습니다.'); return; }
      if (it.readonly) { problems.push(it.label + '에는 표나 그림 같은 요소가 있어 AI가 고치지 않았습니다.'); return; }
      if (op === 'set') plan.push({ op: op, it: it, id: target, text: text });
      else if ((op === 'insert_after' || op === 'delete') && it.kind === 'p') plan.push({ op: op, it: it, id: target, text: text });
      else if (op === 'insert_after' || op === 'delete') problems.push('표 칸에는 문단 추가·삭제 대신 글 바꾸기만 할 수 있어 1건을 적용하지 않았습니다.');
      else problems.push('알 수 없는 수정 방식(' + op + ') 1건은 적용하지 않았습니다.');
    });

    // 1) 글 바꾸기 — 같은 위치를 여러 번 바꾸면 마지막 것만 쓴다.
    var lastSet = {};
    plan.forEach(function (x, i) { if (x.op === 'set') lastSet[x.id] = i; });
    plan.forEach(function (x, i) {
      if (x.op !== 'set' || lastSet[x.id] !== i) return;
      var before = self.text(x.id), after = x.it.kind === 'cell' ? x.text : x.text.replace(/\r?\n/g, ' ');
      if (before === after) return;
      if (x.it.kind === 'cell') setCellText(x.it.el, after); else setParaText(x.it.el, after);
      changes.push({ label: x.it.label, before: before, after: after });
    });

    var lastClone = new Map(), grown = {};

    // 2) 줄 채우기 — target 줄부터 모양이 같은 줄들을 한 칸에 하나씩 왼쪽→오른쪽, 위→아래로 채운다.
    //    값이 남으면 마지막 줄을 복제해 늘리고, 값보다 칸이 많으면 남는 칸을 비운다.
    plan.forEach(function (x) {
      if (x.op !== 'fill_rows') return;
      try {
        var tbl = self.tables[x.table].el, head = rowHeadOf(self, x.table, x.row);
        var block = sameShapeRows(tbl, x.src), per = kids(x.src, 'tc').length;
        var beforeText = block.map(function (tr) { return sortedCells(tr).map(cellText).filter(Boolean).join(' · '); }).filter(Boolean).join(' · ');
        var need = Math.max(1, Math.ceil(x.cells.length / per));
        while (block.length < need) {
          var r = addRow(tbl, x.src, block[block.length - 1], []);
          block.push(r.clone);
          grown[x.table] = (grown[x.table] || 0) + r.height;
        }
        block.forEach(function (tr, j) {
          sortedCells(tr).forEach(function (tc, k) { setCellText(tc, x.cells[j * per + k] == null ? '' : x.cells[j * per + k]); });
        });
        var filled = x.cells.filter(function (c) { return c; });
        changes.push({ label: (head || '표') + ' 줄 채우기(' + block.length + '줄)', before: beforeText, after: filled.join(' · ') });
      } catch (err) { problems.push(err.message); }
    });

    // 3) 행 추가 — 같은 행 뒤에 여러 개면 적은 순서대로 아래에 붙인다.
    plan.forEach(function (x) {
      if (x.op !== 'add_row') return;
      try {
        var tbl = self.tables[x.table].el;
        var r = addRow(tbl, x.src, lastClone.get(x.src) || x.src, x.cells);
        lastClone.set(x.src, r.clone);
        grown[x.table] = (grown[x.table] || 0) + r.height;
        var head = self.items[x.table + ':r' + x.row + 'c1'] && self.items[x.table + ':r' + x.row + 'c1'].head;
        var shown = x.cells.filter(function (c) { return c; }).join(' · ');
        changes.push({ label: (head ? head + ' ' : '표 ') + '새 줄', before: '', after: shown || '(빈 줄)' });
      } catch (err) { problems.push(err.message); }
    });
    if (opts.keepOnePage) Object.keys(grown).forEach(function (tid) { keepOnePage(self.tables[tid].el, grown[tid], opts.keepOnePage); });

    // 4) 문단 추가·삭제 — 문단 순서를 지키기 위해 추가는 뒤에서부터 붙인다.
    var inserts = {};
    plan.forEach(function (x) {
      if (x.op !== 'insert_after') return;
      var anchor = inserts[x.id] || x.it.el, np = cleanClone(x.it.el);
      setParaText(np, x.text.replace(/\r?\n/g, ' '));
      anchor.parentNode.insertBefore(np, anchor.nextSibling);
      inserts[x.id] = np;
      changes.push({ label: x.it.label + ' 아래에 새 문단', before: '', after: x.text });
    });
    plan.forEach(function (x) {
      if (x.op !== 'delete' || !x.it.el.parentNode) return;
      var parent = x.it.el.parentNode;
      if (kids(parent, 'p').length <= 1) { problems.push('마지막 남은 문단은 지울 수 없어 1건을 적용하지 않았습니다.'); return; }
      if (paraHoldsSection(x.it.el)) { problems.push(x.it.label + '에는 쪽 설정이 들어 있어 지우지 않았습니다.'); return; }
      var before = paraText(x.it.el);
      parent.removeChild(x.it.el);
      changes.push({ label: x.it.label + ' 삭제', before: before, after: '' });
    });
    return { changes: changes, problems: problems };
  };

  function sortedCells(tr) { return kids(tr, 'tc').sort(function (a, b) { return cellAddr(a).col - cellAddr(b).col; }); }
  function rowShape(tr) { return sortedCells(tr).map(function (tc) { var sp = cellSpan(tc); return cellAddr(tc).col + 'x' + sp.cols + 'x' + sp.rows; }).join(','); }
  // src부터 아래로 칸 배치가 같은 줄들(세로 병합 없는 줄)
  function sameShapeRows(tbl, src) {
    var trs = kids(tbl, 'tr'), shape = rowShape(src), out = [];
    if (sortedCells(src).some(function (tc) { return cellSpan(tc).rows > 1; })) throw new Error('세로로 병합된 칸이 있는 줄은 이어서 채울 수 없습니다.');
    for (var i = trs.indexOf(src); i < trs.length && rowShape(trs[i]) === shape; i++) out.push(trs[i]);
    return out;
  }
  function rowHeadOf(doc, tid, row) {
    var it = Object.keys(doc.items).map(function (k) { return doc.items[k]; }).filter(function (v) { return v.table === tid && v.row === row && v.head; })[0];
    return it ? it.head : '';
  }

  // 행 추가: 원래 행(src)을 복제해 anchor 바로 아래에 붙이고, 아래 행 번호·세로 병합·표 높이를 함께 고친다.
  function addRow(tbl, src, anchor, cells) {
    var trs = kids(tbl, 'tr');
    trs.forEach(function (tr, i) {
      kids(tr, 'tc').forEach(function (tc) { if (cellAddr(tc).row !== i) throw new Error('이 표는 행 구조가 복잡해 AI가 행을 늘리지 못했습니다. 편집기에서 직접 행을 추가해 주세요.'); });
    });
    var row = trs.indexOf(src);
    if (row < 0) throw new Error('추가할 행을 표에서 찾지 못했습니다.');
    var srcCells = kids(src, 'tc');
    if (!srcCells.length || srcCells.some(function (tc) { return cellSpan(tc).rows > 1; }))
      throw new Error((row + 1) + '번째 행은 세로로 병합된 칸이 있어 복제할 수 없습니다. 편집기에서 직접 행을 추가해 주세요.');
    var height = 0;
    srcCells.forEach(function (tc) { height = Math.max(height, attrInt(kid(tc, 'cellSz'), 'height', 0)); });

    var clone = src.cloneNode(true), cloneCells = kids(clone, 'tc');
    cloneCells.sort(function (a, b) { return cellAddr(a).col - cellAddr(b).col; });
    cloneCells.forEach(function (tc, i) { setCellText(tc, cells[i] == null ? '' : cells[i]); });
    tbl.insertBefore(clone, anchor.nextSibling);

    // 원래 행을 덮던 세로 병합 칸은 한 칸 더 길어진다.
    trs.forEach(function (tr) {
      kids(tr, 'tc').forEach(function (tc) {
        var a = cellAddr(tc), sp = cellSpan(tc);
        if (tr !== src && a.row < row && a.row + sp.rows - 1 >= row) {
          kid(tc, 'cellSpan').setAttribute('rowSpan', String(sp.rows + 1));
          var sz = kid(tc, 'cellSz');
          if (sz) sz.setAttribute('height', String(attrInt(sz, 'height', 0) + height));
        }
      });
    });
    // 행 번호를 처음부터 다시 매긴다(행 i의 칸은 rowAddr = i).
    kids(tbl, 'tr').forEach(function (tr, i) { kids(tr, 'tc').forEach(function (tc) { kid(tc, 'cellAddr').setAttribute('rowAddr', String(i)); }); });
    tbl.setAttribute('rowCnt', String(kids(tbl, 'tr').length));
    var tsz = kid(tbl, 'sz');
    if (tsz) tsz.setAttribute('height', String(attrInt(tsz, 'height', 0) + height));
    return { height: height, clone: clone };
  }

  // 표가 글자처럼 놓인 양식은 쪽을 넘기면 표 전체가 다음 쪽으로 밀린다.
  // 늘어난 높이만큼 지정한 행(행 머리 이름 cfg.rows)의 높이를 지금 높이에서 minHeight까지 줄여 한 쪽을 유지한다.
  // 여러 번 행을 늘려도 매번 지금 높이를 기준으로 다시 줄인다.
  function keepOnePage(tbl, addedHeight, cfg) {
    var rows = [];
    kids(tbl, 'tr').forEach(function (tr) {
      var tcs = kids(tr, 'tc'), first = tcs.filter(function (tc) { return cellAddr(tc).col === 0; })[0];
      if (!first || cfg.rows.indexOf(cellText(first).split('\n')[0].trim()) < 0) return;
      var h = 0; tcs.forEach(function (tc) { h = Math.max(h, attrInt(kid(tc, 'cellSz'), 'height', 0)); });
      if (h > cfg.minHeight) rows.push({ tcs: tcs, h: h });
    });
    if (!rows.length) return;
    var per = Math.ceil(addedHeight / rows.length), total = 0;
    rows.forEach(function (r) {
      var cut = Math.min(r.h - cfg.minHeight, per);
      r.tcs.forEach(function (tc) { kid(tc, 'cellSz').setAttribute('height', String(r.h - cut)); });
      total += cut;
    });
    var tsz = kid(tbl, 'sz');
    if (tsz) tsz.setAttribute('height', String(attrInt(tsz, 'height', 0) - total));
  }

  Doc.prototype.serialize = function () {
    var ser = new XMLSerializer();
    return this.sections.map(function (s) {
      var x = ser.serializeToString(s.doc);
      if (s.decl && !/^\s*<\?xml/.test(x)) x = s.decl + x;
      return { name: s.name, xml: x };
    });
  };

  /* .hwpx 바이트 ↔ 문서 모델 */
  function sectionNames(zip) {
    return Object.keys(zip.files).filter(function (n) { return /^Contents\/section\d+\.xml$/.test(n); })
      .sort(function (a, b) { return parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10); });
  }
  async function open(bytes) {
    var zip = await JSZip.loadAsync(bytes);
    var names = sectionNames(zip);
    if (!names.length) throw new Error('한글 문서의 본문을 찾지 못했습니다.');
    var sections = [];
    for (var i = 0; i < names.length; i++) sections.push({ name: names[i], xml: await zip.file(names[i]).async('string') });
    var doc = new Doc(sections);
    doc.zip = zip;
    return doc;
  }
  async function pack(doc) {
    doc.serialize().forEach(function (s) { doc.zip.file(s.name, s.xml); });
    // mimetype은 압축하지 않은 첫 항목이어야 한다(HWPX·OCF 규칙). JSZip은 기존 순서를 유지한다.
    if (doc.zip.file('mimetype')) doc.zip.file('mimetype', await doc.zip.file('mimetype').async('string'), { compression: 'STORE' });
    return doc.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
  }

  window.DrHwpxDoc = { open: open, pack: pack, Doc: Doc };
})();
