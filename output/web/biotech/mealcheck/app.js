/* ============================================================
   급식표가 말하지 않는 것 — 엔진
   원칙
     1) 이름에 적힌 것 = 확정. 이름에서 짐작한 것 = 추론. 절대 섞지 않는다.
     2) 못 찾은 것은 "없다"가 아니라 "찾지 못했다"로 쓴다.
     3) 근거 등급을 합치지 않는다 (혈청학적 / 임상적 / 추론).
     4) 서버로 아무것도 보내지 않는다. OCR도 브라우저 안에서 돈다.
   ============================================================ */
"use strict";

const MASK = "◼";
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const NO = ["","①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫","⑬","⑭","⑮","⑯","⑰","⑱","⑲"];
function josa(w, withJong, without){
  const c = String(w).charCodeAt(String(w).length - 1);
  return w + ((c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0) ? withJong : without);
}

/* ---------- 데이터 ---------- */
let DB = null, INF = null, DISH = null, byId = {}, ALL_ALIAS = [], ALL_EXACT = [], ALL_FF = [], SHORT_OK = new Set();
let LEX = null, LEX_ING = [];

async function loadData(){
  // 단일 파일 빌드는 데이터를 HTML 안에 심어 둔다. file:// 에서는 fetch 가 막히기 때문이다.
  const get = n => window.__DATA && window.__DATA[n]
    ? Promise.resolve(window.__DATA[n])
    : fetch("data/" + n).then(r => { if (!r.ok) throw new Error(n + " " + r.status); return r.json(); });
  const [a, i, d, lx] = await Promise.all([get("allergens.json"), get("inference.json"), get("dishes.json"), get("food-lexicon.json")]);
  DB = a; INF = i; DISH = d; LEX = lx;
  LEX_ING = Object.keys(LEX.ingredients).sort((p, q) => q.length - p.length);
  DB.allergens.forEach(x => byId[x.id] = x);
  ALL_ALIAS = DB.allergens.flatMap(x => x.aliases.map(al => ({ id: x.id, alias: al })))
                          .sort((p, q) => q.alias.length - p.alias.length);
  ALL_EXACT = DB.allergens.flatMap(x => (x.exact_aliases || []).map(al => ({ id: x.id, alias: al })));
  ALL_FF = [...new Set(DB.allergens.flatMap(x => x.false_friends || []))].sort((p, q) => q.length - p.length);
  // 한 글자 토큰은 기본적으로 버리지만(요일 표기 등), 한 글자가 곧 식품명인 것은 살린다: 밤·잣·게·밀
  SHORT_OK = new Set([...ALL_EXACT, ...ALL_ALIAS].filter(x => x.alias.length === 1).map(x => x.alias));
}

/* ---------- 1. 정규화 ---------- */
const STOP = new Set(["날짜","요일","중식","석식","조식","간식","열량","단백질","칼슘","철분","비타민",
  "나트륨","알레르기","원산지","식단","식단표","메뉴","구분","비고","합계","영양","에너지","탄수화물",
  "지방","급식","월","화","수","목","금","토","일","kcal","g","mg"]);

// 날짜·요일·표 머리글 줄은 메뉴가 아니다. 메뉴 이름에는 이런 패턴이 나오지 않는다.
const HEADER_RE = /요일|주간|식단표|원산지|열량|영양성분|알레르기\s*표시|\d+\s*월\s*\d+\s*일|^\s*\d+\s*[월일]\s*$/;

function normalize(raw){
  const menus = [];
  for (const line of String(raw).normalize("NFC").split(/\r?\n/)){
    let s = line.trim();
    if (!s) continue;
    if (HEADER_RE.test(s)) continue;
    const rawLine = s;

    // 줄 끝 알레르기 번호를 버리지 않고 읽어둔다 (표시 누락 교차검증에 쓴다)
    let numbers = [];
    const m = s.match(/[\s,.·]*((?:\d{1,2})(?:\s*[.,·]\s*\d{1,2})*)\s*$/);
    if (m){
      const cand = m[1].split(/[.,·\s]+/).map(Number).filter(n => n >= 1 && n <= 19);
      if (cand.length){ numbers = [...new Set(cand)]; s = s.slice(0, m.index).trim(); }
    }

    s = s.replace(/[*※☆★▶▷◆■□•]/g, "").trim();
    if (!s || !/[가-힣]/.test(s)) continue;           // 한글이 없는 줄은 메뉴가 아니다

    const tokens = [];
    for (const part of s.split(/[\/|]/).map(x => x.trim()).filter(Boolean)){
      const inner = [...part.matchAll(/[（(]([^）)]*)[）)]/g)].map(x => x[1].trim()).filter(Boolean);
      const outer = part.replace(/[（(][^）)]*[）)]/g, "").trim();
      if (outer) tokens.push(outer);
      inner.forEach(t => tokens.push(t));
    }
    const keep = tokens.filter(t => (t.length > 1 || SHORT_OK.has(t)) && !STOP.has(t) && /[가-힣]/.test(t));
    if (!keep.length) continue;
    menus.push({ raw: rawLine, display: s, tokens: keep, numbers });
  }
  return menus;
}

/* ---------- 2. 확정 매칭 ---------- */
function matchMenu(menu){
  const hits = new Map(), trace = [];
  for (const token of menu.tokens){
    const start = token.replace(/\s+/g, "");
    let work = start;
    const ffHits = [];
    for (const ff of ALL_FF){
      let i;
      while ((i = work.indexOf(ff)) !== -1){
        ffHits.push(ff);
        work = work.slice(0, i) + MASK.repeat(ff.length) + work.slice(i + ff.length);
      }
    }
    const aHits = [];
    for (const { id, alias } of ALL_EXACT){                 // 전체 일치만
      if (work !== alias) continue;
      work = MASK.repeat(alias.length);
      aHits.push({ id, alias, exact: true });
      if (!hits.has(id)) hits.set(id, alias);
    }
    for (const { id, alias } of ALL_ALIAS){                 // 긴 것부터 소비
      const i = work.indexOf(alias);
      if (i === -1) continue;
      work = work.slice(0, i) + MASK.repeat(alias.length) + work.slice(i + alias.length);
      aHits.push({ id, alias });
      if (!hits.has(id)) hits.set(id, alias);
    }
    trace.push({ token, start, masked: work, ffHits, aHits });
  }
  const warn = [], already = [];
  for (const [id, alias] of hits) (byId[id].legal19 ? already : warn).push({ a: byId[id], alias });
  return { warn, already, trace };
}

/* ---------- 3. 재료 추론 (확정과 반드시 구분해서 표시한다) ---------- */
function inferMenu(menu){
  const res = new Map();
  for (const rule of INF.rules){
    const key = rule.match.find(k => menu.tokens.some(t => t.replace(/\s+/g, "").includes(k)));
    if (!key) continue;
    for (const inf of rule.infer){
      const w = (INF.grades[inf.grade] || { w: 0 }).w;
      const prev = res.get(inf.allergen);
      if (!prev || w > prev.w){
        res.set(inf.allergen, { grade: inf.grade, w, rules: [rule.id], keys: [key], vias: [rule.via], whys: [rule.why] });
      } else {
        prev.rules.push(rule.id); prev.keys.push(key); prev.vias.push(rule.via); prev.whys.push(rule.why);
      }
    }
  }
  return res;
}

/* ---------- 4. 표시 누락 의심 ---------- */
function gapCheck(menu, inferred){
  if (!menu.numbers.length) return { gaps: [], unknown: true };
  const gaps = [];
  for (const [id, info] of inferred){
    const a = byId[id];
    if (!a || !a.legal19 || !a.legalNo) continue;
    if (info.grade !== "거의확실") continue;
    if (!menu.numbers.includes(a.legalNo)) gaps.push({ a, info });
  }
  return { gaps, unknown: false };
}

/* ---------- 5. 종합 ---------- */
function analyze(text){
  return normalize(text).map(menu => {
    const direct = matchMenu(menu);
    const inferred = inferMenu(menu);
    // 확정으로 이미 잡힌 것은 추론에서 뺀다. 확정이 항상 이긴다.
    [...direct.warn, ...direct.already].forEach(x => inferred.delete(x.a.id));
    const { gaps, unknown } = gapCheck(menu, inferred);
    const gapIds = new Set(gaps.map(g => g.a.id));
    const infOut = [], infLegal = [];
    for (const [id, info] of inferred){
      const a = byId[id];
      if (!a || gapIds.has(id)) continue;
      (a.legal19 ? infLegal : infOut).push({ a, info });
    }
    const ord = { "거의확실": 0, "흔함": 1, "가능": 2 };
    infOut.sort((p, q) => ord[p.info.grade] - ord[q.info.grade]);
    infLegal.sort((p, q) => ord[p.info.grade] - ord[q.info.grade]);
    return { menu, direct, infOut, infLegal, gaps, numUnknown: unknown };
  });
}

function crossFor(id){
  return DB.cross_reactions.filter(x => x.a === id || x.b === id)
    .map(x => x.a === id ? x : { ...x, a: x.b, aProt: x.bProt, b: x.a, bProt: x.aProt });
}
function srcLink(k){
  const s = DB.sources[k];
  return s ? `<div class="src">출처 <a href="${s.u}" target="_blank" rel="noopener">${esc(k)} · ${esc(s.t)}</a></div>` : "";
}
// 급식표에 실제로 인쇄되는 형태는 숫자다 (예: 1.5.6.10). 숫자로 보여줘야 대조가 된다.
function numBadges(menu, highlightMissing){
  if (!menu.numbers.length) return `<span class="no">번호 못 읽음</span>`;
  return menu.numbers.map(n => `<span class="no hit">${n}번</span>`).join("") +
    (highlightMissing ? `<span class="no miss">${highlightMissing}번 없음</span>` : "");
}

/* ============================================================
   원재료명(성분표) 입력
   메뉴 이름과 다른 점: 라벨의 원재료명은 짐작이 아니라 제조사가 표기한 사실이다.
   그래서 여기서 매칭된 것은 전부 확정이다. 조리법 추론이 끼어들 자리가 없다.
   다만 복합 원재료(마요네즈·카레분)의 속은 라벨에 안 적히는 일이 잦고,
   그 구멍만 따로 추론해서 확정과 분리해 보여준다.
   ============================================================ */
const OPEN_B = /[(（[【]/, CLOSE_B = /[)）\]】]/;
const ING_SEP = /[,、，·ㆍ‧・;；\/|]/;
const AMOUNT_RE = /^[\d.,]+\s*(%|퍼센트|g|kg|mg|ml|l|ℓ)?$/i;
const AMOUNT_TAIL = /\s*[\d.,]+\s*(%|퍼센트|g|kg|mg|ml|l|ℓ)\s*$/i;
const ORIGIN_RE = /^(국내|수입|외국|[가-힣]{2,5})산$/;
// 라벨이 스스로 밝힌 교차오염 고지. 성분이 아니므로 성분 목록에서 뺀다.
const FACILITY_RE = /같은\s*(제조\s*)?시설|동일\s*(제조\s*)?시설|혼입|같은\s*(생산\s*)?라인/;

const isAliasWord = w => ALL_ALIAS.some(x => x.alias === w) || ALL_EXACT.some(x => x.alias === w);

// 괄호 깊이 0 에서만 자른다. "빵가루(밀가루, 정제소금)" 이 셋으로 쪼개지면 안 된다.
function splitTop(str){
  const out = [];
  let depth = 0, buf = "";
  const flush = () => { const t = buf.trim(); if (t) out.push(t); buf = ""; };
  for (const ch of String(str)){
    if (OPEN_B.test(ch)){ depth++; buf += ch; }
    else if (CLOSE_B.test(ch)){ depth = Math.max(0, depth - 1); buf += ch; }
    else if (depth === 0 && ING_SEP.test(ch)) flush();
    else buf += ch;
  }
  flush();
  return out;
}

// 바깥 이름과 괄호 안 내용을 분리한다. 괄호가 안 닫혀도 버리지 않는다.
function peelParens(piece){
  let depth = 0, outer = "", cur = "";
  const inners = [];
  for (const ch of String(piece)){
    if (OPEN_B.test(ch)){ depth++; if (depth === 1) continue; cur += ch; }
    else if (CLOSE_B.test(ch)){ depth--; if (depth === 0){ inners.push(cur); cur = ""; continue; } cur += ch; }
    else if (depth > 0) cur += ch;
    else outer += ch;
  }
  if (cur.trim()) inners.push(cur);
  return { outer: outer.trim(), inners };
}

