/* 업무 양식 AI — PPT 탭 (2단계)
 *
 * 덱 데이터({ theme, title, slides[] })를 slides.js(DrSlides)로 그리고 .pptx로 내보낸다.
 * AI 생성은 두 번에 나눈다: ① 장 구성(장마다 레이아웃·제목·담을 내용) ② 6장씩 본문 채우기.
 * 한 번에 길게 받다 끊기는 문제(융합 설계실 2026-09-05)를 피하고, 진행 상황을 장 단위로 보여 준다.
 * 이미 만든 덱은 장·칸 주소(S3.title, S3.cards.1.body)로 고친다. 고치기 전 덱을 통째로 보관해 한 번에 되돌린다.
 */
const S = window.DrSlides;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LAYOUT_KEYS = Object.keys(S.LAYOUTS);
const BATCH = 6;
const MAX_SLIDES = 20;

export const clone = (d) => JSON.parse(JSON.stringify(d));
export function emptyDeck(theme, title) { return { theme, title: title || '', slides: [] }; }

/* ── 요청 판별: 한글 문서를 고치는 중에 PPT를 만들어 달라고 했는가 ── */
// 새로 만들기는 PPT 낱말 바로 뒤에 '만들·생성·짜'가 올 때만 본다("슬라이드 활용 계획을 작성해 줘"는 한글 문서 요청이다).
const DECK_CREATE = /(?:ppt|피피티|파워\s*포인트|슬라이드|발표\s*자료|프레젠테이션)(?:를|을|로|으로|도)?\s*(?:\d+\s*장(?:짜리)?(?:으로|로)?\s*)?(?:새로\s*)?(?:만들|생성|짜)/i;
export function isDeckRequest(text) { return DECK_CREATE.test(String(text || '')); }
// 이미 만든 PPT를 고치려는 요청인가(ppt·파워포인트라고 분명히 말했을 때만)
export function mentionsDeck(text) { return /(ppt|피피티|파워\s*포인트)/i.test(String(text || '')); }

