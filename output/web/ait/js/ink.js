// 무대 확대와 판서. 줌잇(ZoomIt)처럼 단축키로 펜·직선·네모·원·화살표·글을 넣고, 화면을 확대해 옮겨 본다.
//   editable: 진행 화면. 판서와 단축키를 쓴다. 바뀔 때마다 onChange로 상태를 알려 발표 화면이 따라 그린다.
//   interactive: 학생 화면. 판서는 없고 손가락 벌리기·Ctrl+휠·두 번 누르기로 확대만 한다.
//   둘 다 아니면 발표 화면처럼 apply()로 받은 상태만 그린다.
// 좌표는 그림(슬라이드·교과서 쪽)의 가로·세로에 대한 비율로 적어, 크기가 다른 화면에서도 같은 자리에 그린다.
import { el } from './common.js';

export const INK_COLORS = { r: '#e53935', g: '#1f9d55', b: '#1e6fd9', y: '#ffd400', o: '#ff8a00', p: '#ff4fa3' };
const COLOR_NAMES = { r: '빨강', g: '초록', b: '파랑', y: '노랑', o: '주황', p: '분홍' };
const WIDTHS = [0.003, 0.005, 0.008, 0.012, 0.018]; // 그림 높이에 대한 선 굵기 비율
const TOOLS = [['pen', '펜'], ['line', '직선'], ['rect', '네모'], ['ellipse', '원'], ['arrow', '화살표'], ['text', '글']];
const MAX_S = 6;
const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const INK_HELP = 'D 판서 시작·끝 · 끌기 펜 · Shift 직선 · Ctrl 네모 · Tab 원 · Ctrl+Shift 화살표 · T 글 · R G B Y O P 색 · [ ] 굵기 · W/K 흰·검은 칠판 · E 모두 지우기 · Ctrl+Z 되돌리기 · Esc 끝내기 · + − 0 확대';