function pushIng(name, depth, parent, out){
  let t = String(name).replace(AMOUNT_TAIL, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^[.\-–—]+|[.\-–—]+$/g, "").trim();
  if (!t) return "";
  let kind = "성분";
  if (AMOUNT_RE.test(t)) kind = "함량";
  else if (ORIGIN_RE.test(t) && !isAliasWord(t)) kind = "원산지";   // 별칭과 겹치면 성분으로 살린다
  else if (!/[가-힣]/.test(t)) kind = "기타";
  out.push({ text: t, kind, depth, parent });
  return kind === "성분" ? t : "";
}

function collectIng(str, depth, parent, out){
  for (const piece of splitTop(str)){
    const { outer, inners } = peelParens(piece);
    // "밀가루(밀:미국산)" 처럼 콜론으로 성분:원산지 를 붙여 쓴 표기
    let name = outer, origin = "";
    const c = outer.split(/[:：]/);
    if (c.length === 2 && c[0].trim() && c[1].trim()){ name = c[0].trim(); origin = c[1].trim(); }
    const kept = name ? pushIng(name, depth, parent, out) : "";
    if (origin) pushIng(origin, depth, kept || parent, out);
    for (const inner of inners) collectIng(inner, depth + 1, kept || parent, out);
  }
}

// [대두, 밀 함유] 같은 제조사 자체 선언과 동일시설 고지를 성분 본문에서 떼어낸다.
function extractDecl(raw){
  const declText = [], facility = [];
  let body = String(raw).normalize("NFC")
    .split(/\r?\n/)
    .filter(ln => { if (FACILITY_RE.test(ln)){ facility.push(ln.trim()); return false; } return true; })
    .join("\n");
  const grab = (m, g) => { declText.push(g.trim()); return " "; };
  body = body.replace(/[[【]([^\]】]*?함유[^\]】]*?)[\]】]/g, grab)
             .replace(/[(（]([^)）]*?함유[^)）]*?)[)）]/g, grab)
             .replace(/(?:^|[,\n])\s*([^,\n]*?함유(?:하고\s*있습니다)?\.?)\s*$/, grab);
  return { body, declText, facility };
}

function analyzeIngredients(raw){
  const { body, declText, facility } = extractDecl(raw);
  // 첫 줄이 "제품명 : 원재료명..." 형태면 제품명을 떼어 따로 보여준다.
  // 성분 안에도 콜론이 흔하므로(밀:미국산) 제품명 자리에 괄호·구분자가 오면 제품명으로 보지 않는다.
  let product = "", text = body;
  const pm = body.match(/^\s*([^\n:：(（[【,、，·ㆍ‧・;；\/|]{1,20})\s*[:：]\s*([\s\S]+)$/);
  if (pm){ product = pm[1].trim(); text = pm[2]; }

  const items = [];
  collectIng(text, 0, "", items);
  const ing = items.filter(x => x.kind === "성분");

  const pseudo = { raw: text.trim(), display: product || "원재료명", tokens: ing.map(x => x.text), numbers: [] };
  const direct = matchMenu(pseudo);
  const inferred = inferMenu(pseudo);
  [...direct.warn, ...direct.already].forEach(x => inferred.delete(x.a.id));

  // 제조사 선언을 같은 엔진으로 읽는다. 선언과 성분을 같은 자로 재야 대조가 성립한다.
  const declTokens = declText.flatMap(t => splitTop(t.replace(/함유(하고\s*있습니다)?\.?/g, " "))
    .map(x => x.replace(/[을를이가과와,]\s*$/, "").trim()).filter(Boolean));
  const declMatch = declTokens.length
    ? matchMenu({ raw: declText.join(" · "), display: "", tokens: declTokens, numbers: [] })
    : { warn: [], already: [], trace: [] };
  const declIds = new Set([...declMatch.warn, ...declMatch.already].map(x => x.a.id));

  const facTokens = facility.flatMap(t => splitTop(t.replace(FACILITY_RE, " ")));
  const facMatch = facTokens.length
    ? matchMenu({ raw: facility.join(" · "), display: "", tokens: facTokens, numbers: [] })
    : { warn: [], already: [], trace: [] };

  // 성분이 하나도 없어도 함유 선언이나 동일시설 고지가 있으면 그것만이라도 보여준다
  return { product, items, ing, direct, inferred, declText, declTokens, declIds, declMatch,
           facility, facMatch, empty: !ing.length && !declText.length && !facility.length };
}

/* ============================================================
   학교 급식 불러오기 — 교육부 NEIS 오픈API
   이 기능을 쓸 때만 학교 이름이 기기 밖으로 나간다. 사진과 OCR 결과는 나가지 않는다.
   키 없이 호출되고 Access-Control-Allow-Origin 이 열려 있어 브라우저에서 직접 부른다.
   ============================================================ */
/* ---------- 메뉴명 → 영어 프롬프트 조립 ----------
   NEIS 가 주는 메뉴명은 사전에 없는 것이 대부분이다. '재료 + 조리법' 합성어라는 규칙을
   이용해 즉석에서 영어 설명문을 만든다. 사전에 있으면 손으로 쓴 문장을 그대로 쓴다. */
function stripModifiers(name){
  let s = String(name).normalize("NFC").replace(/[^가-힣]/g, "");
  let prev;
  do { prev = s; for (const m of LEX.modifiers) if (s.startsWith(m) && s.length > m.length + 1) s = s.slice(m.length); }
  while (s !== prev);
  return s;
}

function composePrompts(rawName){
  if (!LEX) return null;
  const hit = DISH.dishes.find(d => d.ko === rawName);
  if (hit) return Array.isArray(hit.en) ? hit.en : [hit.en];
  const name = stripModifiers(rawName);
  if (name.length < 2) return null;
  const hit2 = DISH.dishes.find(d => d.ko === name);
  if (hit2) return Array.isArray(hit2.en) ? hit2.en : [hit2.en];

  let rest = name, meth = null;
  for (const m of LEX.methods){
    if (rest === m.suf){ meth = m; rest = ""; break; }
    if (rest.endsWith(m.suf) && rest.length > m.suf.length){ meth = m; rest = rest.slice(0, -m.suf.length); break; }
  }
  const parts = [];
  let work = rest;
  for (const k of LEX_ING){
    if (work.includes(k)){ parts.push(LEX.ingredients[k]); work = work.split(k).join(""); if (parts.length >= 3) break; }
  }
  let ing = parts.length ? [...new Set(parts)].join(" and ") : "";
  if (!meth && !ing) return null;
  let tpl = meth ? meth.en : LEX.fallback;
  if (meth && meth.whiteEn && /^(백|물)|동치미/.test(name)) tpl = meth.whiteEn;      // 백김치는 붉지 않다
  if (meth && meth.riceDedup && ing && !/rice/.test(ing)) ing = ing + " rice";       // '현미' 는 이미 rice 를 품는다
  if (meth && meth.riceDedup && !ing) ing = "white rice";
  return tpl.map(t => t.replace(/\{i\}/g, ing || "vegetables").replace(/\s+/g, " ").trim());
}

const NEIS_BASE = "https://open.neis.go.kr/hub/";
const SCHOOL_KEY = "gsk.school";
const NEIS_KEY = "gsk.neiskey";

const pad2 = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
const ymdLabel = s => `${+s.slice(4, 6)}월 ${+s.slice(6, 8)}일`;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

// 키 없이 부르면 pSize·pIndex 와 무관하게 5건이 상한이다. 총 건수는 head 가 알려주므로
// 몇 건 중 몇 건을 보여주는지 그대로 밝힌다. 키가 있으면 상한이 풀린다.
async function neis(path, params){
  const url = new URL(NEIS_BASE + path);
  const q = { Type: "json", pIndex: 1, pSize: 100, ...params };
  if (state.neisKey) q.KEY = state.neisKey;
  url.search = new URLSearchParams(q);
  const r = await fetch(url);
  if (!r.ok) throw new Error("NEIS 응답 " + r.status);
  const j = await r.json();
  if (j.RESULT) {                                   // 데이터 없음(INFO-200) 등은 빈 결과로 돌린다
    if (j.RESULT.CODE === "INFO-200") return { rows: [], total: 0 };
    throw new Error(j.RESULT.MESSAGE || j.RESULT.CODE);
  }
  const box = j[path];
  if (!box) return { rows: [], total: 0 };
  const rows = (box.find(x => x.row) || {}).row || [];
  const head = (box.find(x => x.head) || {}).head || [];
  const total = (head.find(x => "list_total_count" in x) || {}).list_total_count ?? rows.length;
  return { rows, total };
}

// "기장밥 <br/>전복살미역국 (5.6.18)" → 한 줄에 한 메뉴, 번호는 줄 끝. 기존 정규화가 그대로 먹는다.
function neisMenuText(ddish){
  return String(ddish || "")
    .split(/<br\s*\/?>/i)
    .map(s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
               .replace(/[（(]\s*([\d][\d.\s,·]*)\s*[）)]/g, " $1")   // (5.6.18) → 5.6.18
               .replace(/\s+/g, " ").trim())
    .filter(Boolean).join("\n");
}

async function searchSchool(q){
  const { rows, total } = await neis("schoolInfo", { SCHUL_NM: q });
  return {
    total,
    list: rows.map(r => ({
      atpt: r.ATPT_OFCDC_SC_CODE, code: r.SD_SCHUL_CODE, name: r.SCHUL_NM,
      office: r.ATPT_OFCDC_SC_NM, kind: r.SCHUL_KND_SC_NM, addr: r.ORG_RDNMA
    }))
  };
}

async function loadMeals(school){
  const now = new Date(), tm = new Date(now); tm.setDate(tm.getDate() + 1);
  const { rows } = await neis("mealServiceDietInfo", {
    ATPT_OFCDC_SC_CODE: school.atpt, SD_SCHUL_CODE: school.code,
    MLSV_FROM_YMD: ymd(now), MLSV_TO_YMD: ymd(tm)
  });
  const today = ymd(now);
  return rows.map(r => ({
    date: r.MLSV_YMD, when: r.MLSV_YMD === today ? "오늘" : "내일",
    meal: r.MMEAL_SC_NM, text: neisMenuText(r.DDISH_NM), cal: r.CAL_INFO
  })).filter(m => m.text)
     .sort((a, b) => a.date.localeCompare(b.date) || a.meal.localeCompare(b.meal));
}

function scMsg(t, bad){
  const el = $("#sc-msg"); if (!el) return;
  el.innerHTML = t ? `<span style="color:var(--${bad ? "fix" : "dim"})">${esc(t)}</span>` : "";
}

function renderSchoolList(list, total){
  const el = $("#sc-list");
  if (!list.length){ el.innerHTML = ""; return; }
  const cut = total > list.length;
  el.innerHTML = `<div class="sc-hits">` + list.map((s, i) =>
    `<button class="sc-hit" data-i="${i}"><span class="n">${esc(s.name)}</span>
      <span class="d">${esc(s.office)} · ${esc(s.kind || "—")}${s.addr ? " · " + esc(s.addr) : ""}</span></button>`
  ).join("") + `</div>` +
  (cut ? `<div class="xs" style="margin-top:8px;color:var(--inf)">
    <strong>${total}곳 중 ${list.length}곳만 보여줍니다.</strong>
    ${state.neisKey ? "" : "NEIS는 인증키 없이 조회하면 5곳까지만 돌려줍니다. "}
    찾는 학교가 없으면 이름을 더 자세히 적어 주십시오.</div>` : "");
  $$("#sc-list .sc-hit").forEach(b => b.onclick = () => pickSchool(list[+b.dataset.i]));
}

async function pickSchool(s){
  state.school = s;
  try { localStorage.setItem(SCHOOL_KEY, JSON.stringify(s)); } catch {}
  $("#sc-list").innerHTML = "";
  $("#sc-q").value = s.name;
  scMsg("급식을 불러오는 중…");
  try {
    state.meals = await loadMeals(s);
    state.mealsLoaded = true;
  } catch (e){
    state.meals = []; state.mealsLoaded = false;
    scMsg("급식을 불러오지 못했습니다: " + e.message, true);
    renderDays();
    return;
  }
  scMsg("");
  renderDays();
  const first = state.meals.find(m => m.when === "오늘" && m.meal === "중식") || state.meals[0];
  if (first) useMeal(first);
}

function renderDays(){
  const el = $("#sc-days");
  const s = state.school;
  if (!s){ el.innerHTML = ""; return; }
  let h = `<div class="sc-cur"><b>${esc(s.name)}</b> <span class="muted">${esc(s.office)}</span>
    <button class="lnk" id="sc-reset">다른 학교</button>
    <button class="lnk" id="sc-reload">다시 불러오기</button></div>`;
  if (!state.mealsLoaded){
    // 아직 조회하지 않았다. "없다" 고 적으면 확인하지 않은 것을 확인한 것처럼 말하게 된다.
    h += `<div class="xs muted" style="margin-top:9px">저장된 학교입니다. 아직 급식을 불러오지 않았습니다.</div>`;
  } else if (!state.meals.length){
    h += `<div class="xs muted" style="margin-top:9px">오늘과 내일 급식이 NEIS에 올라와 있지 않습니다.
      방학이거나 학교가 아직 등록하지 않은 경우입니다. 급식표 사진으로 확인해 주십시오.</div>`;
  } else {
    h += `<div class="sc-days">` + state.meals.map((m, i) => {
      const d = new Date(+m.date.slice(0, 4), +m.date.slice(4, 6) - 1, +m.date.slice(6, 8));
      return `<button class="sc-day${state.mealPick === i ? " on" : ""}" data-i="${i}">
        <span class="w">${esc(m.when)} · ${WEEK[d.getDay()]}요일</span>
        <span class="t">${ymdLabel(m.date)} ${esc(m.meal)}</span></button>`;
    }).join("") + `</div>`;
  }
  el.innerHTML = h;
  const rs = $("#sc-reset"); if (rs) rs.onclick = () => {
    state.school = null; state.meals = []; state.mealPick = -1; state.mealsLoaded = false;
    try { localStorage.removeItem(SCHOOL_KEY); } catch {}
    $("#sc-q").value = ""; $("#sc-days").innerHTML = ""; setText(""); scMsg("");
  };
  const rl = $("#sc-reload"); if (rl) rl.onclick = () => pickSchool(s);
  $$("#sc-days .sc-day").forEach(b => b.onclick = () => useMeal(state.meals[+b.dataset.i]));
}

function useMeal(m){
  state.mealPick = state.meals.indexOf(m);
  renderDays();
  setText(m.text);
  $("#fixbox").open = false;
}

function wireSchool(){
  const go = async () => {
    const q = $("#sc-q").value.trim();
    if (q.length < 2){ scMsg("학교 이름을 두 글자 이상 적어 주십시오.", true); return; }
    $("#sc-list").innerHTML = "";
    scMsg("찾는 중…");
    try {
      const { list, total } = await searchSchool(q);
      if (!list.length){ scMsg("그런 이름의 학교를 찾지 못했습니다.", true); return; }
      scMsg(total > list.length ? `${total}곳이 걸렸습니다. 아래에서 고르세요.`
                                : `${total}곳을 찾았습니다. 학교를 고르세요.`);
      renderSchoolList(list, total);
    } catch (e){ scMsg("학교를 찾지 못했습니다: " + e.message, true); }
  };
  $("#sc-go").onclick = go;
  $("#sc-q").addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); go(); } });

  const kf = $("#sc-key");
  if (kf){
    try { state.neisKey = localStorage.getItem(NEIS_KEY) || ""; } catch {}
    kf.value = state.neisKey;
    kf.addEventListener("input", e => {
      state.neisKey = e.target.value.trim();
      try {
        if (state.neisKey) localStorage.setItem(NEIS_KEY, state.neisKey);
        else localStorage.removeItem(NEIS_KEY);
      } catch {}
    });
  }

  try {
    const saved = JSON.parse(localStorage.getItem(SCHOOL_KEY) || "null");
    if (saved && saved.code){ state.school = saved; $("#sc-q").value = saved.name; renderDays(); }
  } catch {}
}