/* ── AI가 쓰는 공통 장 모양 → 레이아웃별 덱 데이터 ── */
const ITEM = { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, value: { type: 'string' } }, required: ['title', 'body', 'value'] };
const SIDE = { type: 'object', properties: { label: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['label', 'items'] };
export const SLIDE_SCHEMA = {
  type: 'object',
  properties: {
    layout: { type: 'string', enum: LAYOUT_KEYS },
    tag: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' },
    org: { type: 'string' }, date: { type: 'string' }, presenter: { type: 'string' },
    items: { type: 'array', items: ITEM },
    left: SIDE, right: SIDE,
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    note: { type: 'string' }, notes: { type: 'string' }, source: { type: 'string' }
  },
  required: ['layout', 'tag', 'title', 'subtitle', 'org', 'date', 'presenter', 'items', 'left', 'right', 'rows', 'note', 'notes', 'source']
};
const s = (v) => (v == null ? '' : String(v)).trim();
const list = (a) => (Array.isArray(a) ? a : []);
export function normalizeSlide(u, no) {
  u = u || {};
  const layout = LAYOUT_KEYS.includes(u.layout) ? u.layout : 'bullets';
  const items = list(u.items).map((it) => ({ title: s(it && it.title), body: s(it && it.body), value: s(it && it.value) })).filter((it) => it.title || it.body || it.value);
  const out = { layout, tag: s(u.tag), title: s(u.title), note: s(u.note), notes: s(u.notes), source: s(u.source) };
  switch (layout) {
    case 'cover': Object.assign(out, { kicker: s(u.tag), subtitle: s(u.subtitle), org: s(u.org), date: s(u.date), presenter: s(u.presenter) }); delete out.tag; break;
    case 'agenda': out.items = items.map((it) => ({ title: it.title, sub: it.body })); break;
    case 'section': Object.assign(out, { no: no || 1, sub: s(u.subtitle) }); break;
    case 'bullets': out.bullets = items.map((it) => ({ title: it.title, sub: it.body })); break;
    case 'cards': out.cards = items.map((it) => ({ title: it.title, body: it.body })); break;
    case 'process': out.steps = items.map((it) => ({ title: it.title, body: it.body })); break;
    case 'stats': out.stats = items.map((it) => ({ value: it.value || it.title, label: it.value ? it.title : '', sub: it.body })); break;
    case 'summary': Object.assign(out, { points: items.map((it) => ({ title: it.title, body: it.body })), next: out.note }); out.note = ''; break;
    case 'compare': ['left', 'right'].forEach((k) => { const v = u[k] || {}; out[k] = { label: s(v.label), items: list(v.items).map(s).filter(Boolean) }; }); break;
    case 'table': out.rows = list(u.rows).map((r) => list(r).map(s)).filter((r) => r.some(Boolean)); break;
    case 'end': Object.assign(out, { sub: s(u.subtitle), contact: s(u.presenter) }); break;
  }
  return out;
}
// 구역 표지 번호를 순서대로 다시 매긴다.
export function renumber(deck) { let n = 0; deck.slides.forEach((sl) => { if (sl.layout === 'section') sl.no = ++n; }); }

/* ── 프롬프트 ── */
const RULES = [
  '[슬라이드 글쓰기]',
  '- 화면 글은 명사형·핵심구·행동형(~하기)으로 쓴다. 화면에는 ~다·~한다·~이다·~합니다로 끝나는 문장을 쓰지 않는다. 실제 질문과 직접 인용은 원래 말투를 지킨다.',
  '- 한 항목에는 핵심 하나만 담는다. 항목은 40자 안팎, 카드·단계 설명은 60자 안팎, 제목은 25자 안팎으로 쓴다. 길면 항목을 나누거나 발표 노트로 옮긴다.',
  '- 제목은 그 장의 주제나 핵심이 드러나는 핵심구로 쓴다. "이론", "데이터" 같은 분류명을 제목 앞에 붙이지 않는다.',
  '- 수치에는 단위·기준 시점·대상을 붙인다. 자료에 없는 사실, 수치, 날짜, 이름, 기관은 지어내지 않는다. 확인할 수 없으면 쓰지 않는다.',
  '- notes(발표 노트)는 보고체(~한다, ~이다)로 화면 내용의 의미·근거·사례를 2~4문장으로 설명한다. ~합니다·~습니다·~요로 끝내지 않는다. 화면 글을 그대로 반복하지 않는다.',
  '- source에는 그 장의 근거가 된 자료 이름과 쪽·위치를 짧게 적는다(예: 연수자료.pdf 3쪽). 근거 자료가 없는 장(표지·목차·마무리)은 빈 문자열로 둔다.',
  '- tag는 영어 대문자 짧은 머리말(예: WHY, PROCESS, KEY NUMBERS)이다. 표지의 tag는 행사·과정 이름 같은 짧은 머리말이다.'
].join('\n');
function fieldGuide() {
  return [
    '[레이아웃과 채울 필드] 모든 필드를 응답에 넣고, 쓰지 않는 필드는 "" 또는 []로 둔다.',
    '- cover(표지): title(2줄 이내, 줄바꿈은 \\n), subtitle, tag(머리말), org(학교·학년·행사), date(교사나 자료가 알려 준 발표 날짜만, 없으면 ""), presenter(알려 준 발표자만, 없으면 "")',
    '- agenda(목차): title="목차", items 3~6개(title=구역 이름, body=한 줄 설명)',
    '- section(구역 표지): title, subtitle(한 줄)',
    '- bullets(글머리): items 3~5개(title=핵심 한 줄, body=짧은 풀이), note(강조 한 줄, 선택)',
    '- cards(카드): items 2~4개(title, body), note(선택)',
    '- compare(비교): left·right 각각 label과 items 2~5개, note(선택)',
    '- table(표): rows 첫 줄이 머리글, 최대 8줄 5칸, note(선택)',
    '- process(단계): items 3~5개(title=단계 이름, body=할 일), note(선택)',
    '- stats(수치): items 2~4개(value=숫자와 단위 예: 12건, title=무엇의 수치, body=기준·출처), note(선택)',
    '- summary(정리): items 2~4개(title, body), note=다음 행동 한 줄(선택)',
    '- end(마무리): title(기본 감사합니다), subtitle, presenter(연락처·모둠 이름)'
  ].join('\n');
}
function sourcesBlock(sources) {
  if (!sources.length) return ['[자료] 없음. 교사의 요청 문장만 근거로 쓴다. 구체적인 사실·수치가 필요하면 지어내지 말고 reply에서 자료를 요청한다.'];
  const L = ['[자료] 교사가 함께 보낸 파일이다. 슬라이드 내용은 이 자료와 요청 문장에서만 가져온다.'];
  sources.forEach((x) => { L.push('--- ' + x.name + ' (' + x.kind + ')' + (x.cut ? ', 앞부분만' : '') + ' ---'); L.push(x.text); });
  return L;
}
function head(ctx) {
  return ['너는 ' + ctx.role + '가 학교에서 쓸 발표 자료(파워포인트)를 만들도록 돕는 AI 도우미다. 오늘은 ' + ctx.today + '이다.'];
}
function historyBlock(ctx) {
  if (!ctx.history.length) return [];
  const L = ['', '[지난 대화]'];
  ctx.history.forEach((h) => { L.push('교사: ' + h.user); L.push('도우미: ' + h.reply); });
  return L;
}

export const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' }, title: { type: 'string' },
    slides: { type: 'array', items: { type: 'object', properties: { layout: { type: 'string', enum: LAYOUT_KEYS }, title: { type: 'string' }, plan: { type: 'string' } }, required: ['layout', 'title', 'plan'] } }
  },
  required: ['reply', 'title', 'slides']
};
export function outlinePrompt(ctx) {
  return head(ctx).concat(historyBlock(ctx), ['', '[이번 요청]', ctx.request, ''], sourcesBlock(ctx.sources), ['',
    '[할 일] 발표 자료의 장 구성만 먼저 정한다. 본문은 다음 단계에서 채운다.',
    '- 장 수: 교사가 정했으면 그대로, 정하지 않았으면 자료 분량에 맞춰 8~12장. 최대 ' + MAX_SLIDES + '장.',
    '- 첫 장은 cover, 마지막 장은 end. 8장 이상이면 둘째 장에 agenda를 둔다. 큰 묶음이 2개 이상이면 묶음 앞에 section을 둔다. 마지막 바로 앞은 summary를 권장한다.',
    '- 본문 장은 내용 관계에 맞는 레이아웃을 고른다: 나열=bullets·cards, 순서=process, 대조=compare, 수치=stats, 여러 속성 비교=table.',
    '- 같은 레이아웃이 세 장 넘게 이어지지 않게 한다.',
    '- plan에는 그 장에 담을 내용과 근거 자료의 위치(파일 이름·쪽)를 한두 문장으로 쓴다.',
    '- title은 그 장의 제목 초안이다. 전체 발표 제목은 title(최상위)에 쓴다.',
    '- reply는 교사에게 보여 줄 짧은 안내다. 존댓말로 몇 장을 어떤 흐름으로 만드는지 쓴다. 자료가 부족하면 무엇이 더 필요한지 쓴다.',
    '', RULES]).join('\n');
}
export const FILL_SCHEMA = { type: 'object', properties: { slides: { type: 'array', items: SLIDE_SCHEMA } }, required: ['slides'] };
export function fillPrompt(ctx, outline, from, to) {
  const L = head(ctx).concat(['', '[이번 요청]', ctx.request, ''], sourcesBlock(ctx.sources), ['',
    '[전체 구성] 발표 제목: ' + outline.title]);
  outline.slides.forEach((o, i) => L.push((i + 1) + '. [' + o.layout + '] ' + o.title + ' — ' + o.plan));
  L.push('', '[할 일] 위 구성 가운데 ' + (from + 1) + '~' + to + '번 장의 본문을 채운다. slides 배열에 ' + (to - from) + '개를 순서대로 넣는다. 레이아웃은 구성대로 쓴다.', '', fieldGuide(), '', RULES);
  return L.join('\n');
}
export const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    edits: { type: 'array', items: { type: 'object', properties: {
      op: { type: 'string', enum: ['set', 'replace_slide', 'add_slide', 'delete_slide', 'move_slide'] },
      target: { type: 'string' }, text: { type: 'string' }, to: { type: 'integer' }, slide: SLIDE_SCHEMA
    }, required: ['op', 'target', 'text', 'to', 'slide'] } }
  },
  required: ['reply', 'edits']
};
export function editPrompt(ctx, deck) {
  return head(ctx).concat(['', '[고칠 PPT] ' + (deck.title || ctx.name) + ', ' + deck.slides.length + '장',
    '[PPT 현재 내용] 장마다 S번호 [레이아웃], 칸마다 주소 = 지금 글(JSON 문자열)', deckMap(deck)],
  ctx.sources.length ? [''].concat(sourcesBlock(ctx.sources)) : [], historyBlock(ctx), ['', '[이번 요청]', ctx.request, '',
    '[고치는 방법] 고칠 것은 edits 배열에 넣는다. 질문만 했으면 edits는 빈 배열이다.',
    '- set: target 칸(예: S3.title, S3.cards.1.body, S5.rows.2.1, S4.notes)의 글을 text로 바꾼다. 주소는 위 [PPT 현재 내용]에 있는 것만 쓴다.',
    '- replace_slide: target 장(예: S4)을 slide로 통째로 바꾼다. 레이아웃을 바꾸거나 항목 수를 늘리고 줄일 때 쓴다.',
    '- add_slide: target 장(예: S4) 바로 뒤에 slide를 새로 넣는다. 맨 앞에 넣으려면 target을 S0으로 쓴다.',
    '- delete_slide: target 장을 지운다. move_slide: target 장을 to번째 자리로 옮긴다. to는 이 응답의 다른 작업을 모두 마친 뒤의 최종 순서(1부터)다.',
    '- 장 번호는 모두 위 [PPT 현재 내용]의 번호로 쓴다. 같은 응답 안에서 장을 넣거나 지워도 번호를 다시 세지 않는다.',
    '- 쓰지 않는 필드는 "", [], 0으로 둔다(slide 안의 필드 포함).',
    '- 요청과 관계없는 장과 칸은 고치지 않는다.',
    '- reply는 교사에게 보여 줄 답이다. 존댓말로 무엇을 고쳤는지 쓴다.', '', fieldGuide(), '', RULES]).join('\n');
}

