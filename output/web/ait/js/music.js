// 퀴즈 음악과 효과음: 외부 음원 없이 브라우저의 소리 합성(Web Audio)으로 직접 연주한다.
// 분위기 세 가지: chip(신나는 전자음), lofi(잔잔한 로파이), drum(긴장감 있는 타악).
// 장면: lobby(대기실), question(문제 풀이), board(순위판). 시상대는 팡파르 한 번 뒤 대기실 음악으로 돌아간다.

export const MOODS = [
  { id: 'chip', label: '신나는 전자음', hint: '빠른 박자의 8비트풍 선율' },
  { id: 'lofi', label: '잔잔한 로파이', hint: '느린 박자, 부드러운 건반' },
  { id: 'drum', label: '긴장감 있는 타악', hint: '북과 박수, 시간이 줄수록 빨라짐' },
];

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const _ = null;

// 4마디(64칸) 진행. 각 마디의 화음(MIDI 음 높이)과 뿌리음.
const SONGS = {
  chip: {
    bpm: 138,
    chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], // C G Am F
    roots: [36, 43, 45, 41],
    melody: [
      76, _, 79, _, 76, _, 72, _, 74, _, 76, _, 72, _, _, _,
      74, _, 71, _, 67, _, 71, _, 74, _, 79, _, 74, _, _, _,
      72, _, 76, _, 81, _, 79, _, 76, _, 72, _, 76, _, _, _,
      77, _, 76, _, 74, _, 72, _, 74, _, 71, _, 72, _, _, _,
    ],
  },
  lofi: {
    bpm: 78,
    chords: [[60, 64, 67, 71], [57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65]], // Cmaj7 Am7 Dm7 G7
    roots: [36, 45, 38, 43],
    melody: [
      _, _, 76, _, _, _, 74, _, 72, _, _, _, _, _, _, _,
      _, _, 72, _, _, _, 69, _, _, _, 67, _, _, _, _, _,
      _, _, 77, _, _, _, 76, _, 74, _, _, _, 72, _, _, _,
      _, _, 71, _, _, _, 74, _, _, _, _, _, _, _, _, _,
    ],
  },
  drum: {
    bpm: 112,
    chords: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]], // Am F G E
    roots: [33, 29, 31, 28],
    melody: [
      69, 72, 76, 72, 69, 72, 76, 72, 69, 72, 76, 72, 69, 72, 76, 79,
      65, 69, 72, 69, 65, 69, 72, 69, 65, 69, 72, 69, 65, 69, 72, 74,
      67, 71, 74, 71, 67, 71, 74, 71, 67, 71, 74, 71, 67, 71, 74, 76,
      64, 68, 71, 68, 64, 68, 71, 68, 64, 68, 71, 68, 76, 74, 71, 68,
    ],
  },
};

