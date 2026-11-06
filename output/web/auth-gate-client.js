// 로그인 상태와 서버 게이트 쿠키를 맞춘다. 페이지 <head>에서 먼저 실행된다.
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="dr-gate-variant"]');
  var variant = meta ? meta.content : 'public';
  var ENDPOINT = '/.netlify/functions/auth-session';
  var RETURN_KEY = 'dr_gate_return', EXP_KEY = 'dr_gate_exp', RELOAD_KEY = 'dr_gate_reload_at', DENIED_KEY = 'dr_gate_denied';
  var RENEW_WITHIN_MS = 12 * 60 * 60 * 1000;
  var busy = false;

  function local(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }
  function tab(fn) { try { return fn(window.sessionStorage); } catch (e) { return null; } }
  function session() { return local(function (s) { return JSON.parse(s.getItem('dr_sess_v1')); }); }
  function pendingReturn() { return tab(function (s) { return s.getItem(RETURN_KEY); }); }

  // 보호 화면에서 넘어온 복귀 경로를 주소창에서 지우고 보관한다(같은 사이트 경로만 허용).
  var params = new URLSearchParams(location.search);
  if (params.has('gate_return')) {
    var requested = params.get('gate_return');
    if (/^\/(?![\/\\])/.test(requested) && requested.indexOf('\\') === -1) {
      tab(function (s) { s.setItem(RETURN_KEY, requested); s.removeItem(DENIED_KEY); });
    }
    params.delete('gate_return');
    var query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
  }

  function reloadOnce() {
    var last = Number(tab(function (s) { return s.getItem(RELOAD_KEY); })) || 0;
    if (Date.now() - last < 30000) return;
    tab(function (s) { s.setItem(RELOAD_KEY, String(Date.now())); });
    location.reload();
  }

  function settle(tier) {
    var target = pendingReturn();
    if (target) {
      tab(function (s) { s.removeItem(RETURN_KEY); });
      if (tier) { location.replace(target); return; }
    }
    // 전략실 로그인 복귀가 진행 중이면 그쪽 이동을 방해하지 않는다.
    if (tab(function (s) { return s.getItem('dr_login_return_v1'); })) return;
    if ((tier || 'public') !== variant) reloadOnce();
  }

  function onIssued(data) {
    local(function (s) { s.setItem(EXP_KEY, String(data.exp || 0)); });
    var target = pendingReturn();
    // 구현 미리보기 관리 화면은 자체 명단으로 확인하므로 교사 승인 전 계정도 돌아가게 둔다.
    var allowed = data.tier === 'teacher' || !target || /^\/(?:_timetable_|sdg\/)/.test(target);
    if (allowed) {
      tab(function (s) { s.removeItem(DENIED_KEY); });
    } else {
      tab(function (s) { s.setItem(DENIED_KEY, '1'); s.removeItem(RETURN_KEY); });
      alert('이 화면은 승인된 교사 계정으로만 열 수 있습니다.');
    }
    settle(data.tier);
  }

  function sync() {
    if (busy) return;
    var current = session();
    var exp = Number(local(function (s) { return s.getItem(EXP_KEY); })) || 0;

    if (!current || !current.token) {
      if (variant === 'public' && !exp) return;
      busy = true;
      local(function (s) { s.removeItem(EXP_KEY); });
      fetch(ENDPOINT, { method: 'DELETE', credentials: 'same-origin' })
        .then(function () { if (variant !== 'public') reloadOnce(); })
        .catch(function () {})
        .then(function () { busy = false; });
      return;
    }
    if (variant !== 'public' && !pendingReturn() && exp * 1000 - Date.now() > RENEW_WITHIN_MS) return;

    busy = true;
    var ready = typeof window.ensureToken === 'function' ? window.ensureToken() : Promise.resolve(current.token);
    ready.then(function (token) {
      return fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Authorization: 'Bearer ' + (token || current.token) }
      });
    }).then(function (res) {
      if (res.status === 401) {
        local(function (s) { s.removeItem(EXP_KEY); });
        settle(null);
        return null;
      }
      return res.ok ? res.json().then(onIssued) : null;
    }).catch(function () {}).then(function () { busy = false; });
  }

  window.addEventListener('dr-auth-change', function () { setTimeout(sync, 0); });
  // 열어 둔 화면에서 쿠키가 만료되지 않도록 복귀할 때와 1시간마다 확인한다.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
  setInterval(sync, 60 * 60 * 1000);
})();
