/* 업무 양식 AI·문서작성 AI — 자료 파일 읽기 (PDF·엑셀·파워포인트·한글·붙여넣기·이미지)
 *
 * 각 읽기 함수는 { text, preview, note } 를 돌려준다.
 *   text    : AI에게 보낼 글(자료). 쪽·시트·슬라이드 표시를 붙인다.
 *   preview : 오른쪽 미리보기용 데이터(형식마다 다르다)
 *   note    : 교사에게 알릴 한계(예: 글자가 없는 스캔 쪽)
 * 모두 브라우저 안에서만 처리한다. 서버로 보내지 않는다.
 */
import * as pdfjs from './lib/pdfjs/pdf.min.js';

const PDFJS_BASE = new URL('./lib/pdfjs/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';

export const KIND_OF = (name) => {
  const n = String(name || '').toLowerCase();
  if (/\.(hwpx|hwp)$/.test(n)) return 'hwp';
  if (/\.pdf$/.test(n)) return 'pdf';
  if (/\.(xlsx|xls|csv)$/.test(n)) return 'xlsx';
  if (/\.pptx$/.test(n)) return 'pptx';
  if (/\.(txt|md)$/.test(n)) return 'text';
  if (/\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/.test(n)) return 'image';
  return '';
};
export const KIND_LABEL = { hwp: '한글', pdf: 'PDF', xlsx: '엑셀', pptx: '파워포인트', text: '글', paste: '붙여넣기', slides: 'PPT', image: '이미지' };

/* ── 이미지(캡처·사진): AI에게 그림으로 함께 보낸다 ──
 * 긴 변이 IMG_MAX_SIDE를 넘으면 줄이고, 그래도 IMG_MAX_BYTES를 넘으면 JPEG 품질을 낮춘다.
 * 서버 AI(Claude)의 이미지 한도 5MB는 base64 기준이라 원본 3.5MB(base64 약 4.7MB)를 상한으로 둔다. */
export const IMG_MAX_SIDE = 2000;
export const IMG_MAX_BYTES = 3.5 * 1024 * 1024;
export const IMG_SEND_MAX = 6;                 // 한 번에 보내는 이미지 장수
// 서버 본문 한도 15MB: base64(4/3배)에 첫 장이 한 번 더 실리므로(serverLlm.ts) 원본 합계 6.5MB로 둔다.
export const IMG_SEND_TOTAL = 6.5 * 1024 * 1024;
// GIF는 Gemini가 받지 않아 PNG로 바꿔 보낸다.
const IMG_KEEP = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const IMAGE_TEXT = '[이미지] 이 요청에 그림으로 함께 첨부했다. 그림에 보이는 내용만 근거로 쓰고, 읽을 수 없는 부분은 지어내지 않는다.';
export function imageMime(file) {
  const t = String((file && file.type) || '').toLowerCase();
  if (t) return t === 'image/jpg' ? 'image/jpeg' : t;
  const n = String((file && file.name) || '').toLowerCase();
  if (/\.png$/.test(n)) return 'image/png';
  if (/\.jpe?g$/.test(n)) return 'image/jpeg';
  if (/\.gif$/.test(n)) return 'image/gif';
  if (/\.webp$/.test(n)) return 'image/webp';
  return '';
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
// 그림을 연다. 브라우저가 열지 못하는 형식(HEIC 등)이면 오류를 낸다.
async function decodeImage(blob) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch (e) { /* 아래 img 경로로 한 번 더 */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
// { text, preview:{ url, width, height }, note, image:{ mimeType, data(base64) }, size }
export async function readImage(bytes, file) {
  const mime0 = imageMime(file);
  const blob0 = new Blob([bytes], { type: mime0 || 'application/octet-stream' });
  let img;
  try { img = await decodeImage(blob0); }
  catch (e) { throw new Error('이 그림 형식은 브라우저가 열지 못합니다. PNG나 JPG로 저장하거나 화면을 캡처해 붙여 넣어 주세요.'); }
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  if (!w0 || !h0) throw new Error('그림의 크기를 읽지 못했습니다.');
  const scale = Math.min(1, IMG_MAX_SIDE / Math.max(w0, h0));
  let outBlob = null, note = '';
  if (scale === 1 && IMG_KEEP.has(mime0) && bytes.length <= IMG_MAX_BYTES) {
    outBlob = blob0; // 그대로 보낸다
  } else {
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    // 투명 배경 PNG를 JPEG로 바꿀 때 검게 되지 않게 흰 바탕을 깐다.
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    if (mime0 === 'image/png' || mime0 === 'image/gif') {
      const png = await canvasBlob(c, 'image/png');
      if (png && png.size <= IMG_MAX_BYTES) outBlob = png;
    }
    for (const q of [0.9, 0.8, 0.7, 0.55, 0.4]) {
      if (outBlob) break;
      const jpg = await canvasBlob(c, 'image/jpeg', q);
      if (jpg && jpg.size <= IMG_MAX_BYTES) outBlob = jpg;
    }
    if (!outBlob) throw new Error('그림이 너무 커서 줄여도 3.5MB를 넘습니다. 필요한 부분만 캡처해 주세요.');
    if (scale < 1) note = '크기를 줄여 보냅니다(원본 ' + w0 + '×' + h0 + ', 보내는 크기 ' + w + '×' + h + ').';
  }
  if (img.close) img.close();
  const out = new Uint8Array(await outBlob.arrayBuffer());
  const mimeType = outBlob.type || mime0;
  return {
    text: IMAGE_TEXT,
    preview: { url: URL.createObjectURL(outBlob), width: w0, height: h0 },
    note,
    image: { mimeType, data: bytesToBase64(out) },
    size: out.length
  };
}

/* ── PDF ── */
export async function openPdf(bytes) {
  // pdf.js는 넘겨받은 버퍼를 워커로 옮겨 비우므로 복사본을 넘긴다.
  return pdfjs.getDocument({ data: bytes.slice(0), cMapUrl: PDFJS_BASE + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_BASE + 'standard_fonts/' }).promise;
}
export async function readPdf(bytes) {
  const doc = await openPdf(bytes);
  const parts = [], empty = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // 같은 줄(y가 비슷한) 조각을 이어 붙이고 줄이 바뀌면 줄바꿈한다.
    let lastY = null, line = '', lines = [];
    tc.items.forEach((it) => {
      if (!('str' in it)) return;
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { if (line.trim()) lines.push(line.trim()); line = ''; }
      line += it.str + (it.hasEOL ? '' : '');
      lastY = y;
    });
    if (line.trim()) lines.push(line.trim());
    const text = lines.join('\n');
    if (text.replace(/\s/g, '').length < 10) empty.push(p);
    parts.push('[' + p + '쪽]\n' + text);
  }
  const note = empty.length
    ? '글자가 없는 쪽 ' + empty.length + '개(' + empty.slice(0, 8).join(', ') + (empty.length > 8 ? ' …' : '') + '쪽)는 스캔 이미지라 아직 읽지 못합니다. 필요한 내용은 요청 칸에 글로 적어 주세요.'
    : '';
  return { text: parts.join('\n\n'), preview: { doc }, note, pages: doc.numPages };
}

/* ── 엑셀·CSV ── */
export async function readSheet(bytes, name) {
  if (!window.XLSX) throw new Error('엑셀 읽기 모듈을 불러오지 못했습니다. 새로 고침해 주세요.');
  let wb;
  if (/\.csv$/i.test(name)) wb = XLSX.read(decodeText(bytes), { type: 'string' });
  else wb = XLSX.read(bytes, { type: 'array' });
  const sheets = wb.SheetNames.map((s) => ({ name: s, rows: XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, defval: '', blankrows: false }) }));
  const text = sheets.map((s) => (sheets.length > 1 ? '[시트: ' + s.name + ']\n' : '') + s.rows.map((r) => r.join('\t')).join('\n')).join('\n\n');
  return { text, preview: { sheets }, note: '' };
}