/* ── 고치기 적용 ── */
const PART = { title: '제목', tag: '머리말', subtitle: '부제', kicker: '머리말', org: '기관', date: '날짜', presenter: '발표자', note: '강조 문구', notes: '발표 노트',
  source: '출처', sub: '설명', body: '설명', label: '이름', value: '값', next: '다음 행동', contact: '연락처',
  items: '항목', bullets: '항목', cards: '카드', steps: '단계', stats: '수치', points: '항목', left: '왼쪽', right: '오른쪽', rows: '표' };
function labelOf(n, path) {
  return 'S' + n + ' ' + path.split('.').map((p) => (/^\d+$/.test(p) ? String(+p + 1) : PART[p] || p)).join(' ');
}
// 레이아웃마다 고칠 수 있는 칸. 지금 비어 있어 화면에 그려지지 않은 칸도 AI가 채울 수 있게 화면이 아니라 이 목록으로 정한다.
// N은 항목 번호(0부터), R·C는 표의 줄·칸 번호다.
const FIELDS = {
  cover: ['kicker', 'title', 'subtitle', 'org', 'date', 'presenter'],
  agenda: ['tag', 'title', 'items.N.title', 'items.N.sub'],
  section: ['title', 'sub'],
  bullets: ['tag', 'title', 'note', 'bullets.N.title', 'bullets.N.sub'],
  cards: ['tag', 'title', 'note', 'cards.N.title', 'cards.N.body'],
  compare: ['tag', 'title', 'note', 'left.label', 'right.label', 'left.items.N', 'right.items.N'],
  table: ['tag', 'title', 'note', 'rows.R.C'],
  process: ['tag', 'title', 'note', 'steps.N.title', 'steps.N.body'],
  stats: ['tag', 'title', 'note', 'stats.N.value', 'stats.N.label', 'stats.N.sub'],
  summary: ['tag', 'title', 'next', 'points.N.title', 'points.N.body'],
  end: ['title', 'sub', 'contact']
};
const MAX_ITEMS = { agenda: 6, bullets: 6, cards: 4, compare: 5, table: 8, process: 5, stats: 4, summary: 4 };
function fieldOk(sl, path) {
  if (path === 'notes' || path === 'source') return true;
  const max = MAX_ITEMS[sl.layout] || 6;
  return (FIELDS[sl.layout] || []).some((f) => {
    const re = new RegExp('^' + f.replace(/\./g, '\\.').replace('R', '(\\d+)').replace('C', '(\\d+)').replace('N', '(\\d+)') + '$');
    const m = re.exec(path); if (!m) return false;
    if (f === 'rows.R.C') return +m[1] < 8 && +m[2] < 5;
    return m[1] === undefined || +m[1] < max;
  });
}
// AI에게 보여 줄 덱 지도: 장마다 고칠 수 있는 칸과 지금 글. 빈 칸도 주소를 보여 준다(항목은 있는 것 + 다음 하나).
export function deckMap(deck) {
  const L = [];
  deck.slides.forEach((sl, i) => {
    const n = 'S' + (i + 1);
    L.push(n + ' [' + sl.layout + ']');
    const put = (path) => L.push('  ' + n + '.' + path + ' = ' + JSON.stringify(s(S.getPath(sl, path))));
    (FIELDS[sl.layout] || []).forEach((f) => {
      if (f === 'rows.R.C') { L.push('  ' + n + '.rows = ' + JSON.stringify(sl.rows || []) + '  (칸 주소: ' + n + '.rows.줄.칸, 0부터)'); return; }
      if (!f.includes('N')) { put(f); return; }
      const arr = S.getPath(sl, f.slice(0, f.indexOf('.N'))) || [];
      const count = Math.min((MAX_ITEMS[sl.layout] || 6), arr.length + 1);
      for (let k = 0; k < count; k++) put(f.replace('N', k));
    });
    put('notes'); put('source');
  });
  return L.join('\n');
}
const hasContent = (nu) => !!(nu.title || nu.subtitle || nu.sub || ['items', 'bullets', 'cards', 'steps', 'stats', 'points', 'rows'].some((k) => Array.isArray(nu[k]) && nu[k].length) ||
  (nu.left && nu.left.items && nu.left.items.length) || (nu.right && nu.right.items && nu.right.items.length));
