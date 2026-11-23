// 퀴즈 진행 화면(교실 화면·발표 화면 공용). 진행 화면은 교사 조작 버튼까지, 발표 화면은 보이는 부분만 그린다.
import { el } from './common.js';
import { MOODS } from './music.js';

export const AVATARS = ['face_smile', 'face_laugh', 'face_sparkle', 'face_fist', 'face_calm', 'face_thinking', 'face_shy', 'face_surprised'];
export const avatarUrl = (i) => `/img/daeryuni/${AVATARS[i] || AVATARS[0]}.webp`;
export const LETTERS = ['가', '나', '다', '라'];
const TYPE_LABEL = { choice: '고르기', ox: 'OX', order: '순서 맞추기', short: '단답형' };

// DOM append는 null을 'null' 글자로 붙인다. 빈 자리는 걸러 낸다.
const keep = (kids) => kids.flat().filter((k) => k !== null && k !== undefined && k !== false && k !== '');
const add = (node, ...kids) => node.append(...keep(kids));
const addFirst = (node, ...kids) => node.prepend(...keep(kids));

let clock = null;

// 색종이 한 조각. 자리와 떨어지는 시간을 조각마다 다르게 한다(무작위 없이 같은 모양으로 되풀이).
function confettiPiece(i) {
  const piece = el('i', { class: `k${i % 6}` });
  piece.style.left = `${(i * 37) % 100}%`;
  piece.style.animationDelay = `${((i * 7) % 30) / 10}s`;
  piece.style.animationDuration = `${2.6 + ((i * 13) % 12) / 10}s`;
  return piece;
}

function timerBar(view, onTick) {
  const fill = el('div', { class: 'qz-timefill' });
  const num = el('span', { class: 'qz-timenum' });
  const deadline = Date.now() + (view.remainingMs || 0);
  const total = (view.q?.time || 20) * 1000;
  const draw = () => {
    const left = view.paused ? view.remainingMs : Math.max(0, deadline - Date.now());
    fill.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
    fill.classList.toggle('hurry', left <= 5000);
    num.textContent = String(Math.ceil(left / 1000));
    onTick && onTick(left);
  };
  draw();
  clearInterval(clock);
  if (!view.paused) clock = setInterval(draw, 200);
  return el('div', { class: 'qz-timer' }, el('div', { class: 'qz-timebar' }, fill), num);
}

const D = (name) => `/img/daeryuni/${name}.webp`;
// 대륜이와 말풍선. 장면마다 학생 입장에서 한마디를 건넨다.
const buddy = (img, text, cls = '') => el('div', { class: `qz-buddy ${cls}` }, el('p', { class: 'qz-bubble' }, text), el('img', { src: D(img), alt: '' }));

const btn = (label, action, arg, cls = 'btn-ghost btn-sm', onAction) => el('button', { type: 'button', class: cls, onclick: () => onAction(action, arg) }, label);

function playerChip(p, teacher, onAction) {
  return el('li', { class: 'qz-chip' },
    el('img', { src: avatarUrl(p.avatar), alt: '' }),
    el('span', {}, p.name),
    teacher ? el('span', { class: 'qz-chip-tools' },
      btn('이름 초기화', 'reset-name', p.pid, 'btn-ghost btn-xs', onAction),
      btn('내보내기', 'kick', p.pid, 'btn-ghost btn-xs', onAction)) : null);
}

