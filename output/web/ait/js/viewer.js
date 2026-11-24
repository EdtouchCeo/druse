// 슬라이드와 교과서 쪽을 무대에 그린다. 이웃 장을 미리 불러 넘김이 끊기지 않게 한다.
import { el, slideUrl, thumbUrl, pageUrl } from './common.js';
import { createInk } from './ink.js';

// inkOptions: 진행 화면은 { editable, onChange }, 학생 화면은 { interactive }(확대만), 발표 화면은 비워 둔다.
// mediaOptions: 장 그림 위에 겹칠 움직이는 그림(GIF)과 동영상.
//   진행 화면 { controls: true, onMedia }(재생·멈춤·옮김을 알린다), 학생 화면 { controls: true },
//   발표 화면 { controls: true, onMedia, sound: true }. 진행 화면과 발표 화면은 어느 쪽에서 눌러도 서로 따라 한다(media.apply).
export function createStage(stage, lesson, inkOptions = {}, mediaOptions = {}) {
  const img = el('img', { alt: '', decoding: 'async' });
  const layer = el('div', { class: 'slide-media' });
  const box = el('div', { class: 'zoom-box' }, img, layer);
  stage.replaceChildren(box);
  const ink = createInk(stage, box, img, inkOptions);
  const media = createMediaLayer(lesson, img, box, layer, mediaOptions);
  // 다른 그림으로 바뀔 때만 판서와 확대를 지운다(같은 장을 다시 그리라는 신호에는 그대로 둔다).
  const show = (src, alt, slide = null) => {
    if (img.getAttribute('src') !== src) { img.src = src; ink.reset(); media.show(slide); }
    img.alt = alt;
  };
  const cache = new Map();
  const preload = (url) => {
    if (!url || cache.has(url)) return;
    const i = new Image();
    i.decoding = 'async';
    i.src = url;
    cache.set(url, i);
  };
  return {
    ink,
    media,
    showSlide(n) {
      const slide = lesson.slides[n - 1];
      if (!slide) return;
      show(slideUrl(lesson, slide), `${n}장. ${slide.title || ''}`, slide);
      [n + 1, n + 2, n - 1].forEach((k) => lesson.slides[k - 1] && preload(slideUrl(lesson, lesson.slides[k - 1])));
    },
    showPage(page) {
      show(pageUrl(lesson, page), `교과서 ${page}쪽`);
      [page + 1, page - 1].forEach((p) => preload(pageUrl(lesson, p)));
    },
  };
}

// PDF로 바꾼 장 그림에는 GIF·동영상의 첫 장면만 남는다. 원본을 PPT에서의 자리에 겹쳐 움직이게 한다.
// 겹친 층은 확대 상자(zoom-box) 안에 있어 함께 확대되고, 판서 캔버스와 칠판은 그 위에 놓인다.
function createMediaLayer(lesson, img, box, layer, { controls = false, onMedia = null, sound = false } = {}) {
  let slide = null;
  let videos = [];
  let applying = false;

  function layout() {
    const W = img.offsetWidth || box.offsetWidth;
    const H = img.offsetHeight || box.offsetHeight;
    const nw = img.naturalWidth || 16;
    const nh = img.naturalHeight || 9;
    const k = Math.min(W / nw, H / nh) || 1;
    Object.assign(layer.style, {
      left: `${img.offsetLeft + (W - nw * k) / 2}px`, top: `${img.offsetTop + (H - nh * k) / 2}px`,
      width: `${nw * k}px`, height: `${nh * k}px`,
    });
  }

  function report(i, v) {
    if (applying || !onMedia) return;
    onMedia({ slide: slide?.n, i, playing: !v.paused && !v.ended, t: v.currentTime });
  }

  function show(next) {
    slide = next;
    videos = [];
    layer.replaceChildren();
    for (const item of next?.media || []) {
      const style = { left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, height: `${item.h * 100}%` };
      const src = `${lesson.base}/${item.src}`;
      let node;
      if (item.type === 'video') {
        const i = videos.length;
        node = el('video', { src, preload: 'auto', playsinline: true, controls, 'aria-label': `${next.n}장 동영상` });
        node.muted = !sound; // 학생 기기와 진행 화면은 소리 없이 시작한다. 소리는 발표 화면에서 낸다.
        if (onMedia) ['play', 'pause', 'seeked', 'ended'].forEach((ev) => node.addEventListener(ev, () => report(i, node)));
        videos.push(node);
      } else {
        node = el('img', { src, alt: '', decoding: 'async' });
      }
      node.className = `slide-media-item ${item.type}`;
      Object.assign(node.style, style);
      layer.append(node);
    }
    layer.hidden = !layer.childElementCount;
    layout();
  }

  // 짝이 되는 화면(진행 화면과 발표 화면)의 재생 상태를 따른다. 같은 장일 때만 맞춘다.
  async function apply(msg) {
    const v = videos[msg.i];
    if (!v || msg.slide !== slide?.n) return;
    applying = true;
    try {
      if (Math.abs(v.currentTime - msg.t) > 0.4) v.currentTime = msg.t;
      if (msg.playing && v.paused) {
        v.muted = !sound;
        await v.play().catch(() => { v.muted = true; return v.play().catch(() => {}); });
      } else if (!msg.playing && !v.paused) v.pause();
    } finally { applying = false; }
  }

  new ResizeObserver(layout).observe(box);
  img.addEventListener('load', layout);
  layer.hidden = true;
  return { show, apply, clear: () => show(null) };
}

// 화면을 좌우로 밀어 장을 넘긴다.
export function onSwipe(target, onLeft, onRight) {
  let x0 = null;
  let y0 = null;
  target.addEventListener('touchstart', (e) => {
    // 확대해 옮기거나 판서하는 중, 두 손가락으로 벌리는 중에는 장을 넘기지 않는다.
    if (e.touches.length > 1 || target.classList.contains('zoomed') || target.classList.contains('inking')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  target.addEventListener('touchend', (e) => {
    if (x0 === null || e.touches.length) { x0 = null; return; }
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    (dx < 0 ? onLeft : onRight)();
  }, { passive: true });
}

// 소단원별 축소판 목차.
export function openToc(lesson, current, onPick) {
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { drawer.remove(); document.removeEventListener('keydown', onKey); };
  const panel = el('div', { class: 'drawer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '목차' },
    el('h2', {}, '목차', el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: close }, '닫기')));
  const starts = new Map(lesson.sections.map((s) => [s.start, s]));
  let grid = el('div', { class: 'thumbs' });
  panel.append(grid);
  for (const slide of lesson.slides) {
    if (starts.has(slide.n)) {
      panel.append(el('div', { class: 'toc-sec' }, starts.get(slide.n).title));
      grid = el('div', { class: 'thumbs' });
      panel.append(grid);
    }
    const btn = el('button', { type: 'button', class: 'thumb', 'aria-current': slide.n === current ? 'true' : 'false', onclick: () => { close(); onPick(slide.n); } },
      el('img', { src: thumbUrl(lesson, slide), alt: '', loading: 'lazy' }),
      el('span', {}, `${slide.n}. ${slide.title || ''}`));
    grid.append(btn);
  }
  const drawer = el('div', { class: 'drawer', onclick: (e) => { if (e.target === drawer) close(); } }, panel);
  document.addEventListener('keydown', onKey);
  document.body.append(drawer);
  const cur = panel.querySelector('[aria-current="true"]');
  (cur || panel.querySelector('button')).focus();
  cur && cur.scrollIntoView({ block: 'center' });
}
