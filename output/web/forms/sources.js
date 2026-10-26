/* 업무 양식 AI — 자료 파일 읽기 (PDF·엑셀·파워포인트·한글·붙여넣기)
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
  return '';
};
export const KIND_LABEL = { hwp: '한글', pdf: 'PDF', xlsx: '엑셀', pptx: '파워포인트', text: '글', paste: '붙여넣기', slides: 'PPT' };

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

export function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('euc-kr').decode(bytes); }
}