export function applyDeckEdits(deck, edits) {
  const changes = [], problems = [];
  const orig = deck.slides.slice();
  edits = (Array.isArray(edits) ? edits : []).filter((e) => e && typeof e === 'object');
  const at = (tgt) => { const m = /^S(\d+)$/i.exec(s(tgt)); return m ? +m[1] : null; };
  // 장 단위 작업은 모두 원래 번호로 해석한다. 장마다 다시 쓰기·지우기·뒤에 넣을 장을 모았다가 마지막에 한 번에 새 목록을 만든다.
  const plan = orig.map(() => ({ replace: null, del: false, after: [] })), head = [], moves = [];
  edits.filter((e) => e.op !== 'set').forEach((e) => {
    const n = at(e.target);
    if (n == null || n > orig.length || (n === 0 && e.op !== 'add_slide')) { problems.push('없는 장이라 처리하지 못했습니다: ' + s(e.target)); return; }
    if (e.op === 'replace_slide' || e.op === 'add_slide') {
      const nu = normalizeSlide(e.slide);
      if (!hasContent(nu)) { problems.push((e.op === 'add_slide' ? '넣을 장' : 'S' + n + '을(를) 바꿀 내용') + '이 비어 있어 처리하지 않았습니다.'); return; }
      if (e.op === 'replace_slide') {
        if (!nu.notes && orig[n - 1].notes) nu.notes = orig[n - 1].notes;
        plan[n - 1].replace = nu;
        changes.push({ label: 'S' + n + ' 장 다시 쓰기', before: orig[n - 1].title || '', after: nu.title || '' });
      } else {
        (n === 0 ? head : plan[n - 1].after).push(nu);
        changes.push({ label: (n === 0 ? '맨 앞' : 'S' + n + ' 뒤') + '에 장 추가', before: '', after: nu.title || S.LAYOUTS[nu.layout].label });
      }
    } else if (e.op === 'delete_slide') {
      plan[n - 1].del = true;
      changes.push({ label: 'S' + n + ' 장 지우기', before: orig[n - 1].title || '', after: '' });
    } else if (e.op === 'move_slide') {
      moves.push({ n, to: parseInt(e.to, 10) });
    }
  });
  // 칸 바꾸기: 다시 쓰거나 지울 장의 칸은 건너뛴다.
  edits.filter((e) => e.op === 'set').forEach((e) => {
    const m = /^S(\d+)\.(.+)$/i.exec(s(e.target));
    if (!m || !orig[+m[1] - 1]) { problems.push('없는 칸이라 고치지 못했습니다: ' + s(e.target)); return; }
    const i = +m[1] - 1, path = m[2], sl = orig[i];
    if (plan[i].replace || plan[i].del) return;
    if (!fieldOk(sl, path)) { problems.push('고칠 수 없는 칸입니다: ' + s(e.target)); return; }
    const before = s(S.getPath(sl, path)), after = String(e.text == null ? '' : e.text);
    if (before === after.trim()) return;
    S.setPath(sl, path, after);
    changes.push({ label: labelOf(i + 1, path), before, after });
  });
  const next = head.slice();
  orig.forEach((sl, i) => { const p = plan[i]; if (!p.del) next.push(p.replace || sl); next.push(...p.after); });
  // 옮기기: to는 모든 작업을 마친 뒤의 자리(1부터)
  moves.forEach(({ n, to }) => {
    const p = plan[n - 1]; if (p.del) return;
    const ref = p.replace || orig[n - 1], i = next.indexOf(ref); if (i < 0) return;
    next.splice(i, 1);
    const k = Math.max(1, Math.min(next.length + 1, to || 1));
    next.splice(k - 1, 0, ref);
    changes.push({ label: 'S' + n + ' → ' + k + '번째 자리', before: '', after: ref.title || '' });
  });
  deck.slides = next;
  renumber(deck);
  return { changes, problems };
}