export function createMusic() {
  let ctx = null;
  let master = null;
  let bus = null;
  let noise = null;
  let timer = null;
  let mood = 'chip';
  let scene = null;
  let step = 0;
  let nextTime = 0;
  let tempo = 1;
  let volume = Number(localStorage.getItem('ait_music_volume') || 0.6);
  let muted = localStorage.getItem('ait_music_muted') === '1';

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      master.connect(comp);
      comp.connect(ctx.destination);
      bus = ctx.createGain();
      bus.connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 악기
  function tone(freq, t, dur, { type = 'square', gain = 0.08, attack = 0.005, release = 0.08, filter = 0, dest = bus, detune = 0 } = {}) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function noiseHit(t, dur, { gain = 0.1, freq = 8000, type = 'highpass', q = 0.7 } = {}) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(bus);
    s.start(t);
    s.stop(t + dur + 0.02);
  }
  function kick(t, gain = 0.5) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + 0.25);
  }
  const hat = (t, gain = 0.05, open = false) => noiseHit(t, open ? 0.18 : 0.04, { gain, freq: 9000 });
  const snare = (t, gain = 0.18) => { noiseHit(t, 0.16, { gain, freq: 1800, type: 'bandpass', q: 0.6 }); tone(190, t, 0.08, { type: 'triangle', gain: gain * 0.6 }); };
  const clap = (t, gain = 0.16) => [0, 0.012, 0.024].forEach((d) => noiseHit(t + d, 0.09, { gain, freq: 1400, type: 'bandpass', q: 1.2 }));
  function tom(t, freq, gain = 0.3) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + 0.32);
  }

  // 한 칸(16분음표)을 연주한다.
  function playStep(i, t, spb) {
    const song = SONGS[mood];
    const bar = Math.floor(i / 16) % 4;
    const s = i % 16;
    const chord = song.chords[bar];
    const root = song.roots[bar];
    const mel = song.melody[i % 64];
    const q = scene === 'question';
    const board = scene === 'board';
    if (mood === 'chip') {
      if (s % 4 === 0) kick(t, board ? 0.25 : 0.42);
      if (s === 4 || s === 12) snare(t, 0.14);
      if (s % 2 === 1) hat(t, 0.035);
      if (s % 2 === 0) tone(hz(root + (s % 4 === 2 ? 12 : 0)), t, spb * 1.8, { type: 'triangle', gain: 0.16 });
      tone(hz(chord[s % chord.length] + 12), t, spb * 0.9, { type: 'square', gain: 0.025, filter: 3200 });
      if ((q || i % 128 < 64) && mel) tone(hz(mel), t, spb * 1.9, { type: 'square', gain: 0.05, filter: 4200 });
    } else if (mood === 'lofi') {
      const sw = s % 2 === 1 ? spb * 0.25 : 0; // 살짝 밀어 치는 리듬
      if (s === 0) chord.forEach((n, k) => tone(hz(n), t + k * 0.012, spb * 15, { type: 'triangle', gain: 0.045, attack: 0.04, release: 0.6, filter: 1400 }));
      if (s === 0 || s === 10) kick(t, 0.32);
      if (s === 4 || s === 12) clap(t + sw, 0.07);
      if (s % 2 === 0) hat(t + sw, 0.02);
      if (s === 0 || s === 7) tone(hz(root), t, spb * 5, { type: 'sine', gain: 0.18, attack: 0.02, release: 0.2 });
      if (mel && !board) tone(hz(mel), t + sw, spb * 3.5, { type: 'sine', gain: q ? 0.07 : 0.05, attack: 0.02, release: 0.3, filter: 2600 });
    } else {
      if (s === 0 || s === 6 || s === 8 || s === 14) kick(t, 0.45);
      if (s === 4 || s === 12) clap(t, 0.12);
      if (q && s % 2 === 1) hat(t, 0.03);
      if (s === 10) tom(t, 110);
      if (s === 11) tom(t, 90);
      if (q && s === 15) tom(t, 70);
      if (s === 0) tone(hz(root), t, spb * 16, { type: 'sine', gain: 0.12, attack: 0.1, release: 0.5 });
      if (mel && (q || s % 2 === 0)) tone(hz(mel), t, spb * 0.7, { type: 'triangle', gain: 0.06, attack: 0.002, release: 0.05 });
    }
  }

  function tick() {
    if (!scene || !ctx) return;
    const spb = 60 / (SONGS[mood].bpm * tempo) / 4;
    while (nextTime < ctx.currentTime + 0.15) {
      playStep(step, nextTime, spb);
      nextTime += spb;
      step = (step + 1) % 128;
    }
  }

  function play(next) {
    if (next === scene) return;
    ensure();
    scene = next;
    if (!timer) {
      step = 0;
      nextTime = ctx.currentTime + 0.06;
      timer = setInterval(tick, 25);
    }
  }

  function stop() {
    scene = null;
    clearInterval(timer);
    timer = null;
  }

  // 효과음
  function sfx(name) {
    ensure();
    const t = ctx.currentTime + 0.01;
    const n = (m, d, o, opt) => tone(hz(m), t + o, d, opt);
    if (name === 'join') { n(84, 0.08, 0, { type: 'sine', gain: 0.12 }); n(91, 0.1, 0.07, { type: 'sine', gain: 0.1 }); }
    else if (name === 'tick') noiseHit(t, 0.03, { gain: 0.12, freq: 3000, type: 'bandpass', q: 3 });
    else if (name === 'count') n(76, 0.14, 0, { type: 'square', gain: 0.08, filter: 3000 });
    else if (name === 'go') [72, 76, 79, 84].forEach((m, k) => n(m, 0.25, k * 0.05, { type: 'square', gain: 0.07, filter: 4000 }));
    else if (name === 'reveal') { [60, 67, 72, 76].forEach((m, k) => n(m, 0.5, k * 0.06, { type: 'triangle', gain: 0.1 })); noiseHit(t, 0.4, { gain: 0.06, freq: 6000 }); }
    else if (name === 'correct') [72, 76, 79, 84].forEach((m, k) => n(m, 0.18, k * 0.07, { type: 'sine', gain: 0.13 }));
    else if (name === 'wrong') { n(52, 0.22, 0, { type: 'sawtooth', gain: 0.06, filter: 900 }); n(47, 0.3, 0.18, { type: 'sawtooth', gain: 0.06, filter: 800 }); }
    else if (name === 'rank') [79, 84].forEach((m, k) => n(m, 0.12, k * 0.08, { type: 'square', gain: 0.05, filter: 3500 }));
    else if (name === 'fanfare') {
      const f = [[72, 0, 0.14], [72, 0.15, 0.14], [72, 0.3, 0.14], [77, 0.45, 0.5], [79, 0.95, 0.2], [81, 1.15, 0.2], [84, 1.35, 1.0]];
      f.forEach(([m, o, d]) => { n(m, d, o, { type: 'square', gain: 0.07, filter: 4000 }); n(m - 12, d, o, { type: 'triangle', gain: 0.08 }); });
      [60, 64, 67, 72].forEach((m) => n(m, 1.4, 1.35, { type: 'triangle', gain: 0.06, release: 0.6 }));
      [0, 0.45, 0.95, 1.35].forEach((o) => { kick(t + o, 0.4); noiseHit(t + o, 0.5, { gain: 0.05, freq: 7000 }); });
      setTimeout(() => { if (scene === 'podium') { scene = 'lobby'; } }, 2600);
    }
  }

  return {
    get mood() { return mood; },
    setMood(m) { if (SONGS[m]) { mood = m; } },
    play(next) {
      if (next === 'podium') { stop(); sfx('fanfare'); setTimeout(() => play('lobby'), 2800); return; }
      play(next);
    },
    stop,
    sfx,
    unlock() { ensure(); },
    setTempo(mul) { tempo = mul; },
    get volume() { return volume; },
    setVolume(v) { volume = v; localStorage.setItem('ait_music_volume', String(v)); if (master && !muted) master.gain.value = v; },
    get muted() { return muted; },
    setMuted(on) { muted = on; localStorage.setItem('ait_music_muted', on ? '1' : '0'); if (master) master.gain.value = on ? 0 : volume; },
  };
}
