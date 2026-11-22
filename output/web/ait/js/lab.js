// 실습 칸: 브라우저 파이썬(Pyodide)으로 셀을 고쳐 실행한다. 코랩처럼 마지막 줄의 값과 그림을 셀 아래에 보여 준다.
// 학생이 고친 코드는 이 기기의 브라우저에만 저장하고 서버로 보내지 않는다.
import { el, CONTENT_BASE } from './common.js';

const PYODIDE_VERSION = '0.29.3';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const PRELUDE = `
import matplotlib
matplotlib.use("Agg")
import io, base64, json
import matplotlib.pyplot as plt
plt.show = lambda *args, **kwargs: None  # 그림은 셀이 끝난 뒤 한꺼번에 꺼낸다.
_outputs = []
def display(*objs):
    for obj in objs:
        _show(obj)
def _show(obj):
    if obj is None:
        return
    mod = type(obj).__module__ or ""
    if mod.startswith(("matplotlib", "seaborn")):
        return
    if isinstance(obj, list) and obj and type(obj[0]).__module__.startswith("matplotlib"):
        return
    if hasattr(obj, "to_html") and hasattr(obj, "columns"):
        _outputs.append({"kind": "html", "data": obj.to_html(max_rows=20, max_cols=12)})
    else:
        text = repr(obj)
        _outputs.append({"kind": "text", "data": text[:20000]})
def _take_outputs():
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=90, bbox_inches="tight")
        _outputs.append({"kind": "png", "data": base64.b64encode(buf.getvalue()).decode()})
    plt.close("all")
    out = json.dumps(_outputs)
    _outputs.clear()
    return out
`;

export async function loadLab(lesson, ref) {
  const base = `${CONTENT_BASE}/${lesson.course}/${lesson.unit}/labs/`;
  const res = await fetch(`${base}${ref.path.split('/').pop()}`, { cache: 'no-cache' });  // 실습 정의는 단원의 labs 폴더에 있다
  if (!res.ok) throw new Error('lab');
  const lab = await res.json();
  lab.base = base;
  return lab;
}

