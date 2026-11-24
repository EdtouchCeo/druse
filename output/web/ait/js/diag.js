// 화면이 멈췄을 때 까닭을 알 수 있게 오류를 화면 아래에 띄운다.
// 전자칠판처럼 오래된 브라우저에서도 돌아야 하므로 옛 문법(ES5)으로만 쓴다. 모듈보다 먼저 읽힌다.
(function () {
  var shown = 0;
  function browser() {
    var m = /(Edg|Chrome|Firefox|Version)\/(\d+)/.exec(navigator.userAgent) || [];
    return m[1] ? (m[1] === 'Version' ? 'Safari' : m[1]) + ' ' + m[2] : '알 수 없는 브라우저';
  }
  function show(text) {
    if (shown >= 3 || !document.body) return;
    shown += 1;
    var bar = document.createElement('div');
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#7f1d1d;color:#fff;padding:10px 14px;border-radius:10px;font:14px/1.5 sans-serif;word-break:break-all;';
    bar.appendChild(document.createTextNode('화면에 문제가 생겼습니다. 새로 고쳐도 같으면 아래 내용을 선생님께 알려 주세요. '));
    var code = document.createElement('span');
    code.style.cssText = 'display:block;opacity:.85;font-size:12px;';
    code.appendChild(document.createTextNode(text + ' · ' + browser()));
    bar.appendChild(code);
    bar.onclick = function () { if (bar.parentNode) bar.parentNode.removeChild(bar); };
    document.body.appendChild(bar);
  }
  function later(text) {
    if (document.body) show(text);
    else document.addEventListener('DOMContentLoaded', function () { show(text); });
  }
  window.addEventListener('error', function (e) {
    // 그림 같은 자료가 안 받아진 경우(e.message 없음)는 화면이 따로 알린다. 스크립트 오류만 띄운다.
    if (e && e.message) {
      later(e.message + (e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : ''));
      return;
    }
    var t = e && e.target;
    if (t && t.tagName === 'SCRIPT' && t.src) later('스크립트를 받지 못했습니다: ' + String(t.src).split('/').pop());
  }, true);
  window.__aitDiag = { show: later };
}());
