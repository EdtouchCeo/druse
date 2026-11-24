// 자료 올리기: 교사 PC의 content 폴더와 비공개 수업 보관함을 맞춘다.
// 파일마다 지문(SHA-256)을 만들어 보관함 목록과 견주고, 바뀐 파일만 한 번 쓰는 주소로 올린다.
import { $, el } from './common.js';

const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json', csv: 'text/csv', txt: 'text/plain', ipynb: 'application/json', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' };
const MAX_BYTES = 10 * 1024 * 1024;
const PARALLEL = 6;

let plan = null;

const msg = (text, kind = '') => { $('#msg').textContent = text; $('#msg').className = `msg ${kind}`; };

async function api(method, body) {
  const res = await fetch('/ait-api/upload', {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `보관함에 연결하지 못했습니다(${res.status}).`);
  return data;
}

async function sha256(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function progress(done, total, label) {
  $('#progress').hidden = false;
  $('#bar').max = Math.max(total, 1);
  $('#bar').value = done;
  $('#bar-text').textContent = `${label} ${done} / ${total}`;
}

async function pick(files) {
  plan = null;
  $('#plan').hidden = true;
  msg('');
  const list = [...files].filter((f) => {
    const name = f.name;
    return !name.startsWith('.') && !name.startsWith('~$') && name !== 'Thumbs.db' && name !== 'desktop.ini';
  });
  if (!list.length) { msg('고른 폴더에 파일이 없습니다.', 'error'); return; }
  // 첫 단계(폴더 이름)를 떼어 보관함 경로로 쓴다. content 폴더 바로 아래에 차시 목록이 있어야 한다.
  const entries = list.map((f) => ({ file: f, path: f.webkitRelativePath.split('/').slice(1).join('/') }));
  const paths = new Set(entries.map((e) => e.path));
  if (!paths.has('catalog.json') || !paths.has('courses.json')) {
    msg('content 폴더를 골라 주세요. 그 폴더 바로 안에 catalog.json과 courses.json이 있어야 합니다(다른 폴더를 고르면 보관함 자료가 지워질 수 있어 멈췄습니다).', 'error');
    return;
  }
  const bad = entries.filter((e) => !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(e.path) || !TYPES[e.path.split('.').pop().toLowerCase()] || e.file.size > MAX_BYTES);
  const good = entries.filter((e) => !bad.includes(e));
  $('#picked').textContent = `${list[0].webkitRelativePath.split('/')[0]} 폴더 · 파일 ${good.length}개`;

  const local = {};
  for (let i = 0; i < good.length; i += 1) {
    if (i % 20 === 0) progress(i, good.length, '파일 지문 만드는 중');
    local[good[i].path] = await sha256(good[i].file);
  }
  progress(good.length, good.length, '파일 지문 만드는 중');
  let remote;
  try {
    remote = (await api('GET')).manifest || {};
  } catch (e) {
    msg(e.message, 'error');
    return;
  }
  const upload = good.filter((e) => remote[e.path] !== local[e.path]);
  const remove = Object.keys(remote).filter((p) => !(p in local));
  plan = { upload, remove, local, remote };
  $('#progress').hidden = true;

  const lessonsChanged = [...new Set(upload.map((e) => e.path.split('/').slice(0, 3).join('/')).filter((p) => p.split('/').length === 3))];
  $('#plan').replaceChildren(...[
    el('p', {}, `업로드할 파일 ${upload.length}개, 보관함에서 지울 파일 ${remove.length}개입니다.${upload.length || remove.length ? ' 아래 업로드 단추를 눌러 주세요.' : ''}`),
    lessonsChanged.length ? el('p', { class: 'hint' }, `바뀐 곳: ${lessonsChanged.slice(0, 8).join(', ')}${lessonsChanged.length > 8 ? ' 외' : ''}`) : null,
    bad.length ? el('p', { class: 'hint' }, `올리지 않는 파일 ${bad.length}개(10MB 초과, 지원하지 않는 형식, 영문·숫자가 아닌 이름): ${bad.slice(0, 3).map((e) => e.path).join(', ')}`) : null,
    upload.length || remove.length
      ? el('button', { type: 'button', class: 'btn', onclick: run }, '업로드')
      : el('p', { class: 'msg ok' }, '업로드할 파일이 없습니다. 사이트 자료가 이미 PC와 같습니다.'),
  ].filter(Boolean));
  $('#plan').hidden = false;
}

async function run(e) {
  if (!plan) return;
  e.currentTarget.disabled = true;
  const { upload, remove, local, remote } = plan;
  const done = { ...remote };
  for (const p of Object.keys(done)) if (!(p in local)) delete done[p];
  let count = 0;
  const failed = [];
  try {
    for (let i = 0; i < upload.length; i += 50) {
      const batch = upload.slice(i, i + 50);
      const { urls } = await api('POST', { action: 'sign', paths: batch.map((x) => x.path) });
      const byPath = new Map(urls.map((u) => [u.path, u.url]));
      let next = 0;
      const worker = async () => {
        while (next < batch.length) {
          const item = batch[next++];
          try {
            const res = await fetch(byPath.get(item.path), {
              method: 'PUT',
              headers: { 'Content-Type': TYPES[item.path.split('.').pop().toLowerCase()], 'x-upsert': 'true', 'cache-control': 'max-age=300' },
              body: item.file,
            });
            if (!res.ok) throw new Error(String(res.status));
            done[item.path] = local[item.path];
          } catch {
            failed.push(item.path);
          }
          count += 1;
          progress(count, upload.length, '업로드 중');
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
    }
    for (let i = 0; i < remove.length; i += 100) {
      await api('POST', { action: 'remove', paths: remove.slice(i, i + 100) });
    }
    await api('POST', { action: 'manifest', manifest: done });
  } catch (err) {
    msg(`${err.message} 폴더를 다시 고르면 남은 파일만 이어서 업로드합니다.`, 'error');
    await api('POST', { action: 'manifest', manifest: done }).catch(() => {});
    return;
  }
  if (failed.length) msg(`${upload.length - failed.length}개를 업로드했고 ${failed.length}개는 실패했습니다. 폴더를 다시 고르면 남은 파일만 업로드합니다.`, 'error');
  else msg(`업로드를 마쳤습니다. 업로드한 파일 ${upload.length}개, 지운 파일 ${remove.length}개. 이제 진행 화면에서 수업을 열 수 있습니다.`, 'ok');
  plan = null;
}

$('#folder').addEventListener('change', (e) => pick(e.target.files));
