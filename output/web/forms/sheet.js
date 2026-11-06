/* 문서작성 AI — 엑셀 탭 (3단계)
 *
 * 편집기: Univer 1.0.4 시트(Apache-2.0)를 lib/univer/에 두고 엑셀 탭을 처음 열 때만 불러온다. 편집기는 하나이고,
 *         탭을 바꿀 때 지금 통합 문서를 데이터로 보관했다가 다른 탭의 데이터를 올린다(한글 편집기와 같은 방식).
 * 저장:   원본 .xlsx를 다시 열어, 편집기에서 한 행 넣기·지우기를 같은 순서로 적용한 뒤 값·수식이 달라진 셀만 고쳐 쓴다
 *         (lib/xlsx-doc.js). 원본의 테두리·색·글꼴·병합·열 너비가 그대로 남는다. 원본이 없는 새 시트는 SheetJS로 저장한다.
 * 서식:   AI의 format 작업만 저장한다. 작업을 행 작업과 같은 기록(rowOps)에 순서대로 남겨 두었다가, 받을 때 그 뒤의 행 작업만큼 주소를
 *         옮겨 styles.xml에 반영한다. 되돌리기는 기록 길이를 줄이는 것으로 함께 처리된다.
 * 막는 일: 열 넣기·지우기, 셀 병합, 시트 추가·삭제·이름 바꾸기, 키보드로 하는 글자 모양 바꾸기는 저장할 수 없어 편집기에서 막고 안내한다.
 * AI:     시트 지도(행마다 셀 주소 = 값)를 주고 set·fill·insert_rows·delete_rows·clear·format으로 고치게 한다.
 */
const X = window.DrXlsxDoc;
const S = (v) => (v == null ? '' : String(v));
const ERR = /^#(REF!|NAME\?|VALUE!|DIV\/0!|N\/A|NUM!|NULL!|SPILL!|CALC!)$/;
const BLOCK = [
  [/^sheet\.command\.(insert-col|insert-multi-cols|remove-col|move-cols)/, '열 넣기·지우기·옮기기는 여기서 할 수 없습니다. 엑셀에서 해 주세요.'],
  [/^sheet\.command\.(add-worksheet-merge|remove-worksheet-merge)/, '셀 병합은 여기서 바꿀 수 없습니다. 엑셀에서 해 주세요.'],
  [/^sheet\.command\.(insert-sheet|remove-sheet|copy-sheet|set-worksheet-name|set-worksheet-order|move-rows|sort)/, '시트 추가·삭제·이름 바꾸기와 정렬·행 옮기기는 여기서 할 수 없습니다. 엑셀에서 해 주세요.'],
  [/^sheet\.command\.(set-(bold|italic|underline|stroke|font|text-color|background-color|border|horizontal|vertical|text-wrap|text-rotation|style|numfmt)|reset-|add-border|clear-selection-format|set-format-painter|apply-format-painter)/, '글자 모양·색·테두리는 왼쪽 대화로 요청해 주세요. 예: 머리글을 굵게 하고 배경을 넣어 줘.']
];

let U = null, api = null, cur = null; // cur: { t, wb, unitId }
let opts = null, loading = false, painting = false;

export async function ensureSheetEditor(container, o) {
  opts = o;
  if (api) return api;
  if (!document.getElementById('univer-css')) {
    const l = document.createElement('link'); l.id = 'univer-css'; l.rel = 'stylesheet'; l.href = o.base + 'univer.css'; document.head.appendChild(l);
  }
  await import(o.base + 'univer.js');
  U = window.DrUniver;
  const made = U.createUniver({
    locale: U.LocaleType.KO_KR,
    locales: { [U.LocaleType.KO_KR]: U.mergeLocales(U.koKR) },
    presets: [U.UniverSheetsCorePreset({ container, toolbar: false, header: true, formulaBar: true, disableAutoFocus: true })]
  });
  api = made.univerAPI;
  api.addEvent(api.Event.BeforeCommandExecute, (e) => {
    if (loading || painting || !cur) return;
    const hit = BLOCK.find(([re]) => re.test(e.id));
    if (hit) { e.cancel = true; o.onBlocked(hit[1]); }
  });
  api.addEvent(api.Event.CommandExecuted, (e) => {
    if (loading || !cur || e.type !== 2) return; // 2 = MUTATION
    const p = e.params || {};
    if (p.unitId && p.unitId !== cur.unitId) return;
    if (/^sheet\.mutation\.(insert-row|remove-rows)$/.test(e.id) && p.range) {
      cur.t.rowOps.push({ sheetId: p.subUnitId, op: e.id.endsWith('insert-row') ? 'insertRows' : 'deleteRows', at: p.range.startRow + 1, count: p.range.endRow - p.range.startRow + 1 });
    }
    if (/^sheet\.mutation\.(set-range-values|insert-row|remove-rows|set-worksheet-row|set-row|set-col)/.test(e.id)) o.onEdit(cur.t);
  });
  return api;
}

export function emptyWorkbook(name) {
  return { id: 'wb', name: name || '', appVersion: '', locale: 'koKR', styles: {}, sheetOrder: ['sheet1'],
    sheets: { sheet1: { id: 'sheet1', name: 'Sheet1', cellData: {}, rowCount: 200, columnCount: 26, defaultColumnWidth: 88, defaultRowHeight: 24 } } };
}
// 파일 바이트 → 탭 데이터. .xlsx는 원본을 보관하고, .xls·.csv는 SheetJS로 .xlsx로 바꿔 원본으로 삼는다.
export async function prepare(t, bytes, name) {
  let orig = bytes, note = '';
  if (!/\.xlsx$/i.test(name)) {
    const wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellDates: false });
    orig = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    note = /\.csv$/i.test(name) ? 'CSV 파일은 받을 때 엑셀(.xlsx)로 저장됩니다.' : '예전 엑셀(.xls) 파일은 받을 때 .xlsx로 저장되고, 일부 서식이 빠질 수 있습니다.';
  }
  const doc = await X.open(orig, JSZip);
  t.orig = orig; t.wbData = X.toUniver(doc); t.rowOps = []; t.sheetNote = note;
}

