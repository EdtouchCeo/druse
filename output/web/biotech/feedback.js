/* 학생 결과물 피드백 위젯 — 갤러리 카드와 결과물 페이지가 같은 데이터를 공유한다.
 *
 * 결과물 페이지에서 쓰는 법 (</body> 앞에 한 줄):
 *   <script src="/biotech/feedback.js" data-fb-slug="mirror" data-fb-title="프로젝트 미러"></script>
 *   → 우하단에 피드백 버튼이 뜨고, 누르면 갤러리와 같은 모달이 열린다.
 *
 * 갤러리에서 쓰는 법:
 *   DRFB.counts([...slugs]) 로 카드 수치를 채우고, DRFB.open(slug, title) 로 모달을 연다.
 *
 * 서버: /.netlify/functions/biofeedback  (Supabase Storage, DB 테이블 없음)
 * 관리자 삭제: 같은 오리진(daeryun.life)의 Supabase 세션을 읽어 토큰을 함께 보낸다.
 */
(function () {
  'use strict';
  if (window.DRFB) return;

  var API = '/.netlify/functions/biofeedback';
  var ROLES = [
    { v: 'student', t: '학생' }, { v: 'parent', t: '학부모' },
    { v: 'teacher', t: '교사' }, { v: 'other', t: '외부' }
  ];
  var TAGS = [
    { v: 'valid', t: '타당성', q: '문제 정의와 근거가 설득력 있나요?' },
    { v: 'fit', t: '적합성', q: '해결 방식이 그 문제·대상에 맞나요?' },
    { v: 'usab', t: '사용성', q: '하려던 걸 막힘없이 할 수 있었나요?' },
    { v: 'ui', t: 'UI', q: '화면이 보기 쉽고 읽기 편한가요?' },
    { v: 'ux', t: 'UX', q: '처음부터 끝까지 흐름이 자연스러웠나요?' },
    { v: 'idea', t: '아이디어', q: '이런 걸 더해 보면 어떨까요?' }
  ];
  var tagName = {};
  TAGS.forEach(function (t) { tagName[t.v] = t.t; });
  var roleName = {};
  ROLES.forEach(function (r) { roleName[r.v] = r.t; });

  // ── 브라우저 식별자(좋아요 1인 1표·내 글 표시용, 개인정보 아님) ──
  var cid = (function () {
    try {
      var k = 'dr-bio-cid', v = localStorage.getItem(k);
      if (!v) {
        v = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return 'c' + Date.now().toString(36); }
  })();

  // ── 관리자 토큰 (메인 사이트 Supabase 세션 재사용) ──
  function adminToken() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(k)) continue;
        var raw = JSON.parse(localStorage.getItem(k));
        var t = raw && (raw.access_token || (raw.currentSession && raw.currentSession.access_token));
        if (t) return t;
      }
    } catch (e) { /* 무시 */ }
    return '';
  }

  function api(payload) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return { error: '응답을 읽지 못했습니다.' }; })
        .then(function (d) { if (!r.ok) throw new Error(d.error || '오류가 발생했습니다.'); return d; });
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ago(iso) {
    var d = Date.parse(iso);
    if (!Number.isFinite(d)) return '';
    var s = Math.max(0, (Date.now() - d) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 86400 * 7) return Math.floor(s / 86400) + '일 전';
    return new Date(d).toLocaleDateString('ko-KR');
  }

  // ── 스타일 (한 번만 주입) ──
  function injectStyle() {
    if (document.getElementById('drfb-style')) return;
    var css = [
      '.drfb-mask{position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.62);backdrop-filter:blur(4px)}',
      '.drfb-box{width:min(680px,100%);max-height:min(88vh,860px);display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:#fff;color:#172033;box-shadow:0 26px 70px rgba(0,0,0,.36);font-family:Pretendard,"Noto Sans KR",system-ui,-apple-system,sans-serif;line-height:1.6;word-break:keep-all;overflow-wrap:break-word}',
      '.drfb-head{display:flex;align-items:center;gap:12px;padding:15px 18px;border-bottom:1px solid #e2e8f0}',
      '.drfb-head b{flex:1;font-size:1.02rem;letter-spacing:-.02em}',
      '.drfb-x{border:0;background:none;font-size:1.2rem;line-height:1;color:#64748b;cursor:pointer;padding:4px 6px}',
      '.drfb-like{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;color:#3730a3;font:700 .86rem inherit;cursor:pointer}',
      '.drfb-like.on{background:#4f46e5;border-color:#4f46e5;color:#fff}',
      '.drfb-body{overflow-y:auto;padding:16px 18px 22px}',
      '.drfb-guide{margin:0 0 14px;border:1px solid #e2e8f0;border-radius:13px;background:#f8fafc}',
      '.drfb-guide>summary{padding:11px 14px;font-weight:800;font-size:.9rem;color:#3730a3;cursor:pointer;list-style:none}',
      '.drfb-guide>summary::-webkit-details-marker{display:none}',
      '.drfb-guide .in{padding:0 14px 13px;font-size:.87rem;color:#475569}',
      '.drfb-guide .in ul{margin:8px 0 0;padding-left:18px}',
      '.drfb-guide .in li{margin-bottom:4px}',
      '.drfb-guide .tip{margin-top:10px;padding:9px 11px;border-radius:9px;background:#eef2ff;color:#3730a3}',
      '.drfb-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:9px}',
      '.drfb-in{flex:1 1 150px;min-width:0;padding:9px 11px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;font-size:.92rem;color:inherit;background:#fff}',
      '.drfb-ta{width:100%;min-height:112px;padding:11px 12px;border:1px solid #cbd5e1;border-radius:11px;font:inherit;font-size:.94rem;line-height:1.65;resize:vertical;background:#fff;color:inherit}',
      '.drfb-in:focus,.drfb-ta:focus{outline:2px solid #a5b4fc;outline-offset:1px;border-color:#818cf8}',
      '.drfb-tags{display:flex;flex-wrap:wrap;gap:6px;margin:9px 0}',
      '.drfb-tag{padding:5px 11px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#475569;font:600 .82rem inherit;cursor:pointer}',
      '.drfb-tag.on{background:#4f46e5;border-color:#4f46e5;color:#fff}',
      '.drfb-send{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:4px}',
      '.drfb-note{font-size:.78rem;color:#64748b}',
      '.drfb-btn{padding:10px 20px;border:0;border-radius:11px;background:#4f46e5;color:#fff;font:800 .92rem inherit;cursor:pointer}',
      '.drfb-btn:disabled{opacity:.55;cursor:default}',
      '.drfb-msg{margin:10px 0 0;padding:9px 12px;border-radius:10px;font-size:.86rem;display:none}',
      '.drfb-msg.err{display:block;background:#fef2f2;color:#991b1b;border:1px solid #fecaca}',
      '.drfb-msg.ok{display:block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}',
      '.drfb-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}',
      '.drfb-list{margin-top:20px;border-top:1px solid #e2e8f0;padding-top:14px}',
      '.drfb-count{margin:0 0 10px;font-size:.86rem;color:#64748b}',
      '.drfb-item{padding:13px 0;border-bottom:1px solid #f1f5f9}',
      '.drfb-meta{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-bottom:6px;font-size:.82rem;color:#64748b}',
      '.drfb-who{font-weight:800;color:#172033}',
      '.drfb-badge{padding:2px 8px;border-radius:999px;background:#f1f5f9;font-size:.75rem;font-weight:700;color:#475569}',
      '.drfb-badge.t{background:#eef2ff;color:#3730a3}',
      '.drfb-text{margin:0;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;font-size:.95rem}',
      '.drfb-acts{display:flex;align-items:center;gap:8px;margin-top:8px}',
      '.drfb-ilike{padding:4px 10px;border:1px solid #e2e8f0;border-radius:999px;background:#fff;color:#475569;font:700 .78rem inherit;cursor:pointer}',
      '.drfb-ilike.on{border-color:#c7d2fe;background:#eef2ff;color:#3730a3}',
      '.drfb-del{padding:4px 9px;border:1px solid #fecaca;border-radius:999px;background:#fff;color:#b91c1c;font:700 .78rem inherit;cursor:pointer}',
      '.drfb-empty{padding:26px 0;text-align:center;color:#64748b;font-size:.9rem}',
      '.drfb-fab{position:fixed;right:18px;bottom:18px;z-index:99990;display:inline-flex;align-items:center;gap:8px;padding:11px 17px;border:0;border-radius:999px;background:#4f46e5;color:#fff;font:800 .9rem Pretendard,"Noto Sans KR",system-ui,sans-serif;box-shadow:0 10px 26px rgba(79,70,229,.42);cursor:pointer}',
      '.drfb-fab:hover{background:#3730a3}',
      '@media(max-width:560px){.drfb-mask{padding:0}.drfb-box{max-height:100%;height:100%;border-radius:0}.drfb-fab{right:12px;bottom:12px;padding:10px 14px;font-size:.84rem}}'
    ].join('\n');
    var s = el('style');
    s.id = 'drfb-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ── 모달 ──
  var state = { slug: '', title: '', opened: 0, mask: null, tags: [] };

  function close() {
    if (state.mask) { state.mask.remove(); state.mask = null; }
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(slug, title) {
    injectStyle();
    close();
    state.slug = slug;
    state.title = title || slug;
    state.opened = Date.now();
    state.tags = [];

    var mask = el('div', 'drfb-mask');
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    var box = el('div', 'drfb-box');
    mask.appendChild(box);

    // 헤더
    var head = el('div', 'drfb-head');
    head.appendChild(el('b', null, state.title + ' — 피드백'));
    var likeBtn = el('button', 'drfb-like', '👍 0');
    likeBtn.type = 'button';
    head.appendChild(likeBtn);
    var x = el('button', 'drfb-x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', '닫기');
    x.addEventListener('click', close);
    head.appendChild(x);
    box.appendChild(head);

    var body = el('div', 'drfb-body');
    box.appendChild(body);

    // 작성 가이드
    var g = document.createElement('details');
    g.className = 'drfb-guide';
    g.open = true;
    var sm = el('summary', null, '어떻게 써야 팀에 도움이 될까요?');
    g.appendChild(sm);
    var gin = el('div', 'in');
    gin.appendChild(el('div', null, '자유롭게 쓰시면 됩니다. 아래 관점 중 하나만 짚어 주셔도 팀에게는 큰 도움이 됩니다.'));
    var ul = el('ul');
    TAGS.forEach(function (t) {
      var li = el('li');
      li.appendChild(el('b', null, t.t + ' — '));
      li.appendChild(document.createTextNode(t.q));
      ul.appendChild(li);
    });
    gin.appendChild(ul);
    gin.appendChild(el('div', 'tip', '팁 · 막혔던 곳은 “어디서 → 무엇을 하려다 → 어떻게 됐다” 순으로 적어 주시면 팀이 바로 고칠 수 있습니다.'));
    g.appendChild(gin);
    body.appendChild(g);

    // 작성 폼
    var row = el('div', 'drfb-row');
    var name = el('input', 'drfb-in');
    name.placeholder = '이름 또는 별명 (비우면 익명)';
    name.maxLength = 12;
    var role = el('select', 'drfb-in');
    ROLES.forEach(function (r) {
      var o = el('option', null, r.t);
      o.value = r.v;
      role.appendChild(o);
    });
    role.value = 'other';
    row.appendChild(name);
    row.appendChild(role);
    body.appendChild(row);

    var ta = el('textarea', 'drfb-ta');
    ta.placeholder = '이 결과물을 보고 느낀 점, 좋았던 점, 개선하면 좋겠는 점을 적어 주세요.';
    ta.maxLength = 1000;
    body.appendChild(ta);

    var tagWrap = el('div', 'drfb-tags');
    tagWrap.appendChild(el('span', 'drfb-note', '관점 선택(선택, 최대 3개)'));
    TAGS.forEach(function (t) {
      var b = el('button', 'drfb-tag', t.t);
      b.type = 'button';
      b.addEventListener('click', function () {
        var i = state.tags.indexOf(t.v);
        if (i >= 0) { state.tags.splice(i, 1); b.classList.remove('on'); }
        else if (state.tags.length < 3) { state.tags.push(t.v); b.classList.add('on'); }
      });
      tagWrap.appendChild(b);
    });
    body.appendChild(tagWrap);

    var hp = el('input', 'drfb-hp');           // 허니팟
    hp.tabIndex = -1;
    hp.setAttribute('autocomplete', 'off');
    hp.setAttribute('aria-hidden', 'true');
    body.appendChild(hp);

    var send = el('div', 'drfb-send');
    send.appendChild(el('span', 'drfb-note', '실명 언급·비방·개인정보는 삭제됩니다. 작성 시각이 함께 저장됩니다.'));
    var btn = el('button', 'drfb-btn', '피드백 남기기');
    btn.type = 'button';
    send.appendChild(btn);
    body.appendChild(send);

    var msg = el('p', 'drfb-msg');
    body.appendChild(msg);

    // 목록
    var list = el('div', 'drfb-list');
    var count = el('p', 'drfb-count', '불러오는 중…');
    list.appendChild(count);
    var items = el('div');
    list.appendChild(items);
    body.appendChild(list);

    document.body.appendChild(mask);
    state.mask = mask;
    document.addEventListener('keydown', onKey);
    ta.focus();

    function say(text, kind) {
      msg.textContent = text || '';
      msg.className = 'drfb-msg' + (text ? ' ' + kind : '');
    }

    // 좋아요
    var liked = false;
    function paintLike(n, on) {
      liked = !!on;
      likeBtn.textContent = '👍 ' + n;
      likeBtn.classList.toggle('on', liked);
    }
    likeBtn.addEventListener('click', function () {
      var next = !liked;
      likeBtn.disabled = true;
      api({ action: 'like', slug: state.slug, cid: cid, on: next })
        .then(function (d) { paintLike(d.likes, d.liked); bump(state.slug); })
        .catch(function (e) { say(e.message, 'err'); })
        .then(function () { likeBtn.disabled = false; });
    });

    function render(data) {
      paintLike(data.likes || 0, data.liked);
      items.textContent = '';
      var arr = data.items || [];
      count.textContent = arr.length ? '피드백 ' + arr.length + '건' : '';
      if (!arr.length) {
        items.appendChild(el('div', 'drfb-empty', '아직 남겨진 피드백이 없습니다. 첫 번째로 의견을 들려주세요.'));
        return;
      }
      var token = adminToken();
      arr.forEach(function (it) { items.appendChild(itemNode(it, token)); });
    }

    function itemNode(it, token) {
      var wrap = el('div', 'drfb-item');
      var meta = el('div', 'drfb-meta');
      meta.appendChild(el('span', 'drfb-who', it.name || '익명'));
      meta.appendChild(el('span', 'drfb-badge', roleName[it.role] || '외부'));
      (it.tags || []).forEach(function (t) {
        if (tagName[t]) meta.appendChild(el('span', 'drfb-badge t', tagName[t]));
      });
      meta.appendChild(el('span', null, ago(it.ts)));
      wrap.appendChild(meta);
      wrap.appendChild(el('p', 'drfb-text', it.text));

      var acts = el('div', 'drfb-acts');
      var lb = el('button', 'drfb-ilike' + (it.liked ? ' on' : ''), '👍 도움돼요 ' + (it.likes || 0));
      lb.type = 'button';
      lb.addEventListener('click', function () {
        var next = !lb.classList.contains('on');
        lb.disabled = true;
        api({ action: 'itemLike', slug: state.slug, id: it.id, cid: cid, on: next })
          .then(function (d) {
            lb.textContent = '👍 도움돼요 ' + d.likes;
            lb.classList.toggle('on', d.liked);
          })
          .catch(function (e) { say(e.message, 'err'); })
          .then(function () { lb.disabled = false; });
      });
      acts.appendChild(lb);

      if (token) {
        var db = el('button', 'drfb-del', '삭제');
        db.type = 'button';
        db.addEventListener('click', function () {
          if (!confirm('이 피드백을 삭제할까요?')) return;
          db.disabled = true;
          api({ action: 'delete', slug: state.slug, id: it.id, token: adminToken() })
            .then(function () { wrap.remove(); bump(state.slug); })
            .catch(function (e) { say(e.message, 'err'); db.disabled = false; });
        });
        acts.appendChild(db);
      }
      wrap.appendChild(acts);
      return wrap;
    }

    function load() {
      api({ action: 'list', slug: state.slug, cid: cid })
        .then(render)
        .catch(function (e) { count.textContent = ''; say(e.message, 'err'); });
    }

    btn.addEventListener('click', function () {
      var text = ta.value.trim();
      if (text.length < 10) { say('내용을 10자 이상 적어 주세요.', 'err'); ta.focus(); return; }
      btn.disabled = true;
      say('등록하는 중…', 'ok');
      api({
        action: 'create', slug: state.slug, cid: cid,
        name: name.value, role: role.value, tags: state.tags,
        text: text, hp: hp.value, dwell: Date.now() - state.opened
      }).then(function () {
        ta.value = '';
        state.tags = [];
        tagWrap.querySelectorAll('.drfb-tag.on').forEach(function (b) { b.classList.remove('on'); });
        say('고맙습니다. 피드백이 등록되었습니다.', 'ok');
        bump(state.slug);
        load();
      }).catch(function (e) {
        say(e.message, 'err');
      }).then(function () { btn.disabled = false; });
    });

    load();
  }

  // ── 카드 수치 ──
  var listeners = [];
  function onCounts(fn) { listeners.push(fn); }
  function bump(slug) {                       // 변경 후 해당 팀 수치 갱신
    counts([slug]);
  }
  function counts(slugs) {
    return api({ action: 'counts', slugs: slugs })
      .then(function (d) {
        listeners.forEach(function (fn) { try { fn(d.counts || {}); } catch (e) { } });
        return d.counts || {};
      })
      .catch(function () { return {}; });
  }

  // ── 결과물 페이지용 떠 있는 버튼 ──
  function mountFab(slug, title) {
    injectStyle();
    var b = el('button', 'drfb-fab', '💬 피드백 남기기');
    b.type = 'button';
    b.addEventListener('click', function () { open(slug, title); });
    document.body.appendChild(b);
    counts([slug]).then(function (c) {
      var n = c[slug] || {};
      if (n.feedback || n.likes) {
        b.textContent = '💬 피드백 ' + (n.feedback || 0) + ' · 👍 ' + (n.likes || 0);
      }
    });
    return b;
  }

  window.DRFB = { open: open, close: close, counts: counts, onCounts: onCounts, mountFab: mountFab, like: function (slug, on) { return api({ action: 'like', slug: slug, cid: cid, on: on }); } };

  // data-fb-slug 가 붙은 script 태그로 불렸으면 자동으로 버튼을 단다
  var me = document.currentScript;
  if (me && me.dataset && me.dataset.fbSlug) {
    var slug = me.dataset.fbSlug, title = me.dataset.fbTitle || document.title;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { mountFab(slug, title); });
    } else {
      mountFab(slug, title);
    }
  }
})();