/* ── 파워포인트: 슬라이드 순서대로 글과 표를 뽑는다(디자인은 자료로 쓰지 않는다) ── */
export async function readPptx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml$/)[1] - +b.match(/(\d+)\.xml$/)[1]);
  const slides = [];
  for (const n of names) {
    const xml = new DOMParser().parseFromString(await zip.file(n).async('string'), 'application/xml');
    const paras = [];
    Array.from(xml.getElementsByTagName('*')).forEach((el) => {
      if (el.localName !== 'p' || el.namespaceURI.indexOf('drawingml') < 0) return;
      const t = Array.from(el.getElementsByTagName('*')).filter((x) => x.localName === 't').map((x) => x.textContent).join('');
      if (t.trim()) paras.push(t.trim());
    });
    // 발표자 노트도 자료가 된다.
    const noteName = n.replace('slides/slide', 'notesSlides/notesSlide');
    let notes = '';
    if (zip.file(noteName)) {
      const nx = new DOMParser().parseFromString(await zip.file(noteName).async('string'), 'application/xml');
      notes = Array.from(nx.getElementsByTagName('*')).filter((x) => x.localName === 't').map((x) => x.textContent).join(' ').trim();
      if (/^\d+$/.test(notes)) notes = '';
    }
    slides.push({ paras, notes });
  }
  const text = slides.map((s, i) => '[슬라이드 ' + (i + 1) + ']\n' + s.paras.join('\n') + (s.notes ? '\n(발표자 노트) ' + s.notes : '')).join('\n\n');
  return { text, preview: { slides }, note: slides.length ? '' : '슬라이드에서 글을 찾지 못했습니다.' };
}

