/* 학생 결과물 페이지에서 갤러리로 돌아가는 떠 있는 링크.
 *
 * 학생이 만든 페이지는 레이아웃이 제각각(문서형·전체화면 앱·3D 게임)이라
 * 본문에 상단 바를 끼워 넣으면 원래 화면이 밀리거나 자기 헤더와 겹친다.
 * 그래서 화면 위에 작은 알약 하나만 띄운다. 원본 마크업은 건드리지 않는다.
 *
 * 쓰는 법: </body> 앞에
 *   <script src="/biotech/home-link.js" data-dr-home defer></script>
 * 아래쪽이 가려지는 페이지(예: 대화창이 하단 전체 폭인 3D 게임)는
 *   data-pos="top-left"
 */
(function () {
  if (window.__drHomeLink) return;
  window.__drHomeLink = true;

  var tag = document.currentScript || document.querySelector('script[data-dr-home]');
  var d = (tag && tag.dataset) || {};
  var pos = d.pos === 'top-left' ? 'dr-tl' : 'dr-bl';
  var href = d.href || '/biotech/';
  var label = d.label || '결과물 갤러리';

  var CSS = [
    '#dr-home-link{position:fixed;z-index:2147483000;display:inline-flex;align-items:center;',
    'padding:9px 15px;border-radius:999px;text-decoration:none;color:#fff;',
    "font:600 13px/1 Pretendard,'Noto Sans KR',system-ui,-apple-system,sans-serif;letter-spacing:-.01em;",
    'background:rgba(49,46,129,.88);border:1px solid rgba(255,255,255,.3);',
    'box-shadow:0 6px 18px rgba(15,23,42,.3);opacity:.8;',
    'transition:opacity .15s,background .15s,transform .15s}',
    '#dr-home-link:hover,#dr-home-link:focus-visible{opacity:1;background:#312e81;transform:translateY(-1px)}',
    '#dr-home-link.dr-bl{left:14px;bottom:14px}',
    '#dr-home-link.dr-tl{left:14px;top:14px}',
    '#dr-home-link.dr-bl{left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom))}',
    '#dr-home-link.dr-tl{left:max(14px,env(safe-area-inset-left));top:max(14px,env(safe-area-inset-top))}',
    '@media print{#dr-home-link{display:none}}'
  ].join('');

  // 받침에 맞춰 '으로/로'를 고른다(ㄹ 받침은 '로')
  function ro(w) {
    var c = w.charCodeAt(w.length - 1) - 0xac00;
    if (c < 0 || c > 11171) return '로';
    var jong = c % 28;
    return jong === 0 || jong === 8 ? '로' : '으로';
  }

  function mount() {
    if (document.getElementById('dr-home-link')) return;
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    var a = document.createElement('a');
    a.id = 'dr-home-link';
    a.className = pos;
    a.href = href;
    a.textContent = '← ' + label;
    a.setAttribute('aria-label', label + ro(label) + ' 돌아가기');
    document.body.appendChild(a);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