function choiceGrid(view, reveal) {
  const q = view.q;
  if (q.type === 'order') {
    return el('ol', { class: 'qz-order' }, ...q.items.map((it, i) => {
      const pos = reveal ? reveal.answer.indexOf(it.id) : -1;
      return el('li', { class: `qz-opt c${i % 4}` }, el('b', {}, reveal ? `${pos + 1}` : LETTERS[i]), el('span', {}, it.text));
    }));
  }
  if (q.type === 'short') {
    return el('div', { class: 'qz-short' }, reveal ? `정답: ${reveal.answer.join(', ')}` : '학생 기기에 답을 적어 보냅니다.');
  }
  const options = q.type === 'ox' ? ['O 맞다', 'X 아니다'] : q.choices;
  const correct = reveal ? (q.type === 'ox' ? (reveal.answer ? 0 : 1) : reveal.answer) : -1;
  const max = reveal ? Math.max(1, ...reveal.dist) : 1;
  return el('div', { class: `qz-grid n${options.length}` }, ...options.map((text, i) => el('div', {
    class: `qz-opt c${q.type === 'ox' ? (i ? 3 : 0) : i}${reveal ? (i === correct ? ' right' : ' dim') : ''}`,
  },
  el('b', {}, q.type === 'ox' ? (i ? 'X' : 'O') : LETTERS[i]),
  el('span', {}, q.type === 'ox' ? (i ? '아니다' : '맞다') : text),
  reveal ? el('span', { class: 'qz-dist' }, el('i', { class: 'qz-distbar' }), `${reveal.dist[i] || 0}명`) : null)));
}

function fixDistBars(root, view) {
  if (!view.reveal || !view.reveal.dist) return;
  const max = Math.max(1, ...view.reveal.dist);
  root.querySelectorAll('.qz-distbar').forEach((b, i) => { b.style.width = `${((view.reveal.dist[i] || 0) / max) * 100}%`; });
}

// 같은 단계 안에서는 응답 수와 명단만 바꾼다. 학생이 답할 때마다 화면 전체를 다시 그리면
// 선생님이 누르던 버튼이 사라질 수 있기 때문이다.
export function renderHostView(root, view, opts = {}) {
  const key = [view.phase, view.qIndex, view.paused, view.countdown, view.mood, view.speed, view.muted, view.remainingMs > 0 && view.paused ? view.remainingMs : ''].join('|');
  if (root.dataset.key === key && root.firstChild) {
    const count = root.querySelector('.qz-count');
    if (count) count.textContent = `참여 ${view.count}명`;
    const answered = root.querySelector('.qz-answered');
    if (answered) answered.textContent = `응답 ${view.answered} / ${view.count}`;
    if (view.phase === 'lobby') {
      const chips = root.querySelector('.qz-chips');
      if (chips) chips.replaceChildren(...view.players.map((p) => playerChip(p, opts.teacher, opts.onAction || (() => {}))));
      const empty = root.querySelector('.qz-empty');
      if (empty) empty.hidden = view.players.length > 0;
    }
    return;
  }
  root.dataset.key = key;
  draw(root, view, opts);
}

