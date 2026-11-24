// 학생 기기의 퀴즈 참여 화면: 대화명 정하기, 답 고르기, 내 결과 보기.
import { el } from './common.js';
import { AVATARS, avatarUrl, LETTERS } from './quiz-view.js';
import { validName } from './filter.js';
import { createMusic } from './music.js';

export function createQuizPlayer(root, { pid, send, code }) {
  const sfxOn = () => localStorage.getItem('ait_quiz_sfx') === '1';
  let music = null;
  const play = (name) => { if (!sfxOn()) return; music = music || createMusic(); music.sfx(name); };
  const kickKey = `ait_kicked_${code}`;
  let me = { name: sessionStorage.getItem('ait_quiz_name') || '', avatar: Number(sessionStorage.getItem('ait_quiz_avatar') || 0), joined: false, locked: false, no: null };
  let view = null;
  let you = null;
  let sentQ = -1;
  let picked = [];
  let formError = '';
  let kicked = localStorage.getItem(kickKey) === '1';
  let timerClock = null;
  let rejoinSent = false;
  let draftName = null;
  let finalReport = null;
  let onlyWrong = true;
  let shortDraft = '';

  // 입력을 받는 화면(대화명 적기, 문제 풀기)의 열쇠. 같은 열쇠면 화면을 새로 만들지 않는다.
  function stableKey() {
    if (kicked || !view) return '';
    if (!me.joined) return 'join';
    if (view.phase === 'question' && sentQ !== view.qIndex) return `q|${view.qIndex}|${view.paused ? 1 : 0}`;
    // 내 결과를 읽는 동안 선생님이 오답 보기를 넘겨도 읽던 자리가 그대로 남는다.
    if (finalReport && ['podium', 'end', 'done', 'review'].includes(view.phase)) return 'report';
    return '';
  }

  // 같은 화면에서 바뀌는 것은 남은 시간뿐이다("10초 더").
  function refresh() {
    const bar = root.querySelector('.qz-timebar');
    if (bar && view.phase === 'question') bar.replaceWith(timer());
  }

  function join() {
    send({ type: 'quiz-join', pid, name: me.name, avatar: me.avatar });
  }

  function onMessage(msg) {
    if (msg.type === 'quiz') {
      const prev = view;
      view = msg.view;
      if (view.phase === 'question' && (!prev || prev.qIndex !== view.qIndex || prev.phase !== 'question')) { picked = []; shortDraft = ''; }
      if (view.phase === 'countdown' && prev?.phase !== 'countdown') play('count');
      if (!me.joined && !kicked && !rejoinSent && sessionStorage.getItem('ait_quiz_joined') === code) { rejoinSent = true; join(); }
      // 다른 학생이 답하거나 들어올 때마다 같은 화면이 다시 온다. 입력 중인 칸을 새로 만들면
      // 적던 글과 한글 조합이 사라지므로, 화면이 같으면 남은 시간만 고친다.
      const key = stableKey();
      if (key && root.dataset.key === key && root.firstChild) { refresh(); return; }
      paint();
    } else if (msg.pid !== pid) {
      return;
    } else if (msg.type === 'quiz-name') {
      me.joined = true;
      me.no = msg.no;
      me.locked = msg.locked;
      if (msg.rejected) formError = '바른 말로 된 대화명만 쓸 수 있어 자동 이름을 붙였습니다.';
      if (msg.reset) formError = '선생님이 대화명을 바꿨습니다.';
      me.name = msg.name;
      sessionStorage.setItem('ait_quiz_joined', code);
      paint();
    } else if (msg.type === 'quiz-you') {
      const before = you;
      you = msg;
      if (msg.phase === 'reveal' && before?.phase !== 'reveal' && msg.answered !== null) play(msg.correct ? 'correct' : 'wrong');
      paint();
    } else if (msg.type === 'quiz-report') {
      finalReport = msg;
      paint();
    } else if (msg.type === 'quiz-got') {
      sentQ = msg.q;
      paint();
    } else if (msg.type === 'kick') {
      kicked = true;
      localStorage.setItem(kickKey, '1');
      paint();
    }
  }

  const card = (img, title, ...rest) => el('div', { class: 'qp-card' }, el('img', { src: img, alt: '' }), el('h2', {}, title), ...rest);
  const scoreLine = () => you ? el('p', { class: 'qp-score' }, `${you.score.toLocaleString()}점${you.rank ? ` · ${you.rank}위` : ''}`) : null;

  function joinForm() {
    const nameInput = el('input', { id: 'qp-name', maxlength: '12', autocomplete: 'off', value: draftName ?? me.name, placeholder: '예: 펭귄탐험가' });
    nameInput.addEventListener('input', () => { draftName = nameInput.value; });
    const avatars = el('div', { class: 'qp-avatars', role: 'radiogroup', 'aria-label': '대륜이 표정 고르기' }, ...AVATARS.map((_, i) => el('button', {
      type: 'button', class: 'qp-avatar', role: 'radio', 'aria-checked': String(i === me.avatar), 'aria-label': `표정 ${i + 1}`,
      onclick: (e) => {
        // 표정만 바꾸고 화면은 다시 그리지 않는다. 입력 중인 대화명이 지워지지 않게 한다.
        me.avatar = i;
        e.currentTarget.parentElement.querySelectorAll('.qp-avatar').forEach((b, k) => b.setAttribute('aria-checked', String(k === i)));
      },
    }, el('img', { src: avatarUrl(i), alt: '' }))));
    const msg = el('p', { class: 'msg error', role: 'alert' }, formError);
    const submit = (e) => {
      e.preventDefault();
      const checked = validName(nameInput.value);
      if (!checked.ok) { formError = checked.message; msg.textContent = formError; nameInput.focus(); return; }
      me.name = checked.name;
      sessionStorage.setItem('ait_quiz_name', me.name);
      sessionStorage.setItem('ait_quiz_avatar', String(me.avatar));
      formError = '';
      sessionStorage.setItem('ait_quiz_joined', code);
      join();
    };
    return el('form', { class: 'qp-card qp-join', onsubmit: submit },
      el('div', { class: 'qp-hello' }, el('img', { src: '/img/daeryuni/pose_wave.webp', alt: '' }), el('p', { class: 'qz-bubble' }, '반가워요! 대화명과 표정을 골라 주세요.')),
      el('h2', {}, '퀴즈에 참여하기'),
      el('label', { for: 'qp-name' }, '대화명'),
      nameInput,
      el('p', { class: 'hint' }, '12자 이내. 비워 두면 "대륜이 번호"로 정해집니다. 선생님이 바꿀 수 있습니다.'),
      el('label', {}, '대륜이 표정'),
      avatars,
      msg,
      el('button', { type: 'submit', class: 'btn-gold' }, '참여하기'));
  }

  function answerUi() {
    const q = view.q;
    const sendAnswer = (answer) => { send({ type: 'quiz-answer', pid, q: view.qIndex, answer }); sentQ = view.qIndex; paint(); };
    if (q.type === 'choice') {
      return el('div', { class: `qp-grid n${q.choices.length}` }, ...q.choices.map((text, i) => el('button', { type: 'button', class: `qz-opt c${i}`, onclick: () => sendAnswer(i) }, el('b', {}, LETTERS[i]), el('span', {}, text))));
    }
    if (q.type === 'ox') {
      return el('div', { class: 'qp-grid n2' },
        el('button', { type: 'button', class: 'qz-opt c0', onclick: () => sendAnswer(true) }, el('b', {}, 'O'), el('span', {}, '맞다')),
        el('button', { type: 'button', class: 'qz-opt c3', onclick: () => sendAnswer(false) }, el('b', {}, 'X'), el('span', {}, '아니다')));
    }
    if (q.type === 'order') {
      const done = picked.length === q.items.length;
      return el('div', { class: 'qp-order' },
        el('p', { class: 'hint' }, '처음부터 차례로 누르세요. 다시 누르면 취소됩니다.'),
        ...q.items.map((it, i) => {
          const pos = picked.indexOf(it.id);
          return el('button', { type: 'button', class: `qz-opt c${i % 4}${pos >= 0 ? ' picked' : ''}`, onclick: () => { if (pos >= 0) picked = picked.slice(0, pos); else picked.push(it.id); paint(); } },
            el('b', {}, pos >= 0 ? String(pos + 1) : '·'), el('span', {}, it.text));
        }),
        el('button', { type: 'button', class: 'btn-gold', disabled: !done, onclick: () => sendAnswer(picked) }, done ? '이 순서로 보내기' : `${q.items.length - picked.length}개 더 고르기`));
    }
    // 일시 정지처럼 화면을 새로 그릴 때도 적던 답을 되살린다.
    const input = el('input', { class: 'qp-short-input', maxlength: '40', autocomplete: 'off', 'aria-label': '답', value: shortDraft });
    input.addEventListener('input', () => { shortDraft = input.value; });
    return el('form', { class: 'qp-short', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) sendAnswer(input.value.trim()); } }, input, el('button', { type: 'submit', class: 'btn-gold' }, '보내기'));
  }

  function timer() {
    const fill = el('div', { class: 'qz-timefill' });
    const deadline = Date.now() + (view.remainingMs || 0);
    const total = (view.q?.time || 20) * 1000;
    const draw = () => {
      const left = view.paused ? view.remainingMs : Math.max(0, deadline - Date.now());
      fill.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
      fill.classList.toggle('hurry', left <= 5000);
    };
    draw();
    clearInterval(timerClock);
    if (!view.paused) timerClock = setInterval(draw, 200);
    return el('div', { class: 'qz-timebar' }, fill);
  }

  // 최종 결과: 점수와 순위, 문항별 내 답과 정답·해설.
  function reportView() {
    const r = finalReport;
    const wrong = r.items.filter((x) => !x.correct);
    const shown = onlyWrong ? wrong : r.items;
    const face = r.right / r.total >= 0.8 ? 'pose_thumb' : r.right / r.total >= 0.5 ? 'face_smile' : 'face_thinking';
    const line = wrong.length ? `틀린 ${wrong.length}문제를 다시 보면 실력이 더 단단해져요.` : '모든 문제를 맞혔어요. 정말 대단해요!';
    return el('div', { class: 'qp-report' },
      el('div', { class: 'qp-card qp-summary' },
        el('div', { class: 'qp-hello' }, el('img', { src: `/img/daeryuni/${face}.webp`, alt: '' }), el('p', { class: 'qz-bubble' }, line)),
        el('h2', {}, `${r.name}의 최종 결과`),
        el('div', { class: 'qp-stats' },
          el('div', {}, el('b', {}, `${r.score.toLocaleString()}`), el('span', {}, '점')),
          el('div', {}, el('b', {}, r.rank ? `${r.rank}` : '-'), el('span', {}, `위 / ${r.players}명`)),
          el('div', {}, el('b', {}, `${r.right}`), el('span', {}, `문제 맞힘 / ${r.total}`))),
        el('div', { class: 'qp-filter', role: 'group', 'aria-label': '보기' },
          el('button', { type: 'button', class: 'btn-ghost btn-sm', 'aria-pressed': String(onlyWrong), onclick: () => { onlyWrong = true; paint(); } }, `틀린 문제 ${wrong.length}`),
          el('button', { type: 'button', class: 'btn-ghost btn-sm', 'aria-pressed': String(!onlyWrong), onclick: () => { onlyWrong = false; paint(); } }, `전체 ${r.total}`),
          el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: saveReport }, '결과 저장'))),
      shown.length ? el('ol', { class: 'qp-items' }, ...shown.map((x) => el('li', { class: x.correct ? 'ok' : 'no' },
        el('div', { class: 'qp-item-head' }, el('span', { class: 'qp-mark' }, x.correct ? '정답' : '오답'), el('strong', {}, `${x.n}. ${x.prompt}`)),
        el('dl', {},
          el('dt', {}, '내 답'), el('dd', {}, x.mine),
          x.correct ? null : el('dt', {}, '정답'), x.correct ? null : el('dd', { class: 'right' }, x.right)),
        el('p', { class: 'qp-explain' }, x.explain),
        el('p', { class: 'qp-ref' }, [x.page ? `교과서 ${x.page}쪽` : '', x.slide ? `슬라이드 ${x.slide}장` : ''].filter(Boolean).join(' · ')))))
        : el('p', { class: 'qp-card' }, '틀린 문제가 없습니다.'));
  }

  // 내 결과를 글 파일로 남긴다. 이 기기에만 저장된다.
  function saveReport() {
    const r = finalReport;
    const lines = [`${r.name} 퀴즈 결과`, `점수 ${r.score}점 · ${r.rank || '-'}위 / ${r.players}명 · ${r.right}/${r.total}문제 맞힘`, ''];
    for (const x of r.items) {
      lines.push(`${x.n}. [${x.correct ? '정답' : '오답'}] ${x.prompt}`, `   내 답: ${x.mine}`);
      if (!x.correct) lines.push(`   정답: ${x.right}`);
      lines.push(`   해설: ${x.explain}`, `   근거: ${[x.page ? `교과서 ${x.page}쪽` : '', x.slide ? `슬라이드 ${x.slide}장` : ''].filter(Boolean).join(', ')}`, '');
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const a = el('a', { href: url, download: '퀴즈_내결과.txt' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function paint() {
    clearInterval(timerClock);
    const head = el('div', { class: 'qp-head' },
      me.joined ? el('img', { src: avatarUrl(me.avatar), alt: '' }) : null,
      el('span', { class: 'qp-me' }, me.joined ? me.name : '퀴즈'),
      el('button', { type: 'button', class: 'btn-ghost btn-sm', 'aria-pressed': String(sfxOn()), onclick: () => { localStorage.setItem('ait_quiz_sfx', sfxOn() ? '0' : '1'); if (sfxOn()) play('join'); paint(); } }, sfxOn() ? '효과음 끄기' : '효과음 켜기'));
    let body;
    if (kicked) body = card('/img/daeryuni/face_calm.webp', '퀴즈에서 나왔습니다', el('p', {}, '선생님이 이 기기의 참여를 멈췄습니다. 궁금한 점은 선생님께 여쭤 보세요.'));
    else if (!view) body = card('/img/daeryuni/pose_explore.webp', '퀴즈를 준비하고 있습니다');
    else if (!me.joined) body = joinForm();
    else if (view.phase === 'lobby') body = card(avatarUrl(me.avatar), `${me.name}, 반가워요`, el('p', {}, '선생님이 시작하면 문제가 나옵니다.'), formError ? el('p', { class: 'msg error' }, formError) : null, el('p', { class: 'hint' }, `지금 ${view.count}명이 들어와 있습니다.`));
    else if (view.phase === 'countdown') body = el('div', { class: 'qp-card' }, el('div', { class: 'qz-picket small' }, el('img', { src: '/img/daeryuni/pose_picket.webp', alt: '' }), el('span', { class: 'qz-picket-num' }, String(view.countdown))), el('h2', {}, `문제 ${view.qIndex + 1}`));
    else if (view.phase === 'question') {
      if (sentQ === view.qIndex) body = card('/img/daeryuni/face_thinking.webp', '답을 보냈습니다', el('p', {}, `친구들을 기다리는 중입니다. 응답 ${view.answered} / ${view.count}`));
      else {
        body = el('div', { class: 'qp-question' },
          el('p', { class: 'qp-progress' }, el('img', { src: '/img/daeryuni/face_thinking.webp', alt: '' }), `문제 ${view.qIndex + 1} / ${view.total}${view.paused ? ' · 일시 정지' : ''}`, view.q.double ? el('span', { class: 'qz-double' }, '2배 점수') : null),
          timer(),
          el('h2', { class: 'qp-prompt' }, view.q.prompt),
          view.q.image ? el('img', { class: 'qp-img', src: view.q.image, alt: '문항 그림' }) : null,
          answerUi());
      }
    } else if (view.phase === 'reveal') {
      const mine = you && you.q === view.qIndex ? you : null;
      if (!mine || !mine.answered) body = card('/img/daeryuni/face_surprised.webp', '시간이 끝났습니다', el('p', {}, '다음 문제는 꼭 답해 보세요.'), scoreLine());
      else if (mine.correct) body = card('/img/daeryuni/face_fist.webp', '정답입니다!', el('p', { class: 'qp-points' }, `+${mine.points.toLocaleString()}점`), mine.streak >= 2 ? el('p', {}, `${mine.streak}문제 연속 정답`) : null, scoreLine());
      else body = card('/img/daeryuni/face_shy.webp', '아쉬워요', el('p', {}, '교실 화면의 해설을 함께 읽어 보세요.'), scoreLine());
    } else if (view.phase === 'board') body = card('/img/daeryuni/pose_raise.webp', you?.rank ? `지금 ${you.rank}위` : '순위 확인', scoreLine(), el('p', { class: 'hint' }, '다음 문제를 준비하세요.'));
    else body = finalReport ? reportView() : card('/img/daeryuni/pose_thumb.webp', you?.rank ? `최종 ${you.rank}위` : '퀴즈가 끝났습니다', scoreLine(), el('p', {}, '끝까지 함께해 주어 고맙습니다.'));
    // 적던 칸에 커서가 있었으면 새로 그린 뒤에도 그 자리에 둔다.
    const active = document.activeElement;
    const focused = active && root.contains(active) ? (active.id === 'qp-name' ? '#qp-name' : active.classList.contains('qp-short-input') ? '.qp-short-input' : '') : '';
    const caret = focused ? active.selectionStart : null;
    root.dataset.key = stableKey();
    root.replaceChildren(head, el('div', { class: 'qp-body' }, body));
    const again = focused ? root.querySelector(focused) : null;
    if (again) {
      again.focus();
      try { if (caret !== null) again.setSelectionRange(caret, caret); } catch { /* 커서 자리를 못 옮겨도 입력은 된다 */ }
    }
  }

  paint();
  return { onMessage, hello: () => { if (sessionStorage.getItem('ait_quiz_joined') === code) join(); } };
}