/* ── 확인: 코드가 센 값 ── */
function overflowSlides(deck) {
  const bad = [];
  deck.slides.forEach((sl, i) => {
    const over = S.shapesFor(deck, i).some((sh) => {
      if (sh.t !== 'text' || !sh.path) return false;
      const size = sh.paras[0] && sh.paras[0][0] ? sh.paras[0][0].size : 14;
      const len = sh.paras.map((p) => p.map((r) => r.text).join('')).join('').length;
      const perLine = Math.max(1, Math.floor((sh.w * 72) / (size * 0.98)));
      const lines = Math.max(1, Math.floor((sh.h * 72 + size * 0.3) / (size * 1.2 * sh.line)));
      const need = sh.paras.reduce((a, p) => a + Math.max(1, Math.ceil(p.map((r) => r.text).join('').length / perLine)), 0);
      return len > 0 && need > lines;
    });
    if (over) bad.push(i + 1);
  });
  return bad;
}
export function checkDeck(deck) {
  const n = deck.slides.length, out = ['총 ' + n + '장'];
  const empty = deck.slides.map((sl, i) => (!s(sl.title) && sl.layout !== 'end' ? i + 1 : 0)).filter(Boolean);
  if (empty.length) out.push('제목이 빈 장: ' + empty.map((x) => 'S' + x).join(', '));
  const body = deck.slides.filter((sl) => !['cover', 'agenda', 'section', 'end'].includes(sl.layout));
  const withSrc = body.filter((sl) => s(sl.source)).length;
  if (body.length) out.push('본문 ' + body.length + '장 중 출처 표시 ' + withSrc + '장');
  const cut = deck.slides.map((sl, i) => (sl.layout === 'table' && Array.isArray(sl.rows) && (sl.rows.length > 8 || sl.rows.some((r) => r.length > 5)) ? i + 1 : 0)).filter(Boolean);
  if (cut.length) out.push('표가 8줄·5칸을 넘어 일부가 빠진 장: ' + cut.map((x) => 'S' + x).join(', '));
  const over = overflowSlides(deck);
  if (over.length) out.push('글이 칸을 넘칠 수 있는 장: ' + over.map((x) => 'S' + x).join(', '));
  return out;
}