/* ============================================================
   OCR — 로컬에 내려받은 Tesseract.js + kor.traineddata
   ============================================================ */
const OCR = {
  worker: null, ready: false,
  async ensure(log){
    if (this.worker) return this.worker;
    if (typeof Tesseract === "undefined")
      throw new Error("Tesseract 스크립트를 불러오지 못했습니다. vendor/tesseract/ 를 확인하세요.");
    log && log("모델 불러오는 중… (최초 1회, 로컬 파일)");
    // 워커는 blob 안에서 importScripts 를 호출한다. blob 에는 base URL 이 없으므로
    // 상대 경로는 반드시 절대 URL 로 바꿔서 넘겨야 한다.
    const abs = p => new URL(p, location.href).href;
    this.worker = await Tesseract.createWorker("kor", 1, {
      workerPath: abs("vendor/tesseract/worker.min.js"),
      corePath:   abs("vendor/tesseract/"),
      langPath:   abs("vendor/tesseract/lang"),
      gzip: false,
      logger: m => {
        if (!m || !m.status) return;
        const pct = m.progress != null ? Math.round(m.progress * 100) : null;
        log && log(m.status + (pct != null ? ` ${pct}%` : ""), m.progress);
      }
    });
    await this.worker.setParameters({
      tessedit_pageseg_mode: "6",          // 균일한 텍스트 블록
      preserve_interword_spaces: "1"
    });
    this.ready = true;
    return this.worker;
  },
  async run(canvas, log){
    const w = await this.ensure(log);
    const { data } = await w.recognize(canvas);
    return data.text || "";
  }
};

/* ============================================================
   음식 사진 인식 — CLIP zero-shot, 전부 로컬
   모델은 후보를 좁히기만 한다. 확정은 사람이 누른다.
   CLIP 은 영어 학습 모델이라 나물류를 잘 구분하지 못한다.
   모델 점수를 확정으로 쓰면 틀린 알레르겐을 알려주게 된다.
   ============================================================ */
const VISION = {
  ready: false, modelReady: false, tok: null, proc: null, txtModel: null, visModel: null, textEmb: null,
  proto: null, lastVec: null, rKey: null, rNames: null, rEmb: null,

  async lib(log){
    if (window.transformers) return window.transformers;
    log && log("인식 라이브러리 불러오는 중…");
    // 벤더 파일은 ESM 빌드(export{...})다. 클래식 <script> 로 넣으면 구문 오류가 나고
    // 전역도 안 생긴다. 동적 import 로 받아 window.transformers 에 얹는다.
    const url = new URL("vendor/transformers.min.js", location.href).href;
    let mod;
    try {
      mod = await import(/* webpackIgnore: true */ url);
    } catch (e){
      throw new Error("vendor/transformers.min.js 를 불러오지 못했습니다: " + e.message);
    }
    const T = mod.default && mod.default.AutoTokenizer ? mod.default : mod;
    if (!T || !T.AutoTokenizer) throw new Error("transformers 모듈에 AutoTokenizer 가 없습니다");
    window.transformers = T;
    return T;
  },

  async ensure(log){
    await this.ensureModel(log);
    await this.ensureDict(log);
  },

  /** 모델만 올린다. 사전 임베딩은 아직 계산하지 않는다. */
  async ensureModel(log){
    if (this.modelReady) return;
    const T = await this.lib(log);
    T.env.allowRemoteModels = false;                       // 외부로 절대 나가지 않는다
    T.env.allowLocalModels = true;
    T.env.localModelPath = new URL("vendor/models/", location.href).href;
    T.env.backends.onnx.wasm.wasmPaths = new URL("vendor/ort/", location.href).href;
    T.env.backends.onnx.wasm.numThreads = 1;
    const id = "Xenova/clip-vit-base-patch32";
    log && log("모델 불러오는 중… 약 147MB, 최초 1회만", 0.1);
    this.tok = await T.AutoTokenizer.from_pretrained(id);
    this.proc = await T.AutoProcessor.from_pretrained(id);
    log && log("텍스트 모델 불러오는 중…", 0.35);
    this.txtModel = await T.CLIPTextModelWithProjection.from_pretrained(id, { quantized: true });
    log && log("이미지 모델 불러오는 중…", 0.6);
    this.visModel = await T.CLIPVisionModelWithProjection.from_pretrained(id, { quantized: true });
    this.proto = loadProto();
    this.modelReady = true;
  },

  /** 후보 이름 목록 → 이름별 평균 임베딩. 프롬프트 앙상블은 여기서 한다. */
  async embedNames(names, log, from){
    const tpl = DISH.prompt_template || "a photo of {}";
    const flat = [], owner = [], keep = [];
    names.forEach(ko => {
      const en = composePrompts(ko);
      if (!en) return;                                     // 재료도 조리법도 못 읽으면 후보에서 뺀다
      const i = keep.push(ko) - 1;
      en.forEach(s => { flat.push(tpl.replace("{}", s)); owner.push(i); });
    });
    const acc = keep.map(() => null);
    const B = 256;
    for (let s = 0; s < flat.length; s += B){
      const ti = this.tok(flat.slice(s, s + B), { padding: true, truncation: true });
      const { text_embeds } = await this.txtModel(ti);
      this.unit(text_embeds).forEach((v, k) => {
        const i = owner[s + k];
        if (!acc[i]) acc[i] = v.slice();
        else for (let j = 0; j < v.length; j++) acc[i][j] += v[j];
      });
      log && log(`${from || "메뉴 후보"} 임베딩 ${Math.min(s + B, flat.length)} / ${flat.length}`,
                 0.7 + 0.29 * Math.min(1, (s + B) / flat.length));
      await new Promise(r => setTimeout(r, 0));            // 메인 스레드를 놔줘야 화면이 안 멈춘다
    }
    return { names: keep, emb: acc.map(v => {
      let s = 0; for (const x of v) s += x * x;
      s = Math.sqrt(s) || 1;
      return v.map(x => x / s);
    }) };
  },

  /** 사전 전체(400종) 임베딩. 후보를 좁혀 쓸 때는 이걸 아예 건너뛴다. */
  async ensureDict(log){
    if (this.ready) return;
    await this.ensureModel(log);
    log && log("메뉴 후보 " + DISH.dishes.length + "개 임베딩 계산 중…", 0.7);
    const r = await this.embedNames(DISH.dishes.map(d => d.ko), log, "사전");
    const at = new Map(r.names.map((ko, i) => [ko, r.emb[i]]));
    this.textEmb = DISH.dishes.map(d => at.get(d.ko) || null);
    this.ready = true;
  },

  /** 텐서를 행별 단위벡터 배열로 (코사인 유사도용) */
  unit(t){
    const [n, d] = t.dims, a = t.data, out = [];
    for (let i = 0; i < n; i++){
      const v = Array.from(a.slice(i * d, (i + 1) * d));
      let s = 0; for (const x of v) s += x * x;
      s = Math.sqrt(s) || 1;
      out.push(v.map(x => x / s));
    }
    return out;
  },

  /** 사진 한 장을 512차원 단위벡터로 */
  async embed(src){
    const T = window.transformers;
    const img = await T.RawImage.read(src);
    const { image_embeds } = await this.visModel(await this.proc(img));
    return this.unit(image_embeds)[0];
  },

  /** 예시 사진 한 장을 그 메뉴의 프로토타입에 흡수시킨다 (평균 방향 갱신) */
  learn(ko, vec){
    const cur = this.proto[ko];
    if (!cur){ this.proto[ko] = { v: vec.slice(), n: 1 }; }
    else {
      for (let i = 0; i < vec.length; i++) cur.v[i] = (cur.v[i] * cur.n + vec[i]) / (cur.n + 1);
      let s = 0; for (const x of cur.v) s += x * x;
      s = Math.sqrt(s) || 1;
      cur.v = cur.v.map(x => x / s);
      cur.n += 1;
    }
    saveProto(this.proto);
  },

  /** restrict 에 이름 목록을 주면 그 안에서만 고른다 (예: NEIS 가 알려준 오늘 급식). */
  async classify(src, log, topk = 5, restrict = null){
    let cands, emb, narrowed = false;
    if (restrict && restrict.length){
      // 사전 400종을 다 임베딩할 필요가 없다. 오늘 나온 것만 계산하면 몇 초면 끝난다.
      await this.ensureModel(log);
      const key = restrict.join("|");
      if (this.rKey !== key){
        const r = await this.embedNames(restrict, log, "오늘 급식");
        this.rKey = key; this.rNames = r.names; this.rEmb = r.emb;
      }
      cands = this.rNames.map((ko, i) => ({ ko, ti: i }));
      emb = this.rEmb; narrowed = true;
    } else {
      await this.ensureDict(log);
      cands = DISH.dishes.map((d, i) => ({ ko: d.ko, ti: i }));
      emb = this.textEmb;
    }
    log && log("사진 분석 중…", 0.95);
    const iv = await this.embed(src);
    this.lastVec = iv;                                     // 고른 뒤 예시로 등록할 때 다시 쓴다

    const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
    const P = this.proto || {};
    // 사전에 없는 이름으로 가르쳤다면 그 이름도 후보에 넣는다. 안 그러면 배워도 안 나온다.
    // 다만 후보를 좁힌 상태에서는 넣지 않는다. 좁힌 뜻이 사라진다.
    if (!narrowed) for (const ko of Object.keys(P)) if (!cands.some(c => c.ko === ko)) cands.push({ ko, ti: -1 });

    const tS = cands.map(c => (c.ti >= 0 && emb[c.ti]) ? dot(emb[c.ti], iv) : null);  // 사진 ↔ 설명문
    const pS = cands.map(c => P[c.ko] ? dot(P[c.ko].v, iv) : null);             // 사진 ↔ 배운 사진
    // 점수는 CLIP 온도(100)를 곱한 로짓. 배운 사진은 여기에 가산점으로 얹는다.
    //
    // 주의: CLIP 이미지 임베딩은 서로 무관한 사진끼리도 코사인이 0.9 안팎으로 높다.
    // 절대값을 그대로 쓰면 배운 메뉴가 모든 사진에서 이겨버린다. 그래서 이 사진에 대한
    // '배경 수준'(프로토타입들과의 중앙값)을 재고, 거기서 얼마나 튀는지만 신호로 본다.
    const ps = pS.filter(x => x !== null);
    let base0, span;
    if (ps.length >= 3){
      const st = [...ps].sort((a, b) => a - b);
      base0 = st[Math.floor(st.length / 2)];
      span = Math.max(1e-3, Math.max(...ps) - base0);
    } else {
      base0 = 0.85; span = Math.max(1e-3, 1 - base0);   // 배운 게 한둘이면 잴 수 없다. 보수적으로 본다.
    }
    const known = tS.filter(x => x !== null);
    const meanT = known.reduce((a, b) => a + b, 0) / (known.length || 1);
    const final = cands.map((c, i) => {
      const base = (tS[i] === null ? meanT : tS[i]) * 100;   // 사전에 없이 사진으로만 배운 메뉴는 평균에서 출발
      const pr = P[c.ko];
      if (!pr) return base;
      const rel = Math.max(0, Math.min(1, (pS[i] - base0) / span));
      return base + 6 * rel * (pr.n / (pr.n + 2));           // 글자 점수 차이가 보통 0.5~2 로짓이라 6 이면 충분히 세다
    });

    const scored = cands.map((c, i) => ({
      ko: c.ko, score: final[i], textScore: tS[i], protoScore: pS[i],
      shots: P[c.ko] ? P[c.ko].n : 0, taughtOnly: c.ti < 0
    })).sort((p, q) => q.score - p.score).slice(0, topk);
    const top = scored[0] ? scored[0].score : 0;
    const ex = scored.map(x => Math.exp(x.score - top));    // 로짓 그대로 softmax (오버플로 방지)
    const sum = ex.reduce((p, q) => p + q, 0) || 1;
    scored.forEach((x, i) => x.p = ex[i] / sum);
    return scored;
  }
};

