import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import net from "node:net";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGE_URL = `${pathToFileURL(join(ROOT, "output", "web", "index.html")).href}#/teacher/club-stats`;
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
      window.__drcsRouteApplied = document.querySelector('#sub-club-stats').classList.contains('active');
      document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
      document.querySelector('#tab-teacher').classList.add('active');
      document.querySelector('#teacher-login-required').style.display = 'none';
      document.querySelector('#teacher-content').style.display = 'block';
      document.querySelectorAll('#tab-teacher .sub-panel').forEach(el => el.classList.remove('active'));
      document.querySelector('#sub-club-stats').classList.add('active');
      return window.drClubStatsInit();
    })()`);

    const checks = [];
    async function check(label, expression) {
      const value = await evaluate(expression);
      checks.push({ label, ok: Boolean(value), value });
    }
    await check("hash route targets club stats", "location.hash === '#/teacher/club-stats' && window.__drcsRouteApplied && document.querySelector('#sub-club-stats').classList.contains('active')");
    await check("public snapshot loaded", "window.DR_CLUB_STATS_2026_2?.clubs.length === 29 && !document.querySelector('#drcs-content').hidden");
    await check("headline metadata rendered", "document.querySelector('#drcs-phase').textContent.includes('1차 집계 완료 · 2차 접수 전') && document.querySelector('#drcs-snapshot').textContent.includes('2026.08.30. 23:58')");
    await check("summary values rendered", "['29개','28개','537명','94.2%','31명'].every(v => document.querySelector('#drcs-summary').textContent.includes(v)) && document.querySelector('#drcs-round1').textContent.includes('506명')");
    await check("round two is semantic not-open", "document.querySelector('#sub-club-stats').textContent.includes('접수 전') && !document.querySelector('#sub-club-stats').textContent.includes('2차 지원 0명')");
    await check("owner summary is 20/8/1 and 439/168", "(() => { const t=document.querySelector('#drcs-owner').textContent; return ['20개 · 439명','8개 · 168명','1개'].every(v=>t.includes(v)); })()");
    await check("default table has 29 rows and 8 columns", "document.querySelectorAll('#drcs-tbody tr').length === 29 && document.querySelectorAll('#drcs-tbody tr:first-child td').length === 8");

    async function select(id, value) {
      await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(id)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    }
    await select("#drcs-status-filter", "selection_required");
    await check("selection filter returns 15", "document.querySelector('#drcs-result-count').textContent.includes('15개 표시')");
    await select("#drcs-status-filter", "recruiting_available");
    await check("available filter returns 13", "document.querySelector('#drcs-result-count').textContent.includes('13개 표시')");
    await select("#drcs-status-filter", "preorganized");
    await check("preorganized status returns 1", "document.querySelector('#drcs-result-count').textContent.includes('1개 표시')");
    await select("#drcs-status-filter", "");
    await select("#drcs-group-filter", "student");
    await check("student-led filter returns 20", "document.querySelector('#drcs-result-count').textContent.includes('20개 표시')");
    await select("#drcs-group-filter", "teacher");
    await check("teacher-led filter returns 8", "document.querySelector('#drcs-result-count').textContent.includes('8개 표시')");
    await select("#drcs-group-filter", "preorganized");
    await check("preorganized group returns 1", "document.querySelector('#drcs-result-count').textContent.includes('1개 표시')");
    await select("#drcs-group-filter", "");
    await evaluate(`(() => { const el=document.querySelector('#drcs-search'); el.value='호모루덴스'; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await check("name search returns one", "document.querySelector('#drcs-result-count').textContent.includes('1개 표시') && document.querySelector('#drcs-tbody').textContent.includes('호모루덴스')");
    await evaluate(`(() => { const el=document.querySelector('#drcs-search'); el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await check("CSV contains only eight public columns", `(() => { const csv=window.drClubStatsBuildCsv(); const header=csv.replace(/^\\uFEFF/,'').split(/\\r?\\n/)[0]; return header.split(',').length===8 && ${JSON.stringify(["advisor", "location", "leader", "description", "sharepoint.com", "forms.cloud.microsoft", "@"]) }.every(v=>!csv.toLowerCase().includes(v.toLowerCase())); })()`);
    await check("print controls and print-only contract exist", "document.querySelector('#drcs-print') && document.querySelector('#drcs-csv') && document.querySelector('#sub-club-stats style').textContent.includes('@media print')");
    await check("controls meet keyboard and touch contract", "[...document.querySelectorAll('#drcs-search,#drcs-group-filter,#drcs-status-filter,#drcs-sort,#drcs-csv,#drcs-print')].every(el => !el.disabled && el.getBoundingClientRect().height >= 44)");

    for (const width of [320, 375, 768, 1440]) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await new Promise((resolve) => setTimeout(resolve, 120));
      await check(`${width}px page has no horizontal overflow`, "document.documentElement.scrollWidth <= window.innerWidth + 1");
      if (width <= 768) await check(`${width}px table scroll is contained`, "document.querySelector('.drcs-table-wrap').scrollWidth > document.querySelector('.drcs-table-wrap').clientWidth");
    }
    await check("invalid schema fails closed", "(() => { const ok=window.drClubStatsInit({}); const hidden=document.querySelector('#drcs-content').hidden; const shown=getComputedStyle(document.querySelector('#drcs-error')).display!=='none'; window.drClubStatsInit(window.DR_CLUB_STATS_2026_2); return ok===false && hidden && shown; })()");
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
