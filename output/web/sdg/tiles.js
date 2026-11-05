// 피그마 PDF·PNG를 브라우저에서 JPEG 조각으로 바꾼다. 16920×1244처럼 긴 한 장은 글자가 읽히도록 잘라서 보낸다.
export const MAX_TILES = 20;
const MAX_EDGE = 1568; // 이보다 크면 API가 축소해 글자가 흐려진다.
const MAX_CANVAS = 16000;
const TARGET_SHORT = 1100; // 긴 한 장을 렌더링할 때 짧은 변의 목표 크기

/** 긴 축을 따라 자를 때 조각 크기와 수를 계산한다. 조각끼리 조금 겹친다. */
export function tilePlan(w, h) {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (long <= MAX_EDGE || long / short <= 1.6) return { count: 1, tile: long };
  const tile = Math.min(MAX_EDGE, Math.round(short * 1.3));
  if (long <= tile) return { count: 1, tile: long };
  const overlap = Math.round(tile * 0.03);
  return { count: Math.ceil((long - overlap) / (tile - overlap)), tile };
}

/** 전체 조각 수가 상한 안에 들어오는 배율을 찾는다. sizes는 [{w,h}] 원본 크기. */
export function fitScale(sizes) {
  const longest = Math.max(...sizes.map(({ w, h }) => Math.max(w, h)));
  const shortest = Math.max(...sizes.map(({ w, h }) => Math.min(w, h)));
  let scale = Math.min(TARGET_SHORT / shortest, MAX_CANVAS / longest, 2);
  const total = (s) => sizes.reduce((sum, { w, h }) => sum + tilePlan(w * s, h * s).count, 0);
  while (total(scale) > MAX_TILES && scale > 0.05) scale *= 0.9;
  return scale;
}

function toJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('변환 실패'))), 'image/jpeg', 0.85);
  });
}

/** 캔버스를 조각으로 잘라 JPEG Blob 배열을 돌려준다. */
export async function sliceCanvas(src) {
  const { width: w, height: h } = src;
  const { count, tile } = tilePlan(w, h);
  const horizontal = w >= h;
  const long = horizontal ? w : h;
  const step = count === 1 ? 0 : (long - tile) / (count - 1);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.round(step * i);
    const sw = count === 1 ? w : horizontal ? tile : w;
    const sh = count === 1 ? h : horizontal ? h : tile;
    const shrink = Math.min(1, MAX_EDGE / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * shrink);
    c.height = Math.round(sh * shrink);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, count > 1 && horizontal ? start : 0, count > 1 && !horizontal ? start : 0, sw, sh, 0, 0, c.width, c.height);
    out.push(await toJpeg(c));
    c.width = 0;
  }
  return out;
}

async function renderPdf(file, onProgress) {
  const pdfjs = await import('/sdg/vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/sdg/vendor/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  try {
    if (doc.numPages > MAX_TILES) throw new Error(`PDF는 ${MAX_TILES}쪽까지 올릴 수 있습니다. (현재 ${doc.numPages}쪽)`);
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) pages.push(await doc.getPage(i));
    const scale = fitScale(pages.map((p) => { const v = p.getViewport({ scale: 1 }); return { w: v.width, h: v.height }; }));
    const tiles = [];
    for (let i = 0; i < pages.length; i += 1) {
      onProgress?.(`PDF ${i + 1}/${pages.length}쪽 처리 중입니다.`);
      const viewport = pages[i].getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await pages[i].render({ canvasContext: canvas.getContext('2d'), viewport, background: 'white' }).promise;
      tiles.push(...await sliceCanvas(canvas));
      canvas.width = 0;
    }
    return tiles;
  } finally {
    await doc.destroy();
  }
}

async function renderPngs(files, onProgress) {
  const bitmaps = [];
  try {
    for (const f of files) bitmaps.push(await createImageBitmap(f));
    const scale = fitScale(bitmaps.map((b) => ({ w: b.width, h: b.height })));
    const tiles = [];
    for (let i = 0; i < bitmaps.length; i += 1) {
      onProgress?.(`이미지 ${i + 1}/${bitmaps.length}장 처리 중입니다.`);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmaps[i].width * scale);
      canvas.height = Math.round(bitmaps[i].height * scale);
      canvas.getContext('2d').drawImage(bitmaps[i], 0, 0, canvas.width, canvas.height);
      tiles.push(...await sliceCanvas(canvas));
      canvas.width = 0;
    }
    return tiles;
  } finally {
    bitmaps.forEach((b) => b.close());
  }
}

/** 선택한 파일을 검사한 뒤 JPEG 조각으로 변환한다. 조건에 맞지 않으면 안내 문구와 함께 예외를 던진다. */
export async function filesToTiles(fileList, onProgress) {
  const files = [...fileList];
  if (files.length === 0) throw new Error('PDF 또는 PNG 파일을 골라 주세요.');
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  const pngs = files.filter((f) => /\.png$/i.test(f.name) || f.type === 'image/png');
  if (pdfs.length + pngs.length !== files.length) throw new Error('PDF 또는 PNG 파일만 올릴 수 있습니다.');
  if (pdfs.length && pngs.length) throw new Error('PDF와 PNG를 섞어 올릴 수 없습니다. 한 종류만 골라 주세요.');
  if (pdfs.length > 1) throw new Error('PDF는 1개만 올릴 수 있습니다.');
  if (pngs.length > MAX_TILES) throw new Error(`PNG는 ${MAX_TILES}장까지 올릴 수 있습니다.`);
  if (files.some((f) => f.size > 30 * 1024 * 1024)) throw new Error('파일 하나의 크기는 30MB 이하여야 합니다.');
  let tiles;
  try {
    tiles = pdfs.length ? await renderPdf(pdfs[0], onProgress) : await renderPngs(pngs, onProgress);
  } catch (err) {
    if (/쪽까지/.test(err.message)) throw err;
    throw new Error('파일을 읽지 못했습니다. 피그마에서 다시 내보낸 뒤 올려 주세요.');
  }
  if (tiles.length > MAX_TILES) throw new Error('화면이 너무 많습니다. 주요 화면만 남기고 다시 올려 주세요.');
  return tiles;
}