let mountSeq = 0;
function unitIdOf(t) { return 'wb-' + t.id + '-' + (++mountSeq); }
export function snapshot(t) {
  if (cur && cur.t === t) return cur.wb.save();
  return t.wbData;
}
// 탭을 편집기에 올린다. 다른 탭이 올라와 있으면 먼저 그 데이터를 보관한다.
export function mount(t) {
  if (cur && cur.t === t) return;
  loading = true;
  try {
    if (cur) { cur.t.wbData = cur.wb.save(); api.disposeUnit(cur.unitId); cur = null; }
    const data = JSON.parse(JSON.stringify(t.wbData));
    data.id = unitIdOf(t);
    const wb = api.createWorkbook(data);
    cur = { t, wb, unitId: data.id };
  } finally { loading = false; }
}
export function unmount(t) {
  if (!cur || cur.t !== t) return;
  loading = true;
  try { t.wbData = cur.wb.save(); api.disposeUnit(cur.unitId); cur = null; } finally { loading = false; }
}
export function isMounted(t) { return !!cur && cur.t === t; }
// 되돌리기: 보관한 데이터로 통합 문서를 다시 만든다.
export function restore(t, data, rowOpsLen) {
  t.wbData = JSON.parse(JSON.stringify(data));
  t.rowOps.length = Math.min(t.rowOps.length, rowOpsLen);
  if (cur && cur.t === t) {
    loading = true;
    try { api.disposeUnit(cur.unitId); cur = null; } finally { loading = false; }
    mount(t);
  }
}
export function setReadOnly(t, ro) { if (cur && cur.t === t) { try { cur.wb.setEditable(!ro); } catch (e) { /* 이전 판 */ } } }

/* ── 셀 값 ── */
// si만 있는 셀에 수식을 채운 시트 사본(원본 스냅숏은 건드리지 않는다)
function withFormulas(sheet) {
  const cd = sheet.cellData || {}, anchors = {}, out = {};
  Object.entries(cd).forEach(([r, row]) => Object.entries(row || {}).forEach(([c, cell]) => { if (cell && cell.si && cell.f) anchors[cell.si] = { f: S(cell.f).replace(/^=/, ''), r: +r, c: +c }; }));
  Object.entries(cd).forEach(([r, row]) => {
    out[r] = {};
    Object.entries(row || {}).forEach(([c, cell]) => {
      if (cell && cell.si && !cell.f && anchors[cell.si]) { const a = anchors[cell.si]; out[r][c] = Object.assign({}, cell, { f: '=' + X.shiftFormula(a.f, +r - a.r, +c - a.c) }); }
      else out[r][c] = cell;
    });
  });
  return Object.assign({}, sheet, { cellData: out });
}
function richText(c) { // 서식 있는 글은 v 없이 p(문서)에만 남는다
  const ds = c && c.p && c.p.body && c.p.body.dataStream;
  return typeof ds === 'string' ? ds.replace(/\r?\n$/, '').replace(/\r\n?/g, '\n') : null;
}
function cellVal(c) {
  if (!c) return { v: '' };
  if (c.f) return { f: S(c.f).replace(/^=/, '') };
  if ((c.v === undefined || c.v === null || c.v === '') && richText(c) != null) return { v: richText(c) };
  if (c.v === undefined || c.v === null) return { v: '' };
  if (c.t === 3) return { v: c.v === true || c.v === 1 || c.v === '1' || c.v === 'TRUE' };
  if (c.t === 2 || typeof c.v === 'number') return { v: Number(c.v) };
  return { v: S(c.v) };
}
// 수식 비교: 따옴표 밖만 대문자로 맞추고 공백을 무시한다(따옴표 안 글자의 대소문자 차이는 바뀐 것으로 본다).
function normF(f) { return S(f).replace(/("[^"]*")|[^"]+/g, (m, q) => (q ? q : m.replace(/\s+/g, '').toUpperCase())); }
function sameVal(a, b) {
  if (a.f || b.f) return !!a.f && !!b.f && normF(a.f) === normF(b.f);
  if (typeof a.v === 'number' && typeof b.v === 'number') return Math.abs(a.v - b.v) < 1e-9;
  if (typeof a.v === 'boolean' || typeof b.v === 'boolean') {
    const tb = (x) => (typeof x === 'boolean' ? x : x === 1 || x === '1' || /^true$/i.test(S(x)) ? true : x === 0 || x === '0' || /^false$/i.test(S(x)) ? false : x);
    return tb(a.v) === tb(b.v);
  }
  return S(a.v) === S(b.v);
}
function snapCells(sheet) {
  const out = {}; sheet = withFormulas(sheet);
  Object.entries(sheet.cellData || {}).forEach(([r, row]) => Object.entries(row || {}).forEach(([c, cell]) => {
    const v = cellVal(cell); if (v.f || S(v.v) !== '' || typeof v.v === 'boolean' || typeof v.v === 'number') out[X.refOf(+r + 1, +c + 1)] = v;
  }));
  return out;
}
// 원본 셀을 편집기에서 한 행 작업 순서대로 옮겨 비교 기준을 만든다.
function baseline(docSheet, ops) {
  let cells = {};
  Object.entries(docSheet.cells).forEach(([ref, c]) => { cells[ref] = c.f ? { f: c.f } : { v: c.v === undefined ? '' : c.v }; });
  ops.forEach((op) => {
    const n = op.op === 'insertRows' ? op.count : -op.count, next = {};
    Object.entries(cells).forEach(([ref, c]) => {
      const p = X.parseRef(ref), nr = X.shiftRowRef(p.r, op.at, n); if (nr == null) return;
      next[X.refOf(nr, p.c)] = c.f ? { f: X.shiftFormulaRows(c.f, op.at, n) } : c;
    });
    cells = next;
  });
  return cells;
}