/* ---------- 배운 사진(프로토타입) 저장 ---------- */
const PROTO_KEY = "gsk.proto";
function loadProto(){
  try { return JSON.parse(localStorage.getItem(PROTO_KEY) || "{}") || {}; } catch { return {}; }
}
function saveProto(p){
  try {
    // 512차원 × 메뉴 수. 소수 4자리로 줄여야 localStorage 안에 들어간다.
    const slim = {};
    for (const [k, v] of Object.entries(p)) slim[k] = { v: v.v.map(x => +x.toFixed(4)), n: v.n };
    localStorage.setItem(PROTO_KEY, JSON.stringify(slim));
  } catch (e){ console.warn("프로토타입 저장 실패:", e.message); }
}
function protoStats(){
  const p = VISION.proto || loadProto();
  const ks = Object.keys(p);
  return { classes: ks.length, shots: ks.reduce((n, k) => n + p[k].n, 0), map: p };
}

/** 대비 보정 + 확대. 한국어 OCR 정확도에 가장 크게 기여한다. */
function preprocess(img){
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  let scale = Math.max(1, Math.min(3, 1500 / Math.min(sw, sh)));
  if (sw * scale > 2400) scale = 2400 / sw;
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  const gray = new Uint8ClampedArray(p.length >> 2);
  let mn = 255, mx = 0;
  for (let i = 0, j = 0; i < p.length; i += 4, j++){
    const g = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0;
    gray[j] = g; if (g < mn) mn = g; if (g > mx) mx = g;
  }
  const range = Math.max(1, mx - mn);
  for (let i = 0, j = 0; i < p.length; i += 4, j++){
    const v = ((gray[j] - mn) * 255 / range) | 0;
    p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return { canvas: c, scale: +scale.toFixed(2), w: c.width, h: c.height };
}

/* ============================================================
   학생 · 학부모용 렌더
   ============================================================ */
function gradeChip(grade){
  const g = INF.grades[grade] || {};
  return `<span class="g i">추론 · ${esc(g.label || grade)}<span class="n">${esc(g.desc || "")}</span></span>`;
}

/* ---------- 한눈 요약: 메뉴별이 아니라 알레르겐별로 묶는다 ----------
   학부모가 실제로 하는 질문은 "오늘 우리 아이 알레르겐이 나오나?" 하나다.
   메뉴 13개를 훑게 하지 말고 알레르겐 이름을 크게 보여준다.        */
const KIND_RANK = { gap: 0, fix: 1, inf: 2 };
const KIND_LABEL = { gap: "급식표 번호 빠짐", fix: "이름에 적힘", inf: "조리법 추론" };
const gw = g => (INF.grades[g] || { w: 0 }).w;

function summarize(rows){
  const main = new Map();
  const put = (a, kind, grade, menu) => {
    const p = main.get(a.id);
    if (!p){ main.set(a.id, { a, kind, grade, menus: [menu] }); return; }
    if (!p.menus.includes(menu)) p.menus.push(menu);
    if (KIND_RANK[kind] < KIND_RANK[p.kind]){ p.kind = kind; p.grade = grade; }
    else if (kind === p.kind && kind === "inf" && gw(grade) > gw(p.grade)) p.grade = grade;
  };
  for (const r of rows){
    r.gaps.forEach(x => put(x.a, "gap", x.info.grade, r.menu.display));
    r.direct.warn.forEach(x => put(x.a, "fix", null, r.menu.display));
    r.infOut.forEach(x => put(x.a, "inf", x.info.grade, r.menu.display));
  }
  // 19종은 급식표 번호로 확인되므로 따로 띠에 모은다. 위에 이미 오른 것은 뺀다.
  const legal = new Map();
  for (const r of rows){
    const add = (a, sure) => {
      if (main.has(a.id)) return;
      const p = legal.get(a.id) || { a, menus: [], sure: false };
      p.sure = p.sure || sure;
      if (!p.menus.includes(r.menu.display)) p.menus.push(r.menu.display);
      legal.set(a.id, p);
    };
    r.direct.already.forEach(x => add(x.a, true));
    r.infLegal.forEach(x => add(x.a, false));
  }
  return {
    main: [...main.values()].sort((p, q) =>
      KIND_RANK[p.kind] - KIND_RANK[q.kind] || gw(q.grade) - gw(p.grade) ||
      p.a.name.localeCompare(q.a.name)),
    legal: [...legal.values()].sort((p, q) => (p.a.legalNo || 99) - (q.a.legalNo || 99))
  };
}

function renderGlance(rows){
  const { main, legal } = summarize(rows);
  let h = `<div class="glance-h">
    <span class="t">오늘 이 알레르기가 있으면 확인하세요</span>
    <span class="c">급식표에 번호가 붙지 않는 것 ${main.length}종</span></div>`;

  if (main.length){
    h += `<div class="glance">`;
    for (const m of main){
      const grade = m.kind === "inf" ? (INF.grades[m.grade] || {}).label || m.grade : null;
      h += `<div class="gl k-${m.kind}">
        <span class="gl-k">${esc(KIND_LABEL[m.kind])}</span>
        <div class="gl-n">${esc(m.a.name)}</div>
        ${grade ? `<div class="gl-g">추론 · ${esc(grade)}</div>` : ""}
        ${m.kind === "gap" ? `<div class="gl-g">급식표에 ${m.a.legalNo}번이 안 보입니다</div>` : ""}
        <div class="gl-m">${esc(m.menus.slice(0, 3).join(", "))}${m.menus.length > 3 ? ` 외 ${m.menus.length - 3}개` : ""}</div>
      </div>`;
    }
    h += `</div>
    <div class="legend">
      <span class="l-fix"><i></i>이름에 적힘 (확정)</span>
      <span class="l-inf"><i></i>조리법에서 짐작 (추론)</span>
      <span class="l-gap"><i></i>급식표 번호가 빠짐 (확인 필요)</span>
    </div>`;
  } else {
    h += `<div class="glance-none">이 도구가 찾는 19종 밖 알레르겐이 오늘 메뉴에서 발견되지 않았습니다.<br>
      <b>※ 알레르겐이 없다는 뜻이 아닙니다. 찾지 못했다는 뜻입니다.</b>
      이름에 드러나지 않는 재료와 조리 중 교차오염은 이 도구가 알 수 없습니다.</div>`;
  }

  if (legal.length){
    h += `<div class="strip"><div class="st-t">급식표 번호로 확인하세요 — 법정 표시 대상 19종</div>
      <div class="st-l">${legal.map(x =>
        `<span class="chip"><span class="n">${x.a.legalNo}번</span>${esc(x.a.name)}${x.sure ? "" : '<span class="q">추론</span>'}</span>`
      ).join("")}</div>
      <div class="st-f">이 항목들은 급식표에 번호가 붙습니다. 종이 급식표의 번호를 직접 보는 것이
        이 도구의 추론보다 정확합니다. <b>추론</b> 표시는 이름에서 짐작한 것으로, 번호가 실제로
        있는지는 아래 4번 항목에서 대조할 수 있습니다.</div></div>`;
  }
  return h;
}

function renderStudent(rows){
  const fix = [], gap = [], io = [], il = [], alr = [], non = [];
  for (const r of rows){
    r.direct.warn.forEach(x => fix.push({ r, ...x }));
    r.gaps.forEach(x => gap.push({ r, ...x }));
    r.infOut.forEach(x => io.push({ r, ...x }));
    r.infLegal.forEach(x => il.push({ r, ...x }));
    r.direct.already.forEach(x => alr.push({ r, ...x }));
    if (!r.direct.warn.length && !r.gaps.length && !r.infOut.length && !r.infLegal.length && !r.direct.already.length)
      non.push(r);
  }
  let h = "";

  /* 0. 한눈 요약 — 알레르겐별. 학부모가 가장 먼저 보는 것 */
  h += renderGlance(rows);

  h += `<div class="xs muted" style="margin-top:var(--s3)">읽은 메뉴 ${rows.length}개 ·
    확정 ${fix.length}건 · 번호 확인 ${gap.length}건 · 추론 ${io.length}건.
    아래는 메뉴별로 자세히 본 것입니다.</div>`;

  /* 1. 함께 조심할 것 — 교차반응, 한 줄씩 */
  // 19종 안팎을 가리지 않고 탐지된 모든 알레르겐에서 교차반응을 찾는다.
  // 새우 ⑨ 가 잡혔는데 게 ⑧ 와의 교차반응을 감추면, 번호만 보고 안심하게 만든다.
  const xrIds = [...new Set([...fix, ...gap, ...io, ...il, ...alr].map(x => x.a.id))]
    .filter(id => crossFor(id).length);
  if (xrIds.length){
    h += `<div class="xrs"><div class="t">함께 조심할 수 있는 것</div><div class="ln">`;
    for (const id of xrIds){
      const a = byId[id];
      h += `<div><b>${esc(a.name)}</b> → ${crossFor(id).map(x =>
        `${esc(byId[x.b].name)}<span class="g2">혈청 ${esc(x.serologic)}</span><span class="g2">증상 ${esc(x.clinical)}</span>${x.unverified ? '<span class="g2">출처 미확인</span>' : ""}`
      ).join(" · ")}</div>`;
    }
    h += `</div><div class="f">혈청 등급과 증상 등급은 다릅니다. 항체가 붙는다고 사람이 반응하는 것은 아닙니다.
      자세한 근거는 전문가용 화면에 있습니다.</div></div>`;
  }

  /* 2. 메뉴별 상세 — 접어둔다 */
  h += `<details class="more"><summary>메뉴별로 자세히 보기 (${rows.length}개)</summary>
    <div class="more-b"><table class="dtl"><tbody>`;
  for (const r of rows){
    const items = [];
    r.gaps.forEach(x => items.push(`<span class="it"><span class="tag2 a-gap">번호</span>${esc(x.a.name)} <span class="faint">${x.a.legalNo}번 없음</span></span>`));
    r.direct.warn.forEach(x => items.push(`<span class="it"><span class="tag2 a-fix">확정</span>${esc(x.a.name)}</span>`));
    r.infOut.forEach(x => items.push(`<span class="it"><span class="tag2 a-inf">추론</span>${esc(x.a.name)} <span class="faint">${esc((INF.grades[x.info.grade] || {}).label || x.info.grade)}</span></span>`));
    r.infLegal.forEach(x => items.push(`<span class="it"><span class="tag2 a-inf">추론</span>${esc(x.a.name)} <span class="faint">${x.a.legalNo}번</span></span>`));
    r.direct.already.forEach(x => items.push(`<span class="it"><span class="tag2 a-alr">표시</span>${esc(x.a.name)}</span>`));
    h += `<tr><td class="mn">${esc(r.menu.display)}</td>
      <td class="nb">${r.menu.numbers.length ? r.menu.numbers.join(".") + "번" : "번호 없음"}</td>
      <td class="fi">${items.length ? items.join("") : '<span class="faint">찾은 것 없음</span>'}</td></tr>`;
  }
  h += `</tbody></table>
    <div class="xs muted" style="margin-top:10px">"찾은 것 없음"은 <b>알레르겐이 없다는 뜻이 아닙니다.</b>
    이 도구가 찾지 못했다는 뜻입니다. 이름에 드러나지 않는 재료와 조리 중 교차오염은 알 수 없습니다.</div>
    </div></details>`;

  h += `<div class="tail">이 결과는 판정이 아닙니다. <b>확인할 것의 목록</b>입니다.
    담당 의사와 영양교사에게 확인하십시오.</div>`;
  return h;
}

function renderCross(a, collapsed){
  const xr = crossFor(a.id);
  if (!xr.length) return "";
  let inner = `<div class="xr-t">함께 반응할 수 있다고 보고된 식품</div>`;
  for (const x of xr){
    const B = byId[x.b];
    inner += `<div class="xr-item">
      <div class="xr-pair">${esc(a.name)} ↔ ${esc(B.name)}${x.unverified ? '<span class="unv">출처 미확인</span>' : ""}</div>
      <div class="grades">
        <span class="g s">혈청 검사 ${esc(x.serologic)}<span class="n">${esc(DB.grade_defs[x.serologic] || "")}</span></span>
        <span class="g c">실제 증상 ${esc(x.clinical)}<span class="n">${esc(DB.grade_defs[x.clinical] || "")}</span></span>
      </div>
      <div class="xr-note">${esc(x.note)}</div>
      ${x.source ? srcLink(x.source) : '<div class="src">출처가 확인되지 않은 항목입니다.</div>'}</div>`;
  }
  inner += `<div class="xr-note" style="margin-top:10px">혈청 검사 등급과 실제 증상 등급은 <strong>다른 것</strong>입니다.
    항체가 붙는다고 해서 사람이 반응한다는 뜻이 아닙니다.</div>`;
  return collapsed
    ? `<details style="margin-top:10px"><summary>교차반응 보기</summary><div class="xr" style="border-top:0">${inner}</div></details>`
    : `<div class="xr">${inner}</div>`;
}

/* ============================================================
   전문가용 렌더
   ============================================================ */
function renderExpert(rows){
  if (!rows) rows = [];
  let h = "";
  const nFix = rows.reduce((n, r) => n + r.direct.warn.length, 0);
  const nGap = rows.reduce((n, r) => n + r.gaps.length, 0);
  const nInf = rows.reduce((n, r) => n + r.infOut.length + r.infLegal.length, 0);

  h += `<div class="blk"><div class="blk-h"><span>DETECTION — 확정 (이름에 직접 표기)</span>
    <span>메뉴 ${rows.length} · 19종밖 ${nFix} · 19종내 ${rows.reduce((n, r) => n + r.direct.already.length, 0)}</span></div>
    <div class="blk-b scroll"><table><thead><tr>
      <th>메뉴</th><th>매칭 별칭</th><th>알레르겐</th><th>19종</th><th>순위</th><th>줄의 번호</th><th>출처</th>
    </tr></thead><tbody>`;
  let any = false;
  for (const r of rows) for (const { a, alias } of [...r.direct.warn, ...r.direct.already]){
    any = true;
    h += `<tr><td class="m">${esc(r.menu.display)}</td><td class="m">${esc(alias)}</td>
      <td>${esc(a.name)}</td>
      <td>${a.legal19 ? NO[a.legalNo] + a.legalNo : '<b style="color:var(--fix)">없음</b>'}</td>
      <td>${a.rank ? a.rank + "위" : "—"}</td>
      <td class="m">${r.menu.numbers.length ? r.menu.numbers.join(",") : "—"}</td>
      <td class="m">${a.source ? esc(a.source) : '<span style="color:var(--fix)">미확인</span>'}</td></tr>`;
  }
  if (!any) h += `<tr><td colspan="7" class="muted">탐지된 항목이 없습니다.</td></tr>`;
  h += `</tbody></table></div></div>`;

  /* 추론 감사 */
  h += `<div class="blk"><div class="blk-h"><span>INFERENCE — 추론 (이름에서 짐작)</span>
    <span>${nInf}건 · 누락의심 ${nGap}</span></div><div class="blk-b scroll"><table><thead><tr>
      <th>메뉴</th><th>규칙</th><th>키워드</th><th>경로</th><th>추론 재료</th><th>등급</th><th>19종</th><th>판정</th>
    </tr></thead><tbody>`;
  let anyI = false;
  // 한 메뉴에서 나온 추론은 한 덩어리로 묶는다. 메뉴 이름을 줄마다 되풀이하면
  // 같은 메뉴에 재료가 몇 개 딸렸는지가 눈에 안 들어온다.
  for (const r of rows){
    const list = [...r.gaps.map(x => ({ ...x, gap: true })), ...r.infOut, ...r.infLegal];
    if (!list.length) continue;
    anyI = true;
    list.forEach(({ a, info, gap }, i) => {
      const verdict = gap ? '<b style="color:var(--gap)">번호 누락 의심</b>'
        : a.legal19 ? (r.menu.numbers.includes(a.legalNo) ? '<span style="color:var(--ok)">번호 일치</span>'
          : r.menu.numbers.length ? '<span class="muted">번호 없음(등급 낮음)</span>' : '<span class="muted">번호 못 읽음</span>')
        : '<span style="color:var(--inf)">19종 밖 · 번호로 확인 불가</span>';
      h += `<tr class="${i === 0 ? "mgrp" : ""}">`;
      if (i === 0) h += `<td class="m mname" rowspan="${list.length}">${esc(r.menu.display)}
        <span class="mcnt">추론 ${list.length}</span></td>`;
      h += `<td class="m">${esc(info.rules[0])}</td>
        <td class="m">${esc(info.keys[0])}</td><td class="m">${esc(info.vias[0])}</td>
        <td>${esc(a.name)}</td><td class="m">${esc(info.grade)}</td>
        <td>${a.legal19 ? NO[a.legalNo] + a.legalNo : "없음"}</td><td>${verdict}</td></tr>`;
    });
  }
  if (!anyI) h += `<tr><td colspan="8" class="muted">추론된 항목이 없습니다.</td></tr>`;
  h += `</tbody></table>
    <div class="xs muted" style="margin-top:10px"><strong>추론은 확정이 아니다.</strong>
    '거의확실' 등급이고 19종인데 그 줄에서 번호를 읽지 못한 경우에만 누락을 의심한다.
    그 줄에서 번호를 하나도 읽지 못하면 OCR 실패와 구분할 수 없으므로 판정하지 않는다.</div></div></div>`;

  /* 교차반응 — 19종 안팎을 가리지 않는다. 새우 ⑨ 와 게 ⑧ 처럼 둘 다 표시 대상인 쌍이야말로
     '번호 하나만 보고 안심하는' 상황을 막아준다. */
  const ids = new Set();
  rows.forEach(r => [...r.direct.warn, ...r.direct.already, ...r.infOut, ...r.infLegal, ...r.gaps]
    .forEach(w => ids.add(w.a.id)));
  // crossFor 는 양쪽 방향을 다 돌려준다. 표에서는 같은 쌍을 한 줄로만 보여준다.
  const seenPair = new Set();
  const pairs = [...ids].flatMap(id => crossFor(id)).filter(x => {
    const k = [x.a, x.b].sort().join("|");
    if (seenPair.has(k)) return false;
    seenPair.add(k); return true;
  });
  if (pairs.length){
    h += `<div class="blk"><div class="blk-h"><span>CROSS-REACTIVITY</span><span>혈청학적 / 임상적 분리 표기</span></div>
      <div class="blk-b scroll"><table><thead><tr><th>쌍</th><th>단백질</th><th>혈청</th><th>임상</th><th>출처</th></tr></thead><tbody>`;
    for (const x of pairs){
      h += `<tr><td>${esc(byId[x.a].name)} ↔ ${esc(byId[x.b].name)}${x.unverified ? '<span class="unv">미확인</span>' : ""}</td>
        <td class="m">${esc(x.aProt || "—")} / ${esc(x.bProt || "—")}</td>
        <td class="m"><span class="g s">${esc(x.serologic)}</span></td>
        <td class="m"><span class="g c">${esc(x.clinical)}</span></td>
        <td class="m">${x.source ? esc(x.source) : '<span style="color:var(--fix)">없음</span>'}</td></tr>
        <tr><td colspan="5" class="muted xs">${esc(x.note)}</td></tr>`;
    }
    h += `</tbody></table></div></div>`;
  }

  /* 정규화 추적 */
  h += `<div class="blk"><div class="blk-h"><span>NORMALIZATION TRACE</span><span>문자열 처리 전 과정</span></div>
    <div class="blk-b scroll"><table><thead><tr>
      <th>원문 줄</th><th>읽은 번호</th><th>토큰</th><th>공백제거</th><th>마스킹 후</th><th>차단</th></tr></thead><tbody>`;
  for (const r of rows) for (const t of r.direct.trace){
    h += `<tr><td class="m">${esc(r.menu.raw)}</td>
      <td class="m">${r.menu.numbers.length ? r.menu.numbers.join(",") : "—"}</td>
      <td class="m">${esc(t.token)}</td><td class="m">${esc(t.start)}</td>
      <td class="m">${esc(t.masked).replace(new RegExp(MASK + "+", "g"), s => `<span class="mask">${s}</span>`)}</td>
      <td class="m">${t.ffHits.length ? esc(t.ffHits.join(", ")) : "—"}</td></tr>`;
  }
  if (!rows.length) h += `<tr><td colspan="6" class="muted">입력이 없습니다.</td></tr>`;
  h += `</tbody></table><div class="xs muted" style="margin-top:10px">
    마스킹 구간은 소비된 문자열입니다. 긴 별칭을 먼저 소비하므로 <code>아몬드슬라이스</code>가
    <code>아몬드</code>로 중복 매칭되지 않습니다. 차단 열은 false_friends 선차단 결과입니다 (들깨 ≠ 참깨).</div>
    </div></div>`;

  /* 등급 정의 */
  h += `<div class="blk"><div class="blk-h"><span>GRADE DEFINITIONS</span></div><div class="blk-b gdef">`;
  h += `<div style="margin-bottom:8px"><b>교차반응</b></div>`;
  for (const [k, v] of Object.entries(DB.grade_defs)) h += `<div><b>${esc(k)}</b> — ${esc(v)}</div>`;
  h += `<div style="margin:12px 0 8px"><b>재료 추론</b></div>`;
  for (const [k, v] of Object.entries(INF.grades)) h += `<div><b>${esc(k)}</b> — ${esc(v.desc)}</div>`;
  h += `<div style="margin-top:12px;color:var(--fix)">S3 이라고 해서 C3 인 것이 아니다.
    '거의확실'이라고 해서 확정인 것도 아니다. 축을 합치는 순간 사용자를 속이게 된다.</div></div></div>`;

  /* 사전 감사 */
  const caut = DB.allergens.filter(a => a.caution);
  const noSrc = DB.allergens.filter(a => !a.legal19 && !a.source);
  const unv = DB.cross_reactions.filter(x => x.unverified);
  h += `<div class="blk"><div class="blk-h"><span>DICTIONARY AUDIT</span>
    <span>알레르겐 ${DB.allergens.length} · 추론규칙 ${INF.rules.length}</span></div><div class="blk-b">`;
  caut.forEach(a => h += `<div class="chk"><span class="st fail">오탐주의</span><span><strong>${esc(a.name)}</strong> — ${esc(a.caution)}</span></div>`);
  noSrc.forEach(a => h += `<div class="chk"><span class="st fail">출처없음</span><span><strong>${esc(a.name)}</strong> — 19종 밖 항목인데 출처가 비어 있습니다.</span></div>`);
  unv.forEach(x => h += `<div class="chk"><span class="st fail">인용오류</span><span><strong>${esc(byId[x.a].name)} ↔ ${esc(byId[x.b].name)}</strong> — ${esc(x.note)}</span></div>`);
  h += `<div class="xs muted" style="margin-top:9px">오탐 허용치는 0건이다. 애매하면 사전에 넣지 않는다.
    거짓 경고가 반복되면 사용자는 진짜 경고도 무시한다.</div>
    <details style="margin-top:10px"><summary>알레르겐 사전 전체 (${DB.allergens.length}종)</summary>
    <div class="scroll" style="margin-top:9px"><table><thead><tr><th>알레르겐</th><th>19종</th><th>별칭</th><th>차단어</th></tr></thead><tbody>`;
  for (const a of DB.allergens){
    const ex = (a.exact_aliases || []).map(x => `<span class="mask">${esc(x)}</span>`).join(", ");
    h += `<tr><td>${esc(a.name)}</td><td class="m">${a.legal19 ? NO[a.legalNo] + a.legalNo : "N"}</td>
      <td class="m">${esc(a.aliases.join(", "))}${ex ? " · " + ex + " (전체일치)" : ""}</td>
      <td class="m">${(a.false_friends || []).length ? esc(a.false_friends.join(", ")) : "—"}</td></tr>`;
  }
  h += `</tbody></table></div></details>
    <details style="margin-top:8px"><summary>추론 규칙 전체 (${INF.rules.length}개)</summary>
    <div class="scroll" style="margin-top:9px"><table><thead><tr><th>id</th><th>키워드</th><th>경로</th><th>추론</th></tr></thead><tbody>`;
  for (const r of INF.rules){
    h += `<tr><td class="m">${esc(r.id)}</td><td class="m">${esc(r.match.join(", "))}</td>
      <td class="m">${esc(r.via)}</td>
      <td class="m">${r.infer.map(i => `${esc((byId[i.allergen] || {}).name || i.allergen)}:${esc(i.grade)}`).join(", ")}</td></tr>`;
  }
  h += `</tbody></table></div></details></div></div>`;

  /* 참고 전용 */
  h += `<div class="blk"><div class="blk-h"><span>REFERENCE ONLY</span><span>탐지 대상 아님</span></div><div class="blk-b">`;
  for (const r of DB.reference_only){
    h += `<div class="xr-item"><div class="xr-pair">${esc(r.label)}</div>
      <div class="grades"><span class="g s">${esc(r.serologic)}</span><span class="g c">${esc(r.clinical)}</span></div>
      <div class="xr-note">${esc(r.note)}</div>${srcLink(r.source)}</div>`;
  }
  h += `</div></div>`;

  return h;
}

/* ---------- 원재료명 결과 ---------- */
function declCell(res, id, legal19){
  if (!res.declText.length) return `<span class="muted">라벨에 함유 표기 없음</span>`;
  if (res.declIds.has(id)) return `<span style="color:var(--ok)">선언됨</span>`;
  return legal19
    ? `<b style="color:var(--gap)">선언에 없음</b>`
    : `<span style="color:var(--inf)">선언에 없음 · 의무 아님</span>`;
}

function renderIngredients(res){
  if (!res) return "";
  if (res.empty){
    return `<div class="blk"><div class="blk-b muted">원재료명에서 성분을 찾지 못했습니다.
      라벨의 원재료명 부분을 쉼표까지 그대로 붙여넣어 주십시오.</div></div>`;
  }
  const warn = res.direct.warn, already = res.direct.already;
  let h = "";

  /* 19종 밖 — 이 도구의 본론 */
  h += `<div class="blk"><div class="blk-h"><span>DETECTION — 19종 밖 (확정 · 라벨에 적힘)</span>
    <span>${res.product ? esc(res.product) + " · " : ""}성분 ${res.ing.length} · 검출 ${warn.length}</span></div>
    <div class="blk-b scroll"><table><thead><tr>
      <th>성분</th><th>매칭 별칭</th><th>알레르겐</th><th>순위</th><th>라벨 함유 선언</th><th>출처</th>
    </tr></thead><tbody>`;
  for (const { a, alias } of warn){
    const src = res.ing.find(x => x.text.replace(/\s+/g, "").includes(alias));
    h += `<tr><td class="m">${esc(src ? src.text : alias)}${src && src.parent ? `<span class="muted xs"> ← ${esc(src.parent)}</span>` : ""}</td>
      <td class="m"><span class="mask">${esc(alias)}</span></td>
      <td><strong>${esc(a.name)}</strong></td>
      <td>${a.rank ? a.rank + "위" : "—"}</td>
      <td class="m">${declCell(res, a.id, false)}</td>
      <td class="m">${a.source ? esc(a.source) : '<span style="color:var(--fix)">미확인</span>'}</td></tr>`;
  }
  if (!warn.length) h += `<tr><td colspan="6" class="muted">19종 밖 알레르겐이 이 원재료명에서 검출되지 않았습니다. 검출되지 않은 것과 들어 있지 않은 것은 다릅니다.</td></tr>`;
  h += `</tbody></table><div class="xs muted" style="margin-top:10px">
    19종 밖 품목은 <strong>함유 선언 의무가 없습니다.</strong> 선언에 없다는 것이 표시 위반은 아닙니다.
    원재료명에 적혀 있는데 선언에는 빠지는 것이 정상적인 결과라는 뜻이고, 그래서 원재료명을 직접 읽어야 합니다.</div>
    </div></div>`;

  /* 19종 내 — 선언과 대조 */
  const missing = already.filter(x => res.declText.length && !res.declIds.has(x.a.id));
  h += `<div class="blk"><div class="blk-h"><span>DETECTION — 19종 내 (확정 · 선언 대조)</span>
    <span>검출 ${already.length} · 선언 누락 의심 ${missing.length}</span></div>
    <div class="blk-b scroll"><table><thead><tr>
      <th>성분</th><th>매칭 별칭</th><th>알레르겐</th><th>번호</th><th>라벨 함유 선언</th>
    </tr></thead><tbody>`;
  for (const { a, alias } of already){
    const src = res.ing.find(x => x.text.replace(/\s+/g, "").includes(alias));
    h += `<tr><td class="m">${esc(src ? src.text : alias)}${src && src.parent ? `<span class="muted xs"> ← ${esc(src.parent)}</span>` : ""}</td>
      <td class="m"><span class="mask">${esc(alias)}</span></td>
      <td>${esc(a.name)}</td>
      <td class="m">${a.legalNo ? NO[a.legalNo] + a.legalNo : "—"}</td>
      <td class="m">${declCell(res, a.id, true)}</td></tr>`;
  }
  if (!already.length) h += `<tr><td colspan="5" class="muted">19종 내 알레르겐이 검출되지 않았습니다.</td></tr>`;
  h += `</tbody></table>${missing.length ? `<div class="xs" style="margin-top:10px;color:var(--gap)">
    <strong>원재료명에는 적혀 있는데 함유 선언에는 없는 19종 품목이 ${missing.length}건입니다.</strong>
    라벨을 다시 확인하고, 제조사에 문의할 근거로 쓰십시오.</div>` : ""}</div></div>`;

  /* 제조사 선언 */
  h += `<div class="blk"><div class="blk-h"><span>LABEL DECLARATION — 제조사가 스스로 밝힌 것</span>
    <span>선언 ${res.declText.length ? res.declTokens.length : 0} · 교차오염 고지 ${res.facility.length}</span></div><div class="blk-b">`;
  if (res.declText.length){
    h += `<div class="chk"><span class="st pass">선언</span><span class="m">${esc(res.declText.join(" · "))}</span></div>`;
    const declOnly = [...res.declMatch.warn, ...res.declMatch.already]
      .filter(x => ![...warn, ...already].some(y => y.a.id === x.a.id));
    if (declOnly.length){
      h += `<div class="chk"><span class="st fail">역방향</span><span>선언에는 있으나 원재료명에서는 찾지 못한 항목:
        <strong>${declOnly.map(x => esc(x.a.name)).join(", ")}</strong> — 복합 원재료 속에 있거나, 원재료명을 덜 붙여넣었을 수 있습니다.</span></div>`;
    }
  } else {
    h += `<div class="chk"><span class="st fail">없음</span><span>이 입력에는 <code>[… 함유]</code> 형태의 선언이 없습니다. 선언과 대조할 수 없습니다.</span></div>`;
  }
  for (const f of res.facility){
    const ids = [...res.facMatch.warn, ...res.facMatch.already].map(x => x.a.name);
    h += `<div class="chk"><span class="st fail">동일시설</span><span class="m">${esc(f)}${ids.length ? ` <strong>→ ${esc(ids.join(", "))}</strong>` : ""}</span></div>`;
  }
  h += `<div class="xs muted" style="margin-top:9px">동일시설 고지는 제조사의 진술입니다. 이 도구가 검증한 것이 아닙니다.
    조리 중 교차오염은 이 도구가 알 수 없습니다.</div></div></div>`;

  /* 복합 원재료 추론 — 확정과 반드시 분리 */
  const infList = [...res.inferred].map(([id, info]) => ({ a: byId[id], info })).filter(x => x.a);
  h += `<div class="blk"><div class="blk-h"><span>INFERENCE — 복합 원재료의 속 (추론)</span>
    <span>${infList.length}건 · 확정 아님</span></div><div class="blk-b scroll"><table><thead><tr>
      <th>규칙</th><th>키워드</th><th>경로</th><th>추론 재료</th><th>등급</th><th>19종</th><th>라벨 함유 선언</th>
    </tr></thead><tbody>`;
  for (const { a, info } of infList){
    h += `<tr><td class="m">${esc(info.rules[0])}</td><td class="m">${esc(info.keys[0])}</td>
      <td class="m">${esc(info.vias[0])}</td><td>${esc(a.name)}</td>
      <td class="m">${esc(info.grade)}</td>
      <td class="m">${a.legal19 ? NO[a.legalNo] + a.legalNo : "없음"}</td>
      <td class="m">${declCell(res, a.id, !!a.legal19)}</td></tr>`;
  }
  if (!infList.length) h += `<tr><td colspan="7" class="muted">추론된 항목이 없습니다.</td></tr>`;
  h += `</tbody></table><div class="xs muted" style="margin-top:10px">
    위쪽 두 표는 라벨에 적힌 사실이고, <strong>이 표는 짐작입니다.</strong>
    복합 원재료(마요네즈·카레분 등)는 속 재료가 라벨에 다 적히지 않는 경우가 있어 규칙으로 짐작합니다.
    확정으로 이미 잡힌 것은 이 표에서 뺐습니다.</div></div></div>`;

  /* 교차반응 */
  const ids = new Set([...warn, ...already, ...infList].map(x => x.a.id));
  // crossFor 는 양쪽 방향을 다 돌려준다. 표에서는 같은 쌍을 한 줄로만 보여준다.
  const seenPair = new Set();
  const pairs = [...ids].flatMap(id => crossFor(id)).filter(x => {
    const k = [x.a, x.b].sort().join("|");
    if (seenPair.has(k)) return false;
    seenPair.add(k); return true;
  });
  if (pairs.length){
    h += `<div class="blk"><div class="blk-h"><span>CROSS-REACTIVITY</span><span>혈청학적 / 임상적 분리 표기</span></div>
      <div class="blk-b scroll"><table><thead><tr><th>쌍</th><th>단백질</th><th>혈청</th><th>임상</th><th>출처</th></tr></thead><tbody>`;
    for (const x of pairs){
      h += `<tr><td>${esc(byId[x.a].name)} ↔ ${esc(byId[x.b].name)}${x.unverified ? '<span class="unv">미확인</span>' : ""}</td>
        <td class="m">${esc(x.aProt || "—")} / ${esc(x.bProt || "—")}</td>
        <td class="m"><span class="g s">${esc(x.serologic)}</span></td>
        <td class="m"><span class="g c">${esc(x.clinical)}</span></td>
        <td class="m">${x.source ? esc(x.source) : '<span style="color:var(--fix)">없음</span>'}</td></tr>
        <tr><td colspan="5" class="muted xs">${esc(x.note)}</td></tr>`;
    }
    h += `</tbody></table></div></div>`;
  }

  /* 파싱 추적 */
  h += `<div class="blk"><div class="blk-h"><span>PARSE TRACE — 원재료명 분해</span>
    <span>토큰 ${res.items.length} · 성분 ${res.ing.length}</span></div>
    <div class="blk-b scroll"><table><thead><tr>
      <th>깊이</th><th>토큰</th><th>분류</th><th>상위 원재료</th></tr></thead><tbody>`;
  for (const it of res.items){
    h += `<tr><td class="m">${it.depth}</td>
      <td class="m" style="padding-left:${9 + it.depth * 16}px">${it.depth ? "└ " : ""}${esc(it.text)}</td>
      <td class="m">${it.kind === "성분" ? esc(it.kind) : `<span class="muted">${esc(it.kind)}</span>`}</td>
      <td class="m muted">${esc(it.parent || "—")}</td></tr>`;
  }
  h += `</tbody></table><div class="xs muted" style="margin-top:10px">
    괄호 안은 상위 원재료의 속 재료로 보고 한 단계 들여씁니다. <code>빵가루(밀가루(밀:미국산), 정제소금)</code> 처럼
    중첩된 괄호도 끝까지 펼칩니다. 원산지·함량은 성분에서 제외하되 지우지 않고 분류만 바꿔 남깁니다.
    다만 알레르겐 별칭과 겹치는 낱말은 원산지로 보지 않고 성분으로 살립니다.</div></div></div>`;

  /* 매칭 추적 */
  h += `<div class="blk"><div class="blk-h"><span>NORMALIZATION TRACE</span><span>문자열 처리 전 과정</span></div>
    <div class="blk-b scroll"><table><thead><tr>
      <th>성분</th><th>공백제거</th><th>마스킹 후</th><th>차단</th></tr></thead><tbody>`;
  for (const t of res.direct.trace){
    h += `<tr><td class="m">${esc(t.token)}</td><td class="m">${esc(t.start)}</td>
      <td class="m">${esc(t.masked).replace(new RegExp(MASK + "+", "g"), s => `<span class="mask">${s}</span>`)}</td>
      <td class="m">${t.ffHits.length ? esc(t.ffHits.join(", ")) : "—"}</td></tr>`;
  }
  h += `</tbody></table></div></div>`;

  return h;
}

/* ============================================================
   상태 · 라우터 · 이벤트
   ============================================================ */
const state = { text: "", rows: null, mode: "menu", picked: [], ing: "", ingRes: null, inTab: "menu",
                school: null, meals: [], mealPick: -1, mealsLoaded: false, neisKey: "", narrow: true };

function reanalyzeIng(){
  state.ingRes = state.ing.trim() ? analyzeIngredients(state.ing) : null;
  const el = $("#ing-out");
  if (el) el.innerHTML = state.ingRes ? renderIngredients(state.ingRes) : "";
}

// 전문가용 INPUT 탭. 급식표와 원재료명은 입력도 결과도 섞지 않는다.
function setInTab(which){
  state.inTab = which;
  $$("#exp-tabs .um").forEach(b => {
    const on = b.dataset.in === which;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  $$("[data-pane]").forEach(p => { p.hidden = p.dataset.pane !== which; });
  const eo = $("#exp-out"), io = $("#ing-out");
  if (eo) eo.hidden = which !== "menu";
  if (io) io.hidden = which !== "ing";
  if (which === "ing") reanalyzeIng(); else reanalyze();
}

function reanalyze(){
  state.rows = state.text.trim() ? analyze(state.text) : [];
  const s = $("#stu-out"); if (s) s.innerHTML = state.rows.length ? renderStudent(state.rows) : emptyMsg();
  const e = $("#exp-out");
  if (e && $("#screen-expert").classList.contains("on")) e.innerHTML = renderExpert(state.rows);
  const st = $("#step3-st"); if (st) st.textContent = state.rows.length ? `메뉴 ${state.rows.length}개` : "";
  $$(".step").forEach(x => x.classList.toggle("done", x.dataset.step <= (state.rows.length ? "3" : state.text.trim() ? "2" : "1")));
}
function emptyMsg(){
  return `<div class="card c-non"><div class="say">입력에서 메뉴를 찾지 못했습니다.
    한 줄에 한 메뉴씩 들어가 있는지 확인해 주십시오. 한글이 없는 줄과 표 머리글(날짜·열량 등)은 건너뜁니다.</div></div>`;
}

function route(){
  const h = location.hash.replace(/^#\/?/, "");
  const name = ["student", "expert"].includes(h) ? h : "intro";
  $$(".screen").forEach(s => s.classList.toggle("on", s.id === "screen-" + name));
  $$(".pick").forEach(b => b.setAttribute("aria-current", String(b.dataset.go === name)));
  if (name === "expert"){
    $("#exp-out").innerHTML = renderExpert(state.rows);
    reanalyzeIng();
  }
  if (name !== "intro") setDrawer(false);
  scrollTo(0, 0);
}

/* ---------- 우측 당기는 탭 ---------- */
let W = 0, open = false, drag = null, suppressClick = false;
const drawer = () => $("#drawer"), handle = () => $("#handle");
function measure(){ W = drawer().offsetWidth - handle().offsetWidth; }
function setDrawer(v, anim = true){
  open = v;
  const d = drawer(), hd = handle();
  d.classList.toggle("anim", anim);
  d.style.transform = "";
  d.classList.toggle("open", v);
  d.setAttribute("aria-hidden", String(!v));
  hd.setAttribute("aria-expanded", String(v));
  $(".lbl", hd).textContent = v ? "닫기" : "눌러서 열기";
  $(".arw", hd).textContent = v ? "▶" : "◀";
  $("#scrim").classList.toggle("on", v && innerWidth < 900);
}

function wireDrawer(){
  const hd = handle(), d = drawer();
  measure();
  addEventListener("resize", () => { measure(); setDrawer(open, false); });
  hd.addEventListener("pointerdown", e => {
    if (e.button) return;
    e.preventDefault();          // 텍스트 선택이 시작되면 pointercancel 로 드래그가 죽는다
    suppressClick = false;       // 이전 pointercancel 이 남긴 억제 플래그를 지운다
    measure();
    drag = { x: e.clientX, base: open ? 0 : W, moved: 0 };
    d.classList.remove("anim");
    try { hd.setPointerCapture(e.pointerId); } catch {}
  });
  hd.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    const x = Math.min(W, Math.max(0, drag.base + dx));
    d.style.transform = `translateX(${x}px)`;
    $("#scrim").classList.toggle("on", innerWidth < 900 && x < W * 0.6);
  });
  const end = e => {
    if (!drag) return;
    const mv = drag.moved; drag = null;
    try { hd.releasePointerCapture(e.pointerId); } catch {}
    if (mv < 6) return;                                  // 클릭으로 처리
    // 드래그였으니 뒤따르는 click 한 번만 무시한다. click 은 pointerup 직후
    // 같은 이벤트 순번에 오므로 setTimeout(0) 이 그다음에 플래그를 지운다.
    // (플래그를 계속 들고 있으면 pointercancel 로 끝난 경우 다음 클릭까지 먹는다.)
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const m = /translateX\(([-\d.]+)px\)/.exec(d.style.transform);
    setDrawer((m ? parseFloat(m[1]) : (open ? 0 : W)) < W * 0.65);
  };
  hd.addEventListener("pointerup", end);
  hd.addEventListener("pointercancel", end);
  hd.addEventListener("click", () => {
    if (suppressClick){ suppressClick = false; return; }
    setDrawer(!open);
  });
  hd.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft"){ e.preventDefault(); setDrawer(true); }
    if (e.key === "ArrowRight"){ e.preventDefault(); setDrawer(false); }
  });
  $("#scrim").onclick = () => setDrawer(false);
  addEventListener("keydown", e => { if (e.key === "Escape" && open) setDrawer(false); });
  setDrawer(false, false);
}