/* ── 자료로 쓸 때의 글 ── */
export function deckText(deck) {
  return deck.slides.map((sl, i) => {
    const parts = [];
    const walk = (v) => { if (v == null) return; if (typeof v === 'string' || typeof v === 'number') { if (String(v).trim()) parts.push(String(v)); } else if (Array.isArray(v)) v.forEach(walk); else Object.keys(v).forEach((k) => { if (k !== 'layout' && k !== 'no') walk(v[k]); }); };
    walk(sl);
    return '슬라이드 ' + (i + 1) + ': ' + parts.join(' / ');
  }).join('\n');
}

/* ── 화면 ── */
// assets: { key: url }
export function createDeckView(t, opts) {
  const box = document.createElement('div');
  box.className = 'deck';
  box.innerHTML = `<div class="deck-head"><span class="deck-meta"></span><span class="spacer"></span>
      <button class="btn small" type="button" data-act="up" title="이 장을 앞으로">앞으로</button>
      <button class="btn small" type="button" data-act="down" title="이 장을 뒤로">뒤로</button>
      <button class="btn small danger" type="button" data-act="del">이 장 지우기</button></div>
    <div class="deck-stage"><div class="deck-frame"></div><div class="deck-empty" hidden></div></div>
    <label class="deck-notes-label" for="deck-notes-${t.id}">발표 노트</label>
    <textarea class="deck-notes" id="deck-notes-${t.id}" rows="3" placeholder="이 장에서 말할 내용을 적습니다. 파워포인트의 슬라이드 노트로 들어갑니다."></textarea>
    <div class="deck-thumbs" role="list" aria-label="슬라이드 목록"></div>`;
  const frame = box.querySelector('.deck-frame'), thumbs = box.querySelector('.deck-thumbs'), notes = box.querySelector('.deck-notes');
  const empty = box.querySelector('.deck-empty');
  t.cur = t.cur || 0;
  const scaleTo = (el, width) => { const sc = width / (S.W * 96); el.style.height = (S.H * 96 * sc) + 'px'; const p = el.firstElementChild; if (p) { p.style.transform = 'scale(' + sc + ')'; p.style.transformOrigin = '0 0'; } };
  const fit = () => scaleTo(frame, frame.clientWidth || 800);
  new ResizeObserver(fit).observe(frame);
  let editing = false;
  function renderMain() {
    const d = t.deck, n = d.slides.length;
    box.querySelector('.deck-meta').textContent = n ? (S.THEMES[d.theme] || {}).name + ' 양식 · ' + n + '장 · ' + (t.cur + 1) + '번째 장 보는 중' : '';
    box.querySelectorAll('.deck-head button').forEach((b) => { b.disabled = !n || opts.isBusy(); });
    empty.hidden = !!n; frame.hidden = !n; notes.hidden = !n; box.querySelector('.deck-notes-label').hidden = !n;
    if (!n) { empty.innerHTML = opts.emptyHtml(t); return; }
    if (t.cur >= n) t.cur = n - 1;
    frame.innerHTML = S.renderHtml(d, t.cur, opts.assets, { editable: !opts.isBusy() });
    fit();
    notes.value = d.slides[t.cur].notes || '';
    notes.disabled = opts.isBusy();
  }
  function renderThumbs() {
    const d = t.deck;
    thumbs.innerHTML = d.slides.map((sl, i) => `<button type="button" class="deck-thumb${i === t.cur ? ' on' : ''}" role="listitem" data-i="${i}" aria-label="${i + 1}번째 장 ${esc(sl.title || S.LAYOUTS[sl.layout].label)}"><span class="deck-no">${i + 1}</span><span class="deck-mini">${S.renderHtml(d, i, opts.assets)}</span></button>`).join('');
    thumbs.querySelectorAll('.deck-mini').forEach((m) => scaleTo(m, 160));
  }
  function refresh() { if (!editing) renderMain(); renderThumbs(); }
  thumbs.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; t.cur = +b.dataset.i; refresh(); });
  frame.addEventListener('focusin', () => { editing = true; });
  frame.addEventListener('input', (e) => {
    const el = e.target.closest('[data-path]'); if (!el) return;
    S.setPath(t.deck.slides[t.cur], el.dataset.path, el.innerText.replace(/\n$/, ''));
    opts.onEdit();
  });
  frame.addEventListener('focusout', () => { editing = false; setTimeout(() => { if (!frame.contains(document.activeElement)) { renderThumbs(); } }, 0); });
  notes.addEventListener('input', () => { const sl = t.deck.slides[t.cur]; if (sl) { sl.notes = notes.value; opts.onEdit(); } });
  box.querySelector('.deck-head').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || opts.isBusy()) return;
    const d = t.deck, i = t.cur;
    if (b.dataset.act === 'del') {
      if (!confirm((i + 1) + '번째 장을 지울까요?')) return;
      d.slides.splice(i, 1);
    } else {
      const j = b.dataset.act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= d.slides.length) return;
      d.slides.splice(j, 0, d.slides.splice(i, 1)[0]); t.cur = j;
    }
    renumber(d); opts.onEdit(); refresh();
  });
  box.refresh = refresh;
  refresh();
  return box;
}

