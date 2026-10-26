/* daeryun.life 개인 AI 연결 — 독립 페이지용 공용 모듈 (window.drAi)
 *
 * 본체(index.html)의 시간표 AI 설정(window.drAiCall·drAiOpen)과 같은 저장 키(dr_tt_llm_v1)·같은 문안·
 * 같은 호출 사다리를 쓴다. 같은 오리진이므로 어느 화면에서 한 번 설정하면 이 브라우저의 모든 AI 기능이 함께 쓴다.
 * 문안 출처: edtouch _workspace/ai-setup-easy-20261021/00_contract.md (세 사이트 공통). daeryun에는 서버 제공 AI가 없다.
 * 본체의 AI 설정을 고치면 이 파일도 함께 고친다.
 *
 *   drAi.call(prompt, schema, onMsg) → Promise<object>   구조화(JSON) 응답
 *   drAi.has()                       → 설정 완료 여부
 *   drAi.open()                      → 설정 창 열기 (저장하면 'drai-change' 이벤트)
 *   drAi.label()                     → "Gemini 무료 키" 같은 현재 연결 이름
 *   drAi.scope()                     → 전송 범위 한 줄
 */
(function () {
  'use strict';
  // 사이트별 설정(같은 파일을 daeryun.life와 edtouch.ai가 함께 쓴다). 없으면 daeryun 기본값.
  //   storageKey: AI 설정 저장 키, seedKey: 저장값이 없을 때 대신 읽을 키,
  //   openExternal: 설정 창을 이 모듈 대신 부모 사이트가 열게 하는 함수(예: edtouch의 전역 AI 설정 창)
  var CFG = window.DR_AI_CONFIG || {};
  var AI_KEY = CFG.storageKey || 'dr_tt_llm_v1';
  var SEED_KEY = CFG.seedKey || '';
  // 폴백은 반드시 실재하는 모델이어야 한다 — flash-lite는 일부 키에서 404가 나 원래 오류를 뒤덮는 실사고(특기사항 AI, 2026-07)
  var GEM_DEFAULT = 'gemini-3.5-flash', GEM_FALLBACK = 'gemini-2.5-flash';
  var BRIDGE = 'http://127.0.0.1:47321';
  var BRIDGE_DOWN = '연결 도우미가 실행 중이 아닙니다. 연결 도우미 창을 연 뒤 다시 눌러 주세요. 크롬이 이 기기 접근을 허용할지 물으면 허용을 누릅니다.';
  var BRIDGE_DENIED = '브라우저가 이 사이트의 내 PC 접근을 막아 두었습니다. 주소창 왼쪽 아이콘을 눌러 사이트 설정에서 로컬 네트워크 접근을 허용으로 바꾼 뒤 새로고침해 주세요.';
  var SCOPE = {
    gemini: '입력한 글은 Google로 전송됩니다. 키는 이 브라우저에만 저장됩니다.',
    bridge: '입력한 글은 내 PC를 거쳐 Anthropic이나 OpenAI로 전송되고, 내 구독 사용 한도에서 차감됩니다.',
    ollama: '입력한 글이 이 PC 밖으로 나가지 않습니다. PC 사양에 따라 느릴 수 있습니다.'
  };
  var codexModels = [];

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(AI_KEY) || (SEED_KEY ? localStorage.getItem(SEED_KEY) : null));
      if (s && typeof s === 'object') return {
        provider: s.provider === 'ollama' ? 'ollama' : s.provider === 'bridge' ? 'bridge' : 'gemini',
        gemini: { apiKey: ((s.gemini && s.gemini.apiKey) || '').trim(), model: ((s.gemini && s.gemini.model) || '').trim() || GEM_DEFAULT },
        ollama: { url: ((s.ollama && s.ollama.url) || '').trim() || 'http://localhost:11434', model: ((s.ollama && s.ollama.model) || '').trim() },
        bridge: { provider: (s.bridge && s.bridge.provider) === 'codex' ? 'codex' : 'claude', model: ((s.bridge && s.bridge.model) || '').trim() }
      };
    } catch (e) {}
    return { provider: 'gemini', gemini: { apiKey: '', model: GEM_DEFAULT }, ollama: { url: 'http://localhost:11434', model: '' }, bridge: { provider: 'claude', model: '' } };
  }
  // 구독 연결은 저장만 하면 '설정됨'으로 본다(본체와 같다). 실제 실행 여부는 첫 요청에서 확인된다.
  function has(s) { s = s || load(); if (s.provider === 'bridge') return true; return s.provider === 'gemini' ? !!s.gemini.apiKey : !!(s.ollama.url && s.ollama.model); }
  function isSaved() { try { return !!(localStorage.getItem(AI_KEY) || (SEED_KEY && localStorage.getItem(SEED_KEY))); } catch (e) { return false; } }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function label() {
    var s = load();
    if (!isSaved() || !has(s)) return '';
    if (s.provider === 'bridge') return s.bridge.provider === 'codex' ? 'ChatGPT 구독' : 'Claude 구독';
    if (s.provider === 'ollama') return 'Ollama · ' + s.ollama.model;
    return 'Gemini · ' + s.gemini.model;
  }

  // 크롬은 127.0.0.1 접근을 'loopback-network' 권한으로 다룬다. edtouch aiBridge.ts의 bridgeLocalAccessState()와 같은 판정.
  async function bridgeAccess() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
      var st = await navigator.permissions.query({ name: 'loopback-network' });
      return st.state === 'granted' || st.state === 'denied' || st.state === 'prompt' ? st.state : 'unknown';
    } catch (e) { return 'unknown'; }
  }
  async function bridgeDownMsg() { return (await bridgeAccess()) === 'denied' ? BRIDGE_DENIED : BRIDGE_DOWN; }
  function verText(v) { return String(v || '').replace(/\s*\([^)]*\)\s*$/, '').trim(); }

  /* ── 설정 창 ── */
  var CSS = '' +
    '#drai-modal{display:none;position:fixed;inset:0;z-index:3300;align-items:center;justify-content:center;font-family:inherit;}' +
    '#drai-modal .drai-back{position:fixed;inset:0;background:rgba(0,0,0,.45);}' +
    '#drai-modal .drai-box{position:relative;background:#fff;color:#111827;border-radius:14px;max-width:460px;width:92%;max-height:88vh;overflow-y:auto;box-shadow:0 20px 50px rgba(0,0,0,.3);}' +
    '#drai-modal .drai-head{background:linear-gradient(135deg,#1a3a6b,#2563eb);color:#fff;padding:14px 18px;border-radius:14px 14px 0 0;display:flex;justify-content:space-between;align-items:center;}' +
    '#drai-modal .drai-head h2{font-size:.95rem;font-weight:700;margin:0;}' +
    '#drai-modal .drai-x{background:rgba(255,255,255,.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:.9rem;}' +
    '#drai-modal .drai-body{padding:16px 18px;font-size:.86rem;line-height:1.6;word-break:keep-all;}' +
    '#drai-modal .ai-lbl{display:block;font-size:.78rem;font-weight:700;color:#1a3a6b;margin:10px 0 3px;}' +
    '#drai-modal .ai-inp{width:100%;box-sizing:border-box;height:38px;padding:0 10px;border:1px solid #d1d5db;border-radius:7px;font-size:.86rem;font-family:inherit;background:#fff;color:#111827;}' +
    '#drai-modal .ai-inp:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15);}' +
    '#drai-modal .ai-help{margin:4px 0 0;color:#4b5563;font-size:.8rem;line-height:1.6;}' +
    '#drai-modal .ai-choices{display:flex;flex-direction:column;gap:6px;margin:4px 0 10px;}' +
    '#drai-modal .ai-choice{display:flex;gap:10px;align-items:flex-start;border:1px solid #d1d5db;border-radius:9px;padding:8px 10px;cursor:pointer;}' +
    '#drai-modal .ai-choice:has(input:checked){border-color:#1a3a6b;background:#eff6ff;}' +
    '#drai-modal .ai-choice input{margin-top:4px;flex-shrink:0;}' +
    '#drai-modal .ai-choice b{display:block;font-size:.86rem;color:#111827;}' +
    '#drai-modal .ai-choice small{display:block;font-size:.78rem;color:#4b5563;line-height:1.5;}' +
    '#drai-modal .ai-steps{margin:6px 0 4px;padding-left:20px;font-size:.82rem;color:#1f2937;}' +
    '#drai-modal .ai-steps li{margin:3px 0;}' +
    '#drai-modal .ai-linkbtn{display:inline-block;margin-left:2px;padding:1px 8px;border:1px solid #1a3a6b;border-radius:6px;color:#1a3a6b;font-weight:600;font-size:.78rem;text-decoration:none;white-space:nowrap;}' +
    '#drai-modal .ai-adv{margin-top:8px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;}' +
    '#drai-modal .ai-adv summary{cursor:pointer;font-size:.8rem;font-weight:600;color:#374151;}' +
    '#drai-modal .ai-code{display:block;margin:2px 0;padding:6px 8px;background:#f3f4f6;border-radius:6px;font-size:.8rem;user-select:all;overflow-x:auto;}' +
    '#drai-modal .ai-scope{margin:12px 0 0;padding:7px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:7px;font-size:.8rem;color:#374151;line-height:1.6;}' +
    '#drai-modal .drai-msg{min-height:18px;font-size:.82rem;margin-top:8px;}' +
    '#drai-modal .drai-msg .ok{color:#166534;} #drai-modal .drai-msg .err{color:#b91c1c;} #drai-modal .drai-msg .wait{color:#6b7280;}' +
    '#drai-modal .drai-btns{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}' +
    '#drai-modal .drai-btn{min-height:36px;padding:0 16px;font-size:.84rem;font-weight:600;font-family:inherit;border:none;border-radius:20px;cursor:pointer;}' +
    '#drai-modal .drai-btn.p{background:#1a3a6b;color:#fff;} #drai-modal .drai-btn.s{background:#f3f4f6;color:#374151;}' +
    '#drai-modal .drai-btn:disabled{opacity:.6;cursor:wait;}';

  var HTML = '' +
    '<div class="drai-back" data-close></div>' +
    '<div class="drai-box" role="dialog" aria-modal="true" aria-labelledby="drai-title">' +
    '<div class="drai-head"><h2 id="drai-title">AI 설정</h2><button type="button" class="drai-x" data-close aria-label="닫기">✕</button></div>' +
    '<div class="drai-body">' +
    '<div class="ai-lbl" id="drai-method-lbl" style="margin-top:0;">AI 연결 방법</div>' +
    '<p class="ai-help" style="margin:0 0 8px;">처음이라면 Gemini 무료 키를 고르세요. 구글 계정만 있으면 바로 받을 수 있습니다.</p>' +
    '<div role="radiogroup" aria-labelledby="drai-method-lbl" class="ai-choices">' +
    '<label class="ai-choice"><input type="radio" name="drai-provider" value="gemini"><span><b>Gemini 무료 키</b><small>구글에서 받은 키를 붙여 넣습니다.</small></span></label>' +
    '<label class="ai-choice"><input type="radio" name="drai-provider" value="bridge"><span><b>구독 연결 (Claude · ChatGPT)</b><small>유료 구독이 있을 때, 이 PC에서 씁니다.</small></span></label>' +
    '<label class="ai-choice"><input type="radio" name="drai-provider" value="ollama"><span><b>Ollama (내 PC)</b><small>기록이 PC 밖으로 나가지 않습니다. 설치가 필요합니다.</small></span></label>' +
    '</div>' +
    '<div id="drai-gem">' +
    '<ol class="ai-steps">' +
    '<li>Google AI Studio를 열고 구글 계정으로 로그인합니다. <a class="ai-linkbtn" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio 열기</a></li>' +
    '<li>Create API key를 눌러 키를 만들고 복사합니다.</li>' +
    '<li>아래 칸에 붙여 넣고 연결 확인을 누릅니다.</li>' +
    '</ol>' +
    '<label class="ai-lbl" for="drai-gem-key">Gemini API 키</label>' +
    '<input id="drai-gem-key" type="password" class="ai-inp" placeholder="AIza로 시작하는 키" autocomplete="off" spellcheck="false">' +
    '<details class="ai-adv"><summary>고급 설정</summary>' +
    '<label class="ai-lbl" for="drai-gem-model">모델</label>' +
    '<input id="drai-gem-model" class="ai-inp" list="drai-gem-models" placeholder="gemini-3.5-flash">' +
    '<datalist id="drai-gem-models"><option value="gemini-3.5-flash"></option><option value="gemini-2.5-flash"></option><option value="gemini-2.5-pro"></option></datalist>' +
    '<p class="ai-help">기본값 그대로 써도 됩니다.</p></details>' +
    '</div>' +
    '<div id="drai-brg" style="display:none;">' +
    '<ol class="ai-steps">' +
    '<li>연결 도우미를 내려받아 압축을 풉니다. <a class="ai-linkbtn" href="https://edtouch.ai/ai-bridge/edtouch-ai-bridge.zip">연결 도우미 내려받기</a> <a href="https://edtouch.ai/ai-bridge" target="_blank" rel="noopener">자세한 준비 방법</a></li>' +
    '<li>start-bridge-windows.bat(맥은 start-bridge-mac.command)을 두 번 눌러 실행합니다. 검은 창에 \'사용 가능\'이 보이면 준비된 것입니다.</li>' +
    '<li>아래에서 구독을 고르고 연결 확인을 누릅니다. 크롬이 이 기기 접근을 허용할지 물으면 허용을 누릅니다.</li>' +
    '</ol>' +
    '<p class="ai-help">이 PC에 Node.js와 Claude Code(또는 Codex)가 설치되어 있고, 내 구독 계정으로 로그인되어 있어야 합니다.</p>' +
    '<label class="ai-lbl" for="drai-brg-prov">구독</label>' +
    '<select id="drai-brg-prov" class="ai-inp"><option value="claude">Claude 구독</option><option value="codex">ChatGPT 구독 (시험 기능)</option></select>' +
    '<details class="ai-adv"><summary>고급 설정</summary>' +
    '<label class="ai-lbl" for="drai-brg-model">모델</label>' +
    '<input id="drai-brg-model" class="ai-inp" list="drai-brg-models" placeholder="비워 두면 기본 모델" autocomplete="off" spellcheck="false">' +
    '<datalist id="drai-brg-models"></datalist>' +
    '<p class="ai-help">비워 두면 프로그램의 기본 모델을 씁니다. 대부분 그대로 두면 됩니다.</p></details>' +
    '</div>' +
    '<div id="drai-oll" style="display:none;">' +
    '<label class="ai-lbl" for="drai-oll-url">Ollama 주소</label>' +
    '<input id="drai-oll-url" class="ai-inp" placeholder="http://localhost:11434">' +
    '<label class="ai-lbl" for="drai-oll-model">모델 이름</label>' +
    '<input id="drai-oll-model" class="ai-inp" placeholder="예: qwen3, gemma3">' +
    '<div class="ai-lbl">이 사이트의 접속 허용</div>' +
    '<p class="ai-help" style="margin:0 0 4px;">아래 명령을 실행한 뒤 Ollama를 다시 시작합니다. 이 설정이 없으면 Ollama가 켜져 있어도 연결 확인이 실패합니다.</p>' +
    '<code class="ai-code">setx OLLAMA_ORIGINS "*"</code>' +
    '<p class="ai-help">edtouch.ai에서 이미 했다면 다시 하지 않아도 됩니다. 이 사이트만 허용하려면 <code>*</code> 대신 <code>https://daeryun.life</code>를 넣고, 여러 사이트는 쉼표로 이어 씁니다.</p>' +
    '<p class="ai-help">연결 확인을 눌렀을 때 크롬이 이 기기 접근을 허용할지 물으면 허용을 누릅니다.</p>' +
    '</div>' +
    '<p id="drai-scope" class="ai-scope"></p>' +
    '<div id="drai-msg" class="drai-msg" role="status" aria-live="polite"></div>' +
    '<div class="drai-btns">' +
    '<button type="button" class="drai-btn s" id="drai-test">연결 확인</button>' +
    '<button type="button" class="drai-btn p" id="drai-save">저장</button>' +
    '<button type="button" class="drai-btn s" data-close>취소</button>' +
    '</div></div></div>';

  var modal = null, lastFocus = null;
  function $(id) { return document.getElementById(id); }
  function ensureModal() {
    if (modal) return modal;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    modal = document.createElement('div'); modal.id = 'drai-modal'; modal.innerHTML = HTML;
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    modal.querySelectorAll('input[name=drai-provider]').forEach(function (r) { r.addEventListener('change', provChange); });
    $('drai-brg-prov').addEventListener('change', function () {
      $('drai-brg-model').value = '';
      fillBrgModels($('drai-brg-prov').value === 'codex' ? codexModels : []);
      setMsg('', '');
    });
    $('drai-test').addEventListener('click', test);
    $('drai-save').addEventListener('click', save);
    return modal;
  }
  function getProv() { var el = modal.querySelector('input[name=drai-provider]:checked'); var v = el ? el.value : 'gemini'; return v === 'ollama' || v === 'bridge' ? v : 'gemini'; }
  function setProv(v) { modal.querySelectorAll('input[name=drai-provider]').forEach(function (r) { r.checked = (r.value === v); }); }
  function setMsg(kind, text) { $('drai-msg').innerHTML = text ? '<span class="' + kind + '">' + esc(text) + '</span>' : ''; }
  function provChange() {
    var p = getProv();
    $('drai-gem').style.display = p === 'gemini' ? '' : 'none';
    $('drai-oll').style.display = p === 'ollama' ? '' : 'none';
    $('drai-brg').style.display = p === 'bridge' ? '' : 'none';
    $('drai-scope').textContent = SCOPE[p];
    setMsg('', '');
  }
  function fillBrgModels(list) {
    var dl = $('drai-brg-models'); dl.innerHTML = '';
    (list || []).forEach(function (m) {
      if (typeof m !== 'string' || !/^[A-Za-z0-9._:[\]-]{1,64}$/.test(m)) return;
      var o = document.createElement('option'); o.value = m; dl.appendChild(o);
    });
  }
  function readForm() {
    return {
      provider: getProv(),
      gemini: { apiKey: $('drai-gem-key').value.trim(), model: $('drai-gem-model').value.trim() || GEM_DEFAULT },
      ollama: { url: $('drai-oll-url').value.trim() || 'http://localhost:11434', model: $('drai-oll-model').value.trim() },
      bridge: { provider: $('drai-brg-prov').value === 'codex' ? 'codex' : 'claude', model: $('drai-brg-model').value.trim() }
    };
  }
  function open() {
    if (typeof CFG.openExternal === 'function') { CFG.openExternal(); return; }
    ensureModal();
    lastFocus = document.activeElement;
    var s = load();
    setProv(s.provider);
    $('drai-gem-key').value = s.gemini.apiKey; $('drai-gem-model').value = s.gemini.model;
    $('drai-oll-url').value = s.ollama.url; $('drai-oll-model').value = s.ollama.model;
    $('drai-brg-prov').value = s.bridge.provider; $('drai-brg-model').value = s.bridge.model;
    fillBrgModels(s.bridge.provider === 'codex' ? codexModels : []);
    provChange();
    modal.style.display = 'flex';
    var first = modal.querySelector('input[name=drai-provider]:checked'); if (first) first.focus();
  }
  function close() {
    if (!modal) return;
    modal.style.display = 'none';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function save() {
    var s = readForm();
    if (!has(s)) { setMsg('err', s.provider === 'gemini' ? 'API 키를 입력해 주세요.' : 'Ollama 주소와 모델명을 입력해 주세요.'); return; }
    try { localStorage.setItem(AI_KEY, JSON.stringify(s)); } catch (e) {}
    close();
    window.dispatchEvent(new CustomEvent('drai-change'));
  }
  async function test() {
    var s = readForm(), btn = $('drai-test');
    setMsg('wait', '확인하는 중…'); btn.disabled = true; btn.textContent = '확인하는 중…';
    try {
      if (s.provider === 'bridge') {
        if (s.bridge.model && !/^[A-Za-z0-9._:[\]-]{1,64}$/.test(s.bridge.model)) throw new Error('모델 이름에는 영문, 숫자와 . _ : - [ ] 만 쓸 수 있습니다.');
        var r;
        try { r = await fetch(BRIDGE + '/health', { cache: 'no-store' }); } catch (e) { throw new Error(await bridgeDownMsg()); }
        if (!r.ok) throw new Error('연결 도우미가 이 사이트의 요청을 받지 않았습니다(' + r.status + '). 연결 도우미를 최신 판으로 다시 받아 주세요.');
        var h = await r.json();
        if (!h || !h.ok || h.name !== 'edtouch-ai-bridge') throw new Error('47321번 포트에서 다른 프로그램이 응답했습니다. 연결 도우미를 다시 실행해 주세요.');
        var p = (h.providers || {})[s.bridge.provider] || {};
        var name = s.bridge.provider === 'codex' ? 'Codex' : 'Claude Code';
        if (!p.available) throw new Error('이 PC에서 ' + name + '를 찾지 못했습니다. ' + name + '를 설치하고 로그인한 뒤 연결 도우미를 다시 실행해 주세요.');
        var cm = h.providers && h.providers.codex && h.providers.codex.models;
        codexModels = Array.isArray(cm) ? cm.filter(function (m) { return typeof m === 'string'; }) : [];
        fillBrgModels(s.bridge.provider === 'codex' ? codexModels : []);
        var hv = verText(h.version), pv = verText(p.version);
        setMsg('ok', (hv ? '연결 도우미(버전 ' + hv + ')가' : '연결 도우미가') + ' 실행 중이고 ' + (pv ? name + '(' + pv + ')' : name) + '를 찾았습니다. 로그인은 첫 요청에서 확인됩니다.');
        return;
      }
      if (s.provider === 'gemini') {
        if (!s.gemini.apiKey) throw new Error('API 키를 입력해 주세요.');
        var g;
        try {
          g = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + s.gemini.model + ':generateContent?key=' + encodeURIComponent(s.gemini.apiKey), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 8 } })
          });
        } catch (e) { throw new Error('네트워크 오류로 Gemini에 연결하지 못했습니다.'); }
        if (g.status === 400 || g.status === 403) throw new Error('API 키가 올바르지 않거나 권한이 없습니다.');
        if (g.status === 404) throw new Error('모델 "' + s.gemini.model + '"을(를) 찾을 수 없습니다.');
        if (!g.ok) throw new Error('Gemini 오류(' + g.status + ')가 발생했습니다.');
      } else {
        if (!s.ollama.url) throw new Error('Ollama 주소를 입력해 주세요.');
        var base = s.ollama.url.replace(/\/$/, ''), o;
        try { o = await fetch(base + '/api/tags'); } catch (e) { throw new Error('Ollama에 연결하지 못했습니다. Ollama가 켜져 있는지, 이 사이트의 접속 허용을 설정했는지 확인해 주세요.'); }
        if (!o.ok) throw new Error('Ollama 오류(' + o.status + ')가 발생했습니다.');
        if (s.ollama.model) {
          var data = await o.json();
          var names = (data.models || []).map(function (m) { return m.name || ''; });
          if (!names.some(function (n) { return n === s.ollama.model || n.indexOf(s.ollama.model + ':') === 0; }))
            throw new Error('모델 "' + s.ollama.model + '"이(가) 없습니다. ollama pull로 먼저 받아주세요.');
        }
      }
      setMsg('ok', '연결을 확인했습니다. 저장을 누르면 이 설정을 씁니다.');
    } catch (e) { setMsg('err', e.message); }
    finally { btn.disabled = false; btn.textContent = '연결 확인'; }
  }

  /* ── 호출 사다리 (본체 aiCall과 같다) ── */
  function toGeminiSchema(sc) {
    if (Array.isArray(sc)) return sc.map(toGeminiSchema);
    if (sc && typeof sc === 'object') {
      var out = {};
      for (var k in sc) {
        if (['type', 'properties', 'required', 'items', 'enum', 'description'].indexOf(k) < 0) continue;
        var v = sc[k];
        if (k === 'type' && typeof v === 'string') out[k] = v.toUpperCase();
        else if (k === 'properties' && v && typeof v === 'object') { out[k] = {}; for (var pk in v) out[k][pk] = toGeminiSchema(v[pk]); }
        else if (k === 'items') out[k] = toGeminiSchema(v);
        else out[k] = v;
      }
      return out;
    }
    return sc;
  }
  function parse(raw) {
    try { return JSON.parse(raw); } catch (e) {}
    var m = String(raw).match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
    throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
  }
  async function geminiOnce(model, key, prompt, gSchema, thinking) {
    var cfg = { maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: gSchema };
    if (thinking) cfg.thinkingConfig = { thinkingBudget: 0 };
    var res;
    try {
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: cfg })
      });
    } catch (e) { var ne = new Error('네트워크 오류로 Gemini에 연결하지 못했습니다.'); ne.status = 0; throw ne; }
    if (!res.ok) {
      var bodyText = ''; try { bodyText = await res.text(); } catch (e) {}
      var thinkRej = res.status === 400 && /think/i.test(bodyText);
      var message = 'Gemini 오류(' + res.status + ')가 발생했습니다.';
      if (!thinkRej) {
        if (res.status === 400 || res.status === 403) message = 'API 키가 올바르지 않거나 권한이 없습니다.';
        else if (res.status === 404) message = '모델 "' + model + '"을(를) 찾을 수 없습니다.';
        else if (res.status === 429) message = '무료 사용량 한도에 도달했습니다. 잠시 후(1분 이상) 다시 시도해 주세요.';
      }
      var err = new Error(message); err.status = res.status; err.thinkRej = thinkRej; throw err;
    }
    var data = await res.json();
    var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    var text = parts.map(function (p) { return p.text || ''; }).join('');
    if (!text.trim()) throw new Error('Gemini가 빈 응답을 반환했습니다. 다시 시도해 주세요.');
    return text;
  }
  async function call(prompt, schema, onMsg) {
    var s = load();
    if (!has(s)) throw new Error('먼저 AI 설정을 완료해 주세요.');
    onMsg = onMsg || function () {};
    if (s.provider === 'bridge') {
      onMsg((s.bridge.provider === 'codex' ? 'ChatGPT' : 'Claude') + '가 답을 만드는 중…');
      var res;
      try {
        res = await fetch(BRIDGE + '/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: s.bridge.provider, model: s.bridge.model || undefined, prompt: prompt, schema: schema })
        });
      } catch (e) { throw new Error(await bridgeDownMsg()); }
      var data = null; try { data = await res.json(); } catch (e) {}
      if (!res.ok || !data || !data.ok) throw new Error((data && data.message) || ('연결 도우미 오류(' + res.status + ')가 발생했습니다.'));
      if (data.json && typeof data.json === 'object') return data.json;
      return parse(data.text || '');
    }
    if (s.provider === 'ollama') {
      onMsg('내 PC의 AI가 답을 만드는 중…');
      var base = s.ollama.url.replace(/\/$/, ''), r;
      // 문서 전체를 보내므로 기본 문맥 길이로는 앞부분이 잘린다. 생각하는 모델(qwen3 등)은 생각만 하다
      // 빈 답을 내기 쉬워 생각을 끈다. 생각 기능이 없는 모델이 think를 거부하면 빼고 한 번 더 보낸다.
      var ollamaBody = { model: s.ollama.model, stream: false, think: false, options: { num_ctx: 16384 }, messages: [{ role: 'user', content: prompt }], format: schema };
      for (var tries = 0; tries < 2; tries++) {
        try {
          r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ollamaBody) });
        } catch (e) { throw new Error('Ollama에 연결하지 못했습니다. 실행 여부와 OLLAMA_ORIGINS 설정을 확인해 주세요.'); }
        if (r.status === 400 && 'think' in ollamaBody) {
          var rej = ''; try { rej = await r.clone().text(); } catch (e) {}
          if (/think/i.test(rej)) { delete ollamaBody.think; continue; }
        }
        break;
      }
      if (r.status === 404) throw new Error('모델 "' + s.ollama.model + '"을(를) 찾을 수 없습니다. ollama pull로 먼저 받아주세요.');
      if (!r.ok) throw new Error('Ollama 오류(' + r.status + ')가 발생했습니다.');
      var od = await r.json();
      var ot = (od.message && od.message.content) || '';
      if (!ot.trim()) throw new Error('Ollama가 빈 응답을 반환했습니다. 다시 시도해 주세요.');
      return parse(ot);
    }
    var gSchema = toGeminiSchema(schema);
    var primary = s.gemini.model || GEM_DEFAULT;
    var models = primary === GEM_FALLBACK ? [primary] : [primary, GEM_FALLBACK];
    // 두 모델 모두 실패하면 사용자가 고른 1순위 모델의 오류를 우선 표시한다(폴백 실패가 원인을 가리지 않게).
    var primaryErr = null, lastErr = null;
    for (var m = 0; m < models.length; m++) {
      if (m > 0) { primaryErr = lastErr; onMsg('예비 모델(' + models[m] + ')로 다시 시도 중…'); }
      var thinking = true;
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          onMsg('AI가 답을 만드는 중…');
          return parse(await geminiOnce(models[m], s.gemini.apiKey, prompt, gSchema, thinking));
        } catch (e) {
          lastErr = e;
          if (e.thinkRej && thinking) { thinking = false; continue; }
          if (e.status === 429) {
            var wait = [15, 30, 45][Math.min(attempt, 2)];
            for (var sec = wait; sec > 0; sec--) { onMsg('무료 한도 대기 ' + sec + '초…'); await sleep(1000); }
            continue;
          }
          if (e.status === 503) {
            onMsg('서버가 혼잡합니다. 잠시 후 다시 시도합니다…');
            await sleep((Math.pow(2, attempt) + Math.random() * 0.5) * 1000);
            continue;
          }
          if (e.status === 404) break;
          throw e;
        }
      }
    }
    throw primaryErr || lastErr || new Error('AI 응답을 받지 못했습니다.');
  }

  // 다른 창(부모 사이트의 설정 창 등)에서 설정을 바꾸면 화면 표시를 새로 고친다.
  window.addEventListener('storage', function (e) { if (e.key === AI_KEY || (SEED_KEY && e.key === SEED_KEY)) window.dispatchEvent(new CustomEvent('drai-change')); });

  window.drAi = {
    call: call,
    has: function () { return isSaved() && has(); },
    open: open,
    label: label,
    scope: function () { return SCOPE[load().provider]; }
  };
})();