/* ---------- 사진 입력: 급식표(OCR) / 음식(CLIP) ---------- */
const setLog = (msg, p) => {
  const l = $(".ocrlog"); if (l) l.textContent = msg || "";
  const b = $(".bar i"); if (b && p != null) b.style.width = Math.round(p * 100) + "%";
};
function setText(t){
  $("#ocr-text").value = t;
  state.text = t;
  reanalyze();
}

function setMode(m){
  state.mode = m;
  // 전문가용 INPUT 탭도 .um 을 쓴다. 학생용 것만 골라야 서로 끄지 않는다.
  $$("#screen-student .um").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
  const photo = m !== "school";
  $("#drop").hidden = !photo;
  $("#preview").hidden = !photo;
  $("#school").hidden = photo;
  $("#drop-t").textContent = m === "dish" ? "음식 사진을 여기로" : "급식표 사진을 여기로";
  $("#drop-s").innerHTML = m === "dish"
    ? "식판이나 반찬 사진 한 장. 후보를 보여주고 <b>직접 고릅니다</b>"
    : "끌어다 놓기 · 클릭해서 고르기 · <b>Ctrl+V</b> 로 붙여넣기";
  $("#dish-pick").innerHTML = "";
  setLog("", 0);
  renderNarrow();
  // 저장된 학교는 이 탭을 열 때 처음 조회한다. 안 쓰는 사람에게 요청을 보내지 않는다.
  if (m === "school" && state.school && !state.mealsLoaded) pickSchool(state.school);
}

