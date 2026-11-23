// 슬라이드와 교과서 쪽을 무대에 그린다. 이웃 장을 미리 불러 넘김이 끊기지 않게 한다.
import { el, slideUrl, thumbUrl, pageUrl } from './common.js';
import { createInk } from './ink.js';

// inkOptions: 진행 화면은 { editable, onChange }, 학생 화면은 { interactive }(확대만), 발표 화면은 비워 둔다.
export function createStage(stage, lesson, inkOptions = {}) {
  const img = el('img', { alt: '', decoding: 'async' });
  const box = el('div', { class: 'zoom-box' }, img);
  stage.replaceChildren(box);
  const ink = createInk(stage, box, img, inkOptions);
  // 다른 그림으로 바뀔 때만 판서와 확대를 지운다(같은 장을 다시 그리라는 신호에는 그대로 둔다).
  const show = (src, alt) => {
    if (img.getAttribute('src') !== src) { img.src = src; ink.reset(); }
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
    showSlide(n) {
      const slide = lesson.slides[n - 1];
      if (!slide) return;
      show(slideUrl(lesson, slide), `${n}장. ${slide.title || ''}`);
      [n + 1, n + 2, n - 1].forEach((k) => lesson.slides[k - 1] && preload(slideUrl(lesson, lesson.slides[k - 1])));
    },
    showPage(page) {
      show(pageUrl(lesson, page), `교과서 ${page}쪽`);
      [page + 1, page - 1].forEach((p) => preload(pageUrl(lesson, p)));
    },
  };
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
