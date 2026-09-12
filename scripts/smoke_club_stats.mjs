import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import net from "node:net";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX_PATH = join(ROOT, "output", "web", "index.html");
const PAGE_URL = process.env.CLUB_PAGE_URL || `${pathToFileURL(INDEX_PATH).href}#/student/club-stats`;
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
  ], { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
  let client;
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    const target = await response.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    const exceptions = [];
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.exception?.description || exceptionDetails.text));
    await Promise.all([client.send("Page.enable"), client.send("Runtime.enable")]);
    const loaded = client.once("Page.loadEventFired");
    await client.send("Page.navigate", { url: PAGE_URL });
    await loaded;
    await new Promise(resolve => setTimeout(resolve, 800));

    async function evaluate(expression) {
      const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    const checks = [];
    async function check(label, expression) {
      const value = await evaluate(expression);
      checks.push({ label, ok: value === true, value });
    }
    async function fill(selector, text) {
      await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); input.value=${JSON.stringify(text)}; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    }
    const visibleNames = "[...document.querySelectorAll('.drcs-item:not([hidden]) > strong')].map(el=>el.textContent.trim())";
    const routeVisible = "document.querySelector('#tab-student').classList.contains('active') && document.querySelector('#sub-club-stats').classList.contains('active')";

    const indexSource = await readFile(INDEX_PATH, "utf8");
    checks.push({ label: "shared search and student tab markers remain", ok: indexSource.includes("semanticRetrieve") && indexSource.includes("SRCH") && indexSource.includes("<!-- TAB:student:START -->") && indexSource.includes("<!-- TAB:student:END -->") });
    await check("public deep link opens club overview without login", `${routeVisible} && !getSess()`);
    await check("club navigation uses the new label", "[...document.querySelectorAll('#tab-student > .sub-nav .sub-nav-btn')].some(el=>el.textContent.trim()==='📋 동아리 현황')");
    await check("headline describes whole-school clubs", "document.querySelector('#sub-club-stats .section-title').textContent==='대륜고등학교 동아리 현황'");
    await check("three groups follow school year order", "JSON.stringify([...document.querySelectorAll('.drcs-group-title')].map(el=>el.textContent))===JSON.stringify(['1·2학년 1학기','1·2학년 2학기','3학년'])");
    await check("all 29, 29 and 16 entries are initially visible", "JSON.stringify([...document.querySelectorAll('.drcs-group')].map(el=>el.querySelectorAll('.drcs-item:not([hidden])').length))==='[29,29,16]'");
    await check("every entry contains only its name and description", "[...document.querySelectorAll('.drcs-item')].every(el=>el.children.length===2 && el.children[0].matches('strong') && el.children[1].matches('p') && el.children[0].textContent.trim().length>0 && el.children[1].textContent.trim().length>0)");
    await check("old recruitment widgets and dataset are not loaded", "!document.querySelector('#drcs-grade-filter,#drcs-tbody,script[src*=club_stats_2026_2]') && !window.DR_CLUB_STATS_2026_2 && !/정원|모집 가능|지원 인원|지도교사|학생명|담당교사/.test(document.querySelector('#sub-club-stats').innerText)");
    await check("source-specific names survive", "document.querySelector('[data-group=first]').textContent.includes('씨ᄋᆞᆯ') && [...document.querySelectorAll('[data-group=first] .drcs-item > strong')].some(el=>el.textContent==='생물 EX') && [...document.querySelectorAll('[data-group=second] .drcs-item > strong')].some(el=>el.textContent==='생물EX')");
    await check("grade three has no semester heading or controls", "document.querySelector('[data-group=third] .drcs-group-title').textContent==='3학년' && !document.querySelector('[data-group=third] button,[data-group=third] select')");

    await fill('#drcs-search', 'AI유스프러너');
    await check("club name search finds the second-semester entry", `${visibleNames}.join('|')==='AI유스프러너' && !document.querySelector('[data-group=second]').hidden && document.querySelector('[data-group=first]').hidden`);
    await fill('#drcs-search', '비즈니스 모델');
    await check("activity description search finds the grade-three club", `${visibleNames}.join('|')==='AI기업가클럽'`);
    await fill('#drcs-search', 'aI 유스 프러너');
    await check("search ignores letter case and spaces", `${visibleNames}.join('|')==='AI유스프러너'`);
    await fill('#drcs-search', '<img src=x onerror=alert(1)>');
    await check("empty search has a visible message and no injected element", "!document.querySelector('#drcs-empty').hidden && document.querySelector('#drcs-result-count').textContent.includes('0건') && !document.querySelector('#sub-club-stats img')");
    await evaluate("document.querySelector('#drcs-reset').click()");
    await check("reset restores all entries and keyboard focus", `${visibleNames}.length===74 && document.activeElement.id==='drcs-search' && document.querySelector('#drcs-empty').hidden`);
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await check("keyboard tab reaches reset control", "document.activeElement.id==='drcs-reset'");

    await fill('#drcs-search', '없는동아리');
    await evaluate("document.querySelector('[data-club-jump=third]').click()");
    await check("grade shortcut restores list and focuses its heading", `${visibleNames}.length===74 && document.activeElement.id==='drcs-title-third'`);
    await fill('#drcs-search', '없는동아리');
    await fill('#searchInput', 'AI유스프러너');
    await new Promise(resolve => setTimeout(resolve, 260));
    await check("global search indexes new club name and overview path", "[...document.querySelectorAll('#searchResults .search-result-item')].some(el=>el.textContent.includes('AI유스프러너') && el.textContent.includes('동아리 현황'))");
    await evaluate("[...document.querySelectorAll('#searchResults .search-result-item')].find(el=>el.textContent.includes('AI유스프러너')).click()");
    await new Promise(resolve => setTimeout(resolve, 240));
    await check("global search navigation reveals a locally hidden club", `${routeVisible} && document.querySelector('#drcs-search').value==='' && ${visibleNames}.includes('AI유스프러너')`);
    await fill('#searchInput', '비즈니스 모델');
    await new Promise(resolve => setTimeout(resolve, 260));
    await check("global search indexes club description", "[...document.querySelectorAll('#searchResults .search-result-item')].some(el=>el.textContent.includes('AI기업가클럽'))");
    await fill('#searchInput', '');

    await evaluate("switchTab('teacher', [...document.querySelectorAll('.tab-btn')].find(el=>(el.getAttribute('onclick')||'').includes(\"'teacher'\")))");
    await check("teacher content remains behind the existing login gate", "getComputedStyle(document.querySelector('#teacher-login-required')).display!=='none' && getComputedStyle(document.querySelector('#teacher-content')).display==='none'");
    for (const hash of ['#student/club-stats', '#/student/club-stats']) {
      await evaluate(`location.hash=${JSON.stringify(hash)}`);
      await new Promise(resolve => setTimeout(resolve, 180));
      await check(`deep link variant ${hash} opens the overview`, routeVisible);
    }

    await fill('#drcs-search', 'AI유스프러너');
    await evaluate("window.__realPrint=window.print; window.__printCalls=0; window.print=()=>window.__printCalls++; document.querySelector('#drcs-print').click(); window.print=window.__realPrint;");
    await check("print button opens the browser print dialog", "window.__printCalls===1");
    await client.send("Emulation.setEmulatedMedia", { media: "print" });
    await evaluate("window.dispatchEvent(new Event('beforeprint'))");
    await check("printing a filtered view includes all 74 entries", "[...document.querySelectorAll('.drcs-item')].every(el=>el.getBoundingClientRect().height>0) && [...document.querySelectorAll('.drcs-group')].every(el=>getComputedStyle(el).display!=='none')");
    await check("print hides controls and other site tabs", "getComputedStyle(document.querySelector('#drcs-print')).display!=='none' && document.querySelector('#drcs-print').getBoundingClientRect().height===0 && getComputedStyle(document.querySelector('#tab-school')).display==='none'");
    await evaluate("window.dispatchEvent(new Event('afterprint'))");
    await client.send("Emulation.setEmulatedMedia", { media: "screen" });
    await check("closing print preserves the previous search", `${visibleNames}.join('|')==='AI유스프러너' && document.querySelector('#drcs-search').value==='AI유스프러너' && !document.body.classList.contains('drcs-printing')`);
    await evaluate("document.querySelector('#drcs-reset').click()");

    for (const width of [320, 375, 768, 1440]) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await new Promise(resolve => setTimeout(resolve, 120));
      await check(`${width}px has no horizontal page overflow`, "document.documentElement.scrollWidth<=window.innerWidth+1");
      await check(`${width}px keeps all content visible`, `${visibleNames}.length===74 && [...document.querySelectorAll('.drcs-group')].every(el=>el.getBoundingClientRect().width>0)`);
      await check(`${width}px controls meet 44px touch target`, "[...document.querySelectorAll('#sub-club-stats button,#drcs-search')].every(el=>el.getBoundingClientRect().height>=44)");
      await check(`${width}px offers wide sections with readable card columns`, `getComputedStyle(document.querySelector('.drcs-groups')).gridTemplateColumns.split(' ').length===1 && getComputedStyle(document.querySelector('.drcs-list')).gridTemplateColumns.split(' ').length===${width > 720 ? 2 : 1}`);
      await evaluate("document.querySelector('[data-club-jump=second]').click()");
      await evaluate("(async () => { let previous=window.scrollY, stable=0; for(let i=0;i<50 && stable<5;i++){await new Promise(resolve=>setTimeout(resolve,100)); const next=window.scrollY; stable=Math.abs(next-previous)<0.5 ? stable+1 : 0; previous=next;} })()");
      await check(`${width}px group shortcut keeps heading below sticky navigation`, "(() => { const title=document.querySelector('#drcs-title-second'), top=title.getBoundingClientRect().top, navBottom=document.querySelector('nav.tab-nav').getBoundingClientRect().bottom; return top>=navBottom && title.getBoundingClientRect().bottom<=window.innerHeight; })()");
    }
    checks.push({ label: "no browser runtime exceptions", ok: exceptions.length === 0, value: exceptions });
    const failed = checks.filter(item => !item.ok);
    checks.forEach(item => console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.ok ? '' : ' '+JSON.stringify(item.value)}`));
    console.log(`\n${checks.length-failed.length}/${checks.length} checks passed`);
    if (failed.length) process.exitCode = 1;
    await client.send("Browser.close").catch(() => {});
    client.close();
  } finally {
    if (!browser.killed) browser.kill();
    await new Promise(resolve => setTimeout(resolve, 250));
    // mkdtemp returned this task's absolute profile path; no external paths are removed.
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