// 사진 인식 후보를 오늘 급식으로 좁힐지 알리고 고르게 한다.
function renderNarrow(){
  const el = $("#narrow"); if (!el) return;
  const names = loadedMenuNames();
  el.hidden = state.mode !== "dish";
  if (state.mode !== "dish") return;
  if (!names){
    el.innerHTML = `<div class="nrw off">후보 <b>${DISH.dishes.length}종</b> 전체에서 찾습니다.
      <span class="muted">‘학교로 불러오기’ 에서 학교를 고르면 그날 급식 안에서만 찾아 훨씬 정확해집니다.</span></div>`;
    return;
  }
  el.innerHTML = `<label class="nrw"><input type="checkbox" id="nrw-on"${state.narrow ? " checked" : ""}>
    <span><b>${esc(state.school ? state.school.name : "불러온 학교")}</b>의 오늘·내일 급식
      <b>${names.length}개</b> 안에서만 찾기
      <span class="muted">— 끄면 사전 ${DISH.dishes.length}종 전체에서 찾습니다.
      좁히면 최초 계산도 훨씬 빠릅니다.</span></span></label>`;
  $("#nrw-on").onchange = e => { state.narrow = e.target.checked; };
}

async function handleFile(file){
  if (!file || !/^image\//.test(file.type)){ setLog("이미지 파일만 됩니다 (png, jpg, webp)."); return; }
  const url = URL.createObjectURL(file);
  $("#preview").classList.add("on");
  $("#preview img").src = url;
  $("#dish-pick").innerHTML = "";
  return state.mode === "dish" ? runDish(url) : runOcr(url);
}

function runOcr(url){
  return new Promise(res => {
    const img = new Image();
    img.onload = async () => {
      const { canvas, scale, w, h } = preprocess(img);
      setLog(`전처리 완료 · ${w}×${h} (${scale}배 확대, 대비 보정)`, 0);
      try {
        const text = await OCR.run(canvas, setLog);
        setLog(`글자 인식 완료 · ${text.replace(/\s+/g, "").length}자. 틀린 곳은 아래에서 고치세요`, 1);
        setText(text);
      } catch (e){
        setLog("글자 인식 실패: " + e.message + " — 아래에 직접 입력해도 결과는 같습니다", 0);
      }
      $("#fixbox").open = true;
      res();
    };
    img.onerror = () => { setLog("이미지를 열 수 없습니다."); res(); };
    img.src = url;
  });
}

// NEIS 가 알려준 오늘·내일 급식의 메뉴 이름들. 사진 인식 후보를 여기로 좁힌다.
function loadedMenuNames(){
  if (!state.meals || !state.meals.length) return null;
  const names = new Set();
  for (const m of state.meals)
    for (const line of String(m.text).split(/\n/)){
      const n = line.replace(/[\s\d.,·]+$/, "").trim();     // 줄 끝 알레르기 번호 제거
      if (n.length >= 2) names.add(n);
    }
  return names.size ? [...names] : null;
}

async function runDish(url){
  try {
    const restrict = state.narrow ? loadedMenuNames() : null;
    const top = await VISION.classify(url, setLog, 5, restrict);
    setLog("후보 " + top.length + "개를 찾았습니다. 맞는 것을 누르세요", 1);
    renderDishPick(top);
  } catch (e){
    setLog("사진 인식 실패: " + e.message, 0);
    $("#dish-pick").innerHTML =
      `<div class="dp-warn">사진 인식을 쓸 수 없습니다. 음식 이름을 직접 넣어도 결과는 똑같습니다.</div>${manualBox()}`;
    wireManual();
  }
}

function manualBox(){
  return `<div class="dp-manual">
    <input id="dish-manual" placeholder="목록에 없으면 직접 입력 (예: 오이무침)" aria-label="음식 이름 직접 입력">
    <button class="btn ghost" id="dish-add">추가</button></div>`;
}
function wireManual(){
  const i = $("#dish-manual"), b = $("#dish-add");
  if (!i || !b) return;
  const go = () => { const v = i.value.trim(); if (v){ addDish(v); i.value = ""; } };
  b.onclick = go;
  i.onkeydown = e => { if (e.key === "Enter"){ e.preventDefault(); go(); } };
}

function renderDishPick(top){
  let h = `<div class="dp-h">이 음식이 무엇인지 골라주세요</div>
    <div class="dp-s">모델이 후보를 좁힌 것입니다. <b>모델이 정한 것이 아닙니다.</b>
      누른 음식으로 알레르겐을 확인합니다.</div><div class="dp-l">`;
  for (const d of top){
    h += `<button class="dp" data-ko="${esc(d.ko)}">
      <span class="nm">${esc(d.ko)}${d.shots ? `<span class="shots">사진 ${d.shots}장 배움</span>` : ""}</span>
      <span class="meter"><i style="width:${(d.p * 100).toFixed(0)}%"></i></span>
      <span class="pc">${(d.p * 100).toFixed(0)}%</span></button>`;
  }
  const st = protoStats();
  h += `</div>${manualBox()}
    <label class="dp-learn"><input type="checkbox" id="dish-learn" checked>
      <span>고른 음식을 <b>이 사진으로 기억</b>하기 — 다음부터 같은 반찬을 더 잘 찾습니다.
        사진은 저장하지 않고 숫자 512개로 바꿔 이 브라우저에만 둡니다.
        ${st.classes ? `지금까지 ${st.classes}개 메뉴 · 사진 ${st.shots}장` : "아직 배운 사진이 없습니다"}</span></label>
    <div class="dp-warn">이 모델(CLIP)은 영어 이미지로 학습됐습니다. 시금치나물과 콩나물무침처럼
      비슷하게 생긴 반찬은 잘 구분하지 못합니다. 그래서 <b>사람이 고르게</b> 만들었습니다.
      퍼센트는 후보 사이의 상대적인 점수이며, 맞을 확률이 아닙니다.</div>`;
  $("#dish-pick").innerHTML = h;
  $$("#dish-pick .dp").forEach(b => b.onclick = () => addDish(b.dataset.ko));
  wireManual();
}

function addDish(name){
  if (!name) return;
  // 사용자가 고른 이름이 곧 정답 라벨이다. 확인해 준 것을 그대로 배운다.
  const lc = $("#dish-learn");
  if (lc && lc.checked && VISION.lastVec && VISION.proto){
    VISION.learn(name, VISION.lastVec);
    setLog(`'${name}' 을 사진으로 기억했습니다 (누적 ${VISION.proto[name].n}장)`, 1);
  }
  if (!state.picked.includes(name)) state.picked.push(name);
  const lines = $("#ocr-text").value.split(/\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.includes(name)) lines.push(name);
  setText(lines.join("\n"));
  renderPicked();
  $("#stu-out").scrollIntoView({ block: "start", behavior: "smooth" });
}
function renderPicked(){
  const el = $("#picked");
  if (!state.picked.length){ el.innerHTML = ""; return; }
  el.innerHTML = `<span class="xs muted" style="align-self:center">고른 음식:</span>` +
    state.picked.map(n => `<span class="pk">${esc(n)}<button data-x="${esc(n)}" aria-label="지우기">✕</button></span>`).join("");
  $$("#picked button").forEach(b => b.onclick = () => {
    state.picked = state.picked.filter(x => x !== b.dataset.x);
    setText($("#ocr-text").value.split(/\n/).filter(l => l.trim() !== b.dataset.x).join("\n"));
    renderPicked();
  });
}

function wireStudent(){
  const drop = $("#drop"), input = $("#file");
  $$(".um").forEach(b => b.onclick = () => setMode(b.dataset.mode));
  input.onchange = () => input.files[0] && handleFile(input.files[0]);
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("hot"); }));
  drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; f && handleFile(f); });
  drop.addEventListener("click", () => input.click());
  addEventListener("paste", e => {
    if (!$("#screen-student").classList.contains("on")) return;
    const it = [...(e.clipboardData?.items || [])].find(x => x.type.startsWith("image/"));
    if (it) handleFile(it.getAsFile());
  });
  $("#ocr-text").addEventListener("input", e => { state.text = e.target.value; reanalyze(); });
  $("#stu-sample").onclick = () => { setText(SAMPLE); $("#fixbox").open = true; };
  $("#stu-clear").onclick = () => {
    state.picked = []; renderPicked();
    $("#dish-pick").innerHTML = "";
    $("#preview").classList.remove("on");
    setLog("", 0);
    setText("");
  };
  setMode("menu");
}