export function createInk(stage, box, img, { editable = false, interactive = false, onChange = null } = {}) {
  const canvas = el('canvas', { class: 'ink-canvas', 'aria-hidden': 'true' });
  const sheet = el('div', { class: 'ink-sheet' });
  sheet.hidden = true;
  box.append(sheet, canvas);
  const ctx = canvas.getContext('2d');

  let shapes = [];
  let draft = null;
  let board = null;
  let view = { s: 1, cx: 0.5, cy: 0.5 };
  let drawMode = false;
  let tool = 'pen';
  let color = 'r';
  let widthLevel = 1;
  let tabHeld = false;
  let textArmed = false;
  let textBox = null;

  // 그림이 무대 안에서 실제로 차지하는 자리(object-fit: contain). offset 값은 확대 변환의 영향을 받지 않는다.
  function rect() {
    const W = img.offsetWidth || box.offsetWidth;
    const H = img.offsetHeight || box.offsetHeight;
    const nw = img.naturalWidth || 16;
    const nh = img.naturalHeight || 9;
    const k = Math.min(W / nw, H / nh) || 1;
    const w = nw * k;
    const h = nh * k;
    return { x: img.offsetLeft + (W - w) / 2, y: img.offsetTop + (H - h) / 2, w, h };
  }

  function layout() {
    const W = box.offsetWidth;
    const H = box.offsetHeight;
    if (!W || !H) return;
    const r = rect();
    const s = view.s;
    let tx = 0;
    let ty = 0;
    if (s > 1.001) {
      tx = clamp(W / 2 - (r.x + view.cx * r.w) * s, W - W * s, 0);
      ty = clamp(H / 2 - (r.y + view.cy * r.h) * s, H - H * s, 0);
      // 가장자리에 막혀 실제로 보이는 중심을 다시 적어 둔다(옮기기·확대가 이 점에서 이어진다).
      view.cx = ((W / 2 - tx) / s - r.x) / r.w;
      view.cy = ((H / 2 - ty) / s - r.y) / r.h;
    } else {
      view = { s: 1, cx: 0.5, cy: 0.5 };
    }
    box.style.transform = s > 1.001 ? `translate(${tx}px, ${ty}px) scale(${s})` : '';
    stage.classList.toggle('zoomed', s > 1.001);
    if (zoomBadge) {
      zoomBadge.hidden = s <= 1.001;
      zoomText.textContent = `${Math.round(s * 100)}%`;
    }

    sheet.hidden = !board;
    if (board) {
      sheet.className = `ink-sheet ${board}`;
      Object.assign(sheet.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    }

    const k = Math.min(4, (window.devicePixelRatio || 1) * Math.max(1, s));
    const cw = Math.round(W * k);
    const ch = Math.round(H * k);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const sh of shapes) paint(sh, r);
    if (draft) paint(draft, r);
  }

  function paint(sh, r) {
    const P = (p) => [r.x + p[0] * r.w, r.y + p[1] * r.h];
    const c = INK_COLORS[sh.c] || '#e53935';
    const lw = Math.max(1, sh.w * r.h);
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (sh.t === 'pen') {
      const pts = sh.pts.map(P);
      if (pts.length === 1) { ctx.arc(pts[0][0], pts[0][1], lw / 2, 0, Math.PI * 2); ctx.fill(); return; }
      ctx.moveTo(...pts[0]);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(...pts[i]);
      ctx.stroke();
    } else if (sh.t === 'text') {
      const [x, y] = P([sh.x, sh.y]);
      const size = sh.size * r.h;
      ctx.font = `700 ${size}px Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, size / 7);
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.strokeText(sh.text, x, y);
      ctx.fillText(sh.text, x, y);
    } else {
      const [ax, ay] = P(sh.a);
      const [bx, by] = P(sh.b);
      if (sh.t === 'line' || sh.t === 'arrow') {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        if (sh.t === 'arrow') {
          const ang = Math.atan2(by - ay, bx - ax);
          const head = Math.max(12, lw * 4);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - head * Math.cos(ang - 0.45), by - head * Math.sin(ang - 0.45));
          ctx.lineTo(bx - head * Math.cos(ang + 0.45), by - head * Math.sin(ang + 0.45));
          ctx.closePath();
          ctx.fill();
        }
      } else if (sh.t === 'rect') {
        ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      } else if (sh.t === 'ellipse') {
        ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // 바뀐 상태를 알린다. 끌어 그리는 동안은 화면 그리기 주기에 한 번만 보낸다.
  let pending = 0;
  const state = () => ({ shapes, draft, view: { ...view }, board, draw: drawMode });
  const emit = () => { if (onChange) onChange(state()); };
  const emitSoon = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; emit(); }); };
  const changed = () => { layout(); emit(); };

  // 화면 좌표 → 무대 좌표(확대 전) → 그림 비율 좌표
  const local = (e) => {
    const b = box.getBoundingClientRect();
    return [(e.clientX - b.left) / view.s, (e.clientY - b.top) / view.s];
  };
  const norm = ([lx, ly]) => { const r = rect(); return [(lx - r.x) / r.w, (ly - r.y) / r.h]; };

  function zoomAt(e, next) {
    const s = clamp(next, 1, MAX_S);
    if (s === view.s) return;
    const [px, py] = e ? norm(local(e)) : [view.cx, view.cy];
    view.cx = px - (px - view.cx) * view.s / s;
    view.cy = py - (py - view.cy) * view.s / s;
    view.s = s;
    changed();
  }
  function panBy(dx, dy) {
    const r = rect();
    view.cx -= dx / (view.s * r.w);
    view.cy -= dy / (view.s * r.h);
    changed();
  }
  const resetView = () => { view = { s: 1, cx: 0.5, cy: 0.5 }; changed(); };

  // 확대 배지: 지금 배율과 원래대로 단추
  let zoomBadge = null;
  let zoomText = null;
  if (editable || interactive) {
    zoomText = el('span', {});
    zoomBadge = el('div', { class: 'zoom-badge' }, zoomText,
      el('button', { type: 'button', class: 'btn-sm', onclick: (e) => { e.stopPropagation(); resetView(); } }, editable ? '원래대로(0)' : '원래대로'));
    zoomBadge.hidden = true;
    stage.append(zoomBadge);

    stage.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(e, view.s * Math.exp(-e.deltaY * 0.0025));
      } else if (view.s > 1.001) {
        e.preventDefault();
        panBy(-e.deltaX, -e.deltaY);
      }
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => {
      if (drawMode || e.target.closest('.ink-bar, .zoom-badge')) return;
      if (view.s > 1.001) resetView();
      else zoomAt(e, 2);
    });

    // 손가락 두 개로 벌리기·오므리기, 확대한 상태에서는 한 손가락(또는 마우스)으로 끌어 옮기기
    const pointers = new Map();
    let pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      if (drawMode || e.target.closest('.ink-bar, .zoom-badge, button, input')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: view.s };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const mid = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
        zoomAt(mid, pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
      } else if (pointers.size === 1 && view.s > 1.001) {
        panBy(cur.x - prev.x, cur.y - prev.y);
      }
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') up(e); });
  }

  // 판서(진행 화면만)
  let bar = null;
  let helpLine = null;
  if (editable) {
    canvas.addEventListener('pointerdown', (e) => {
      if (!drawMode || e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (textBox) { commitText(); return; }
      if (tool === 'text' || textArmed) { placeText(e); return; }
      const t = (e.ctrlKey || e.metaKey) && e.shiftKey ? 'arrow' : (e.ctrlKey || e.metaKey) ? 'rect' : tabHeld ? 'ellipse' : e.shiftKey ? 'line' : tool;
      const p = norm(local(e));
      const w = WIDTHS[widthLevel];
      draft = t === 'pen' ? { t, c: color, w, pts: [p] } : { t, c: color, w, a: p, b: p };
      canvas.setPointerCapture(e.pointerId);
      layout();
      emitSoon();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!draft) return;
      const p = norm(local(e));
      if (draft.t === 'pen') {
        const last = draft.pts[draft.pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0015) return;
        draft.pts.push(p);
      } else {
        draft.b = p;
      }
      layout();
      emitSoon();
    });
    const finish = () => {
      if (!draft) return;
      const tiny = draft.t !== 'pen' && Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1]) < 0.004;
      if (!tiny) shapes.push(draft);
      draft = null;
      changed();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    document.addEventListener('keyup', (e) => { if (e.key === 'Tab') tabHeld = false; });
    window.addEventListener('blur', () => { tabHeld = false; });

    const swatches = Object.keys(INK_COLORS).map((k) => el('button', {
      type: 'button', class: 'ink-swatch', 'data-color': k, title: `${COLOR_NAMES[k]} (${k.toUpperCase()})`, 'aria-label': COLOR_NAMES[k],
      onclick: () => { color = k; paintBar(); },
    }));
    const toolBtns = TOOLS.map(([k, label]) => el('button', { type: 'button', class: 'btn-ghost btn-sm', 'data-tool': k, onclick: () => { tool = k; textArmed = false; paintBar(); } }, label));
    helpLine = el('div', { class: 'ink-help' }, INK_HELP);
    helpLine.hidden = true;
    bar = el('div', { class: 'ink-bar', role: 'toolbar', 'aria-label': '판서 도구' },
      el('div', { class: 'ink-row' },
        ...swatches,
        el('span', { class: 'ink-sep' }),
        ...toolBtns,
        el('span', { class: 'ink-sep' }),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', title: '가늘게 ([)', onclick: () => { widthLevel = clamp(widthLevel - 1, 0, WIDTHS.length - 1); paintBar(); } }, '가늘게'),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', title: '굵게 (])', onclick: () => { widthLevel = clamp(widthLevel + 1, 0, WIDTHS.length - 1); paintBar(); } }, '굵게'),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', 'data-board': 'white', title: '흰 칠판 (W)', onclick: () => toggleBoard('white') }, '흰 칠판'),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', 'data-board': 'black', title: '검은 칠판 (K)', onclick: () => toggleBoard('black') }, '검은 칠판'),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', title: '되돌리기 (Ctrl+Z)', onclick: undo }, '되돌리기'),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', title: '모두 지우기 (E)', onclick: clearAll }, '모두 지우기'),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', title: '단축키 보기', 'aria-pressed': 'false', onclick: (e) => { helpLine.hidden = !helpLine.hidden; e.currentTarget.setAttribute('aria-pressed', String(!helpLine.hidden)); } }, '단축키'),
        el('button', { type: 'button', class: 'btn-sm', title: '판서 끝내기 (Esc)', onclick: () => setDraw(false) }, '끝내기')),
      helpLine);
    bar.hidden = true;
    stage.append(bar);
  }

  function paintBar() {
    if (!bar) return;
    bar.querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === color)));
    bar.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === (textArmed ? 'text' : tool))));
    bar.querySelectorAll('[data-board]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.board === board)));
    stage.style.setProperty('--ink-color', INK_COLORS[color]);
    stage.classList.toggle('ink-text', tool === 'text' || textArmed);
  }

  function placeText(e) {
    const [lx, ly] = local(e);
    const r = rect();
    const size = 0.035 + widthLevel * 0.006;
    const input = el('input', { class: 'ink-input', type: 'text', 'aria-label': '판서 글', autocomplete: 'off' });
    Object.assign(input.style, { left: `${lx}px`, top: `${ly}px`, color: INK_COLORS[color], fontSize: `${size * r.h}px` });
    textBox = { input, at: norm([lx, ly]), size, c: color };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); commitText(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancelText(); }
    });
    input.addEventListener('blur', () => setTimeout(commitText, 0));
    box.append(input);
    input.focus();
  }
  function commitText() {
    if (!textBox) return;
    const { input, at, size, c } = textBox;
    textBox = null;
    const text = input.value.trim();
    input.remove();
    if (tool !== 'text') textArmed = false;
    paintBar();
    if (text) { shapes.push({ t: 'text', c, size, x: at[0], y: at[1], text: text.slice(0, 80) }); changed(); }
  }
  function cancelText() {
    if (!textBox) return;
    textBox.input.remove();
    textBox = null;
    if (tool !== 'text') textArmed = false;
    paintBar();
  }

  function undo() { if (shapes.length) { shapes.pop(); changed(); } }
  function clearAll() { cancelText(); shapes = []; draft = null; board = null; paintBar(); changed(); }
  function toggleBoard(kind) { board = board === kind ? null : kind; paintBar(); changed(); }

  function setDraw(on) {
    if (!editable || drawMode === on) return;
    drawMode = on;
    if (!on) { cancelText(); shapes = []; draft = null; board = null; textArmed = false; tabHeld = false; } // 줌잇처럼 끝내면 지운다.
    stage.classList.toggle('inking', on);
    if (bar) bar.hidden = !on;
    paintBar();
    changed();
  }

  // 진행 화면 단축키. 처리했으면 true를 돌려준다(장 넘기기 등 다른 동작은 하지 않는다).
  function handleKey(e) {
    if (!editable) return false;
    const k = e.key;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (plain && (k === '+' || k === '=')) { zoomAt(null, view.s * 1.25); return true; }
    if (plain && (k === '-' || k === '_')) { zoomAt(null, view.s / 1.25); return true; }
    if (plain && k === '0') { resetView(); return true; }
    if (!drawMode) {
      if (plain && (k === 'd' || k === 'D' || k === 'ㅇ')) { setDraw(true); return true; }
      return false;
    }
    if (k === 'Escape') { setDraw(false); return true; }
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z' || k === 'ㅋ')) { undo(); return true; }
    if (!plain) return false;
    if (NAV_KEYS.includes(k)) return false; // 판서 중에도 화살표·리모컨으로 장을 넘긴다(넘기면 지워진다).
    if (k === 'Tab') { tabHeld = true; return true; }
    // 한글 자판 상태에서 눌러도 같은 글쇠로 알아듣는다.
    const low = ({ ㄱ: 'r', ㅎ: 'g', ㅠ: 'b', ㅛ: 'y', ㅐ: 'o', ㅔ: 'p', ㄷ: 'e', ㅅ: 't', ㅈ: 'w', ㅏ: 'k', ㅇ: 'd' })[k] || k.toLowerCase();
    if (INK_COLORS[low]) { color = low; paintBar(); }
    else if (low === 'e') clearAll();
    else if (low === 't') { textArmed = true; paintBar(); }
    else if (low === 'w') toggleBoard('white');
    else if (low === 'k') toggleBoard('black');
    else if (low === 'd') setDraw(false);
    else if (k === '[') { widthLevel = clamp(widthLevel - 1, 0, WIDTHS.length - 1); paintBar(); }
    else if (k === ']') { widthLevel = clamp(widthLevel + 1, 0, WIDTHS.length - 1); paintBar(); }
    return true;
  }

  new ResizeObserver(() => layout()).observe(box);
  img.addEventListener('load', () => layout());
  paintBar();

  return {
    handleKey,
    setDraw,
    toggleDraw: () => setDraw(!drawMode),
    get drawing() { return drawMode; },
    get zoomed() { return view.s > 1.001; },
    state,
    // 장이나 쪽이 바뀌면 판서와 확대를 처음으로 돌린다(판서 모드는 그대로).
    reset() {
      cancelText();
      const had = shapes.length || draft || board || view.s > 1.001;
      shapes = [];
      draft = null;
      board = null;
      view = { s: 1, cx: 0.5, cy: 0.5 };
      paintBar();
      if (had) changed(); else layout();
    },
    // 발표 화면: 진행 화면이 보낸 상태를 그대로 그린다.
    apply(s) {
      shapes = Array.isArray(s?.shapes) ? s.shapes : [];
      draft = s?.draft || null;
      board = s?.board === 'white' || s?.board === 'black' ? s.board : null;
      view = s?.view && Number.isFinite(s.view.s) ? { s: clamp(s.view.s, 1, MAX_S), cx: s.view.cx, cy: s.view.cy } : { s: 1, cx: 0.5, cy: 0.5 };
      layout();
    },
  };
}

// 옆 칸 교과서 쪽 확대·축소(− 배율 +). Ctrl+휠도 쓴다. 쪽을 넘겨도 배율은 그대로 둔다.
export function zoomPane(view, img, host) {
  const steps = [1, 1.25, 1.5, 2, 2.5, 3];
  let i = 0;
  const label = el('button', { type: 'button', class: 'btn-ghost btn-sm zoom-level', title: '원래 크기로', onclick: () => set(0) }, '100%');
  const set = (n) => {
    const keep = view.scrollHeight ? (view.scrollTop + view.clientHeight / 2) / view.scrollHeight : 0;
    const keepX = view.scrollWidth ? (view.scrollLeft + view.clientWidth / 2) / view.scrollWidth : 0.5;
    i = clamp(n, 0, steps.length - 1);
    const z = steps[i];
    img.style.width = `${z * 100}%`;
    img.style.maxWidth = `${900 * z}px`;
    view.classList.toggle('zoomed', z > 1);
    label.textContent = `${Math.round(z * 100)}%`;
    requestAnimationFrame(() => {
      view.scrollTop = keep * view.scrollHeight - view.clientHeight / 2;
      view.scrollLeft = keepX * view.scrollWidth - view.clientWidth / 2;
    });
  };
  host.append(
    el('button', { type: 'button', class: 'btn-ghost btn-sm', 'aria-label': '교과서 축소', title: '축소', onclick: () => set(i - 1) }, '−'),
    label,
    el('button', { type: 'button', class: 'btn-ghost btn-sm', 'aria-label': '교과서 확대', title: '확대', onclick: () => set(i + 1) }, '+'),
  );
  view.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    set(i + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });
  return { set };
}
