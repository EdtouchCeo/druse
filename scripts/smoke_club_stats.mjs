import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import net from "node:net";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX_PATH = join(ROOT, "output", "web", "index.html");
const PAGE_URL = `${pathToFileURL(INDEX_PATH).href}#/student/club-stats`;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForJson(url, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      (this.listeners.get(message.method) || []).forEach((handler) => handler(message.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.sequence;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== handler));
        resolve(params);
      };
      this.listeners.set(method, [...(this.listeners.get(method) || []), handler]);
    });
  }
  on(method, handler) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), handler]);
  }
  close() { this.ws.close(); }
}

async function main() {
  const port = await getFreePort();
  const profile = await mkdtemp(join(tmpdir(), "daeryun-club-stats-smoke-"));
  const browser = spawn(EDGE, [
    "--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", "--disable-extensions",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  let client;
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    const exceptions = [];
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.exception?.description || exceptionDetails.text));
    await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Log.enable")]);
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: PAGE_URL });
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 700));

    async function evaluate(expression) {
      const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    await evaluate(`(() => {
      window.__drcsRouteApplied = document.querySelector('#tab-student').classList.contains('active') &&
        document.querySelector('#tab-student #sub-club-stats').classList.contains('active');
      return window.drClubStatsInit();
    })()`);

    const checks = [];
    async function check(label, expression) {
      const value = await evaluate(expression);
      checks.push({ label, ok: Boolean(value), value });
    }
    const indexSource = await readFile(INDEX_PATH, "utf8");
    checks.push({
      label: "search and tab contracts are preserved",
      ok: indexSource.includes("semanticRetrieve") && indexSource.includes("SRCH") &&
        indexSource.includes("<!-- TAB:student:START -->") && indexSource.includes("<!-- TAB:student:END -->"),
    });

    await check("student hash route targets club stats", "location.hash === '#/student/club-stats' && window.__drcsRouteApplied && document.querySelector('#tab-student #sub-club-stats').classList.contains('active')");
    await check("stats moved out of teacher content", "!document.querySelector('#tab-teacher #sub-club-stats') && document.querySelectorAll('#tab-student #sub-club-stats').length === 1");
    await check("student navigation label is exact", "[...document.querySelectorAll('#tab-student > .sub-nav .sub-nav-btn')].some(b => b.textContent.trim() === '📊 2학기 동아리 조직 현황')");
    await check("schema two public snapshot loaded", "window.DR_CLUB_STATS_2026_2?.schemaVersion === 2 && window.DR_CLUB_STATS_2026_2?.clubs.length === 18 && !document.querySelector('#drcs-content').hidden");
    await check("public stats visible without login", "getComputedStyle(document.querySelector('#tab-student')).display !== 'none' && getComputedStyle(document.querySelector('#sub-club-stats')).display !== 'none' && !getSess()");
    await check("headline phase and basis date rendered", "document.querySelector('#sub-club-stats .section-title').textContent.includes('2026학년도 2학기 동아리 2차 지원 안내') && document.querySelector('#drcs-phase').textContent === '2차 지원 가능 인원 안내' && document.querySelector('#drcs-basis').textContent.includes('2026.09.01.')");
    await check("summary values rendered", "['18개','17개 · 94명','13개 · 80명','174명'].every(v => document.querySelector('#drcs-summary').textContent.includes(v))");
    await check("group summary rendered", "document.querySelector('#drcs-summary-note').textContent.includes('학생 주도 12개 · 교사 주도 6개')");
    await check("default table and mobile list have 18 seven-column rows", "document.querySelectorAll('#drcs-tbody tr').length === 18 && document.querySelectorAll('#drcs-tbody tr:first-child td').length === 7 && document.querySelectorAll('#drcs-mobile-list .drcs-mobile-card').length === 18");
    await check("AI youth entrepreneur uses 22 and 11/11", `(() => { const c=window.DR_CLUB_STATS_2026_2.clubs.find(c=>c.name==='AI유스프러너'); const row=[...document.querySelectorAll('#drcs-tbody tr')].find(r=>r.cells[0]?.textContent==='AI유스프러너'); return c?.group==='student' && c.capacity===22 && c.grade1.current===9 && c.grade1.target===11 && c.grade1.available===2 && c.grade2.current===11 && c.grade2.target===11 && c.grade2.available===0 && row?.cells[2].textContent.includes('9명 / 11명') && row?.cells[3].textContent.trim()==='2명' && row?.cells[5].textContent.includes('모집 없음'); })()`);
    await check("status model and privacy display are removed", "!document.querySelector('#drcs-status-filter') && !document.querySelector('#drcs-privacy') && !document.querySelector('#sub-club-stats').textContent.includes('학생 개인정보 없이 집계 자료만 제공합니다.') && !('privacyNotice' in window.DR_CLUB_STATS_2026_2)");
    await check("student and teacher capacity rules are visible", "(() => { const t=document.querySelector('.drcs-note').textContent; return t.includes('학생 주도 동아리는 정원 22명') && t.includes('교사 주도 동아리는 정원 21명') && t.includes('최종 배정 또는 합격 인원이 아닙니다'); })()");

    await evaluate(`(() => {
      const teacherButton = [...document.querySelectorAll('.tab-btn')].find(button => (button.getAttribute('onclick') || '').includes("'teacher'"));
      switchTab('teacher', teacherButton);
    })()`);
    await check("teacher manual stays behind auth gate", "getComputedStyle(document.querySelector('#teacher-login-required')).display !== 'none' && getComputedStyle(document.querySelector('#teacher-content')).display === 'none' && [...document.querySelectorAll('#cat-activity .sub-nav-btn')].some(b => b.textContent.trim() === '🎯 동아리 업무 매뉴얼')");
    await evaluate("location.hash='#student/club-stats'");
    await new Promise((resolve) => setTimeout(resolve, 180));
    await check("hash without leading slash is supported", "document.querySelector('#tab-student').classList.contains('active') && document.querySelector('#tab-student #sub-club-stats').classList.contains('active')");
    await evaluate("location.hash='#/student/club-stats'");
    await new Promise((resolve) => setTimeout(resolve, 180));
    await check("hash with leading slash is supported", "document.querySelector('#tab-student').classList.contains('active') && document.querySelector('#tab-student #sub-club-stats').classList.contains('active')");

    async function select(id, value) {
      await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(id)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    }
    async function chooseGrade(value) {
      await evaluate(`(() => { const button=[...document.querySelectorAll('#drcs-grade-filter [data-grade]')].find(b=>b.dataset.grade===${JSON.stringify(value)}); button.click(); })()`);
    }
    await chooseGrade("1");
    await check("grade one filter returns 17 and 94", "document.querySelector('#drcs-result-count').textContent === '1학년 지원 가능 17개 동아리 · 94명' && document.querySelectorAll('#drcs-tbody tr').length===17");
    await chooseGrade("2");
    await check("grade two filter returns 13 and 80", "document.querySelector('#drcs-result-count').textContent === '2학년 지원 가능 13개 동아리 · 80명' && document.querySelectorAll('#drcs-tbody tr').length===13");
    await check("cross-grade overage does not hide available club", `(() => { const c=window.DR_CLUB_STATS_2026_2.clubs.find(c=>c.grade1.available===0 && c.grade2.available>0); const row=[...document.querySelectorAll('#drcs-tbody tr')].find(r=>r.cells[0]?.textContent===c?.name); return !!c && !!row && row.cells[3].textContent.includes('모집 없음') && row.cells[5].textContent.includes(c.grade2.available+'명'); })()`);
    await chooseGrade("");
    await check("all grades restore 18 and 174", "document.querySelector('#drcs-result-count').textContent === '전체 추가 모집 18개 동아리 · 174명'");

    await select("#drcs-group-filter", "student");
    await check("student-led filter returns 12", "document.querySelector('#drcs-result-count').textContent.includes('12개 동아리') && document.querySelectorAll('#drcs-tbody tr').length===12");
    await select("#drcs-group-filter", "teacher");
    await check("teacher-led filter returns 6", "document.querySelector('#drcs-result-count').textContent.includes('6개 동아리') && document.querySelectorAll('#drcs-tbody tr').length===6");
    await select("#drcs-group-filter", "");
    await evaluate(`(() => { const el=document.querySelector('#drcs-search'); el.value='AI유스프러너'; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await check("name search returns AI youth entrepreneur", "document.querySelector('#drcs-result-count').textContent.includes('1개 동아리') && document.querySelector('#drcs-tbody').textContent.includes('AI유스프러너')");
    await evaluate(`(() => { const el=document.querySelector('#drcs-search'); el.value='없는 동아리'; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await check("empty search has student-facing message", "document.querySelector('#drcs-tbody .drcs-empty').textContent.includes('선택한 학년의 추가 모집 대상에 해당하는 동아리가 없습니다.') && document.querySelector('#drcs-mobile-list .drcs-empty')");
    await evaluate(`(() => { const el=document.querySelector('#drcs-search'); el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);

    await select("#drcs-sort", "total");
    await check("total availability sort uses computed values", `(() => { const expected=window.DR_CLUB_STATS_2026_2.clubs.slice().sort((a,b)=>b.totalAvailable-a.totalAvailable||a.order-b.order)[0].name; return document.querySelector('#drcs-tbody tr:first-child td:first-child').textContent===expected; })()`);
    await chooseGrade("1");
    await select("#drcs-sort", "selected");
    await check("selected grade sort uses grade availability", `(() => { const expected=window.DR_CLUB_STATS_2026_2.clubs.filter(c=>c.grade1.available>0).sort((a,b)=>b.grade1.available-a.grade1.available||a.order-b.order)[0].name; return document.querySelector('#drcs-tbody tr:first-child td:first-child').textContent===expected; })()`);
    await chooseGrade("");
    await select("#drcs-sort", "source");

    await check("CSV contains only seven public columns", `(() => { const csv=window.drClubStatsBuildCsv(); const lines=csv.replace(/^\\uFEFF/,'').split(/\\r?\\n/); const header=lines[0]; return header.split(',').length===7 && lines.length===19 && ${JSON.stringify(["advisor", "location", "leader", "description", "sharepoint.com", "forms.cloud.microsoft", "@"]) }.every(v=>!csv.toLowerCase().includes(v.toLowerCase())); })()`);
    await check("CSV neutralizes spreadsheet formula prefixes", `(() => { const source=window.DR_CLUB_STATS_2026_2; const club=source.clubs[0]; const original=club.name; const values=['=1+1','+SUM(A1)','-2+3','@SUM(A1)','\\t=1+1','\\r=1+1']; const safe=values.every(value=>{ club.name=value; const csv=window.drClubStatsBuildCsv(); const expected='"'+"'"+value.replace(/"/g,'""')+'"'; return csv.includes(expected); }); club.name=original; window.drClubStatsInit(source); return safe; })()`);
    await check("CSV filename is round-two specific", "window.drClubStatsCsvFilename === '2026-2학기-동아리-2차-추가모집.csv'");
    await check("print controls and print-only contract exist", "document.querySelector('#drcs-print') && document.querySelector('#drcs-csv') && document.querySelector('#sub-club-stats style').textContent.includes('@media print') && document.querySelector('#sub-club-stats style').textContent.includes('drcs-mobile-list')");
    await check("controls meet keyboard and touch contract", "[...document.querySelectorAll('#drcs-search,#drcs-group-filter,#drcs-sort,#drcs-csv,#drcs-print,#drcs-grade-filter button')].every(el => !el.disabled && el.getBoundingClientRect().height >= 44)");

    await check("updated aggregate fixture renders without hard-coded totals", `(() => { const source=window.DR_CLUB_STATS_2026_2; const f=structuredClone(source); const c=f.clubs.find(c=>c.grade1.current>0 && c.grade1.available>0); if(!c) return false; c.grade1.current-=1; c.grade1.available+=1; c.totalAvailable+=1; f.totals.grade1.available+=1; f.totals.available+=1; const ok=window.drClubStatsInit(f) && document.querySelector('#drcs-summary .drcs-stat:last-child strong').textContent===(f.totals.available+'명'); window.drClubStatsInit(source); return ok; })()`);
    await check("teacher tie fixture gives 11 to grade one", `(() => { const f=structuredClone(window.DR_CLUB_STATS_2026_2); const c=f.clubs.find(c=>c.group==='teacher'); c.grade1={current:0,target:11,available:11}; c.grade2={current:0,target:10,available:10}; c.totalAvailable=21; const recalc=()=>{ const g1=f.clubs.reduce((s,x)=>s+x.grade1.available,0), g2=f.clubs.reduce((s,x)=>s+x.grade2.available,0); f.totals={clubs:f.clubs.length,groups:{student:f.clubs.filter(x=>x.group==='student').length,teacher:f.clubs.filter(x=>x.group==='teacher').length},grade1:{clubs:f.clubs.filter(x=>x.grade1.available>0).length,available:g1},grade2:{clubs:f.clubs.filter(x=>x.grade2.available>0).length,available:g2},available:g1+g2}; }; recalc(); const accepts=window.drClubStatsIsValid(f); c.grade1={current:0,target:10,available:10}; c.grade2={current:0,target:11,available:11}; recalc(); return accepts && !window.drClubStatsIsValid(f); })()`);
    await check("schema one, mismatched totals and extra fields fail closed", `(() => { const source=window.DR_CLUB_STATS_2026_2; const badTotal=structuredClone(source); badTotal.totals.available+=1; const extra=structuredClone(source); extra.privacyNotice='not allowed'; const schemaOne=structuredClone(source); schemaOne.schemaVersion=1; return !window.drClubStatsIsValid(badTotal) && !window.drClubStatsIsValid(extra) && !window.drClubStatsIsValid(schemaOne); })()`);
    await check("invalid date duplicate name and non-contiguous order fail closed", `(() => { const source=window.DR_CLUB_STATS_2026_2; const badDate=structuredClone(source); badDate.basisDate='2026-02-30'; const duplicate=structuredClone(source); duplicate.clubs[1].name=duplicate.clubs[0].name; const gap=structuredClone(source); gap.clubs[gap.clubs.length-1].order=gap.clubs.length+1; return !window.drClubStatsIsValid(badDate) && !window.drClubStatsIsValid(duplicate) && !window.drClubStatsIsValid(gap); })()`);
    await check("URL path and internal file markers fail closed", `(() => { const markers=['sharepoint','forms.cloud.microsoft','onedrive','student@example.com','report.xlsx','report.xls','report.hwpx','report.pdf','https://example.com','http://example.com','file://secret']; return markers.every(marker=>{ const f=structuredClone(window.DR_CLUB_STATS_2026_2); f.clubs[0].name='동아리 '+marker; return !window.drClubStatsIsValid(f); }); })()`);
    await check("invalid schema hides content and shows Korean error", "(() => { const ok=window.drClubStatsInit({}); const hidden=document.querySelector('#drcs-content').hidden; const shown=getComputedStyle(document.querySelector('#drcs-error')).display!=='none'; const message=document.querySelector('#drcs-error').textContent.includes('형식 또는 합계가 올바르지 않습니다'); window.drClubStatsInit(window.DR_CLUB_STATS_2026_2); return ok===false && hidden && shown && message; })()");

    await chooseGrade("2");
    for (const width of [320, 375, 768, 1440]) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await new Promise((resolve) => setTimeout(resolve, 120));
      await check(`${width}px page has no horizontal overflow`, "document.documentElement.scrollWidth <= window.innerWidth + 1");
      if (width <= 768) {
        await check(`${width}px uses 13 mobile cards`, "getComputedStyle(document.querySelector('.drcs-table-wrap')).display==='none' && getComputedStyle(document.querySelector('#drcs-mobile-list')).display==='grid' && document.querySelectorAll('#drcs-mobile-list .drcs-mobile-card').length===13");
        await check(`${width}px selected grade is first in each card`, "[...document.querySelectorAll('#drcs-mobile-list .drcs-mobile-card')].every(card=>card.querySelector('.drcs-mobile-grade:first-child').dataset.grade==='2' && card.querySelector('.drcs-mobile-grade:first-child').classList.contains('drcs-mobile-primary'))");
      } else {
        await check(`${width}px uses desktop table`, "getComputedStyle(document.querySelector('.drcs-table-wrap')).display!=='none' && getComputedStyle(document.querySelector('#drcs-mobile-list')).display==='none'");
      }
    }
    await check("no runtime exceptions", `${JSON.stringify(exceptions)}.length === 0`);

    const failed = checks.filter((item) => !item.ok);
    checks.forEach((item) => console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}`));
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    if (failed.length) process.exitCode = 1;
    await client.send("Browser.close").catch(() => {});
    client.close();
  } finally {
    if (!browser.killed) browser.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