/* ── 받기 ── */
export async function buildXlsx(t) {
  const snap = snapshot(t), formats = formatEdits(t, snap);
  if (!t.orig) {
    const bytes = sheetjsWrite(snap);
    return formats.length ? X.patch(await X.open(bytes, JSZip), formats, JSZip) : bytes;
  }
  const doc = await X.open(t.orig, JSZip);
  const edits = [];
  snap.sheetOrder.forEach((sid, si) => {
    const sh = snap.sheets[sid], ds = doc.sheets[si]; if (!sh || !ds) return;
    const ops = t.rowOps.filter((o) => o.sheetId === sid && isRowOp(o));
    ops.forEach((o) => edits.push({ op: o.op, sheet: si, at: o.at, count: o.count }));
    const base = baseline(ds, ops), now = snapCells(sh);
    new Set(Object.keys(base).concat(Object.keys(now))).forEach((ref) => {
      const a = now[ref] || { v: '' }, b = base[ref] || { v: '' };
      if (!sameVal(a, b)) edits.push(Object.assign({ sheet: si, ref }, a.f ? { f: a.f } : { v: a.v }));
    });
  });
  return X.patch(doc, edits.concat(formats), JSZip);
}
function isRowOp(o) { return o.op === 'insertRows' || o.op === 'deleteRows'; }
// 서식 기록의 주소는 기록할 때의 주소다. 그 뒤의 행 작업만큼 옮겨 마지막 주소로 바꾼다. 지워진 행의 서식은 버린다.
function formatEdits(t, snap) {
  const out = [];
  t.rowOps.forEach((o, i) => {
    if (isRowOp(o)) return;
    const sheet = snap.sheetOrder.indexOf(o.sheetId); if (sheet < 0) return;
    const later = t.rowOps.slice(i + 1).filter((x) => x.sheetId === o.sheetId && isRowOp(x));
    const delta = (x) => (x.op === 'insertRows' ? x.count : -x.count);
    if (o.op === 'format') {
      const range = later.reduce((r, x) => (r ? X.shiftRangeRows(r, x.at, delta(x)) : r), o.range);
      if (range) out.push({ sheet, op: 'format', range, style: o.style });
    } else if (o.op === 'rowHeight') {
      const row = later.reduce((r, x) => (r == null ? r : X.shiftRowRef(r, x.at, delta(x))), o.row);
      if (row != null) out.push({ sheet, op: 'rowHeight', row, height: o.height });
    } else if (o.op === 'colWidth') out.push({ sheet, op: 'colWidth', col: o.col, width: o.width });
  });
  return out;
}
function sheetjsWrite(snap) {
  const wb = XLSX.utils.book_new();
  snap.sheetOrder.forEach((sid) => {
    const sh = snap.sheets[sid], ws = {}; let maxR = 0, maxC = 0;
    Object.entries(snapCells(sh)).forEach(([ref, v]) => {
      const p = X.parseRef(ref); maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
      ws[ref] = v.f ? { t: 'n', f: v.f } : typeof v.v === 'number' ? { t: 'n', v: v.v } : typeof v.v === 'boolean' ? { t: 'b', v: v.v } : { t: 's', v: S(v.v) };
    });
    ws['!ref'] = 'A1:' + X.refOf(Math.max(1, maxR), Math.max(1, maxC));
    if (sh.mergeData && sh.mergeData.length) ws['!merges'] = sh.mergeData.map((m) => ({ s: { r: m.startRow, c: m.startColumn }, e: { r: m.endRow, c: m.endColumn } }));
    ws['!cols'] = Array.from({ length: maxC }, (_, i) => ({ wpx: (sh.columnData && sh.columnData[i] && sh.columnData[i].w) || 88 }));
    XLSX.utils.book_append_sheet(wb, ws, sh.name || 'Sheet1');
  });
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

/* ── 자료·지도 ── */
export function sheetText(snap, limit) {
  const L = [];
  (snap.sheetOrder || []).forEach((sid) => {
    const sh = snap.sheets[sid], cells = snapCells(sh), rows = {};
    Object.entries(cells).forEach(([ref, v]) => { const p = X.parseRef(ref); (rows[p.r] = rows[p.r] || []).push([p.c, v.f ? '=' + v.f : S(v.v)]); });
    L.push('[시트 ' + (sh.name || sid) + ']');
    Object.keys(rows).map(Number).sort((a, b) => a - b).forEach((r) => { L.push(rows[r].sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('\t')); });
  });
  const s = L.join('\n');
  return limit ? s.slice(0, limit) : s;
}
// AI에게 줄 지도: 시트마다 사용 범위·병합, 행마다 "셀 주소=값". 수식은 =수식 (값 …)으로.
export function sheetMap(snap, limit) {
  const L = []; let truncated = 0;
  (snap.sheetOrder || []).forEach((sid) => {
    const sh = withFormulas(snap.sheets[sid]), cells = snapCells(sh), rows = {};
    let maxR = 0, maxC = 0;
    Object.entries(cells).forEach(([ref, v]) => {
      const p = X.parseRef(ref); maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
      const raw = (sh.cellData[p.r - 1] || {})[p.c - 1] || {};
      const st = raw.s && snap.styles && snap.styles[raw.s], isDate = st && st.n && isDatePattern(st.n.pattern) && typeof v.v === 'number';
      if (isDate) { (rows[p.r] = rows[p.r] || []).push([p.c, ref + '=' + JSON.stringify(dateStr(v.v)) + '(날짜)']); return; }
      const shown = v.f ? '=' + v.f + (raw.v !== undefined && raw.v !== '' ? ' (값 ' + S(raw.v) + ')' : '') : JSON.stringify(typeof v.v === 'string' ? v.v : v.v);
      (rows[p.r] = rows[p.r] || []).push([p.c, ref + '=' + shown]);
    });
    L.push('[시트 "' + (sh.name || sid) + '"] 사용 범위 ' + (maxR ? 'A1:' + X.refOf(maxR, maxC) : '비어 있음') +
      ((sh.mergeData || []).length ? ', 병합 ' + sh.mergeData.map((m) => X.refOf(m.startRow + 1, m.startColumn + 1) + ':' + X.refOf(m.endRow + 1, m.endColumn + 1)).join(' ') : ''));
    Object.keys(rows).map(Number).sort((a, b) => a - b).forEach((r) => L.push(r + '행: ' + rows[r].sort((a, b) => a[0] - b[0]).map((x) => x[1]).join(' | ')));
  });
  let text = L.join('\n');
  if (limit && text.length > limit) { truncated = text.slice(limit).split('\n').length; text = text.slice(0, limit); }
  return { text, truncated };
}

/* ── AI ── */
export const SHEET_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    destination: { type: 'string', enum: ['current', 'new'] },
    newName: { type: 'string' },
    edits: { type: 'array', items: { type: 'object', properties: {
      op: { type: 'string', enum: ['set', 'fill', 'insert_rows', 'delete_rows', 'clear', 'format'] },
      sheet: { type: 'string' }, target: { type: 'string' }, text: { type: 'string' }, style: { type: 'string' },
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, count: { type: 'integer' }
    }, required: ['op', 'sheet', 'target', 'text', 'style', 'rows', 'count'] } }
  },
  required: ['reply', 'destination', 'newName', 'edits']
};
export function sheetPromptPart(name, map) {
  return [
    '[고칠 엑셀] ' + name,
    '[엑셀 현재 내용] 행마다 "셀 주소=값". 수식은 =수식 (값 계산 결과)로 적었다.',
    map,
    '',
    '[고치는 방법] 고칠 것은 edits 배열에 넣고, 시트 이름은 sheet에 적는다(시트가 하나면 그 이름).',
    '- target에는 셀 주소(C5)·범위(B4:D9)·행 번호(12)만 쓴다. text는 set에서 넣을 값에만 쓰고, 다른 작업에서는 ""로 둔다.',
    '- set: target 셀(예: C5)에 text를 넣는다. 수식은 =로 시작한다(예: =SUM(E4:E11)). 숫자는 숫자만 쓴다.',
    '- fill: target 셀(예: A4)을 왼쪽 위로 하여 rows(줄마다 칸 목록)를 차례로 채운다. rows의 칸에는 값만 쓴다. 예: [["9","2-3-9","김가람","2026-10-30","2"]] (A12=9처럼 주소를 붙이지 않는다). 명단처럼 여러 줄은 set 여러 개 대신 fill 한 번으로 쓴다.',
    '- 날짜는 2026-10-30처럼 쓴다. 지도에 (날짜)로 표시된 칸과 같은 열이면 날짜로 저장된다.',
    '- insert_rows: target 행 번호(숫자만, 예: 12) 앞에 행을 넣는다. 넣을 줄의 값을 rows에 함께 주면 그 줄 수만큼 넣고 A열부터 채운다(명단에 학생을 더할 때는 이 방법 하나만 쓴다. 예: {"op":"insert_rows","target":"12","rows":[["9","2-3-9","김가람","2026-10-30","2"]]}). rows 없이 빈 줄만 넣을 때는 count에 줄 수를 쓴다. 넣은 행은 바로 위 행의 모양을 따르고, 아래 수식의 범위도 함께 늘어난다.',
    '- delete_rows: target 행 번호부터 count개 행을 지운다. clear: target 범위(예: B4:D9)의 값을 지운다.',
    '- 작업은 적은 순서대로 한다. 행을 넣거나 지운 뒤의 set·fill 주소는 행 작업을 마친 뒤의 주소로 쓴다.',
    '- 명단 아래에 합계·평균 행이 있으면 그 행을 덮어쓰지 말고, insert_rows의 target을 합계 행 번호로 하고 rows에 새 줄 값을 담는다.',
    '- 이미 있는 머리글과 제목의 글은 바꾸지 않는다. 빈 칸에 새 머리글을 쓰는 것은 된다. 쓰지 않는 필드는 "", [], 0으로 둔다.',
    '- 표를 만들어 달라고 하면 머리글 줄과 값 줄을 rows에 담아 fill 한 번으로 빈 곳에 쓴다. 교사가 위치를 말하지 않았으면 지금 내용과 겹치지 않게 맨 아래 내용에서 한 줄을 띄운 곳의 A열부터 쓴다. 지금 명단에 칸만 더하면 되는 요청(예: 명단에 상담 날짜 칸 추가)은 머리글 줄 오른쪽 빈 칸에 새 머리글을 쓰고 그 아래를 채운다. 모르는 값은 빈 칸으로 두고 먼저 만든 뒤 reply에서 물어본다.',
    '- format: target 범위(예: A1:F1)의 모양을 바꾼다. style에 항목을 쉼표로 적는다. 다른 작업에서 style은 ""로 둔다.',
    '  역할 묶음: role:title(표 제목) · role:header(머리글 줄) · role:body(본문) · role:total(합계 줄) · role:note(참고). 색을 따로 고르지 말고 이 묶음을 먼저 쓴다.',
    '  낱개 항목: bold · bold:false · size:12 · color:red · fill:lightblue · fill:none · border:all · border:outer · border:bottom · border:none · align:left · align:center · align:right · valign:middle · wrap · wrap:false · width:14 · width:auto · height:24.',
    '  쓸 수 있는 색: navy blue red pink green yellow gray black white light lightblue lightred lightgreen lightyellow lightpink. 다른 색은 가장 가까운 이름으로 쓴다.',
    '  width는 target 범위의 열 너비(글자 수), width:auto는 내용에 맞춘 너비, height는 행 높이(포인트)다.',
    '- 꾸며 달라는 요청은 묻지 말고 바로 한다. 표마다 제목 줄 role:title, 머리글 줄 role:header, 값 줄 전체 role:body, 합계 줄이 있으면 role:total을 주고, 표 전체 범위에 width:auto를 준다. 값은 바꾸지 않는다. 표가 여러 개면 각각 따로 준다.',
    '- 새 표를 만들면 fill 뒤에 위와 같이 format도 함께 넣는다. 교사가 모양을 말하지 않아도 머리글과 테두리는 넣는다. 행을 넣거나 지운 뒤의 format 주소는 행 작업을 마친 뒤의 주소로 쓴다.',
    '- destination은 보통 "current"이고 newName은 ""다. 지금 표의 내용과 관계없는 새 표를 만들라는 요청이면 destination을 "new", newName을 짧은 표 이름으로 두고 모든 주소를 A1부터 쓴다. 지금 표에 덧붙이거나 지금 표를 바탕으로 만드는 표는 "current"다.',
    '- 열 넣기·지우기, 셀 병합은 할 수 없다. 이런 요청만 있으면 그 사실과 엑셀에서 하면 된다는 것만 reply에 한 문장으로 말한다. 이 제약 때문에 할 수 있는 나머지 요청을 거절하지 않는다.'
  ].join('\n');
}
/* ── 서식 지시 ── */
const NAVY = (window.FORMS_CONFIG && window.FORMS_CONFIG.sheetNavy) || '1E1E32'; // 머리글 색: 사이트 슬라이드 테마의 짙은 색
const PALETTE = { navy: NAVY, blue: '4285F4', red: 'EE3B2E', pink: 'EC2E7A', green: '34A853', yellow: 'F9AB00', gray: '80868B', black: '202124', white: 'FFFFFF',
  light: 'F6F6F9', lightblue: 'E9F1FE', lightred: 'FDEDEB', lightgreen: 'E7F4EB', lightyellow: 'FEF3DC', lightpink: 'FDEBF2' };