/* ── 글 파일 ── */
export function readText(bytes) {
  const text = decodeText(bytes);
  return { text, preview: { text }, note: '' };
}

/* ── 붙여넣기: 표(HTML)는 탭으로 구분한 줄로, 나머지는 글 그대로 ── */
export function readPaste(clip) {
  const html = clip.getData('text/html');
  if (html && /<table/i.test(html)) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    const tables = Array.from(d.querySelectorAll('table')).map((t) =>
      Array.from(t.rows).map((r) => Array.from(r.cells).map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
    if (tables.length) {
      const sheets = tables.map((rows, i) => ({ name: '표 ' + (i + 1), rows }));
      return { text: sheets.map((s) => s.rows.map((r) => r.join('\t')).join('\n')).join('\n\n'), preview: { sheets }, note: '' };
    }
  }
  const text = clip.getData('text/plain');
  return { text, preview: { text }, note: '' };
}

/* ── 링크로 가져오기 (사이트 설정 FORMS_CONFIG.linkReader가 있을 때만 쓴다) ──
 * 서버 함수는 주소의 글을 블록으로 돌려주거나(html) PDF 바이트를 base64로 돌려준다. 실패는 { ok:false, reason, message }.
 * 서버는 받은 글을 저장하지 않는다. 아래 함수들은 응답을 자료 탭에 넣을 모양으로 바꾸기만 한다. */
const cellMd = (s) => String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
export function blocksToMarkdown(blocks) {
  const out = [];
  (Array.isArray(blocks) ? blocks : []).forEach((b) => {
    if (!b || typeof b !== 'object') return;
    if (b.type === 'heading') {
      const t = String(b.text || '').replace(/\s+/g, ' ').trim();
      const lv = Math.min(4, Math.max(1, Number(b.level) || 2));
      if (t) out.push('#'.repeat(lv) + ' ' + t);
    } else if (b.type === 'paragraph') {
      const t = String(b.text || '').trim();
      if (t) out.push(t);
    } else if (b.type === 'list') {
      const items = (Array.isArray(b.items) ? b.items : []).map((x) => String(x || '').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
      if (items.length) out.push(items.map((x, i) => (b.ordered ? (i + 1) + '. ' : '- ') + x).join('\n'));
    } else if (b.type === 'table') {
      const rows = (Array.isArray(b.rows) ? b.rows : []).filter((r) => Array.isArray(r) && r.length);
      if (!rows.length) return;
      const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
      const line = (r) => '| ' + Array.from({ length: cols }, (_, i) => cellMd(r[i])).join(' | ') + ' |';
      out.push([line(rows[0]), '|' + ' --- |'.repeat(cols), ...rows.slice(1).map(line)].join('\n'));
    }
  });
  return out.join('\n\n');
}
export function base64ToBytes(b64) {
  const s = atob(String(b64 || ''));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
// 입력한 주소를 다듬는다. 주소가 아니면 빈 문자열.
export function normalizeLink(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname || (!/[.:]/.test(u.hostname) && u.hostname !== 'localhost')) return '';
    return u.href;
  } catch (e) { return ''; }
}
// 서버 함수를 불러 응답을 그대로 돌려준다. 연결 실패·이상한 응답은 { ok:false, reason:'network' }로 바꾼다.
export async function fetchLink(endpoint, url, signal) {
  let r;
  try {
    r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal });
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, reason: 'timeout', message: '주소를 읽는 데 너무 오래 걸려 멈췄습니다.' };
    return { ok: false, reason: 'network', message: '주소를 읽어 오지 못했습니다. 인터넷 연결을 확인해 주세요.' };
  }
  let d = null;
  try { d = await r.json(); } catch (e) { d = null; }
  if (!d || typeof d !== 'object' || typeof d.ok !== 'boolean') return { ok: false, reason: 'network', message: '주소를 읽어 오지 못했습니다(' + r.status + '). 잠시 뒤 다시 해 주세요.' };
  if (!d.ok) return { ok: false, reason: String(d.reason || 'network'), message: String(d.message || '이 주소의 글을 읽지 못했습니다.') };
  if (d.kind === 'html' && Array.isArray(d.blocks)) return d;
  if (d.kind === 'pdf' && typeof d.base64 === 'string' && d.base64) return d;
  return { ok: false, reason: 'unsupported', message: '이 주소의 글을 읽지 못했습니다.' };
}
// 탭 이름: 제목, 없으면 호스트 이름.
export function linkTabName(title, url) {
  const t = String(title || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 80);
  try { return new URL(url).hostname || '링크 자료'; } catch (e) { return '링크 자료'; }
}

export function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('euc-kr').decode(bytes); }
}