/* ---------- 사진으로 가르치기 (여러 장 / 폴더째) ---------- */
// 폴더째면 상위 폴더 이름이 라벨. 낱장이면 파일명에서 끝 번호를 뗀 것이 라벨.
function labelFromFile(f){
  const rel = f.webkitRelativePath || "";
  if (rel.includes("/")){
    const parts = rel.split("/").filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2].trim();
  }
  return f.name.replace(/\.[^.]+$/, "").replace(/[\s_\-–()[\]]*\d+\s*$/, "").trim() || f.name;
}

function lrnLog(msg, p){
  const l = $("#lrn-log"); if (l) l.innerHTML = msg;
  const b = $("#lrn-bar i"); if (b) b.style.width = ((p ?? 0) * 100).toFixed(1) + "%";
}

function renderLearned(){
  const el = $("#lrn-list"); if (!el) return;
  const st = protoStats();
  if (!st.classes){ el.innerHTML = `<div class="xs muted" style="margin-top:10px">아직 배운 사진이 없습니다.</div>`; return; }
  const known = new Set(DISH.dishes.map(d => d.ko));
  el.innerHTML = `<div class="xs" style="margin:12px 0 7px"><b>${st.classes}개 메뉴 · 사진 ${st.shots}장</b></div>
    <div class="scroll"><table><thead><tr><th>메뉴</th><th>배운 사진</th><th>사전</th><th></th></tr></thead><tbody>` +
    Object.keys(st.map).sort((a, b) => st.map[b].n - st.map[a].n).map(k =>
      `<tr><td>${esc(k)}</td><td class="m">${st.map[k].n}장</td>
        <td class="m">${known.has(k) ? "있음" : '<span style="color:var(--inf)">사진으로만</span>'}</td>
        <td><button class="lnk lrn-del" data-ko="${esc(k)}">지우기</button></td></tr>`).join("") +
    `</tbody></table></div>`;
  $$("#lrn-list .lrn-del").forEach(b => b.onclick = () => {
    delete VISION.proto[b.dataset.ko];
    saveProto(VISION.proto);
    renderLearned();
  });
}

