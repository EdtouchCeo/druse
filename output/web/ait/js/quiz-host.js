// 퀴즈 진행 엔진(교사 진행 화면에서 돈다). 정답은 정답 공개 전까지 학생 기기로 보내지 않고, 채점도 여기서 한다.
// 서버를 붙이면 이 엔진의 채점·기록 부분을 서버 함수로 옮긴다. 화면과 메시지 모양은 그대로 둔다.
import { autoName, validName } from './filter.js';

const COUNTDOWN = 3;
const BASE_POINTS = 500;
const SPEED_POINTS = 500;
const STREAK_BONUS = 100;

const normShort = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[\s.,·]/g, '');

function shuffle(list, seed) {
  const a = [...list];
  let x = seed || 7;
  for (let i = a.length - 1; i > 0; i -= 1) {
    x = (x * 9301 + 49297) % 233280;
    const j = Math.floor((x / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // 섞은 결과가 정답 순서와 같으면 한 칸 돌린다.
  if (a.every((v, i) => v === list[i])) a.push(a.shift());
  return a;
}

export function createQuizHost({ lesson, quiz, room, music, render, present, onGotoSlide, url, code }) {
  const questions = quiz.questions.map((q, i) => ({ ...q, items: q.type === 'order' ? shuffle(q.items.map((text, k) => ({ id: `i${k}`, text })), i + 3) : undefined }));
  const players = new Map();
  const kicked = new Set();
  const answers = []; // 결과 내려받기용 기록
  let nextNo = 1;
  let phase = 'lobby';
  let qIndex = -1;
  let countdown = COUNTDOWN;
  let startedAt = 0;
  let deadline = 0;
  let remaining = 0;
  let paused = false;
  let speed = quiz.speed !== false;
  let reveal = null;
  const reveals = []; // 문항별 정답 공개 내용. 오답 보기에서 다시 쓴다.
  let reviewFrom = 'end'; // 오답 보기를 연 화면(문항별 결과 또는 종료 화면)
  let board = [];
  let lead = null;
  let lastRanks = new Map();
  let timer = null;
  let lastSecond = null;
  let asked = 0; // 학생에게 실제로 낸 문항 수. 중간에 끝내면 전체 문항 수보다 작다.

  const active = () => [...players.values()].filter((p) => !p.kicked);
  const q = () => questions[qIndex];

  function publicQuestion() {
    const item = q();
    if (!item) return null;
    return { type: item.type, prompt: item.prompt, choices: item.choices, items: item.items, time: item.time, double: !!item.double, image: item.image ? `${lesson.base}/${item.image}` : null };
  }

  function view() {
    const answered = qIndex >= 0 ? active().filter((p) => p.answers[qIndex]).length : 0;
    return {
      phase, title: quiz.title || `${lesson.title} 퀴즈`, code, url, total: questions.length, qIndex,
      count: active().length,
      players: active().map((p) => ({ pid: p.pid, name: p.name, avatar: p.avatar })),
      q: phase === 'lobby' ? null : publicQuestion(),
      countdown, paused, answered,
      remainingMs: paused ? remaining : Math.max(0, deadline - Date.now()),
      reveal, board, lead,
      asked,
      review: phase === 'review' ? reviewInfo() : null,
      wrongCount: phase === 'end' || phase === 'done' ? wrongList().length : 0,
      podium: phase === 'podium' || phase === 'end' || phase === 'done' ? ranking().slice(0, 3) : [],
      summary: phase === 'end' ? summary().map((x) => ({ ...x, wrong: wrongList().includes(x.n - 1) })) : [],
      closing: phase === 'done' ? closing() : null,
      mood: music.mood, speed, muted: music.muted,
    };
  }

  function publish() {
    const v = view();
    render(v);
    // 교사 메모는 진행 화면에만 그린다. 발표 화면과 학생 기기로는 보내지 않는다.
    const shared = v.reveal ? { ...v, reveal: { ...v.reveal, teacherNote: undefined } } : v;
    present(shared);
    // 학생에게는 대기실 명단의 학생 식별자를 보내지 않는다.
    room.send({ type: 'quiz', view: { ...shared, players: v.players.map(({ name, avatar }) => ({ name, avatar })) } });
  }

  function ranking() {
    return active().sort((a, b) => b.score - a.score || a.no - b.no)
      .map((p, i) => ({ pid: p.pid, name: p.name, avatar: p.avatar, score: p.score, rank: i + 1 }));
  }

  // 학생에게서 온 메시지
  function handle(msg) {
    if (!msg || typeof msg.pid !== 'string') return;
    if (msg.type === 'quiz-join') join(msg);
    else if (msg.type === 'quiz-answer') answer(msg);
    else if (msg.type === 'hello') {
      publish();
      const p = players.get(msg.pid);
      if (p) personal(p);
      if (p && !p.kicked && (phase === 'podium' || phase === 'end' || phase === 'done' || phase === 'review')) report(p);
    }
  }

  function join(msg) {
    if (kicked.has(msg.pid)) { room.send({ type: 'kick', pid: msg.pid }); return; }
    let p = players.get(msg.pid);
    const checked = validName(msg.name);
    if (!p) {
      p = { pid: msg.pid, no: nextNo, name: autoName(nextNo), avatar: 0, score: 0, streak: 0, answers: [], nameLocked: false, kicked: false, joinedAt: new Date() };
      nextNo += 1;
      players.set(msg.pid, p);
      if (phase === 'lobby') music.sfx('join');
    }
    if (!p.nameLocked && checked.ok && checked.name) p.name = checked.name;
    if (Number.isInteger(msg.avatar) && msg.avatar >= 0 && msg.avatar < 8) p.avatar = msg.avatar;
    room.send({ type: 'quiz-name', pid: p.pid, name: p.name, locked: p.nameLocked, no: p.no, rejected: !checked.ok });
    publish();
    personal(p);
  }

  function answer(msg) {
    const p = players.get(msg.pid);
    if (!p || p.kicked || phase !== 'question' || paused || msg.q !== qIndex || p.answers[qIndex]) return;
    const item = q();
    let correct = false;
    let shown = '';
    if (item.type === 'choice') { correct = msg.answer === item.answer; shown = Number.isInteger(msg.answer) ? `${msg.answer + 1}` : ''; }
    else if (item.type === 'ox') { correct = msg.answer === item.answer; shown = msg.answer === true ? 'O' : msg.answer === false ? 'X' : ''; }
    else if (item.type === 'order') {
      const want = item.items.slice().sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).map((x) => x.id);
      correct = Array.isArray(msg.answer) && msg.answer.length === want.length && msg.answer.every((id, i) => id === want[i]);
      shown = Array.isArray(msg.answer) ? msg.answer.map((id) => Number(id.slice(1)) + 1).join('-') : '';
    } else if (item.type === 'short') {
      const text = String(msg.answer || '').slice(0, 40);
      correct = item.answer.some((a) => normShort(a) === normShort(text));
      shown = text;
    }
    const ms = Math.max(0, item.time * 1000 - Math.max(0, deadline - Date.now()));
    let points = 0;
    if (correct) {
      p.streak += 1;
      const speedPart = speed ? Math.round(SPEED_POINTS * (1 - Math.min(1, ms / (item.time * 1000)))) : SPEED_POINTS / 2;
      points = BASE_POINTS + speedPart + STREAK_BONUS * Math.min(3, Math.max(0, p.streak - 1));
      if (item.double) points *= 2; // 2배 점수 문항
    } else {
      p.streak = 0;
    }
    p.score += points;
    p.answers[qIndex] = { answer: msg.answer, shown, correct, ms, points };
    answers.push({ q: qIndex, pid: p.pid, no: p.no, name: p.name, shown, correct, ms, points, total: p.score, at: new Date() });
    room.send({ type: 'quiz-got', pid: p.pid, q: qIndex });
    publish();
    const asked = qIndex;
    if (active().every((x) => x.answers[qIndex])) setTimeout(() => { if (phase === 'question' && qIndex === asked) close(); }, 700);
  }

  // 답을 사람이 읽는 글로 바꾼다.
  function answerText(item, answer) {
    if (answer === undefined || answer === null) return '답하지 않음';
    if (item.type === 'choice') return Number.isInteger(answer) ? `${'가나다라'[answer]}. ${item.choices[answer]}` : '답하지 않음';
    if (item.type === 'ox') return answer === true ? 'O (맞다)' : answer === false ? 'X (아니다)' : '답하지 않음';
    if (item.type === 'order') {
      if (!Array.isArray(answer)) return '답하지 않음';
      const byId = new Map(item.items.map((it) => [it.id, it.text]));
      return answer.map((id) => byId.get(id)).join(' → ');
    }
    return String(answer);
  }

  function correctText(item) {
    if (item.type === 'choice') return `${'가나다라'[item.answer]}. ${item.choices[item.answer]}`;
    if (item.type === 'ox') return item.answer ? 'O (맞다)' : 'X (아니다)';
    if (item.type === 'order') return item.items.slice().sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).map((x) => x.text).join(' → ');
    return item.answer[0];
  }

  // 퀴즈가 끝난 뒤에만 학생 한 명에게 자기 결과와 정답·해설을 보낸다.
  function report(p) {
    const rank = ranking().find((r) => r.pid === p.pid)?.rank || null;
    const items = questions.slice(0, asked).map((item, i) => {
      const a = p.answers[i];
      return {
        n: i + 1, type: item.type, prompt: item.prompt,
        mine: answerText(item, a ? a.answer : null), right: correctText(item),
        correct: !!(a && a.correct), points: a ? a.points : 0,
        explain: item.explain, page: item.page, slide: item.slide,
      };
    });
    room.send({ type: 'quiz-report', pid: p.pid, name: p.name, score: p.score, rank, players: active().length, total: asked, right: items.filter((x) => x.correct).length, items });
  }

  function personal(p) {
    const a = qIndex >= 0 ? p.answers[qIndex] : null;
    const rank = ranking().find((r) => r.pid === p.pid)?.rank || null;
    room.send({ type: 'quiz-you', pid: p.pid, q: qIndex, phase, answered: !!a, correct: a ? a.correct : null, points: a ? a.points : 0, score: p.score, rank, streak: p.streak, name: p.name, no: p.no });
  }

  // 진행
  function startQuestion(i) {
    qIndex = i;
    phase = 'countdown';
    countdown = COUNTDOWN;
    reveal = null;
    lead = null;
    music.stop();
    music.sfx('count');
    publish();
    clearInterval(timer);
    timer = setInterval(() => {
      countdown -= 1;
      if (countdown > 0) { music.sfx('count'); publish(); return; }
      clearInterval(timer);
      music.sfx('go');
      phase = 'question';
      asked = qIndex + 1;
      paused = false;
      startedAt = Date.now();
      deadline = startedAt + q().time * 1000;
      music.setTempo(1);
      music.play('question');
      publish();
      watch();
    }, 1000);
  }

  function watch() {
    clearInterval(timer);
    lastSecond = null;
    timer = setInterval(() => {
      if (phase !== 'question' || paused) return;
      const left = deadline - Date.now();
      const sec = Math.ceil(left / 1000);
      if (left <= 5000 && sec !== lastSecond && sec > 0) { music.sfx('tick'); music.setTempo(1.25); }
      lastSecond = sec;
      if (left <= 0) close();
    }, 200);
  }

  function close() {
    if (phase !== 'question') return;
    clearInterval(timer);
    const item = q();
    const list = active();
    const got = list.map((p) => p.answers[qIndex]).filter(Boolean);
    let dist = [];
    if (item.type === 'choice') dist = item.choices.map((_, i) => got.filter((a) => a.answer === i).length);
    else if (item.type === 'ox') dist = [got.filter((a) => a.answer === true).length, got.filter((a) => a.answer === false).length];
    const right = got.filter((a) => a.correct).length;
    const answerKey = item.type === 'order' ? item.items.slice().sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).map((x) => x.id) : item.answer;
    reveal = { answer: answerKey, dist, rate: list.length ? Math.round((right / list.length) * 100) : 0, explain: item.explain, ref: { slide: item.slide, page: item.page }, teacherNote: item.teacher_note || '' };
    reveals[qIndex] = reveal;
    phase = 'reveal';
    music.stop();
    music.setTempo(1);
    music.sfx('reveal');
    publish();
    list.forEach(personal);
  }

  function showBoard() {
    const ranks = ranking();
    const prevLeader = [...lastRanks.entries()].find(([, r]) => r === 1)?.[0];
    board = ranks.slice(0, 5).map((r) => ({ ...r, prevRank: lastRanks.get(r.pid) || null }));
    lead = ranks[0] && prevLeader && ranks[0].pid !== prevLeader ? ranks[0].name : null;
    lastRanks = new Map(ranks.map((r) => [r.pid, r.rank]));
    phase = 'board';
    music.play('board');
    music.sfx('rank');
    publish();
    active().forEach(personal);
  }

  function next() {
    if (phase === 'lobby') { if (!active().length && !confirm('아직 들어온 학생이 없습니다. 그래도 시작할까요?')) return; startQuestion(0); }
    else if (phase === 'question') close();
    else if (phase === 'reveal') { if (qIndex + 1 >= questions.length) podium(); else showBoard(); }
    else if (phase === 'board') startQuestion(qIndex + 1);
    else if (phase === 'podium') { phase = 'end'; music.stop(); publish(); }
    else if (phase === 'end') { phase = 'done'; publish(); }
  }

  // 오답 보기: 한 명이라도 틀렸거나 답하지 못한 문항을 정답·응답 분포·해설과 함께 다시 본다.
  function wrongList() {
    const n = active().length;
    const list = [];
    for (let i = 0; i < asked; i += 1) {
      if (!reveals[i]) continue;
      const right = active().filter((p) => p.answers[i]?.correct).length;
      if (n && right < n) list.push(i);
    }
    return list;
  }

  function reviewInfo() {
    const list = wrongList();
    const item = q();
    const people = active();
    const got = people.map((p) => p.answers[qIndex]).filter(Boolean);
    const wrong = got.filter((a) => !a.correct);
    // 단답형과 순서 맞추기는 학생이 낸 틀린 답을 많이 나온 순서로 묶는다(이름은 붙이지 않는다).
    let wrongs = [];
    if (item.type === 'short' || item.type === 'order') {
      const count = new Map();
      wrong.forEach((a) => { const k = a.shown || '(빈 답)'; count.set(k, (count.get(k) || 0) + 1); });
      wrongs = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([text, n]) => ({ text, n }));
    }
    return {
      pos: Math.max(0, list.indexOf(qIndex)) + 1, count: list.length,
      right: got.length - wrong.length, wrong: wrong.length, none: people.length - got.length, wrongs,
    };
  }

  function openReview(n) {
    const list = wrongList();
    if (!list.length) return;
    if (phase === 'end' || phase === 'done') reviewFrom = phase;
    else if (phase !== 'review') return;
    qIndex = Number.isInteger(n) && list.includes(n - 1) ? n - 1 : list[0];
    reveal = reveals[qIndex];
    phase = 'review';
    publish();
  }

  function moveReview(d) {
    if (phase !== 'review') return;
    const list = wrongList();
    const at = list.indexOf(qIndex) + d;
    if (at < 0 || at >= list.length) return;
    qIndex = list[at];
    reveal = reveals[qIndex];
    publish();
  }

  function closeReview() {
    if (phase !== 'review') return;
    qIndex = asked - 1;
    reveal = null;
    phase = reviewFrom;
    publish();
  }

  // 남은 문항을 건너뛰고 끝낸다. 지금까지 낸 문항으로 순위와 결과를 만든다.
  function stop() {
    if (!['countdown', 'question', 'reveal', 'board'].includes(phase)) return;
    const left = questions.length - asked;
    if (!confirm(left > 0 ? `남은 ${left}문제를 건너뛰고 퀴즈를 끝낼까요? 지금까지 푼 ${asked}문제로 순위를 냅니다.` : '퀴즈를 끝내고 최종 순위를 볼까요?')) return;
    clearInterval(timer);
    paused = false;
    reveal = null;
    if (!asked) { // 첫 문제를 내기 전이면 대기실로 돌아간다.
      qIndex = -1;
      phase = 'lobby';
      music.stop();
      music.play('lobby');
      publish();
      return;
    }
    qIndex = asked - 1;
    podium();
  }

  function podium() {
    phase = 'podium';
    music.play('podium');
    publish();
    active().forEach(personal);
    active().forEach(report);
  }

  function summary() {
    return questions.slice(0, asked).map((item, i) => {
      const got = active().map((p) => p.answers[i]).filter(Boolean);
      const right = got.filter((a) => a.correct).length;
      const n = active().length;
      return { n: i + 1, prompt: item.prompt, rate: n ? Math.round((right / n) * 100) : 0, avg: got.length ? (got.reduce((s, a) => s + a.ms, 0) / got.length / 1000).toFixed(1) : null, page: item.page, slide: item.slide };
    });
  }

  // 종료 화면에 보일 요약: 참여 인원, 평균 정답률과 점수, 다시 짚을 문항.
  function closing() {
    const list = active();
    const n = list.length;
    const right = list.reduce((sum, p) => sum + p.answers.slice(0, asked).filter((a) => a && a.correct).length, 0);
    const low = summary().filter((s) => s.rate < 50).sort((a, b) => a.rate - b.rate || a.n - b.n).slice(0, 3);
    return {
      players: n, asked, total: questions.length, stopped: asked < questions.length,
      avgRate: n && asked ? Math.round((right / (n * asked)) * 100) : 0,
      avgScore: n ? Math.round(list.reduce((sum, p) => sum + p.score, 0) / n) : 0,
      responses: answers.length,
      low,
    };
  }

  // 결과 내려받기: 응답 한 건이 한 줄인 표. 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다.
  function exportRows() {
    const date = new Date().toISOString().slice(0, 10);
    return answers.map((a) => ({
      수업일자: date, 차시: lesson.id, 문항번호: a.q + 1, 문항유형: questions[a.q].type, 참가자번호: a.no, 대화명: players.get(a.pid)?.name || a.name,
      응답: a.shown, 정답여부: a.correct ? 1 : 0, 응답시간초: (a.ms / 1000).toFixed(2), 점수: a.points, 누적점수: a.total, 응답시각: a.at.toISOString(),
    }));
  }

  function download(kind) {
    const rows = exportRows();
    let blob;
    let name;
    if (kind === 'csv') {
      const cols = Object.keys(rows[0] || { 수업일자: '' });
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      blob = new Blob(['﻿', [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n')], { type: 'text/csv;charset=utf-8' });
      name = `quiz_responses_${lesson.lesson}_${rows[0]?.수업일자 || 'empty'}.csv`;
    } else {
      blob = new Blob([JSON.stringify({ lesson: lesson.id, quiz: quiz.title, questions: questions.map((x, i) => ({ n: i + 1, type: x.type, prompt: x.prompt, page: x.page, slide: x.slide })), summary: summary(), responses: rows }, null, 1)], { type: 'application/json' });
      name = `quiz_responses_${lesson.lesson}.json`;
    }
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url2;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url2), 1000);
  }

  function action(name, arg) {
    music.unlock();
    if (name === 'start' || name === 'next' || name === 'close') next();
    else if (name === 'stop') stop();
    else if (name === 'back-summary' && phase === 'done') { phase = 'end'; publish(); }
    else if (name === 'review') openReview(arg);
    else if (name === 'review-prev') moveReview(-1);
    else if (name === 'review-next') moveReview(1);
    else if (name === 'review-back') closeReview();
    else if (name === 'mood') { music.setMood(arg); if (phase === 'lobby') { music.stop(); music.play('lobby'); } publish(); }
    else if (name === 'speed') { speed = !speed; publish(); }
    else if (name === 'mute') { music.setMuted(!music.muted); publish(); }
    else if (name === 'pause' && phase === 'question') {
      if (paused) { paused = false; deadline = Date.now() + remaining; music.play('question'); }
      else { paused = true; remaining = Math.max(0, deadline - Date.now()); music.stop(); }
      publish();
    } else if (name === 'more-time' && phase === 'question') {
      if (paused) remaining += 10000; else deadline += 10000;
      music.setTempo(1);
      publish();
    } else if (name === 'goto-slide') onGotoSlide(arg);
    else if (name === 'reset-name') resetName(arg, true);
    else if (name === 'kick') kick(arg);
    else if (name === 'download-csv') download('csv');
    else if (name === 'download-json') download('json');
  }

  function resetName(pid, lock) {
    const p = players.get(pid);
    if (!p) return;
    p.name = autoName(p.no);
    p.nameLocked = lock;
    room.send({ type: 'quiz-name', pid, name: p.name, locked: p.nameLocked, no: p.no, reset: true });
    publish();
  }

  function resetAllNames() {
    active().forEach((p) => resetName(p.pid, true));
  }

  function kick(pid) {
    const p = players.get(pid);
    if (!p) return;
    if (!confirm(`${p.name} 학생을 퀴즈에서 내보낼까요? 같은 기기로는 다시 들어오지 못합니다.`)) return;
    p.kicked = true;
    kicked.add(pid);
    room.send({ type: 'kick', pid });
    publish();
  }

  function begin() {
    phase = 'lobby';
    music.unlock();
    music.play('lobby');
    publish();
  }

  function end() {
    clearInterval(timer);
    music.stop();
  }

  return {
    begin, end, handle, action, view, publish,
    people: () => [...players.values()],
    // 전체 순위(진행 화면 전용): 순위, 점수, 맞힌 문항 수
    rankingAll: () => ranking().map((r) => ({ ...r, correct: players.get(r.pid).answers.slice(0, asked).filter((a) => a && a.correct).length, asked })),
    resetName, resetAllNames, kick,
    get phase() { return phase; },
  };
}