const ROLES = {
  title: { bold: true, size: 14, color: PALETTE.navy, align: 'left', valign: 'center' },
  header: { bold: true, color: PALETTE.white, fill: PALETTE.navy, align: 'center', valign: 'center', wrap: true, border: 'all' },
  body: { valign: 'center', border: 'all' },
  total: { bold: true, fill: PALETTE.light, valign: 'center', border: 'all' },
  note: { color: PALETTE.gray, size: 10 }
};
const ROLE_LABEL = { title: '표 제목', header: '머리글', body: '본문', total: '합계', note: '참고' };
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
// "role:header,align:left,width:auto" → { style, width, height, role, problems }. 모델이 JSON으로 보내도 읽히도록 기호를 먼저 벗긴다.
export function parseStyle(text) {
  const style = {}, out = { style, width: null, height: null, role: '', problems: [] };
  const bad = (w) => out.problems.push('알 수 없는 서식 항목을 건너뛰었습니다: ' + w);
  S(text).replace(/["'{}\[\]]/g, '').split(/[,;\s]+/).filter(Boolean).forEach((w) => {
    const m = /^([a-zA-Z]+)(?:[:=](.+))?$/.exec(w); if (!m) { bad(w); return; }
    const k = m[1].toLowerCase(), v = m[2] == null ? '' : m[2].toLowerCase(), off = v === 'false' || v === 'no' || v === '0';
    if (k === 'role' && ROLES[v]) { Object.assign(style, ROLES[v]); out.role = v; }
    else if (ROLES[k] && !v) { Object.assign(style, ROLES[k]); out.role = k; }
    else if (k === 'bold') style.bold = !off;
    else if (k === 'wrap') style.wrap = !off;
    else if (k === 'size' && num(v, 8, 36)) style.size = num(v, 8, 36);
    else if (k === 'color' && PALETTE[v]) style.color = PALETTE[v];
    else if (k === 'fill' && v === 'none') style.fill = 'none';
    else if (k === 'fill' && PALETTE[v]) style.fill = PALETTE[v];
    else if (k === 'border' && /^(all|outer|bottom|none)$/.test(v)) style.border = v;
    else if (k === 'align' && /^(left|center|right)$/.test(v)) style.align = v;
    else if (k === 'valign' && /^(top|middle|center|bottom)$/.test(v)) style.valign = v === 'middle' ? 'center' : v;
    else if (k === 'width' && v === 'auto') out.width = 'auto';
    else if (k === 'width' && num(v, 3, 80)) out.width = num(v, 3, 80);
    else if (k === 'height' && num(v, 10, 200)) out.height = num(v, 10, 200);
    else bad(w);
  });
  return out;
}
// A1 · A1:F9 · B:D(열) · 3:5(행) → 1부터 센 범위. 열·행 전체는 지금 쓰는 범위로 줄인다.
function areaOf(target, maxR, maxC) {
  const t = S(target).trim().toUpperCase().replace(/\$/g, '');
  let m;
  if ((m = /^([A-Z]{1,3}):([A-Z]{1,3})$/.exec(t))) return { r1: 1, r2: Math.max(1, maxR), c1: X.colNum(m[1]), c2: X.colNum(m[2]) };
  if ((m = /^(\d+):(\d+)$/.exec(t))) return { r1: +m[1], r2: +m[2], c1: 1, c2: Math.max(1, maxC) };
  const a = t.split(':'), p = X.parseRef(a[0]), q = X.parseRef(a[1] || a[0]);
  if (!p || !q || a.length > 2) return null;
  return { r1: Math.min(p.r, q.r), r2: Math.max(p.r, q.r), c1: Math.min(p.c, q.c), c2: Math.max(p.c, q.c) };
}
function textWidth(v) { // 표시 너비: 한글·한자 2칸, 나머지 1칸. 여러 줄이면 가장 긴 줄
  return S(v).split('\n').reduce((m, line) => Math.max(m, Array.from(line).reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)), 0);
}
// 칸이 화면에 보이는 너비. 날짜·숫자는 내부 값이 아니라 표시 형식으로 재야 #####로 잘리지 않는다.
function shownWidth(cell, styles) {
  const raw = cell.f ? (cell.v == null ? '' : cell.v) : cellVal(cell).v;
  const st = typeof cell.s === 'string' ? styles[cell.s] : cell.s, pattern = S(st && st.n && st.n.pattern).replace(/"[^"]*"|\[[^\]]*\]|[\\_*]/g, '');
  const w = textWidth(raw);
  if (typeof raw !== 'number' && !cell.f) return w;
  if (isDatePattern(pattern)) return Math.max(10, pattern.length);
  return Math.max(w, pattern.length);
}
// 편집기 화면에 그린다. 저장은 rowOps 기록으로 따로 한다.
function paint(ws, ref, st) {
  const r = ws.getRange(ref);
  painting = true;
  try {
    if (st.bold !== undefined) r.setFontWeight(st.bold ? 'bold' : 'normal');
    if (st.size) r.setFontSize(st.size);
    if (st.color) r.setFontColor('#' + st.color);
    if (st.fill) r.setBackgroundColor(st.fill === 'none' ? '#FFFFFF' : '#' + st.fill);
    if (st.align) r.setHorizontalAlignment(st.align === 'right' ? 'normal' : st.align);
    if (st.valign) r.setVerticalAlignment(st.valign === 'center' ? 'middle' : st.valign);
    if (st.wrap !== undefined) r.setWrap(st.wrap);
    if (st.border) {
      const type = { all: 'all', outer: 'outside', bottom: 'bottom', none: 'none' }[st.border];
      r.setBorder(type, 1, '#C7CBD1');
    }
  } finally { painting = false; }
}
function clean(s) {
  let v = S(s);
  const m = /^\s*\$?[A-Z]{1,3}\$?\d+\s*=\s*("[\s\S]*"|-?\d+(?:\.\d+)?)\s*$/.exec(v); if (m) v = m[1];
  const q = /^\s*"([\s\S]*)"\s*$/.exec(v); if (q) v = q[1].replace(/\\"/g, '"');
  if (/^[\s\[\],]+$/.test(v)) v = ''; // 배열 기호만 남은 조각(모델 출력이 깨진 경우)
  return v;
}
// 편집기에 넣을 셀 값. 글은 글로 못 박아 '2-3-10'이 날짜로 바뀌지 않게 한다(스타일은 그대로 둔다).
function cellObj(v) {
  if (typeof v === 'number') return { v, t: 2 };
  if (typeof v === 'boolean') return { v: v ? 1 : 0, t: 3 };
  const t = S(v);
  if (/^=/.test(t) && X.formulaOk(t.slice(1))) return { f: t };
  if (t === '') return { v: '' };
  return { v: t, t: 1 };
}
function isDatePattern(pat) { const p = S(pat).replace(/"[^"]*"|\[[^\]]*\]/g, ''); return /[yd]/i.test(p) || /m{1,2}[^a-z]*d/i.test(p); }
function serial(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); }
function dateStr(n) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); return d.toISOString().slice(0, 10); }
function typed(s, dateCell) {
  const v = clean(s);
  if (dateCell) { const m = /^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/.exec(v.trim()); if (m) return serial(+m[1], +m[2], +m[3]); }
  if (/^=/.test(v.trim())) return X.formulaOk(v.trim().slice(1)) ? v.trim() : v; // 깨진 수식은 글로
  const n = v.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(n) && n.length < 16 && !/^-?0\d/.test(n)) return Number(n);
  if (/^(TRUE|FALSE)$/i.test(n)) return /^TRUE$/i.test(n);
  return v;
}
// AI 고치기를 편집기에 적용한다(편집기에 올라온 탭만). 바뀐 칸 목록과 문제를 돌려준다.
export function applySheetEdits(t, edits) {
  const changes = [], problems = [];
  if (!cur || cur.t !== t) { problems.push('엑셀이 편집기에 열려 있지 않아 고치지 못했습니다.'); return { changes, problems }; }
  const wb = cur.wb, sheets = wb.getSheets();
  const sheetOf = (name) => { const n = S(name).trim(); return (n && wb.getSheetByName(n)) || (sheets.length === 1 || !n ? wb.getActiveSheet() : null); };
  const before = (ws, ref) => { try { const v = ws.getRange(ref).getValue(); return v == null ? '' : S(v); } catch (e) { return ''; } };
  let snapCache = null;
  const fresh = () => { snapCache = null; };
  const dateAt = (ws, r, c) => { // 1부터 센 행·열의 칸이 날짜 서식인가(스냅숏은 작업마다 한 번 만든다)
    const snap = snapCache || (snapCache = cur.wb.save()), sh = snap.sheets[ws.getSheetId()], cell = sh && sh.cellData[r - 1] && sh.cellData[r - 1][c - 1];
    const st = cell && cell.s && snap.styles && snap.styles[cell.s];
    return !!(st && st.n && isDatePattern(st.n.pattern));
  };
  const inserted = []; // { ws, r, n } 넣은 행(뒤 작업으로 밀리면 함께 옮긴다)
  (Array.isArray(edits) ? edits : []).forEach((e) => {
    if (!e || typeof e !== 'object') return;
    fresh();
    const ws = sheetOf(e.sheet);
    if (!ws) { problems.push('없는 시트라 고치지 못했습니다: ' + S(e.sheet)); return; }
    const sname = ws.getSheetName(), label = (r) => (sheets.length > 1 ? sname + '!' : '') + r;
    try {
      if (e.op === 'set') {
        const ref = S(e.target).trim().toUpperCase(); if (!X.parseRef(ref)) throw new Error('셀 주소가 아닙니다: ' + e.target);
        const pr = X.parseRef(ref), b = before(ws, ref), v = typed(e.text, dateAt(ws, pr.r, pr.c));
        ws.getRange(ref).setValue(cellObj(v));
        changes.push({ label: label(ref), before: b, after: S(e.text) });
      } else if (e.op === 'fill') {
        // 모델이 주소를 text에 넣는 경우가 있어, target이 주소가 아니면 text를 본다.
        const p = X.parseRef(S(e.target).trim()) || X.parseRef(S(e.text).trim()); if (!p) throw new Error('셀 주소가 아닙니다: ' + e.target);
        const rows = (Array.isArray(e.rows) ? e.rows : []).map((r) => (Array.isArray(r) ? r : [r]));
        const w = rows.reduce((m, r) => Math.max(m, r.length), 0); if (!rows.length || !w) throw new Error('채울 값이 없습니다.');
        const dcols = Array.from({ length: w }, (_, i) => dateAt(ws, p.r, p.c + i));
        const vals = rows.map((r, ri) => Array.from({ length: w }, (_, i) => typed(r[i] == null ? '' : r[i], dcols[i] || dateAt(ws, p.r + ri, p.c + i))));
        const end = X.refOf(p.r + rows.length - 1, p.c + w - 1);
        // 채우기가 합계 같은 수식 칸에 걸리면 그 칸은 덮어쓰지 않는다(주소를 잘못 잡은 경우의 피해를 막는다).
        const sh = cur.wb.save().sheets[ws.getSheetId()], kept = [];
        const objs = vals.map((r, ri) => r.map((v, i) => {
          const old = sh && sh.cellData[p.r - 1 + ri] && sh.cellData[p.r - 1 + ri][p.c - 1 + i];
          if (old && old.f) { kept.push(X.refOf(p.r + ri, p.c + i)); return { f: old.f }; }
          return cellObj(v);
        }));
        ws.getRange(X.refOf(p.r, p.c) + ':' + end).setValues(objs);
        if (kept.length) problems.push('수식이 있는 칸은 덮어쓰지 않았습니다: ' + kept.map(label).join(', ') + '. 채울 위치가 맞는지 확인해 주세요.');
        changes.push({ label: label(X.refOf(p.r, p.c) + ':' + end), before: '', after: rows.length + '줄 × ' + w + '칸' });
      } else if (e.op === 'insert_rows' || e.op === 'delete_rows') {
        const r = parseInt(S(e.target).replace(/[^\d]/g, ''), 10) || (/^\s*\d+\s*$/.test(S(e.text)) ? parseInt(e.text, 10) : 0), n = Math.max(1, Math.min(200, parseInt(e.count, 10) || 1));
        if (!r) throw new Error('행 번호가 아닙니다: ' + e.target);
        if (e.op === 'insert_rows') {
          // rows를 함께 주면 넣은 줄을 A열부터 바로 채운다(줄 수는 rows 수). 주소를 두 번 잡다 틀리는 일을 줄인다.
          const data = (Array.isArray(e.rows) ? e.rows : []).map((x) => (Array.isArray(x) ? x : [x])).filter((x) => x.some((v) => S(v).trim()));
          const k = data.length || n;
          ws.insertRowsBefore(r - 1, k); fresh(); changes.push({ label: label(r + '행 앞'), before: '', after: k + '행 넣기' });
          inserted.forEach((x) => { if (x.ws.getSheetId() === ws.getSheetId() && x.r >= r) x.r += k; });
          inserted.push({ ws, r, n: k });
          extendTotals(ws, r, k, changes, label);
          if (data.length) {
            const w = data.reduce((m, x) => Math.max(m, x.length), 0);
            const objs = data.map((x, ri) => Array.from({ length: w }, (_, i) => cellObj(typed(x[i] == null ? '' : x[i], dateAt(ws, r + ri, 1 + i)))));
            const end = X.refOf(r + k - 1, w);
            ws.getRange('A' + r + ':' + end).setValues(objs);
            changes.push({ label: label('A' + r + ':' + end), before: '', after: k + '줄 × ' + w + '칸' });
          }
        }
        else {
          ws.deleteRows(r - 1, n); changes.push({ label: label(r + '~' + (r + n - 1) + '행'), before: '행 지우기', after: '' });
          inserted.forEach((x) => { if (x.ws.getSheetId() === ws.getSheetId() && x.r > r) x.r = Math.max(r, x.r - n); });
        }
      } else if (e.op === 'clear') {
        const ref = S(e.target).trim().toUpperCase(); const ps = ref.split(':').map(X.parseRef);
        if (!ps[0] || (ps[1] === undefined ? false : !ps[1])) throw new Error('범위가 아닙니다: ' + e.target);
        ws.getRange(ref).clearContent();
        changes.push({ label: label(ref), before: '값', after: '지움' });
      } else if (e.op === 'format') {
        const f = parseStyle(S(e.style).trim() ? e.style : e.text);
        f.problems.forEach((p) => problems.push(p));
        const saved = cur.wb.save(), snapStyles = saved.styles || {};
        const sh = withFormulas(saved.sheets[ws.getSheetId()]), used = Object.keys(snapCells(sh)).map(X.parseRef);
        const maxR = used.reduce((m, p) => Math.max(m, p.r), 0), maxC = used.reduce((m, p) => Math.max(m, p.c), 0);
        const a = areaOf(e.target, maxR, maxC); if (!a) throw new Error('범위가 아닙니다: ' + e.target);
        if ((a.r2 - a.r1 + 1) * (a.c2 - a.c1 + 1) > 20000) throw new Error('범위가 너무 넓어 서식을 넣지 않았습니다: ' + e.target);
        const range = X.refOf(a.r1, a.c1) + (a.r1 === a.r2 && a.c1 === a.c2 ? '' : ':' + X.refOf(a.r2, a.c2));
        const done = [];
        if (Object.keys(f.style).length) {
          paint(ws, range, f.style);
          t.rowOps.push({ sheetId: ws.getSheetId(), op: 'format', range, style: f.style });
          done.push(ROLE_LABEL[f.role] || '글자 모양');
        }
        if (f.width !== null) {
          const merged = (sh.mergeData || []).filter((m) => m.startColumn !== m.endColumn);
          for (let c = a.c1; c <= a.c2; c++) {
            let w = f.width;
            if (w === 'auto') {
              let longest = 0;
              for (let r = a.r1; r <= a.r2; r++) {
                const cell = (sh.cellData[r - 1] || {})[c - 1];
                if (!cell || merged.some((m) => r - 1 >= m.startRow && r - 1 <= m.endRow && c - 1 >= m.startColumn && c - 1 <= m.endColumn)) continue;
                longest = Math.max(longest, shownWidth(cell, snapStyles));
              }
              w = Math.min(40, Math.max(6, longest + 2));
            }
            ws.setColumnWidth(c - 1, Math.round(w * 7 + 5));
            t.rowOps.push({ sheetId: ws.getSheetId(), op: 'colWidth', col: c, width: w });
          }
          done.push('열 너비');
        }
        if (f.height !== null) {
          for (let r = a.r1; r <= a.r2; r++) {
            ws.setRowHeight(r - 1, Math.round(f.height * 96 / 72));
            t.rowOps.push({ sheetId: ws.getSheetId(), op: 'rowHeight', row: r, height: f.height });
          }
          done.push('행 높이');
        }
        if (!done.length) throw new Error('바꿀 모양이 없어 ' + S(e.target) + ' 서식을 그대로 두었습니다.');
        changes.push({ label: label(range), before: '', after: done.join('·') + ' 서식' });
      }
    } catch (err) { problems.push((err && err.message) || String(err)); }
  });
  // 넣은 행이 끝까지 비어 있으면 알린다(AI가 채웠다고 답했어도 실제 표로 확인한다).
  const snapNow = inserted.length ? cur.wb.save() : null, empty = [];
  inserted.forEach((x) => {
    const sh = snapNow.sheets[x.ws.getSheetId()];
    for (let k = 0; k < x.n; k++) {
      const row = sh.cellData[x.r - 1 + k] || {};
      if (!Object.values(row).some((c) => c && (c.f || (c.v !== undefined && c.v !== null && c.v !== '')))) empty.push((sheets.length > 1 ? x.ws.getSheetName() + '!' : '') + (x.r + k) + '행');
    }
  });
  return { changes, problems, emptyRows: empty };
}
// 합계 행 바로 앞에 줄을 넣으면 엑셀은 SUM(E4:E11)의 범위를 늘리지 않는다. 교사가 바라는 대로, 넣은 줄 아래의 수식 가운데
// 범위 끝이 넣은 자리 바로 위(r-1행)인 것만 넣은 줄까지 늘린다.
function extendTotals(ws, r, n, changes, label) {
  const sid = ws.getSheetId(), sh0 = cur.wb.save().sheets[sid]; if (!sh0) return;
  const sh = withFormulas(sh0);
  Object.entries(sh.cellData || {}).forEach(([ri, row]) => {
    if (+ri < r - 1 + n) return;
    Object.entries(row || {}).forEach(([ci, cell]) => {
      if (!cell || !cell.f) return;
      const f = S(cell.f);
      const nf = f.replace(/("[^"]*")|((?:'[^']*'|[^\s(),:=+\-*/&^<>!]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|(\$?[A-Z]{1,3})(\$?)(\d+):(\$?[A-Z]{1,3})(\$?)(\d+)/g,
        (m, str, other, c1, a1, r1, c2, a2, r2) => (str || other || +r2 !== r - 1 || +r1 >= r - 1 ? m : c1 + a1 + r1 + ':' + c2 + a2 + (r - 1 + n)));
      if (nf === f) return;
      const ref = X.refOf(+ri + 1, +ci + 1);
      ws.getRange(ref).setValue(nf);
      changes.push({ label: label(ref) + ' 수식 범위', before: f, after: nf });
    });
  });
}
export function checkSheet(snap, fillChanges, emptyRows) {
  const errs = [];
  (snap.sheetOrder || []).forEach((sid) => {
    const sh = snap.sheets[sid];
    Object.entries(sh.cellData || {}).forEach(([r, row]) => Object.entries(row || {}).forEach(([c, cell]) => {
      if (cell && ERR.test(S(cell.v))) errs.push((snap.sheetOrder.length > 1 ? sh.name + '!' : '') + X.refOf(+r + 1, +c + 1) + '(' + cell.v + ')');
    }));
  });
  const out = ['바꾼 곳 ' + fillChanges + '군데'];
  if (emptyRows && emptyRows.length) out.push('넣었지만 비어 있는 행: ' + emptyRows.join(', '));
  if (errs.length) out.push('수식 오류 칸: ' + errs.slice(0, 8).join(', ') + (errs.length > 8 ? ' 외 ' + (errs.length - 8) + '칸' : ''));
  return out;
}

