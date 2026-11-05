#!/usr/bin/env node
'use strict';
// Netlify 빌드 단계: 전체 index.html을 등급별 3종으로 나눈다. 저장소의 원본은 그대로 둔다.
//   public  → / (비로그인·검색엔진)         : 보호 블록과 시간표 데이터 제거
//   member  → /_gated/member/index.html    : 보호 블록만 제거
//   teacher → /_gated/teacher/index.html   : 전체
// 보호 내용이 하나라도 공개본에 남으면 빌드를 실패시켜 배포를 막는다.
const fs = require('node:fs');
const path = require('node:path');

const BLOCK_IDS = ['teacher-content', 'photos-content', 'ai-content', 'admin-body'];
const GATE_IDS = ['teacher-login-required', 'photos-login-required', 'ai-login-required', 'admin-denied'];
// 블록 제거 누락을 잡는 표식. 원본에는 반드시 있어야 하고 공개본·회원본에는 없어야 한다.
const CANARIES = ['OMR스캔프로그램', 'id="ai-sub-0"', 'id="admin-content"'];
const TIMETABLE_CANARY = '"월":["';

function innerRange(html, id) {
  const open = new RegExp(`<div\\b[^>]*\\bid="${id}"[^>]*>`).exec(html);
  if (!open) throw new Error(`보호 블록을 찾지 못했습니다: ${id}`);
  const start = open.index + open[0].length;
  const token = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<textarea\b[\s\S]*?<\/textarea\s*>|<div\b|<\/div\s*>/gi;
  token.lastIndex = start;
  let depth = 1;
  for (let m = token.exec(html); m; m = token.exec(html)) {
    const t = m[0].slice(0, 5).toLowerCase();
    if (t.startsWith('<div')) depth += 1;
    else if (t.startsWith('</div')) {
      depth -= 1;
      if (depth === 0) return [start, m.index];
    }
  }
  throw new Error(`보호 블록의 닫는 태그를 찾지 못했습니다: ${id}`);
}

function stripBlocks(html) {
  let out = html;
  for (const id of BLOCK_IDS) {
    const [start, end] = innerRange(out, id);
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

function stripTimetable(html) {
  let count = 0;
  const out = html.replace(/^([ \t]*)const (TT|TL)=(.+);[ \t]*\r?$/gm, (_m, indent, name) => {
    count += 1;
    return `${indent}const ${name}=${name === 'TT' ? '{"t":{},"c":{}}' : '[]'};`;
  });
  if (count !== 2) throw new Error(`시간표 데이터 위치가 바뀌었습니다(찾은 수 ${count}). scripts/build_auth_gate.cjs를 확인하세요.`);
  return out;
}

function inject(html, variant) {
  const css = variant === 'teacher' ? '' : `<style>${GATE_IDS.map((id) => `#${id}`).join(',')}{display:block!important}</style>\n`;
  const tag = `<meta name="dr-gate-variant" content="${variant}">\n${css}<script src="/auth-gate-client.js"></script>\n`;
  const m = /<head\b[^>]*>\s*/i.exec(html);
  if (!m) throw new Error('<head>를 찾지 못했습니다.');
  const at = m.index + m[0].length;
  return html.slice(0, at) + tag + html.slice(at);
}

function assertClean(html, label, extra = []) {
  const hits = [...CANARIES, ...extra].filter((c) => html.includes(c));
  if (hits.length) throw new Error(`${label}에 보호 내용이 남아 있습니다: ${hits.join(', ')}`);
}

function split(html) {
  if (html.includes('name="dr-gate-variant"')) throw new Error('이미 분리된 index.html입니다.');
  for (const c of [...CANARIES, TIMETABLE_CANARY]) {
    if (!html.includes(c)) throw new Error(`원본 표식이 사라졌습니다. 표식을 갱신하세요: ${c}`);
  }
  const member = stripBlocks(html);
  const pub = stripTimetable(member);
  assertClean(member, '회원본');
  assertClean(pub, '공개본', [TIMETABLE_CANARY]);
  return { teacher: inject(html, 'teacher'), member: inject(member, 'member'), public: inject(pub, 'public') };
}

function build(root) {
  const source = path.join(root, 'index.html');
  const out = split(fs.readFileSync(source, 'utf8'));
  for (const tier of ['teacher', 'member']) {
    const file = path.join(root, '_gated', tier, 'index.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out[tier]);
  }
  fs.writeFileSync(source, out.public);
  return { teacher: out.teacher.length, member: out.member.length, public: out.public.length };
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || 'output/web');
  if (!process.argv.includes('--in-place')) {
    console.error('index.html을 덮어쓰므로 빌드 환경에서만 --in-place로 실행합니다.');
    process.exit(2);
  }
  console.log('auth gate build', build(root));
}

module.exports = { build, split, innerRange, CANARIES, TIMETABLE_CANARY };