function draw(root, view, { teacher = false, onAction = () => {}, onTick } = {}) {
  clearInterval(clock);
  const head = el('div', { class: 'qz-head' },
    el('span', { class: 'qz-title' }, view.title || '퀴즈'),
    view.qIndex >= 0 && view.total ? el('span', { class: 'qz-progress' }, `문제 ${view.qIndex + 1} / ${view.total}`) : null,
    el('span', { class: 'qz-count' }, `참여 ${view.count}명`),
    view.code ? el('span', { class: 'qz-code' }, view.code) : null);
  const body = el('div', { class: `qz-body phase-${view.phase}` });
  const tools = el('div', { class: 'qz-tools' });

  if (view.phase === 'lobby') {
    add(body, 
      el('div', { class: 'qz-lobby' },
        el('img', { class: 'qz-host', src: '/img/teacher/presenter.webp', alt: '' }),
        el('div', {},
          el('p', { class: 'qz-big' }, '퀴즈 대기실'),
          el('p', {}, `${view.url} 에서 참여 코드를 넣어 주세요.`),
          el('div', { class: 'qz-bigcode' }, view.code || ''),
          el('p', { class: 'qz-sub' }, `${view.total}문제 · ${view.speed ? '빨리 맞히면 점수가 더 높습니다' : '맞히면 같은 점수를 받습니다'}`))),
      el('div', { class: 'qz-lobby-row' },
        el('ul', { class: 'qz-chips' }, ...view.players.map((p) => playerChip(p, teacher, onAction))),
        buddy('pose_wave', view.players.length ? `벌써 ${view.count}명이 모였어요!` : '참여 코드를 넣고 들어오세요!', 'lobby')),
      el('p', { class: 'qz-sub qz-center qz-empty', hidden: view.players.length > 0 }, '아직 들어온 학생이 없습니다.'));
    if (teacher) {
      add(tools, 
        el('span', { class: 'qz-label' }, '음악'),
        ...MOODS.map((m) => el('button', { type: 'button', class: 'btn-ghost btn-sm', 'aria-pressed': String(view.mood === m.id), title: m.hint, onclick: () => onAction('mood', m.id) }, m.label)),
        el('button', { type: 'button', class: 'btn-ghost btn-sm', 'aria-pressed': String(view.speed), onclick: () => onAction('speed') }, '속도 점수'),
        el('span', { class: 'grow' }),
        btn('퀴즈 시작', 'start', null, 'btn-gold', onAction));
    }
  } else if (view.phase === 'countdown') {
    add(body, el('div', { class: 'qz-countdown' },
      el('img', { src: '/img/teacher/pointing.webp', alt: '' }),
      el('div', { class: 'qz-picket' },
        el('img', { src: D('pose_picket'), alt: '' }),
        el('span', { class: 'qz-picket-num' }, String(view.countdown))),
      el('p', { class: 'qz-big' }, `문제 ${view.qIndex + 1}`, el('br'), el('span', { class: 'qz-sub' }, '준비됐나요?'))));
  } else if (view.phase === 'question') {
    const helper = buddy('face_thinking', view.paused ? '잠깐 쉬어 갈게요' : '천천히 읽어 보세요', 'question');
    const hurry = (left) => {
      const late = left <= 5000 && !view.paused;
      if (helper.dataset.late === String(late)) return;
      helper.dataset.late = String(late);
      helper.querySelector('img').src = D(late ? 'face_surprised' : 'face_thinking');
      helper.querySelector('.qz-bubble').textContent = late ? '5초 남았어요!' : view.paused ? '잠깐 쉬어 갈게요' : '천천히 읽어 보세요';
      onTick && onTick(left);
    };
    add(body, 
      el('div', { class: 'qz-qhead' }, el('span', { class: 'qz-type' }, TYPE_LABEL[view.q.type]), view.q.double ? el('span', { class: 'qz-double' }, '2배 점수') : null, timerBar(view, hurry)),
      el('h2', { class: 'qz-prompt' }, view.q.prompt),
      ...(view.q.image ? [el('img', { class: 'qz-img', src: view.q.image, alt: '문항 그림' })] : []),
      choiceGrid(view),
      el('div', { class: 'qz-foot' }, el('p', { class: 'qz-answered' }, `응답 ${view.answered} / ${view.count}`), helper));
    if (teacher) {
      add(tools, 
        btn(view.paused ? '이어 하기' : '일시 정지', 'pause', null, 'btn-ghost btn-sm', onAction),
        btn('10초 더', 'more-time', null, 'btn-ghost btn-sm', onAction),
        el('span', { class: 'grow' }),
        btn('정답 공개', 'close', null, 'btn-gold', onAction));
    }
  } else if (view.phase === 'reveal') {
    const r = view.reveal;
    add(body, 
      el('div', { class: 'qz-qhead' }, el('span', { class: 'qz-type' }, TYPE_LABEL[view.q.type]), view.q.double ? el('span', { class: 'qz-double' }, '2배 점수') : null, el('span', { class: 'qz-rate' }, `정답률 ${r.rate}%`)),
      el('h2', { class: 'qz-prompt' }, view.q.prompt),
      ...(view.q.image ? [el('img', { class: 'qz-img small', src: view.q.image, alt: '문항 그림' })] : []),
      choiceGrid(view, r),
      el('div', { class: 'qz-explain' },
        el('img', { src: r.rate >= 70 ? '/img/teacher/thumbs_up.webp' : '/img/teacher/idea.webp', alt: '' }),
        el('div', { class: 'qz-explain-text' }, el('p', {}, r.explain), el('p', { class: 'qz-ref' }, [r.ref?.page ? `교과서 ${r.ref.page}쪽` : '', r.ref?.slide ? `슬라이드 ${r.ref.slide}장` : ''].filter(Boolean).join(' · ')),
          teacher && r.teacherNote ? el('p', { class: 'qz-tnote' }, el('b', {}, '교사 메모 '), r.teacherNote) : null),
        buddy(r.rate >= 70 ? 'face_fist' : r.rate >= 40 ? 'face_smile' : 'face_thinking',
          r.rate >= 70 ? '다들 잘했어요!' : r.rate >= 40 ? '절반 넘게 맞혔어요' : '해설을 같이 봐요', 'reveal')));
    if (teacher) {
      add(tools, 
        r.ref?.slide ? btn(`슬라이드 ${r.ref.slide}장 보기`, 'goto-slide', r.ref.slide, 'btn-ghost btn-sm', onAction) : null,
        el('span', { class: 'grow' }),
        btn(view.qIndex + 1 >= view.total ? '최종 순위' : '순위 보기', 'next', null, 'btn-gold', onAction));
    }
  } else if (view.phase === 'board') {
    add(body, el('h2', { class: 'qz-prompt qz-center' }, '지금 순위'),
      el('ol', { class: 'qz-board' }, ...view.board.map((p) => el('li', { class: p.rank === 1 ? 'top' : '' },
        el('b', {}, `${p.rank}`),
        el('img', { src: avatarUrl(p.avatar), alt: '' }),
        el('span', { class: 'name' }, p.name),
        p.prevRank && p.prevRank > p.rank ? el('span', { class: 'up' }, `▲${p.prevRank - p.rank}`) : null,
        el('span', { class: 'score' }, `${p.score.toLocaleString()}점`)))),
      view.lead ? el('p', { class: 'qz-lead' }, `${view.lead}이(가) 1위로 올라섰습니다!`) : null,
      view.board[0] ? buddy('pose_thumb', `${view.board[0].name}, 지금 1위예요!`, 'board') : null);
    if (teacher) add(tools, el('span', { class: 'grow' }), btn('다음 문제', 'next', null, 'btn-gold', onAction));
  } else if (view.phase === 'podium') {
    const [first, second, third] = view.podium;
    const stand = (p, place) => el('div', { class: `qz-stand p${place}` },
      p ? el('img', { src: avatarUrl(p.avatar), alt: '' }) : null,
      el('span', { class: 'name' }, p ? p.name : ''),
      el('span', { class: 'score' }, p ? `${p.score.toLocaleString()}점` : ''),
      el('div', { class: 'block' }, `${place}`));
    add(body, el('div', { class: 'qz-confetti', 'aria-hidden': 'true' }, ...Array.from({ length: 36 }, (_, i) => confettiPiece(i))),
      el('h2', { class: 'qz-prompt qz-center' }, '최종 순위'),
      el('div', { class: 'qz-podium' }, stand(second, 2), stand(first, 1), stand(third, 3)),
      el('img', { class: 'qz-celebrate', src: '/img/teacher/celebration.webp', alt: '' }),
      el('img', { class: 'qz-celebrate left', src: D('pose_raise'), alt: '' }));
    if (teacher) add(tools, el('span', { class: 'grow' }), btn('문항별 결과', 'next', null, 'btn-gold', onAction));
  } else if (view.phase === 'end') {
    add(body, el('h2', { class: 'qz-prompt' }, '문항별 결과'),
      el('div', { class: 'qz-summary' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, '문항'), el('th', {}, '정답률'), el('th', {}, '평균 응답 시간'), el('th', {}, '근거'))),
        el('tbody', {}, ...view.summary.map((s) => el('tr', { class: s.rate < 50 ? 'low' : '' },
          el('td', {}, `${s.n}. ${s.prompt}`), el('td', {}, `${s.rate}%`), el('td', {}, s.avg ? `${s.avg}초` : '-'),
          el('td', {}, [s.page ? `${s.page}쪽` : '', s.slide ? `${s.slide}장` : ''].filter(Boolean).join(' · '))))))),
      el('div', { class: 'qz-foot' }, el('p', { class: 'qz-sub' }, '정답률이 50% 아래인 문항은 붉게 표시했습니다.'),
        buddy('pose_mentor', '붉은 문항은 슬라이드로 다시 짚어 봐요', 'end')));
    if (teacher) {
      add(tools, btn('결과 내려받기(CSV)', 'download-csv', null, 'btn-ghost btn-sm', onAction),
        btn('결과 내려받기(JSON)', 'download-json', null, 'btn-ghost btn-sm', onAction),
        el('span', { class: 'grow' }), btn('퀴즈 종료', 'next', null, 'btn-gold', onAction));
    }
  } else if (view.phase === 'done') {
    // 종료 화면: 교실 화면에는 마무리 인사와 요약을, 진행 화면에는 내려받기와 돌아가기 버튼을 둔다.
    const c = view.closing || { players: 0, asked: 0, total: 0, avgRate: 0, avgScore: 0, low: [] };
    const tile = (value, unit, label) => el('div', { class: 'qz-tile' }, el('b', {}, value, el('small', {}, unit)), el('span', {}, label));
    add(body,
      el('div', { class: 'qz-done-head' },
        el('img', { src: '/img/teacher/thumbs_up.webp', alt: '' }),
        el('div', {},
          el('p', { class: 'qz-big' }, '퀴즈를 마쳤습니다'),
          el('p', { class: 'qz-sub' }, c.stopped ? `전체 ${c.total}문제 가운데 ${c.asked}문제까지 풀었습니다.` : `${c.asked}문제를 모두 풀었습니다.`),
          el('p', { class: 'qz-sub' }, '내 기기에서 문항별 내 답과 해설을 확인하세요.')),
        buddy('pose_thumb', '끝까지 함께해 줘서 고마워요', 'done')),
      el('div', { class: 'qz-tiles' },
        tile(`${c.players}`, '명', '참여'),
        tile(`${c.avgRate}`, '%', '평균 정답률'),
        tile(c.avgScore.toLocaleString(), '점', '평균 점수')),
      el('div', { class: 'qz-done-cols' },
        el('section', {},
          el('h3', {}, '최종 순위'),
          view.podium.length ? el('ol', { class: 'qz-board' }, ...view.podium.map((p) => el('li', { class: p.rank === 1 ? 'top' : '' },
            el('b', {}, `${p.rank}`), el('img', { src: avatarUrl(p.avatar), alt: '' }), el('span', { class: 'name' }, p.name), el('span', { class: 'score' }, `${p.score.toLocaleString()}점`))))
            : el('p', { class: 'qz-sub' }, '참여한 학생이 없습니다.')),
        el('section', {},
          el('h3', {}, '다시 짚을 문항'),
          c.low.length ? el('ol', { class: 'qz-low' }, ...c.low.map((s) => el('li', {},
            el('span', { class: 'rate' }, `${s.rate}%`),
            el('span', { class: 'txt' }, `${s.n}. ${s.prompt}`),
            teacher && s.slide ? btn(`${s.slide}장 보기`, 'goto-slide', s.slide, 'btn-ghost btn-xs', onAction) : null)))
            : el('p', { class: 'qz-sub' }, '정답률이 50% 아래인 문항이 없습니다.'))));
    if (teacher) {
      add(tools, btn('결과 내려받기(CSV)', 'download-csv', null, 'btn-ghost btn-sm', onAction),
        btn('결과 내려받기(JSON)', 'download-json', null, 'btn-ghost btn-sm', onAction),
        btn('문항별 결과', 'back-summary', null, 'btn-ghost btn-sm', onAction),
        el('span', { class: 'grow' }), btn('슬라이드로 돌아가기', 'finish', null, 'btn-gold', onAction));
    }
  }

  if (teacher) {
    addFirst(tools, 
      btn(view.muted ? '소리 켜기' : '소리 끄기', 'mute', null, 'btn-ghost btn-sm', onAction),
      btn('전체 화면', 'full', null, 'btn-ghost btn-sm', onAction),
      view.phase !== 'lobby' ? btn('참가자', 'people', null, 'btn-ghost btn-sm', onAction) : btn('퀴즈 나가기', 'leave', null, 'btn-ghost btn-sm', onAction),
      // 문제를 다 내기 전에 끝내야 할 때(종이 울릴 때)를 위한 버튼.
      ['countdown', 'question', 'reveal', 'board'].includes(view.phase) ? btn('퀴즈 끝내기', 'stop', null, 'btn-ghost btn-sm', onAction) : null);
  }
  root.replaceChildren(head, body, teacher ? tools : '');
  fixDistBars(root, view);
}