/* ── 파워포인트로 받기 ── */
let pptxLib = null;
function loadPptxLib(src) {
  if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
  if (!pptxLib) pptxLib = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = src;
    sc.onload = () => (window.PptxGenJS ? res(window.PptxGenJS) : rej(new Error('파워포인트 도구를 불러오지 못했습니다.')));
    sc.onerror = () => { pptxLib = null; rej(new Error('파워포인트 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
    document.head.appendChild(sc);
  });
  return pptxLib;
}
async function toDataUrl(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('그림을 불러오지 못했습니다.');
  const b = await r.blob();
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
}
export async function buildPptxBlob(deck, assets, libUrl) {
  const PptxGenJS = await loadPptxLib(libUrl);
  const data = {};
  for (const [k, url] of Object.entries(assets || {})) { try { data[k] = { data: await toDataUrl(url) }; } catch (e) { console.warn(e); } }
  const pptx = new PptxGenJS();
  S.buildPptx(pptx, deck, data);
  const raw = await pptx.write({ outputType: 'arraybuffer' });
  return S.finalizePptx(raw, window.JSZip);
}

/* ── 덱 만들기(장 구성 → 6장씩 채우기) ── */
export async function generateDeck(t, ctx, call, say, onProgress) {
  say('장 구성을 짜는 중…');
  const ol = await call(outlinePrompt(ctx), OUTLINE_SCHEMA);
  const outline = { title: s(ol && ol.title) || ctx.name, slides: list(ol && ol.slides).slice(0, MAX_SLIDES)
    .map((o) => ({ layout: LAYOUT_KEYS.includes(o && o.layout) ? o.layout : 'bullets', title: s(o && o.title), plan: s(o && o.plan) })) };
  if (!outline.slides.length) throw new Error('AI가 장 구성을 만들지 못했습니다. 요청을 조금 더 구체적으로 적어 다시 보내 주세요.');
  t.deck.title = outline.title;
  const problems = [];
  for (let from = 0; from < outline.slides.length; from += BATCH) {
    const to = Math.min(outline.slides.length, from + BATCH);
    say('슬라이드 ' + (from + 1) + '~' + to + '번을 채우는 중… (전체 ' + outline.slides.length + '장)');
    let got = [], failed = false;
    try { const r = await call(fillPrompt(ctx, outline, from, to), FILL_SCHEMA); got = list(r && r.slides); }
    catch (e) {
      if (!t.deck.slides.length) throw e;
      failed = true;
      problems.push((from + 1) + '~' + to + '번 장을 채우지 못해 제목만 넣었습니다: ' + (e.message || e));
      // 인증·한도 오류면 남은 장도 같은 이유로 실패한다. 더 부르지 않고 제목만 채운다.
      if (/401|403|429|한도|권한|키|quota|설정/i.test(String(e && (e.status || '') + ' ' + (e.message || '')))) {
        for (let i = from; i < outline.slides.length; i++) { const o = outline.slides[i]; t.deck.slides.push(normalizeSlide({ layout: o.layout, title: o.title })); }
        if (to < outline.slides.length) problems.push((to + 1) + '번 장부터는 같은 이유로 만들지 않고 제목만 넣었습니다. 다시 보내 내용을 채워 주세요.');
        renumber(t.deck); onProgress();
        break;
      }
    }
    for (let i = from; i < to; i++) {
      const o = outline.slides[i];
      let u = got[i - from];
      if (!u || !s(u.title) && !list(u.items).length) {
        if (!failed) problems.push((i + 1) + '번 장 내용이 비어 제목만 넣었습니다.');
        u = { layout: o.layout, title: o.title };
      }
      u.layout = o.layout;
      t.deck.slides.push(normalizeSlide(u));
    }
    renumber(t.deck);
    onProgress();
  }
  return { reply: s(ol.reply), problems };
}
