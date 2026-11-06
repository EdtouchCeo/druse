/* 엑셀(.xlsx) 읽기와 서식 보존 저장 — 문서작성 AI 3단계
 *
 * 읽기: 시트 XML·공유 문자열·스타일을 직접 읽어 셀(값·수식·스타일 번호)과 병합·열 너비·행 높이를 얻고,
 *       시트 편집기(Univer)가 쓰는 통합 문서 데이터로 바꾼다. 화면에 원래 양식의 글꼴·색·테두리·맞춤·숫자 서식을 보인다.
 * 저장: 원본 압축 파일은 그대로 두고, 바뀐 셀의 <c> 요소만 고쳐 쓴다. 셀의 스타일 번호(s)를 지켜 테두리·색·글꼴이 남는다.
 *       글은 공유 문자열 표를 건드리지 않도록 inlineStr로 쓴다. 고친 뒤에는 calcChain을 지우고 열 때 다시 계산하게 한다.
 *       "공유 수식"의 기준 셀을 고치면 딸린 셀이 수식을 잃으므로, 먼저 딸린 셀에 각자의 수식을 풀어 쓴다.
 * 브라우저에서는 window.DrXlsxDoc, Node에서는 module.exports. JSZip은 인자로 받는다.
 */
(function (root) {
  'use strict';
  var NS_DATE = /^(?:\[\$[^\]]*\])?(?:[^"]|"[^"]*")*?(?:y|m|d|h|s)/i;
  var BUILTIN_DATE = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 27: 1, 30: 1, 36: 1, 45: 1, 46: 1, 47: 1, 50: 1, 57: 1 };
  var BUILTIN_FMT = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 14: 'yyyy-mm-dd', 22: 'yyyy-mm-dd hh:mm', 49: '@' };
  var THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

  /* ── 작은 도구 ── */
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function xmlUnesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCharCode(parseInt(n, 16)); }).replace(/&amp;/g, '&'); }
  function attr(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? xmlUnesc(m[1]) : null; }
  function setAttr(tag, name, val) {
    var re = new RegExp('\\s' + name + '="[^"]*"');
    if (val == null) return tag.replace(re, '');
    var piece = ' ' + name + '="' + xmlEsc(val) + '"';
    if (re.test(tag)) return tag.replace(re, function () { return piece; });
    return tag.replace(/^<([\w:]+)/, function (m, t) { return '<' + t + piece; });
  }
  function colNum(letters) { var n = 0; for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n; }
  function colName(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function parseRef(ref) { var m = /^([A-Z]+)(\d+)$/.exec(String(ref).toUpperCase().replace(/\$/g, '')); return m ? { c: colNum(m[1]), r: +m[2] } : null; }
  function refOf(r, c) { return colName(c) + r; }
  function resolvePath(base, rel) { // xl/worksheets/sheet1.xml + ../tables/table1.xml → xl/tables/table1.xml
    var parts = base.split('/'); parts.pop();
    rel.split('/').forEach(function (seg) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); });
    return parts.join('/');
  }
  function textOf(x) { // <si> 또는 <is> 안의 글(서식 조각 포함)
    var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g, m;
    var noPh = x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    while ((m = re.exec(noPh))) out += m[1] ? xmlUnesc(m[1]) : '';
    return out;
  }
  // 공유 수식을 풀 때: 상대 참조(앞에 $가 없는 열·행)를 dr행·dc열만큼 옮긴다. 따옴표 안 글과 시트 이름은 그대로 둔다.
  function shiftFormula(f, dr, dc) {
    return String(f).replace(/("[^"]*")|('[^']*'!)|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g, function (m, str, sheet, cAbs, col, rAbs, row) {
      if (str || sheet) return m;
      var c = cAbs ? col : colName(colNum(col) + dc), r = rAbs ? row : String(+row + dr);
      return cAbs + c + rAbs + r;
    });
  }

  /* ── 열기 ── */
  function open(bytes, JSZip) {
    return JSZip.loadAsync(bytes).then(function (zip) {
      var read = function (p) { var f = zip.file(p); return f ? f.async('string') : Promise.resolve(null); };
      return Promise.all([read('xl/workbook.xml'), read('xl/_rels/workbook.xml.rels'), read('xl/sharedStrings.xml'), read('xl/styles.xml')]).then(function (a) {
        var wb = a[0], rels = a[1] || '', sstXml = a[2] || '', stXml = a[3] || '';
        if (!wb) throw new Error('엑셀 통합 문서가 아닙니다.');
        var relMap = {};
        (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(function (t) { relMap[attr(t, 'Id')] = attr(t, 'Target'); });
        var sheets = [];
        (wb.match(/<sheet\b[^>]*>/g) || []).forEach(function (t) {
          var target = relMap[attr(t, 'r:id')] || '';
          var path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
          if (attr(t, 'state') === 'veryHidden') return;
          sheets.push({ name: attr(t, 'name'), path: path, hidden: attr(t, 'state') === 'hidden' });
        });
        var sst = (sstXml.match(/<si>[\s\S]*?<\/si>|<si\/>/g) || []).map(textOf);
        var doc = { zip: zip, workbookXml: wb, sheets: sheets, sst: sst, styles: parseStyles(stXml), styleXml: stXml };
        return Promise.all(sheets.map(function (s) {
          var relPath = s.path.replace(/([^/]+)$/, '_rels/$1.rels');
          return Promise.all([read(s.path), read(relPath)]).then(function (a2) {
            s.xml = a2[0] || ''; parseSheet(doc, s); s.tables = [];
            var tl = (a2[1] || '').match(/<Relationship\b[^>]*\/table"[^>]*>|<Relationship\b[^>]*Type="[^"]*\/table"[^>]*>/g) || [];
            return Promise.all(tl.map(function (t) {
              var tg = attr(t, 'Target') || '', tp = tg.charAt(0) === '/' ? tg.slice(1) : resolvePath(s.path, tg);
              return read(tp).then(function (tx) { if (tx) s.tables.push({ path: tp, xml: tx }); });
            }));
          });
        })).then(function () { return doc; });
      });
    });
  }
  function parseStyles(x) {
    var numFmts = {};
    (x.match(/<numFmt\b[^>]*>/g) || []).forEach(function (t) { numFmts[attr(t, 'numFmtId')] = attr(t, 'formatCode'); });
    var section = function (name, item) { var m = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>').exec(x); return m ? (m[1].match(new RegExp('<' + item + '\\b[^>]*?(?:/>|>[\\s\\S]*?</' + item + '>)', 'g')) || []) : []; };
    var color = function (frag) {
      if (!frag) return null;
      var rgb = attr(frag, 'rgb'); if (rgb) return rgb.slice(-6);
      var th = attr(frag, 'theme'); if (th != null && THEME[+th]) return THEME[+th];
      var idx = attr(frag, 'indexed'); if (idx === '64' || idx == null) return null;
      return null;
    };
    var fonts = section('fonts', 'font').map(function (f) {
      var c = /<color\b[^>]*>/.exec(f), sz = /<sz\b[^>]*>/.exec(f), nm = /<name\b[^>]*>/.exec(f);
      return { b: /<b\/>|<b\s+val="(?:1|true)"/.test(f), i: /<i\/>|<i\s+val="(?:1|true)"/.test(f), u: /<u\b/.test(f), sz: sz ? +attr(sz[0], 'val') : null, color: c ? color(c[0]) : null, name: nm ? attr(nm[0], 'val') : null };
    });
    var fills = section('fills', 'fill').map(function (f) {
      if (!/patternType="solid"/.test(f)) return null;
      var fg = /<fgColor\b[^>]*>/.exec(f); return fg ? color(fg[0]) : null;
    });
    var borders = section('borders', 'border').map(function (b) {
      var o = {};
      ['left', 'right', 'top', 'bottom'].forEach(function (side) {
        var m = new RegExp('<' + side + '\\b([^>]*)(?:/>|>([\\s\\S]*?)</' + side + '>)').exec(b);
        if (!m) return;
        var st = attr('<x' + m[1] + '>', 'style'); if (!st) return;
        var cm = m[2] && /<color\b[^>]*>/.exec(m[2]);
        o[side] = { style: st, color: cm ? color(cm[0]) : '000000' };
      });
      return o;
    });
    var xfs = section('cellXfs', 'xf').map(function (t) {
      var head = /^<xf\b[^>]*>/.exec(t)[0], al = /<alignment\b[^>]*>/.exec(t);
      return { numFmtId: +attr(head, 'numFmtId') || 0, fontId: +attr(head, 'fontId') || 0, fillId: +attr(head, 'fillId') || 0, borderId: +attr(head, 'borderId') || 0,
        align: al ? { h: attr(al[0], 'horizontal'), v: attr(al[0], 'vertical'), wrap: attr(al[0], 'wrapText') === '1' } : null };
    });
    var fmtOf = function (id) { return numFmts[id] || BUILTIN_FMT[id] || null; };
    var isDate = function (id) { if (BUILTIN_DATE[id]) return true; var code = numFmts[id]; if (!code) return false; code = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''); return /[ymdhs]/i.test(code) && !/^[#0.,%\s]*$/.test(code); };
    return { fonts: fonts, fills: fills, borders: borders, xfs: xfs, fmtOf: fmtOf, isDate: function (s) { var xf = xfs[s]; return !!xf && isDate(xf.numFmtId); } };
  }
  function parseSheet(doc, s) {
    var x = s.xml, cells = {}, maxR = 0, maxC = 0, rows = {};
    var shared = {}; // si → {ref, f, r, c}
    (x.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []).forEach(function (rowXml) {
      var rt = /^<row\b[^>]*>/.exec(rowXml)[0], rn = +attr(rt, 'r');
      if (attr(rt, 'ht')) rows[rn] = { ht: +attr(rt, 'ht'), hidden: attr(rt, 'hidden') === '1' };
      (rowXml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(function (cx) {
        var ct = /^<c\b[^>]*>/.exec(cx)[0], ref = attr(ct, 'r'), p = parseRef(ref); if (!p) return;
        var t = attr(ct, 't'), st = attr(ct, 's'), vm = /<v>([\s\S]*?)<\/v>/.exec(cx), fm = /<f\b([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/.exec(cx);
        var cell = { s: st == null ? 0 : +st };
        if (fm) {
          var fa = '<f' + fm[1] + '>', ftext = fm[2] != null ? xmlUnesc(fm[2]) : '';
          if (attr(fa, 't') === 'shared') {
            var si = attr(fa, 'si');
            if (attr(fa, 'ref')) { shared[si] = { f: ftext, r: p.r, c: p.c }; cell.f = ftext; cell.sharedMaster = si; }
            else cell.sharedSi = si;
          } else if (attr(fa, 't') !== 'array' || ftext) cell.f = ftext;
        }
        if (t === 's') cell.v = vm ? doc.sst[+vm[1]] : '';
        else if (t === 'inlineStr') { var is = /<is>([\s\S]*?)<\/is>/.exec(cx); cell.v = is ? textOf(is[1]) : ''; }
        else if (t === 'str') cell.v = vm ? xmlUnesc(vm[1]) : '';
        else if (t === 'b') cell.v = vm ? vm[1] === '1' : false;
        else if (t === 'e') cell.v = vm ? xmlUnesc(vm[1]) : '';
        else if (vm) cell.v = +vm[1];
        if (cell.v === undefined && cell.f === undefined && cell.sharedSi === undefined && !cell.s) return;
        cells[ref] = cell; if (p.r > maxR) maxR = p.r; if (p.c > maxC) maxC = p.c;
      });
    });
    Object.keys(cells).forEach(function (ref) { // 딸린 공유 수식에 각자의 수식을 채워 둔다(읽기용)
      var c = cells[ref]; if (c.sharedSi == null || !shared[c.sharedSi]) return;
      var m = shared[c.sharedSi], p = parseRef(ref); c.f = shiftFormula(m.f, p.r - m.r, p.c - m.c);
    });
    var merges = (x.match(/<mergeCell\b[^>]*>/g) || []).map(function (t) { return attr(t, 'ref'); });
    var cols = (x.match(/<col\b[^>]*>/g) || []).map(function (t) { return { min: +attr(t, 'min'), max: +attr(t, 'max'), width: +attr(t, 'width'), hidden: attr(t, 'hidden') === '1' }; });
    var fmt = /<sheetFormatPr\b[^>]*>/.exec(x);
    s.cells = cells; s.merges = merges; s.cols = cols; s.rows = rows; s.maxR = maxR; s.maxC = maxC; s.shared = shared;
    s.defaultRowHeight = fmt && attr(fmt[0], 'defaultRowHeight') ? +attr(fmt[0], 'defaultRowHeight') : 15;
    s.defaultColWidth = fmt && attr(fmt[0], 'defaultColWidth') ? +attr(fmt[0], 'defaultColWidth') : 8.43;
  }

  /* ── 시트 편집기 데이터 ── */
  var BORDER_STYLE = { thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6, double: 7, medium: 8, mediumDashed: 9, mediumDashDot: 10, mediumDashDotDot: 11, slantDashDot: 12, thick: 13 };
  function univerStyle(st, s) {
    var xf = st.xfs[s]; if (!xf) return null;
    var o = {}, f = st.fonts[xf.fontId] || {};
    if (f.b) o.bl = 1; if (f.i) o.it = 1; if (f.u) o.ul = { s: 1 };
    if (f.sz) o.fs = f.sz; if (f.color && f.color !== '000000') o.cl = { rgb: '#' + f.color };
    if (f.name) o.ff = f.name;
    var bg = st.fills[xf.fillId]; if (bg) o.bg = { rgb: '#' + bg };
    var b = st.borders[xf.borderId];
    if (b) { var bd = {}; [['top', 't'], ['bottom', 'b'], ['left', 'l'], ['right', 'r']].forEach(function (k) { if (b[k[0]]) bd[k[1]] = { s: BORDER_STYLE[b[k[0]].style] || 1, cl: { rgb: '#' + (b[k[0]].color || '000000') } }; }); if (Object.keys(bd).length) o.bd = bd; }
    if (xf.align) {
      var h = { left: 1, center: 2, centerContinuous: 2, right: 3, justify: 4 }[xf.align.h]; if (h) o.ht = h;
      var v = { top: 1, center: 2, bottom: 3 }[xf.align.v]; if (v) o.vt = v;
      if (xf.align.wrap) o.tb = 3;
    }
    var code = st.fmtOf(xf.numFmtId); if (code && code !== 'General') o.n = { pattern: code };
    return Object.keys(o).length ? o : null;
  }
  // 엑셀 날짜 일련번호 ↔ 날짜
  function serialOf(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); }
  function toUniver(doc) {
    var st = doc.styles, styles = {}, styleKey = {}, sheets = {}, order = [];
    var styleId = function (s) {
      if (!s) return undefined;
      if (styleKey[s] !== undefined) return styleKey[s] || undefined;
      var u = univerStyle(st, s); if (!u) { styleKey[s] = ''; return undefined; }
      var id = 's' + s; styles[id] = u; styleKey[s] = id; return id;
    };
    doc.sheets.forEach(function (s, i) {
      var id = 'sheet' + (i + 1), cellData = {};
      Object.keys(s.cells).forEach(function (ref) {
        var c = s.cells[ref], p = parseRef(ref), cd = {};
        if (c.v !== undefined && c.v !== '') cd.v = typeof c.v === 'boolean' ? (c.v ? 1 : 0) : c.v;
        if (typeof c.v === 'number') cd.t = 2; else if (typeof c.v === 'boolean') cd.t = 3; else if (typeof c.v === 'string' && c.v !== '') cd.t = 1;
        if (c.f) cd.f = '=' + c.f;
        var sid = styleId(c.s); if (sid) cd.s = sid;
        if (!Object.keys(cd).length) return;
        (cellData[p.r - 1] = cellData[p.r - 1] || {})[p.c - 1] = cd;
      });
      var columnData = {};
      s.cols.forEach(function (c) { for (var k = c.min; k <= Math.min(c.max, 300); k++) columnData[k - 1] = { w: Math.round(c.width * 7 + 5), hd: c.hidden ? 1 : 0 }; });
      var rowData = {};
      Object.keys(s.rows).forEach(function (r) { rowData[r - 1] = { h: Math.round(s.rows[r].ht * 96 / 72), hd: s.rows[r].hidden ? 1 : 0 }; });
      var mergeData = s.merges.map(function (m) { var a = m.split(':'), p = parseRef(a[0]), q = parseRef(a[1] || a[0]); return { startRow: p.r - 1, startColumn: p.c - 1, endRow: q.r - 1, endColumn: q.c - 1 }; });
      sheets[id] = { id: id, name: s.name, hidden: s.hidden ? 1 : 0, cellData: cellData, mergeData: mergeData, columnData: columnData, rowData: rowData,
        rowCount: Math.max(100, s.maxR + 50), columnCount: Math.max(26, s.maxC + 5),
        defaultColumnWidth: Math.round(s.defaultColWidth * 7 + 5), defaultRowHeight: Math.round(s.defaultRowHeight * 96 / 72) };
      order.push(id);
    });
    return { id: 'wb', name: '', appVersion: '', locale: 'koKR', styles: styles, sheetOrder: order, sheets: sheets };
  }

  /* ── 지금 값 비교: 편집기 셀 ↔ 원본 셀 ── */
  function norm(v) { return v === undefined || v === null ? '' : v; }
  // edits: [{ sheet: 번호(0부터), ref: 'B4', v: 값(문자열·숫자·불·''), f: '수식(= 없이)' 또는 undefined }]
  function formulaOk(f) {
    var depth = 0, q = false, sq = false; f = String(f);
    for (var i = 0; i < f.length; i++) {
      var ch = f[i];
      if (q) { if (ch === '"') q = false; continue; }
      if (sq) { if (ch === "'") sq = false; continue; }
      if (ch === '"') q = true; else if (ch === "'") sq = true;
      else if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth < 0) return false; }
    }
    return depth === 0 && !q && !sq;
  }
  function patch(doc, edits, JSZip) {
    var bad = edits.filter(function (e) { return e.f && !formulaOk(String(e.f).replace(/^=/, '')); });
    if (bad.length) {
      var names = bad.slice(0, 5).map(function (e) { return (doc.sheets.length > 1 ? doc.sheets[e.sheet].name + '!' : '') + e.ref; }).join(', ');
      return Promise.reject(new Error('괄호나 따옴표가 맞지 않는 수식이 있어 저장하지 않았습니다: ' + names + '. 그 칸을 고친 뒤 다시 받아 주세요.'));
    }
    var zip = doc.zip, bySheet = {};
    edits.forEach(function (e) { (bySheet[e.sheet] = bySheet[e.sheet] || []).push(e); });
    var touched = Object.keys(bySheet);
    touched.forEach(function (si) {
      var s = doc.sheets[+si]; if (!s) return;
      s.xml = patchSheet(doc, s, bySheet[si]);
      zip.file(s.path, s.xml);
      (s.tables || []).forEach(function (tb) { if (tb.changed) zip.file(tb.path, tb.xml); });
    });
    commitStyles(doc);
    if (doc.stylesPartMissing) { doc.stylesPartMissing = false; return addStylesPart(zip).then(function () { return finishPatch(doc, zip, touched); }); }
    return finishPatch(doc, zip, touched);
  }
  function finishPatch(doc, zip, touched) {
    if (touched.length) {
      // 열 때 모든 수식을 다시 계산하게 하고, 이전 계산 순서표는 지운다.
      var wb = doc.workbookXml;
      if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b[^>]*>/, function (t) { return setAttr(t, 'fullCalcOnLoad', '1'); });
      else {
        var at = -1;
        ['</sheets>', '<functionGroups/>', '</functionGroups>', '<externalReferences/>', '</externalReferences>', '</definedNames>'].forEach(function (tag) { var i = wb.lastIndexOf(tag); if (i >= 0 && i + tag.length > at) at = i + tag.length; });
        if (at > 0) wb = wb.slice(0, at) + '<calcPr fullCalcOnLoad="1"/>' + wb.slice(at);
      }
      doc.workbookXml = wb; zip.file('xl/workbook.xml', wb);
      if (zip.file('xl/calcChain.xml')) {
        zip.remove('xl/calcChain.xml');
        return Promise.all([zip.file('[Content_Types].xml').async('string'), zip.file('xl/_rels/workbook.xml.rels').async('string')]).then(function (a) {
          zip.file('[Content_Types].xml', a[0].replace(/<Override\b[^>]*calcChain[^>]*\/>/g, ''));
          zip.file('xl/_rels/workbook.xml.rels', a[1].replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ''));
          return gen(zip);
        });
      }
    }
    return gen(zip);
  }
  function gen(zip) {
    return zip.generateAsync({ type: typeof window === 'undefined' ? 'nodebuffer' : 'uint8array', compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function cellXml(ref, s, e, dateStyle) {
    var a = '<c r="' + ref + '"' + (s ? ' s="' + s + '"' : '');
    if (e.f) return a + '><f>' + xmlEsc(String(e.f).replace(/^=/, '')) + '</f></c>';
    var v = e.v;
    if (v === '' || v == null) return a + '/>';
    if (typeof v === 'boolean') return a + ' t="b"><v>' + (v ? 1 : 0) + '</v></c>';
    if (typeof v === 'number' && isFinite(v)) return a + '><v>' + v + '</v></c>';
    var str = String(v);
    if (dateStyle) { // 날짜 서식 칸에 2026-10-27·2026.10.27 같은 글을 쓰면 날짜 값으로 바꾼다.
      var m = /^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/.exec(str.trim());
      if (m) return a + '><v>' + serialOf(+m[1], +m[2], +m[3]) + '</v></c>';
    }
    if (/^-?\d+(?:\.\d+)?$/.test(str.trim()) && str.trim().length < 16 && !/^0\d/.test(str.trim())) return a + '><v>' + Number(str.trim()) + '</v></c>';
    return a + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(str) + '</t></is></c>';
  }
  /* ── 행 넣기·지우기(엑셀과 같은 규칙) ──
   * at행 앞에 n행을 넣으면 at 이상인 행·참조가 n만큼 내려간다. 지우면 그 사이의 참조는 #REF!가 되고,
   * 범위의 끝이 지운 행에 걸리면 범위를 줄인다. 다른 시트를 가리키는 참조(시트!A1)는 건드리지 않는다. */
  function shiftRowRef(row, at, n) { // n>0 넣기, n<0 지우기(지울 행: at..at-n-1). 지워지면 null
    if (n > 0) return row >= at ? row + n : row;
    var end = at - n - 1;
    if (row < at) return row; if (row > end) return row + n; return null;
  }
  function shiftFormulaRows(f, at, n) {
    return String(f).replace(/("[^"]*")|((?:'[^']*'|[^\s(),:=+\-*/&^<>!]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|(\$?[A-Z]{1,3})(\$?)(\d+)(?::(\$?[A-Z]{1,3})(\$?)(\d+))?(?![\w(])/g,
      function (m, str, other, c1, a1, r1, c2, a2, r2) {
        if (str || other) return m;
        if (c2 === undefined) { var nr = shiftRowRef(+r1, at, n); return nr == null ? '#REF!' : c1 + a1 + nr; }
        var s1 = +r1, s2 = +r2, lo = Math.min(s1, s2), hi = Math.max(s1, s2), nlo, nhi;
        if (n > 0) { nlo = shiftRowRef(lo, at, n); nhi = shiftRowRef(hi, at, n); }
        else {
          var end = at - n - 1;
          nlo = lo < at ? lo : lo > end ? lo + n : at;
          nhi = hi < at ? hi : hi > end ? hi + n : at - 1;
          if (nhi < nlo) return '#REF!';
        }
        return c1 + a1 + nlo + ':' + c2 + a2 + nhi;
      });
  }
  function shiftRangeRows(ref, at, n) { // A1:B3 같은 범위(병합·조건부 서식). 사라지면 null
    var a = ref.split(':'), p = parseRef(a[0]), q = parseRef(a[1] || a[0]); if (!p || !q) return ref;
    var lo = p.r, hi = q.r, nlo, nhi;
    if (n > 0) { nlo = shiftRowRef(lo, at, n); nhi = shiftRowRef(hi, at, n); }
    else { var end = at - n - 1; nlo = lo < at ? lo : lo > end ? lo + n : at; nhi = hi < at ? hi : hi > end ? hi + n : at - 1; if (nhi < nlo) return null; }
    return refOf(nlo, p.c) + (a[1] ? ':' + refOf(nhi, q.c) : '');
  }
  function structural(doc, s, rowList, op) {
    var at = op.at, n = op.op === 'insertRows' ? op.count : -op.count;
    // 공유 수식은 먼저 셀마다 풀어 쓴다(옮긴 뒤에는 기준이 맞지 않는다).
    rowList.forEach(function (row) { row.cells.forEach(function (c) {
      if (!/<f\b[^>]*t="shared"/.test(c.xml)) return;
      var full = s.cells[c.ref] && s.cells[c.ref].f;
      var fx = full == null ? '' : '<f>' + xmlEsc(full) + '</f>';
      c.xml = c.xml.replace(/<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/, function () { return fx; });
    }); });
    var srcRow = n > 0 ? rowList.filter(function (r) { return r.r === at - 1; })[0] : null;
    var out = [];
    rowList.forEach(function (row) {
      var nr = shiftRowRef(row.r, at, n); if (nr == null) return;
      row.r = nr; row.tag = setAttr(setAttr(row.tag, 'r', String(nr)), 'spans', null);
      row.cells.forEach(function (c) {
        var p = parseRef(c.ref), ref = refOf(nr, p.c);
        c.xml = c.xml.replace(/^<c\b[^>]*>/, function (t) { return setAttr(t, 'r', ref); }).replace(/<f\b([^>]*)>([\s\S]*?)<\/f>/, function (m, a, f) {
          var ra = /\sref="([^"]*)"/.exec(a); if (ra) { var nr2 = shiftRangeRows(ra[1], at, n); a = a.replace(ra[0], function () { return nr2 ? ' ref="' + nr2 + '"' : ''; }); }
          return '<f' + a + '>' + xmlEsc(shiftFormulaRows(xmlUnesc(f), at, n)) + '</f>';
        });
        c.ref = ref;
      });
      out.push(row);
    });
    if (n > 0) for (var k = 0; k < n; k++) { // 넣은 행은 바로 위 행의 모양(높이·셀 스타일)을 따른다
      var r = at + k, tag = srcRow ? setAttr(setAttr(srcRow.tag, 'r', String(r)), 'spans', null) : '<row r="' + r + '">';
      out.push({ r: r, tag: tag, cells: srcRow ? srcRow.cells.map(function (c) { var p = parseRef(c.ref), st = attr(/^<c\b[^>]*>/.exec(c.xml)[0], 's'); return { ref: refOf(r, p.c), xml: '<c r="' + refOf(r, p.c) + '"' + (st ? ' s="' + st + '"' : '') + '/>' }; }) : [] });
    }
    out.sort(function (a, b) { return a.r - b.r; });
    rowList.length = 0; out.forEach(function (r) { rowList.push(r); });
    // 시트의 다른 부분: 병합, 조건부 서식·데이터 유효성·하이퍼링크 범위
    s.xml = s.xml.replace(/<mergeCell\b[^>]*\/>/g, function (t) { var nrf = shiftRangeRows(attr(t, 'ref'), at, n); return nrf ? setAttr(t, 'ref', nrf) : ''; })
      .replace(/<mergeCells\b[^>]*count="\d+"[^>]*>([\s\S]*?)<\/mergeCells>/, function (m, inner) { var c = (inner.match(/<mergeCell\b/g) || []).length; return c ? setAttr(m.slice(0, m.indexOf('>') + 1), 'count', String(c)) + inner + '</mergeCells>' : ''; })
      .replace(/(<formula[12]?>)([\s\S]*?)(<\/formula[12]?>)/g, function (m, a, f, b) { return a + xmlEsc(shiftFormulaRows(xmlUnesc(f), at, n)) + b; })
      .replace(/(<(?:conditionalFormatting|dataValidation|hyperlink|selection|autoFilter)\b[^>]*?\s(?:sqref|ref)=")([^"]*)(")/g, function (m, a, refs, b) {
        var nrefs = refs.split(/\s+/).map(function (r) { return shiftRangeRows(r, at, n); }).filter(Boolean); return nrefs.length ? a + nrefs.join(' ') + b : a + refs + b; });
    // 시트에 딸린 표: 범위와 자동 필터를 옮긴다. 머리글 행이 지워지면 엑셀이 파일을 열지 못하므로 멈춘다.
    (s.tables || []).forEach(function (tb) {
      var head = /<table\b[^>]*>/.exec(tb.xml); if (!head) return;
      var tref = attr(head[0], 'ref'), nref = shiftRangeRows(tref, at, n);
      var top = parseRef(tref.split(':')[0]);
      if (!nref || (n < 0 && top && top.r >= at && top.r <= at - n - 1)) throw new Error('엑셀 표(표 기능)의 머리글 행은 지울 수 없습니다. 엑셀에서 표를 범위로 바꾼 뒤 지워 주세요.');
      tb.xml = tb.xml.replace(/(<(?:table|autoFilter|sortState)\b[^>]*?\sref=")([^"]*)(")/g, function (m, a, r1, b) { var x2 = shiftRangeRows(r1, at, n); return a + (x2 || r1) + b; });
      tb.changed = true;
    });
    // 이 시트를 가리키는 정의된 이름·인쇄 영역
    var nm = s.name.replace(/'/g, "''");
    doc.workbookXml = doc.workbookXml.replace(/(<definedName\b[^>]*>)([\s\S]*?)(<\/definedName>)/g, function (m, a, body, b) {
      var text = xmlUnesc(body);
      var out = text.replace(/((?:'((?:[^']|'')+)'|([^\s'!,()=+\-*/&^<>]+))!)(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g, function (mm, pre, q, plain, ref2) {
        var sheetName = q != null ? q : plain; if (sheetName !== s.name && sheetName !== nm) return mm;
        var shifted = shiftFormulaRows(ref2, at, n); return pre + shifted;
      });
      return out === text ? m : a + xmlEsc(out) + b;
    });
    doc.workbookChanged = true;
    // 읽기용 셀 정보도 옮긴다
    var cells = {};
    Object.keys(s.cells).forEach(function (ref) { var p = parseRef(ref), nr = shiftRowRef(p.r, at, n); if (nr == null) return; var c = s.cells[ref]; if (c.f) c.f = shiftFormulaRows(c.f, at, n); delete c.sharedMaster; delete c.sharedSi; cells[refOf(nr, p.c)] = c; });
    if (n > 0 && srcRow) for (var j = 0; j < n; j++) srcRow.cells.forEach(function (c) { var p = parseRef(c.ref), st = attr(/^<c\b[^>]*>/.exec(c.xml)[0], 's'); cells[refOf(at + j, p.c)] = { s: st ? +st : 0 }; });
    s.cells = cells; s.maxR = Math.max(0, s.maxR + n);
  }
  function patchSheet(doc, s, edits) {
    var want = {};
    var ops = edits.filter(function (e) { return e.op === 'insertRows' || e.op === 'deleteRows'; });
    var formats = edits.filter(function (e) { return e.op === 'format' || e.op === 'colWidth' || e.op === 'rowHeight'; });
    edits = edits.filter(function (e) { return !e.op; });
    edits.forEach(function (e) { var p = parseRef(e.ref); if (p) want[refOf(p.r, p.c)] = e; });
    if (ops.length) { // 행 작업을 먼저 한다. 셀 주소(ref)는 행 작업을 마친 뒤의 주소다.
      var sd0 = /<sheetData\b[^>]*\/>|<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(s.xml);
      var rl = ((sd0 && sd0[1]) || '').match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || [];
      var rows0 = rl.map(function (rx) { var rt = /^<row\b[^>]*>/.exec(rx)[0]; return { r: +attr(rt, 'r'), tag: rt.replace(/\/>$/, '>'), cells: (rx.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).map(function (cx) { return { ref: attr(/^<c\b[^>]*>/.exec(cx)[0], 'r'), xml: cx }; }) }; });
      ops.forEach(function (op) { structural(doc, s, rows0, op); });
      var body0 = rows0.map(function (row) { return row.cells.length ? row.tag + row.cells.map(function (c) { return c.xml; }).join('') + '</row>' : row.tag.replace(/>$/, '/>'); }).join('');
      s.xml = sd0 ? s.xml.replace(sd0[0], function () { return '<sheetData>' + body0 + '</sheetData>'; }) : s.xml;
      doc.anyStructural = true;
    }
    var x = s.xml;
    // 공유 수식의 기준 셀을 고치면 딸린 셀에 각자의 수식을 먼저 풀어 쓴다.
    var breakSi = {};
    Object.keys(want).forEach(function (ref) { var c = s.cells[ref]; if (c && c.sharedMaster != null) breakSi[c.sharedMaster] = 1; });
    var sd = /<sheetData\b[^>]*\/>|<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(x);
    var inner = sd && sd[1] != null ? sd[1] : '';
    var rowList = (inner.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []).map(function (rx) {
      var rt = /^<row\b[^>]*>/.exec(rx)[0];
      return { r: +attr(rt, 'r'), tag: rt.replace(/\/>$/, '>'), cells: (rx.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).map(function (cx) { return { ref: attr(/^<c\b[^>]*>/.exec(cx)[0], 'r'), xml: cx }; }) };
    });
    var rowsBy = {}; rowList.forEach(function (r) { rowsBy[r.r] = r; });
    if (Object.keys(breakSi).length) rowList.forEach(function (row) {
      row.cells.forEach(function (c) {
        var fm = /<f\b([^>]*)(?:\/>|>[\s\S]*?<\/f>)/.exec(c.xml); if (!fm) return;
        var si = attr('<f' + fm[1] + '>', 'si'); if (si == null || !breakSi[si] || attr('<f' + fm[1] + '>', 't') !== 'shared') return;
        var full = s.cells[c.ref] && s.cells[c.ref].f; if (full == null) return;
        c.xml = c.xml.replace(fm[0], function () { return '<f>' + xmlEsc(full) + '</f>'; });
      });
    });
    var styleAbove = function (r, col) { // 새로 만드는 셀은 같은 열의 바로 위 셀 모양을 따른다(명단 줄 늘리기)
      for (var k = r - 1; k >= Math.max(1, r - 30); k--) { var c = s.cells[refOf(k, col)]; if (c && c.s) return c.s; if (rowsBy[k] && c) return c.s || 0; }
      return 0;
    };
    Object.keys(want).forEach(function (ref) {
      var e = want[ref], p = parseRef(ref), row = rowsBy[p.r];
      if (!row) { row = { r: p.r, tag: '<row r="' + p.r + '">', cells: [], fresh: true }; rowsBy[p.r] = row; rowList.push(row); }
      var old = s.cells[ref], st = old ? old.s : styleAbove(p.r, p.c);
      var isDate = doc.styles.isDate(st);
      var xmlNew = cellXml(ref, st, e, isDate);
      var at = -1; row.cells.forEach(function (c, i) { if (c.ref === ref) at = i; });
      if (at >= 0) row.cells[at].xml = xmlNew;
      else { row.cells.push({ ref: ref, xml: xmlNew }); row.cells.sort(function (a, b) { return parseRef(a.ref).c - parseRef(b.ref).c; }); }
      row.tag = setAttr(row.tag, 'spans', null);
      // 읽기용 셀 정보도 맞춘다(같은 문서로 다시 저장할 때)
      s.cells[ref] = { s: st, v: e.f ? undefined : e.v, f: e.f ? String(e.f).replace(/^=/, '') : undefined };
      if (p.r > s.maxR) s.maxR = p.r; if (p.c > s.maxC) s.maxC = p.c;
    });
    rowList.sort(function (a, b) { return a.r - b.r; });
    var body = rowList.map(function (row) { return row.cells.length ? row.tag + row.cells.map(function (c) { return c.xml; }).join('') + '</row>' : row.tag.replace(/>$/, '/>'); }).join('');
    x = sd ? x.replace(sd[0], function () { return '<sheetData>' + body + '</sheetData>'; }) : x;
    x = x.replace(/<dimension\b[^>]*\/>/, '<dimension ref="A1:' + refOf(Math.max(1, s.maxR), Math.max(1, s.maxC)) + '"/>');
    return formats.length ? applyFormats(doc, s, x, formats) : x;
  }

  /* ── 서식(글자 모양·색·테두리·정렬·열 너비·행 높이) ──
   * styles.xml에 새 글꼴·채움·테두리·셀 서식을 덧붙이고, 범위의 셀에 새 서식 번호를 준다.
   * 새 서식은 그 셀의 지금 서식을 복사해 바뀐 속성만 고치므로 날짜·숫자 표시 형식과 보호 설정이 남는다. */
  var MINIMAL_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  var STYLE_ORDER = ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs', 'tableStyles', 'colors', 'extLst'];
  var STYLE_LISTS = { fonts: 'font', fills: 'fill', borders: 'border', cellXfs: 'xf' };
  function stylerOf(doc) {
    if (doc.styler) return doc.styler;
    if (!doc.styleXml) doc.stylesPartMissing = true;
    var x = String(doc.styleXml || MINIMAL_STYLES).replace(/<(fonts|fills|borders|cellXfs)\b[^>]*\/>/g, '<$1 count="0"></$1>');
    Object.keys(STYLE_LISTS).forEach(function (name) { // 없는 목록은 정해진 순서 자리에 만든다
      if (new RegExp('<' + name + '\\b').test(x)) return;
      var at = -1;
      STYLE_ORDER.slice(STYLE_ORDER.indexOf(name) + 1).some(function (n) { var i = x.search(new RegExp('<' + n + '\\b')); if (i >= 0) { at = i; return true; } return false; });
      if (at < 0) at = x.lastIndexOf('</styleSheet>');
      x = x.slice(0, at) + '<' + name + ' count="0"></' + name + '>' + x.slice(at);
    });
    var lists = {};
    Object.keys(STYLE_LISTS).forEach(function (name) {
      var item = STYLE_LISTS[name], m = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>').exec(x);
      lists[name] = (m[1].match(new RegExp('<' + item + '\\b[^>]*?(?:/>|>[\\s\\S]*?</' + item + '>)', 'g')) || []);
    });
    if (!lists.fonts.length) lists.fonts.push('<font><sz val="11"/><name val="맑은 고딕"/></font>');
    if (!lists.fills.length) lists.fills.push('<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>');
    if (!lists.borders.length) lists.borders.push('<border><left/><right/><top/><bottom/><diagonal/></border>');
    if (!lists.cellXfs.length) lists.cellXfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    doc.styler = { xml: x, lists: lists, cache: {} };
    return doc.styler;
  }
  function addItem(list, xml) { var i = list.indexOf(xml); if (i >= 0) return i; list.push(xml); return list.length - 1; }
  function deriveFont(base, st) {
    var f = /\/>$/.test(base) ? base.replace(/\/>$/, '></font>') : base;
    var open = function (s, piece) { return s.replace(/^<font\b[^>]*>/, function (m) { return m + piece; }); };
    if (st.bold !== undefined) { f = f.replace(/<b(?:\s[^>]*)?\/>/g, ''); if (st.bold) f = open(f, '<b/>'); }
    if (st.size) {
      var sz = '<sz val="' + st.size + '"/>';
      if (/<sz\b[^>]*\/>/.test(f)) f = f.replace(/<sz\b[^>]*\/>/, sz);
      else { var nx = f.search(/<(?:color|name|family|charset|scheme)\b/); f = nx >= 0 ? f.slice(0, nx) + sz + f.slice(nx) : f.replace('</font>', sz + '</font>'); }
    }
    if (st.color) {
      var cl = '<color rgb="FF' + st.color + '"/>';
      f = f.replace(/<color\b[^>]*\/>/g, '');
      var at = f.search(/<(?:name|family|charset|scheme)\b/);
      f = at >= 0 ? f.slice(0, at) + cl + f.slice(at) : f.replace('</font>', cl + '</font>');
    }
    return f;
  }
  function borderSide(side, on, color) { return on ? '<' + side + ' style="thin"><color rgb="FF' + color + '"/></' + side + '>' : '<' + side + '/>'; }
  function deriveBorder(base, sides, color) {
    var head = /^<border\b[^>]*?\/?>/.exec(base)[0].replace(/\/>$/, '>');
    var part = function (side) { var m = new RegExp('<' + side + '\\b[^>]*?(?:/>|>[\\s\\S]*?</' + side + '>)').exec(base); return m ? m[0] : '<' + side + '/>'; };
    var pick = function (side) { return sides[side] === undefined ? part(side) : borderSide(side, sides[side], color); };
    return head + pick('left') + pick('right') + pick('top') + pick('bottom') + part('diagonal') + '</border>';
  }
  // 범위 안에서 칸의 위치에 따라 바뀌는 테두리 변(true=긋기, false=지우기, 없음=그대로)
  function sidesAt(border, r, c, lo, hi) {
    if (border === 'all') return { left: true, right: true, top: true, bottom: true };
    if (border === 'none') return { left: false, right: false, top: false, bottom: false };
    if (border === 'bottom') return r === hi.r ? { bottom: true } : null;
    if (border === 'outer') {
      var o = {}; if (c === lo.c) o.left = true; if (c === hi.c) o.right = true; if (r === lo.r) o.top = true; if (r === hi.r) o.bottom = true;
      return Object.keys(o).length ? o : null;
    }
    return null;
  }
  function deriveXf(doc, cur, st, sides) {
    var sr = stylerOf(doc), key = cur + '|' + JSON.stringify(st) + '|' + JSON.stringify(sides);
    if (sr.cache[key] !== undefined) return sr.cache[key];
    var base = sr.lists.cellXfs[cur] || sr.lists.cellXfs[0];
    var head = /^<xf\b[^>]*?\/?>/.exec(base)[0].replace(/\s*\/?>$/, '>');
    var fontId = +attr(head, 'fontId') || 0, fillId = +attr(head, 'fillId') || 0, borderId = +attr(head, 'borderId') || 0;
    if (st.bold !== undefined || st.size || st.color) { fontId = addItem(sr.lists.fonts, deriveFont(sr.lists.fonts[fontId] || sr.lists.fonts[0], st)); head = setAttr(head, 'applyFont', '1'); }
    if (st.fill === 'none') { fillId = 0; head = setAttr(head, 'applyFill', '1'); }
    else if (st.fill) { fillId = addItem(sr.lists.fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + st.fill + '"/><bgColor indexed="64"/></patternFill></fill>'); head = setAttr(head, 'applyFill', '1'); }
    if (sides) { borderId = addItem(sr.lists.borders, deriveBorder(sr.lists.borders[borderId] || sr.lists.borders[0], sides, st.borderColor || 'C7CBD1')); head = setAttr(head, 'applyBorder', '1'); }
    head = setAttr(setAttr(setAttr(head, 'fontId', String(fontId)), 'fillId', String(fillId)), 'borderId', String(borderId));
    var al = /<alignment\b[^>]*\/>/.exec(base), prot = /<protection\b[^>]*\/>/.exec(base), alTag = al ? al[0] : '';
    if (st.align || st.valign || st.wrap !== undefined) {
      alTag = alTag || '<alignment/>';
      if (st.align) alTag = setAttr(alTag, 'horizontal', st.align);
      if (st.valign) alTag = setAttr(alTag, 'vertical', st.valign);
      if (st.wrap !== undefined) alTag = setAttr(alTag, 'wrapText', st.wrap ? '1' : null);
      head = setAttr(head, 'applyAlignment', '1');
    }
    var inner = alTag + (prot ? prot[0] : '');
    var xml = inner ? head + inner + '</xf>' : head.replace(/>$/, '/>');
    return (sr.cache[key] = addItem(sr.lists.cellXfs, xml));
  }
  function commitStyles(doc) {
    var sr = doc.styler; if (!sr) return;
    var x = sr.xml;
    Object.keys(STYLE_LISTS).forEach(function (name) {
      x = x.replace(new RegExp('(<' + name + '\\b[^>]*>)[\\s\\S]*?(</' + name + '>)'), function (m, a, b) { return setAttr(a, 'count', String(sr.lists[name].length)) + sr.lists[name].join('') + b; });
    });
    doc.styleXml = x; doc.styles = parseStyles(x); doc.styler = null;
    doc.zip.file('xl/styles.xml', x);
  }
  function addStylesPart(zip) { // 서식 부분이 아예 없던 파일에 새로 등록한다
    return Promise.all([zip.file('[Content_Types].xml').async('string'), zip.file('xl/_rels/workbook.xml.rels').async('string')]).then(function (a) {
      zip.file('[Content_Types].xml', a[0].replace('</Types>', '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'));
      zip.file('xl/_rels/workbook.xml.rels', a[1].replace('</Relationships>', '<Relationship Id="rIdDrStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'));
    });
  }
  function setColWidths(x, widths) {
    var m = /<cols\b[^>]*>([\s\S]*?)<\/cols>/.exec(x);
    var list = m ? (m[1].match(/<col\b[^>]*\/>/g) || []).map(function (t) { return { min: +attr(t, 'min'), max: +attr(t, 'max'), tag: t }; }) : [];
    widths.forEach(function (w) {
      var next = [], tag = '<col/>';
      list.forEach(function (it) {
        if (it.max < w.col || it.min > w.col) { next.push(it); return; }
        tag = it.tag;
        if (it.min < w.col) next.push({ min: it.min, max: w.col - 1, tag: it.tag });
        if (it.max > w.col) next.push({ min: w.col + 1, max: it.max, tag: it.tag });
      });
      next.push({ min: w.col, max: w.col, tag: setAttr(setAttr(tag, 'width', String(w.width)), 'customWidth', '1') });
      list = next;
    });
    list.sort(function (a, b) { return a.min - b.min; });
    var body = '<cols>' + list.map(function (it) { return setAttr(setAttr(it.tag, 'min', String(it.min)), 'max', String(it.max)); }).join('') + '</cols>';
    return m ? x.replace(m[0], function () { return body; }) : x.replace(/<sheetData\b/, function (t) { return body + t; });
  }
  function applyFormats(doc, s, x, list) {
    var formats = list.filter(function (e) { return e.op === 'format'; }), heights = list.filter(function (e) { return e.op === 'rowHeight'; }), widths = list.filter(function (e) { return e.op === 'colWidth'; });
    if (widths.length) x = setColWidths(x, widths);
    if (!formats.length && !heights.length) return x;
    var sd = /<sheetData\b[^>]*\/>|<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(x); if (!sd) return x;
    var rowList = ((sd[1] || '').match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []).map(function (rx) {
      var rt = /^<row\b[^>]*>/.exec(rx)[0];
      return { r: +attr(rt, 'r'), tag: rt.replace(/\/>$/, '>'), cells: (rx.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).map(function (cx) { var rf = attr(/^<c\b[^>]*>/.exec(cx)[0], 'r'); return { ref: rf, col: parseRef(rf).c, xml: cx }; }) };
    });
    var rowsBy = {}; rowList.forEach(function (r) { rowsBy[r.r] = r; r.byCol = {}; r.cells.forEach(function (c) { r.byCol[c.col] = c; }); });
    var rowAt = function (n) { if (!rowsBy[n]) { rowsBy[n] = { r: n, tag: '<row r="' + n + '">', cells: [], byCol: {} }; rowList.push(rowsBy[n]); } return rowsBy[n]; };
    formats.forEach(function (e) {
      var a = String(e.range).split(':'), p = parseRef(a[0]), q = parseRef(a[1] || a[0]); if (!p || !q) return;
      var lo = { r: Math.min(p.r, q.r), c: Math.min(p.c, q.c) }, hi = { r: Math.max(p.r, q.r), c: Math.max(p.c, q.c) };
      for (var r = lo.r; r <= hi.r; r++) {
        var row = rowAt(r);
        for (var c = lo.c; c <= hi.c; c++) {
          var cell = row.byCol[c];
          if (!cell) { var ref = refOf(r, c); cell = { ref: ref, col: c, xml: '<c r="' + ref + '"/>' }; row.byCol[c] = cell; row.cells.push(cell); }
          var headTag = /^<c\b[^>]*>/.exec(cell.xml)[0];
          var ns = deriveXf(doc, +attr(headTag, 's') || 0, e.style, sidesAt(e.style.border, r, c, lo, hi));
          cell.xml = setAttr(headTag, 's', String(ns)) + cell.xml.slice(headTag.length);
          if (s.cells[cell.ref]) s.cells[cell.ref].s = ns; else s.cells[cell.ref] = { s: ns };
        }
        row.tag = setAttr(row.tag, 'spans', null);
        if (r > s.maxR) s.maxR = r;
      }
      if (hi.c > s.maxC) s.maxC = hi.c;
    });
    heights.forEach(function (e) { var row = rowAt(e.row); row.tag = setAttr(setAttr(row.tag, 'ht', String(e.height)), 'customHeight', '1'); if (e.row > s.maxR) s.maxR = e.row; });
    rowList.sort(function (a, b) { return a.r - b.r; });
    var body = rowList.map(function (row) { row.cells.sort(function (a, b) { return a.col - b.col; }); return row.cells.length ? row.tag + row.cells.map(function (c) { return c.xml; }).join('') + '</row>' : row.tag.replace(/>$/, '/>'); }).join('');
    x = x.replace(sd[0], function () { return '<sheetData>' + body + '</sheetData>'; });
    return x.replace(/<dimension\b[^>]*\/>/, '<dimension ref="A1:' + refOf(Math.max(1, s.maxR), Math.max(1, s.maxC)) + '"/>');
  }

  var api = { open: open, toUniver: toUniver, patch: patch, formulaOk: formulaOk, shiftRowRef: shiftRowRef, shiftFormulaRows: shiftFormulaRows, shiftRangeRows: shiftRangeRows, univerStyle: univerStyle, parseRef: parseRef, refOf: refOf, colName: colName, colNum: colNum, shiftFormula: shiftFormula, serialOf: serialOf, norm: norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DrXlsxDoc = api;
})(typeof window !== 'undefined' ? window : this);