async function learnFiles(files){
  const imgs = [...files].filter(f => /^image\//.test(f.type));
  if (!imgs.length){ lrnLog("이미지 파일이 없습니다.", 0); return; }
  lrnLog("모델을 준비하는 중…", 0.02);
  try { await VISION.ensure((m, p) => lrnLog(esc(m), (p ?? 0) * 0.3)); }
  catch (e){ lrnLog(`<span style="color:var(--fix)">모델을 불러오지 못했습니다: ${esc(e.message)}</span>`, 0); return; }

  const tally = {}; let ok = 0, fail = 0;
  for (let i = 0; i < imgs.length; i++){
    const f = imgs[i], ko = labelFromFile(f);
    const url = URL.createObjectURL(f);
    try {
      VISION.learn(ko, await VISION.embed(url));
      tally[ko] = (tally[ko] || 0) + 1; ok++;
    } catch { fail++; }
    finally { URL.revokeObjectURL(url); }
    lrnLog(`${i + 1} / ${imgs.length} — ${esc(ko)}`, 0.3 + 0.7 * (i + 1) / imgs.length);
  }
  const names = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
  lrnLog(`<b>${ok}장을 배웠습니다.</b> ${fail ? `<span style="color:var(--fix)">${fail}장 실패. </span>` : ""}` +
    names.slice(0, 12).map(k => `${esc(k)} ${tally[k]}`).join(" · ") +
    (names.length > 12 ? ` 외 ${names.length - 12}개` : ""), 1);
  renderLearned();
}

function wireLearn(){
  const dirf = $("#lrn-dirf"), filf = $("#lrn-files");
  if (!dirf || !filf) return;
  $("#lrn-dir").onclick  = () => dirf.click();
  $("#lrn-pick").onclick = () => filf.click();
  const on = el => el.addEventListener("change", e => { learnFiles(e.target.files); e.target.value = ""; });
  on(dirf); on(filf);
  $("#lrn-clear").onclick = () => {
    VISION.proto = {};
    saveProto({});
    lrnLog("배운 것을 모두 지웠습니다.", 0);
    renderLearned();
  };
  if (!VISION.proto) VISION.proto = loadProto();
  renderLearned();
}

function wireExpert(){
  $("#exp-text").addEventListener("input", e => { state.text = e.target.value; reanalyze(); });
  $("#exp-sample").onclick = () => { $("#exp-text").value = SAMPLE; state.text = SAMPLE; reanalyze(); };
  $("#exp-sync").onclick = () => { $("#exp-text").value = state.text; reanalyze(); };

  $$("#exp-tabs .um").forEach(b => b.onclick = () => setInTab(b.dataset.in));
  $("#ing-text").addEventListener("input", e => { state.ing = e.target.value; reanalyzeIng(); });
  $("#ing-sample").onclick = () => { $("#ing-text").value = ING_SAMPLE; state.ing = ING_SAMPLE; reanalyzeIng(); };
  $("#ing-clear").onclick  = () => { $("#ing-text").value = ""; state.ing = ""; reanalyzeIng(); };
  setInTab("menu");
}

// 실제 라벨 표기를 그대로 옮긴 형태: 중첩 괄호, 콜론 원산지, [함유] 선언, 동일시설 고지
const ING_SAMPLE = `치킨가스 : 닭고기(국내산 85%), 빵가루[밀가루(밀:미국산), 정제소금, 효모], 대두유, 옥수수전분, 계란, 백설탕, 참깨분말, 아몬드분태, 마요네즈(대두유, 난황, 정제식초), 카레분, 정제수, 향미증진제
[밀, 대두, 계란, 닭고기 함유]
이 제품은 메밀, 새우를 사용한 제품과 같은 제조시설에서 생산되었습니다.`;

const SAMPLE = `쌀밥/잡곡밥
멸치아몬드볶음* 7
시금치나물
김구이
어묵볶음 5.6
돈까스 1.5.6.10
들깨미역국
메밀국수 3.6
찜닭(계육) 5.6.15
캐슈넛샐러드드레싱
키위
해파리냉채 9`;

/* ---------- D 계산기 (화면에서 제거됨. 요소가 없으면 조용히 건너뛴다) ---------- */
function wireCalc(){
  const i = $("#dval"), o = $("#dout"), v = $("#dverdict");
  if (!i || !o || !v) return;
  const f = () => {
    const d = Math.max(0, Math.min(100, parseFloat(i.value) || 0));
    const n = Math.round(950 * d / 100);
    o.textContent = n === 0 ? "0건" : `약 ${n}건`;
    v.innerHTML = d === 0
      ? "<strong>D = 0 이면 이 기획은 우리 학교에서 반증됩니다.</strong> 서사의 중심축을 바꾸거나 프로젝트를 접습니다. 실패가 아니라 싸게 얻은 답입니다."
      : d < 3
        ? "<strong>D &lt; 3%: 구멍은 있지만 얇습니다.</strong> 참깨 축으로 옮겨 다시 셉니다."
        : "<strong>D ≥ 3%: 진행합니다.</strong> 그리고 이 숫자가 발표의 첫 슬라이드입니다.";
  };
  i.addEventListener("input", f); f();
}

/* ---------- 부팅 ---------- */
(async function boot(){
  try{
    await loadData();
  } catch (err){
    document.body.insertAdjacentHTML("afterbegin",
      `<div style="padding:16px;background:#fdf1ee;color:#a8341f;font:14px/1.6 system-ui">
       데이터를 불러오지 못했습니다: ${esc(err.message)}<br>
       이 앱은 <b>로컬 서버로 열어야</b> 합니다. <code>python serve.py</code> 를 실행한 뒤
       <code>http://localhost:8000</code> 으로 접속하세요. (file:// 로는 fetch 와 OCR 워커가 막힙니다.)</div>`);
    return;
  }
  $$("[data-ver]").forEach(el => el.textContent =
    `사전 ${DB.version} · 추론 ${INF.version} · 알레르겐 ${DB.allergens.length}종 · 추론규칙 ${INF.rules.length}개`);
  $$(".pick").forEach(b => b.onclick = () => { location.hash = "#/" + b.dataset.go; });
  $$("[data-go]").forEach(b => { if (!b.classList.contains("pick")) b.onclick = () => { location.hash = "#/" + b.dataset.go; }; });
  // data-go 를 가진 버튼은 위에서 이미 목적지가 정해졌다. 덮어쓰지 않는다.
  $$(".back:not([data-go])").forEach(b => b.onclick = () => { location.hash = "#/"; });
  wireDrawer(); wireStudent(); wireSchool(); wireLearn(); wireExpert(); wireCalc();
  addEventListener("hashchange", route);
  route();
  // 전문가용 콘솔 검증 창구. 화면에 보이는 것과 같은 함수를 그대로 노출한다.
  window.__app = { DB, INF, normalize, matchMenu, inferMenu, gapCheck, analyze, state, OCR, preprocess, SAMPLE };
})();