/* ── 새 엑셀 요청 판별 ── */
const SHEET_CREATE = /(?:엑셀|스프레드\s*시트|xlsx)\s*(?:파일|표)?(?:를|을|로|으로|에)?\s*(?:새로\s*)?(?:만들|옮겨|정리해\s*줘|바꿔\s*줘)/i;
// 고치거나 만들라는 요청인가. 답만 비어 돌아오면 한 번 다시 부탁할 때 쓴다(할 수 없는 일·질문은 뺀다).
export function wantsSheetAction(text) {
  const t = S(text).trim();
  if (/[?？]\s*$|(까요|나요|뭐야|무엇|왜|어때|있어|방법)\s*[.!]?\s*$/.test(t)) return false;
  if (/병합|합쳐|열\s*(넣|추가|지워|삭제)|시트\s*(추가|삭제|이름)/.test(t)) return false;
  return /만들|작성|채워|채우|넣어|추가|꾸며|꾸미|다듬|예쁘|서식|굵게|색|테두리|가운데|너비|높이|표로/.test(t);
}
export function isSheetRequest(text) { return SHEET_CREATE.test(S(text)); }
export function mentionsSheet(text) { return /(엑셀|xlsx|스프레드\s*시트)\s*(?:파일|표)?\s*(?:에서|을|를|의)\s*\S/i.test(S(text)) && !/(엑셀|xlsx)[^.?!]{0,12}(?:로|으로|를 보고|을 보고|에 있는)[^.?!]{0,30}(한글|문서|양식|계획서|칸)/i.test(S(text)); }
// 시험용(화면 동작에는 쓰지 않음)
export function _debug() { return { api, cur }; }