// 한 화면에 실행기는 하나만 둔다. 실습마다 필요한 패키지와 파일을 더하고, 파이썬 작업 공간은 실습마다 따로 둔다.
// (한 차시에 실습이 둘이어도 df 같은 변수가 서로 섞이지 않는다.)
let runtime = null;
const prepared = new Map();
function loadRuntime(report) {
  if (runtime) return runtime;
  runtime = (async () => {
    report('파이썬 실행기를 내려받는 중입니다 (1/3)');
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${PYODIDE_URL}pyodide.js`;
      s.onload = resolve;
      s.onerror = () => reject(new Error('실행기를 내려받지 못했습니다. 인터넷 연결을 확인해 주세요.'));
      document.head.append(s);
    });
    return window.loadPyodide({ indexURL: PYODIDE_URL });
  })();
  runtime.catch(() => { runtime = null; });
  return runtime;
}

function prepareLab(lab, report) {
  if (prepared.has(lab.id)) return prepared.get(lab.id);
  const job = (async () => {
    const py = await loadRuntime(report);
    report('데이터 분석 패키지를 내려받는 중입니다 (2/3)');
    await py.loadPackage([...lab.packages, ...(lab.pip.length ? ['micropip'] : [])]);
    if (lab.pip.length) await py.pyimport('micropip').install(lab.pip);
    report('실습 파일을 준비하는 중입니다 (3/3)');
    for (const f of lab.files) {
      const buf = new Uint8Array(await (await fetch(`${lab.base}${f.src}`)).arrayBuffer());
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      if (dir) py.FS.mkdirTree(dir);
      py.FS.writeFile(f.path, buf);
    }
    const ns = py.runPython('dict()');
    await py.runPythonAsync(PRELUDE, { globals: ns });
    return { py, ns };
  })();
  job.catch(() => prepared.delete(lab.id));
  prepared.set(lab.id, job);
  return job;
}

const lastLine = (msg) => String(msg).trim().split('\n').filter(Boolean).pop() || String(msg);

// 실행 결과를 그린다. 표는 pandas가 만든 HTML에서 표 요소만 옮긴다.
export function renderOutputs(box, outputs) {
  box.replaceChildren();
  for (const o of outputs) {
    if (o.kind === 'png') box.append(el('img', { src: `data:image/png;base64,${o.data}`, alt: '실행 결과 그래프' }));
    else if (o.kind === 'html') {
      const table = new DOMParser().parseFromString(o.data, 'text/html').querySelector('table');
      if (table) {
        table.removeAttribute('border');
        table.className = 'df';
        box.append(el('div', { class: 'df-wrap' }, document.importNode(table, true)));
      }
    } else if (o.kind === 'error') {
      box.append(el('div', { class: 'cell-error' }, el('strong', {}, lastLine(o.data)), el('details', {}, el('summary', {}, '오류 자세히 보기'), el('pre', {}, o.data))));
    } else if (o.data && o.data.trim()) box.append(el('pre', {}, o.data.replace(/\s+$/, '')));
  }
}

export function createLabPanel(container, lab, { storageKey, onChange } = {}) {
  const cells = lab.cells.map((c) => ({ ...c, original: c.code, code: localStorage.getItem(`${storageKey}_${c.id}`) ?? c.code, status: 'idle', ms: 0, outputs: [] }));
  const nodes = new Map();
  let message = '셀의 실행 버튼이나 Shift+Enter로 실행합니다. 위 셀부터 차례로 실행하세요.';
  let focus = [];
  let busy = false;
  let lastRun = null;

  const status = el('p', { class: 'lab-msg', 'aria-live': 'polite' }, message);
  const setMessage = (t) => { message = t; status.textContent = t; emit(); };
  const emit = () => onChange && onChange(snapshot());

  const runAllBtn = el('button', { type: 'button', class: 'btn-sm', onclick: () => runRange(0, cells.length) }, '전체 실행');
  const resetBtn = el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: resetCode }, '처음 코드로');
  const dlBtn = el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: download }, '코드 내려받기');
  const colab = (lab.links || []).find((l) => l.kind === 'colab');
  const nbBtn = el('button', { type: 'button', class: 'btn-ghost btn-sm', onclick: downloadNotebook }, '노트북(.ipynb) 내려받기');
  const dataLinks = (lab.files || []).map((f) => el('a', { class: 'btn btn-ghost btn-sm', href: `${lab.base}${f.src}`, download: f.path.split('/').pop() }, `데이터 ${f.path.split('/').pop()}`));
  const links = colab ? [el('a', { class: 'btn btn-gold btn-sm', href: colab.url, target: '_blank', rel: 'noopener' }, '내 코랩에서 열기')] : [];
  const colabHelp = el('details', { class: 'lab-colab-help' },
    el('summary', {}, '내 코랩에서 하려면'),
    colab
      ? el('ol', {}, el('li', {}, '"내 코랩에서 열기"를 누른다.'), el('li', {}, '코랩에서 [파일] → [Drive에 사본 저장]을 누른다. 이제 내 Drive의 노트북이라 고쳐 실행할 수 있다.'), el('li', {}, '첫 셀부터 차례로 실행한다. 데이터는 첫 셀이 캐글에서 내려받는다.'))
      : el('ol', {}, el('li', {}, '"노트북(.ipynb) 내려받기"와 데이터 파일을 내려받는다. 지금 고친 코드가 그대로 담긴다.'), el('li', {}, el('a', { href: 'https://colab.research.google.com/', target: '_blank', rel: 'noopener' }, '코랩'), '에서 [파일] → [노트 업로드]로 내려받은 노트북을 연다.'), el('li', {}, '왼쪽 파일 칸에 데이터 파일을 올린 뒤 첫 셀부터 실행한다.')));
  const list = el('ol', { class: 'cell-list' });
  container.replaceChildren(
    el('div', { class: 'lab-head' }, el('h2', {}, lab.title), el('div', { class: 'lab-tools' }, runAllBtn, resetBtn, ...links)),
    el('div', { class: 'lab-tools lab-more' }, nbBtn, dlBtn, ...dataLinks),
    colabHelp,
    status,
    list,
  );

  for (const cell of cells) {
    const editor = el('textarea', { class: 'code', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': `셀 ${cell.n} 코드` });
    editor.value = cell.code;
    const fit = () => { editor.style.height = 'auto'; editor.style.height = `${editor.scrollHeight + 2}px`; };
    editor.addEventListener('input', () => {
      cell.code = editor.value;
      if (cell.code === cell.original) localStorage.removeItem(`${storageKey}_${cell.id}`);
      else localStorage.setItem(`${storageKey}_${cell.id}`, cell.code);
      fit();
      emit();
    });
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) { e.preventDefault(); runCell(cell).then(() => e.shiftKey && focusNext(cell)); }
      else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); }
    });
    const runBtn = el('button', { type: 'button', class: 'run', 'aria-label': `셀 ${cell.n} 실행`, onclick: () => runCell(cell) }, '▶');
    const state = el('span', { class: 'cell-state' });
    const out = el('div', { class: 'cell-out' });
    const item = el('li', { class: 'cell', id: `cell-${cell.id}` }, el('div', { class: 'cell-bar' }, runBtn, el('span', { class: 'cell-no' }, `셀 ${cell.n}`), state), editor, out);
    list.append(item);
    nodes.set(cell.id, { item, editor, state, out, runBtn, fit });
    requestAnimationFrame(fit);
  }

  function focusNext(cell) {
    const i = cells.indexOf(cell);
    const next = cells[i + 1];
    if (next) nodes.get(next.id).editor.focus();
  }

  function paint(cell) {
    const n = nodes.get(cell.id);
    n.item.dataset.status = cell.status;
    n.state.textContent = cell.status === 'running' ? '실행 중' : cell.status === 'ok' ? `완료 ${(cell.ms / 1000).toFixed(1)}초` : cell.status === 'error' ? '오류' : '';
    renderOutputs(n.out, cell.outputs);
  }

  async function runCell(cell) {
    if (busy) return false;
    busy = true;
    cells.forEach((c) => nodes.get(c.id).runBtn.disabled = true);
    runAllBtn.disabled = true;
    cell.status = 'running';
    cell.outputs = [];
    paint(cell);
    emit();
    let ok = true;
    try {
      const { py, ns } = await prepareLab(lab, setMessage);
      setMessage(`셀 ${cell.n} 실행 중`);
      let stdout = '';
      py.setStdout({ batched: (s) => { stdout += `${s}\n`; } });
      py.setStderr({ batched: (s) => { if (!/FutureWarning|UserWarning|DeprecationWarning/.test(s)) stdout += `${s}\n`; } });
      const t0 = performance.now();
      let error = '';
      let value;
      try {
        value = await py.runPythonAsync(cell.code, { globals: ns });
      } catch (e) {
        error = String(e.message || e);
      }
      const show = ns.get('_show');
      if (!error && value !== undefined) show(value);
      if (value && typeof value.destroy === 'function') value.destroy();
      show.destroy();
      const extra = JSON.parse(py.runPython('_take_outputs()', { globals: ns }));
      cell.ms = performance.now() - t0;
      cell.outputs = [...(stdout.trim() ? [{ kind: 'text', data: stdout }] : []), ...extra, ...(error ? [{ kind: 'error', data: error }] : [])];
      cell.status = error ? 'error' : 'ok';
      ok = !error;
      setMessage(error ? `셀 ${cell.n}에서 오류가 났습니다. 마지막 줄의 오류 이름을 먼저 읽어 보세요.` : `셀 ${cell.n} 실행을 마쳤습니다.`);
    } catch (e) {
      cell.status = 'error';
      cell.outputs = [{ kind: 'error', data: String(e.message || e) }];
      setMessage(String(e.message || e));
      ok = false;
    } finally {
      lastRun = cell;
      busy = false;
      cells.forEach((c) => nodes.get(c.id).runBtn.disabled = false);
      runAllBtn.disabled = false;
      paint(cell);
      emit();
    }
    return ok;
  }

  async function runRange(from, to) {
    for (const cell of cells.slice(from, to)) {
      if (!(await runCell(cell))) break;
    }
  }

  function resetCode() {
    if (!confirm('고친 코드를 모두 지우고 처음 코드로 되돌릴까요?')) return;
    for (const cell of cells) {
      cell.code = cell.original;
      localStorage.removeItem(`${storageKey}_${cell.id}`);
      const n = nodes.get(cell.id);
      n.editor.value = cell.code;
      n.fit();
    }
    setMessage('처음 코드로 되돌렸습니다. 실행 결과는 셀을 다시 실행하면 바뀝니다.');
  }

  // 지금 셀의 코드로 코랩·주피터에서 열 수 있는 노트북 파일을 만든다.
  function downloadNotebook() {
    const lines = (t) => t.split('\n').map((l, i, a) => (i < a.length - 1 ? `${l}\n` : l));
    const nb = {
      nbformat: 4, nbformat_minor: 5,
      metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' }, language_info: { name: 'python' } },
      cells: [
        { cell_type: 'markdown', metadata: {}, source: lines(`# ${lab.title}\n\nDave AIT Class에서 내려받은 노트북입니다. 데이터 파일(${(lab.files || []).map((f) => f.path).join(', ') || '없음'})을 코랩 왼쪽 파일 칸에 올린 뒤 첫 셀부터 실행하세요.`) },
        ...cells.map((c) => ({ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: lines(c.code) })),
      ],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(nb, null, 1)], { type: 'application/x-ipynb+json' }));
    const a = el('a', { href: url, download: `${lab.title}.ipynb` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function download() {
    const text = cells.map((c) => `# 셀 ${c.n}\n${c.code}\n`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/x-python;charset=utf-8' }));
    const a = el('a', { href: url, download: `${lab.title}.py` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function focusCells(ids = []) {
    focus = ids;
    for (const [id, n] of nodes) n.item.classList.toggle('linked', ids.includes(id));
    const first = ids[0] && nodes.get(ids[0]);
    if (first) first.item.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    emit();
  }

  function snapshot() {
    return { title: lab.title, message, focus, cells: cells.map((c) => ({ id: c.id, n: c.n, code: c.code, status: c.status, ms: c.ms, outputs: c.outputs })) };
  }

  // 튜터에게 넘길 셀: 연결된 셀 가운데 오류가 난 셀, 없으면 마지막으로 실행한 셀, 그것도 없으면 연결된 첫 셀.
  function cellContext() {
    const linked = cells.filter((c) => focus.includes(c.id));
    const cell = linked.find((c) => c.status === 'error') || lastRun || linked[0];
    if (!cell) return null;
    const err = cell.outputs.find((o) => o.kind === 'error');
    return { n: cell.n, code: cell.code, error: err ? err.data.split('\n').slice(-8).join('\n') : '' };
  }

  return { focusCells, snapshot, cellContext, runCell: (id) => runCell(cells.find((c) => c.id === id)), runAll: () => runRange(0, cells.length) };
}

// 발표 화면용 읽기 전용 실습 보기. 진행 화면의 실습 칸이 보낸 상태를 그대로 그린다.
export function createLabMirror(container) {
  let lastFocus = '';
  return {
    render(snap) {
      const list = el('ol', { class: 'cell-list' });
      for (const c of snap.cells) {
        const out = el('div', { class: 'cell-out' });
        renderOutputs(out, c.outputs);
        list.append(el('li', { class: `cell${snap.focus.includes(c.id) ? ' linked' : ''}`, id: `mirror-${c.id}`, dataset: { status: c.status } },
          el('div', { class: 'cell-bar' }, el('span', { class: 'cell-no' }, `셀 ${c.n}`), el('span', { class: 'cell-state' }, c.status === 'running' ? '실행 중' : c.status === 'error' ? '오류' : '')),
          el('pre', { class: 'code' }, c.code), out));
      }
      const top = container.scrollTop;
      container.replaceChildren(el('div', { class: 'lab-head' }, el('h2', {}, snap.title)), el('p', { class: 'lab-msg' }, snap.message), list);
      container.scrollTop = top;
      const key = snap.focus.join(',');
      const target = snap.focus[0] && container.querySelector(`#mirror-${snap.focus[0]}`);
      if (target && key !== lastFocus) target.scrollIntoView({ block: 'start' });
      lastFocus = key;
    },
  };
}

// 코랩 밖 플랫폼. embed는 실습 칸 안에 띄우고, link는 안내와 함께 새 창으로 연다.
function createExternalLab(host, lab) {
  host.replaceChildren(
    el('div', { class: 'lab-head' }, el('h2', {}, lab.title), el('div', { class: 'lab-tools' }, el('a', { class: 'btn btn-gold btn-sm', href: lab.url, target: '_blank', rel: 'noopener' }, '새 창으로 열기'))),
    ...(lab.description ? [el('p', { class: 'lab-msg' }, lab.description)] : []),
    ...(lab.steps?.length ? [el('ol', { class: 'lab-steps' }, ...lab.steps.map((t) => el('li', {}, t)))] : []),
    lab.runtime === 'embed'
      ? el('iframe', { class: 'lab-frame', src: lab.url, title: lab.title, loading: 'lazy', allow: 'fullscreen; clipboard-write', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads' })
      : el('p', { class: 'hint' }, '이 실습은 새 창에서 진행합니다. 끝나면 이 화면으로 돌아오세요.'));
  return { focusCells() {}, cellContext: () => null, snapshot: () => ({ title: lab.title, message: lab.runtime === 'embed' ? '실습 칸 안에서 진행하는 실습입니다.' : '새 창에서 진행하는 실습입니다.', focus: [], cells: [] }) };
}

// 한 차시의 실습 칸. 실습이 여럿이면 위쪽 탭으로 고르고, 장을 넘기면 그 장에 연결된 실습으로 바꾼다.
export function createLabArea(container, lesson, { storagePrefix, onChange } = {}) {
  const refs = lesson.labs || [];
  const cache = new Map();
  let active = null;
  const tabs = el('div', { class: 'lab-switch', role: 'tablist', 'aria-label': '실습 고르기' });
  const body = el('div', { class: 'lab-area-body' });
  container.replaceChildren(...(refs.length > 1 ? [tabs] : []), body);

  const paintTabs = () => tabs.replaceChildren(...refs.map((r) => el('button', {
    type: 'button', role: 'tab', class: 'btn-ghost btn-sm', 'aria-selected': String(active?.ref.id === r.id), 'aria-pressed': String(active?.ref.id === r.id),
    onclick: () => open(r.id),
  }, r.title)));

  async function open(id) {
    const ref = refs.find((r) => r.id === id) || refs[0];
    if (!ref) return null;
    if (active?.ref.id === ref.id) return active;
    let entry = cache.get(ref.id);
    if (!entry) {
      const lab = await loadLab(lesson, ref);
      const host = el('div', { class: 'lab-host' });
      const panel = (lab.runtime || 'pyodide') === 'pyodide'
        ? createLabPanel(host, lab, { storageKey: `${storagePrefix}_${lab.id}`, onChange: (snap) => { if (active?.ref.id === ref.id) onChange && onChange(snap); } })
        : createExternalLab(host, lab);
      entry = { ref, lab, host, panel };
      cache.set(ref.id, entry);
    }
    active = entry;
    body.replaceChildren(entry.host);
    paintTabs();
    onChange && onChange(entry.panel.snapshot());
    return entry;
  }

  const ready = refs.length ? open(refs[0].id) : Promise.resolve(null);
  return {
    ready,
    async focus(link) {
      if (!link) return;
      const entry = await open(link.id);
      entry?.panel.focusCells(link.cells || []);
    },
    cellContext: () => active?.panel.cellContext() || null,
    snapshot: () => active?.panel.snapshot() || null,
  };
}
