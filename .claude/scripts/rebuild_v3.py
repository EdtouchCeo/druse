"""
시간표 시뮬레이션 v3
- 수요일 7교시 제외
- 드래그앤드롭 시: 목적지 교사의 맞교대 가능 시간 안내
- 전체 시뮬레이션: 5×7 시각 그리드 (클릭 → 인라인 상세)
- 불필요한 정보 제거, 직관적 UX
"""
import json, sys, os, re
sys.stdout.reconfigure(encoding='utf-8')

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTML_PATH = os.path.join(BASE, 'output', 'web', 'index.html')
JSON_PATH = os.path.join(BASE, 'output', 'web', '_timetable_compact.json')

with open(JSON_PATH, encoding='utf-8') as f:
    raw = json.load(f)
TT_JSON  = json.dumps(raw, ensure_ascii=False, separators=(',', ':'))
ALI_JSON = json.dumps({'김기A':'김기철A','김기B':'김기철B','최유B':'최유리B'},
                      ensure_ascii=False, separators=(',', ':'))

classes_sorted = sorted(raw['c'].keys(),
                        key=lambda x: (int(x.split('-')[0]), int(x.split('-')[1])))
class_opts = '\n'.join(f'        <option value="{c}">{c}</option>'
                       for c in classes_sorted)
teachers_json = json.dumps(sorted(raw['t'].keys()),
                           ensure_ascii=False, separators=(',', ':'))

with open(HTML_PATH, encoding='utf-8') as f:
    html = f.read()

MARKER = '\n<!-- ===== 시간표 검색 패널 ===== -->'
idx = html.find(MARKER)
if idx >= 0:
    html = html[:idx]
else:
    # 마커 없으면 </body> 앞에 삽입 (build_html.py 직후 실행 시)
    body_idx = html.rfind('</body>')
    assert body_idx >= 0, '</body> 태그를 찾을 수 없음'
    html = html[:body_idx]

# 기존 인증 바 제거 (재삽입 위해)
html = re.sub(r'\n<!-- ===== 회원 인증 바 =====.*?(?=\n<!-- ===== |\n<nav )',
              '', html, flags=re.DOTALL)

# 인증 바 삽입 (</header> 직후)
AUTH_BAR = f"""
<!-- ===== 회원 인증 바 ===== -->
<div id="auth-bar" style="background:#f8faff;border-bottom:1px solid #e5e7eb;padding:0 16px;">
  <div style="max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;height:44px;">
    <!-- 시간표 검색 위젯 -->
    <div id="tt-search-wrap" style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
      <span style="font-size:0.8rem;font-weight:700;color:#1a3a6b;white-space:nowrap;">🗓 시간표</span>
      <select id="tt-type" onchange="ttTypeChange()" style="height:30px;border:1px solid #d1d5db;border-radius:20px;font-size:0.75rem;padding:0 10px;cursor:pointer;background:#fff;color:#374151;font-family:inherit;outline:none;">
        <option value="teacher">교사별</option>
        <option value="class">학급별</option>
      </select>
      <!-- 교사별: 텍스트 자동완성 -->
      <div id="tt-teacher-wrap" style="position:relative;">
        <input id="tt-input" type="text" placeholder="교사 이름 검색..." autocomplete="off"
          oninput="ttSuggest()" onkeydown="ttKeydown(event)"
          style="height:30px;border:1px solid #d1d5db;border-radius:20px;font-size:0.75rem;padding:0 12px;width:140px;font-family:inherit;outline:none;color:#374151;">
        <div id="tt-suggest" style="display:none;position:absolute;top:34px;left:0;z-index:2000;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.13);max-height:220px;overflow-y:auto;width:180px;"></div>
      </div>
      <!-- 학급별: select 드롭다운 -->
      <select id="tt-class-select" style="display:none;height:30px;border:1px solid #d1d5db;border-radius:20px;font-size:0.75rem;padding:0 10px;cursor:pointer;background:#fff;color:#374151;font-family:inherit;outline:none;width:100px;">
        <option value="">학반 선택...</option>
{class_opts}
      </select>
      <button onclick="ttSearch()" style="height:30px;padding:0 14px;font-size:0.75rem;font-weight:600;font-family:inherit;background:#1a3a6b;color:#fff;border:none;border-radius:20px;cursor:pointer;white-space:nowrap;">검색</button>
    </div>
    <!-- 우측 인증 영역 -->
    <div style="display:flex;align-items:center;gap:8px;">
    <button id="tab-btn-register" onclick="switchTab('register', document.getElementById('tab-btn-register'))" style="display:inline-flex;align-items:center;height:30px;padding:0 14px;font-size:0.8rem;font-weight:600;font-family:inherit;color:#4b5563;background:#fff;border:1px solid #d1d5db;border-radius:20px;cursor:pointer;white-space:nowrap;">👤 회원가입</button>
    <div style="width:1px;height:18px;background:#d1d5db;flex-shrink:0;"></div>
    <button id="login-btn" onclick="startLogin()" style="display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 14px;font-size:0.8rem;font-weight:600;font-family:inherit;color:#fff;background:#4285f4;border:none;border-radius:20px;cursor:pointer;white-space:nowrap;">
      <svg width="13" height="13" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#fff"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff"/></svg>
      로그인
    </button>
    <div id="user-badge" style="display:none;align-items:center;gap:8px;">
      <span id="user-name-display" style="font-size:0.8rem;font-weight:600;color:var(--primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;"></span>
      <button onclick="doLogout()" style="display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 14px;font-size:0.8rem;font-weight:600;font-family:inherit;color:#fff;background:#ef4444;border:none;border-radius:20px;cursor:pointer;white-space:nowrap;">↩ 로그아웃</button>
    </div>
    </div><!-- /auth-right -->
  </div>
</div>
"""

header_end_idx = html.find('</header>')
assert header_end_idx >= 0, '</header> 태그를 찾을 수 없음'
header_end_idx += len('</header>')
html = html[:header_end_idx] + AUTH_BAR + html[header_end_idx:]

AUTH_JS = r"""
<!-- ===== 인증 JS ===== -->
<script>
(function () {
  'use strict';

  var SB_URL      = 'https://aafpkfcxzdrguuctdwth.supabase.co';
  var SB_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhZnBrZmN4emRyZ3V1Y3Rkd3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MzEwNjYsImV4cCI6MjA5MjMwNzA2Nn0.1VWheZHC2qNwWJhJ6KTFhjfFf9-bAfAdjzja2cD-xmw';
  var SESSION_KEY = 'dr_sess_v1';
  var _pendingToken = null;
  var _pendingAuth  = null;

  function decodeJWT(token) {
    try {
      var b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64));
    } catch(e) { return null; }
  }
  function generateVerifier() {
    var arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode.apply(null, arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }
  function challengeFromVerifier(verifier) {
    var enc = new TextEncoder().encode(verifier);
    return crypto.subtle.digest('SHA-256', enc).then(function(buf) {
      return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    });
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  }
  function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  function clearSession()  { localStorage.removeItem(SESSION_KEY); }

  function showUserBadge(user) {
    document.getElementById('login-btn').style.display = 'none';
    var badge = document.getElementById('user-badge');
    badge.style.display = 'flex';
    var name = (user && user.name) ? user.name : '사용자';
    var role = (user && user.role) ? user.role : '';
    document.getElementById('user-name-display').textContent = name + (role ? ' (' + role + ')' : '');
    var lr = document.getElementById('ai-login-required');
    var ac = document.getElementById('ai-content');
    if (lr) lr.style.display = 'none';
    if (ac) ac.style.display = '';
  }
  function showLoginBtn() {
    document.getElementById('login-btn').style.display = '';
    document.getElementById('user-badge').style.display = 'none';
    var lr = document.getElementById('ai-login-required');
    var ac = document.getElementById('ai-content');
    if (lr) lr.style.display = '';
    if (ac) ac.style.display = 'none';
  }

  window.startLogin = function () {
    var existing = getSession();
    if (existing) { applyAuth(existing); return; }
    var verifier = generateVerifier();
    localStorage.setItem('pkce_v', verifier);
    challengeFromVerifier(verifier).then(function(challenge) {
      var redirectTo = encodeURIComponent('https://daeryun.life');
      window.location.href = SB_URL + '/auth/v1/authorize?provider=google&redirect_to=' + redirectTo
        + '&code_challenge=' + challenge + '&code_challenge_method=S256';
    });
  };

  window.doLogout = function () {
    clearSession();
    showLoginBtn();
    showRegStep('login');
    var schoolBtn = document.querySelector('.tab-btn');
    if (schoolBtn) schoolBtn.click();
  };

  function showRegStep(step) {
    ['login','form','done'].forEach(function(s) {
      var el = document.getElementById('reg-step-' + s);
      if (el) el.style.display = s === step ? '' : 'none';
    });
  }

  window.toggleRegFields = function () {
    var role = document.querySelector('input[name="reg-role"]:checked');
    if (!role) return;
    var isTeacher = role.value === '교사';
    document.getElementById('reg-teacher-fields').style.display = isTeacher ? '' : 'none';
    document.getElementById('reg-student-fields').style.display = isTeacher ? 'none' : '';
  };

  window.submitReg = function (e) {
    e.preventDefault();
    var roleEl = document.querySelector('input[name="reg-role"]:checked');
    if (!roleEl) { alert('구분을 선택해 주세요.'); return; }
    var role = roleEl.value;
    var isTeacher = role === '교사';
    var name  = isTeacher
      ? document.getElementById('reg-name-t').value.trim()
      : document.getElementById('reg-name-s').value.trim();
    var grade  = isTeacher ? null : parseInt(document.getElementById('reg-grade').value) || null;
    var cls    = isTeacher ? null : parseInt(document.getElementById('reg-class').value) || null;
    var number = isTeacher ? null : parseInt(document.getElementById('reg-number').value) || null;
    if (!name) { alert('성명을 입력해 주세요.'); return; }
    var btn = document.getElementById('reg-submit');
    btn.disabled = true; btn.textContent = '저장 중...';
    var payload = { google_id: _pendingAuth.id, email: _pendingAuth.email, name: name, role: role,
                    grade: grade, class: cls, admission_year: number };
    fetch('/.netlify/functions/save-user', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var user = Array.isArray(data) ? data[0] : data;
      var session = { token: _pendingToken, user: user };
      saveSession(session); applyAuth(session); gotoSchoolTab();
    })
    .catch(function() {
      btn.disabled = false; btn.textContent = '가입 완료';
      alert('저장 중 오류가 발생했습니다. 다시 시도해 주세요.');
    });
  };

  function applyAuth(session) {
    if (!session || !session.user) { showLoginBtn(); return; }
    showUserBadge(session.user);
    if (session.user.id) logActivity(session.user.id, '접속', '', '');
  }

  function logActivity(userId, eventType, detail, page) {
    fetch('/.netlify/functions/save-log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, event_type: eventType, detail: detail, page: page })
    }).catch(function() {});
  }

  function handleOAuthCallback(token) {
    var claims = decodeJWT(token);
    var authId = claims ? claims.sub : null;
    var meta   = (claims && claims.user_metadata) ? claims.user_metadata : {};
    var gName  = meta.full_name || meta.name || '';
    if (!authId) { showLoginBtn(); return; }
    _pendingToken = token;
    _pendingAuth  = { id: authId, email: (claims && claims.email) || '', user_metadata: meta };
    var stored = getSession();
    if (stored && stored.user && stored.user.google_id === authId) {
      stored.token = token; saveSession(stored); finishLogin(stored); return;
    }
    fetch('/.netlify/functions/get-user', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_id: authId })
    })
    .then(function(r) { return r.json(); })
    .then(function(profiles) {
      if (profiles && profiles.length > 0) {
        var session = { token: token, user: profiles[0] };
        saveSession(session); finishLogin(session);
      } else {
        var nameInput = document.getElementById('reg-name-t');
        if (nameInput && gName) nameInput.value = gName;
        showRegStep('form'); gotoRegTab();
      }
    })
    .catch(function() {
      var tempUser = { google_id: authId, name: gName || '사용자', role: '', id: authId };
      var session  = { token: token, user: tempUser };
      saveSession(session); finishLogin(session);
      showRegStep('form'); gotoRegTab();
    });
  }

  function finishLogin(session) { applyAuth(session); gotoSchoolTab(); }

  function gotoSchoolTab() {
    var btn = document.querySelector('.tab-btn[onclick*="school"]');
    if (btn) btn.click();
  }
  function gotoRegTab() {
    var btn = document.getElementById('tab-btn-register');
    if (btn) switchTab('register', btn);
  }

  function hookLogs() {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var session = getSession();
        if (!session) return;
        logActivity(session.user.id, '탭클릭', btn.textContent.trim(), '');
      });
    });
    var inp = document.getElementById('searchInput');
    if (!inp) return;
    var timer;
    inp.addEventListener('input', function() {
      clearTimeout(timer);
      var val = inp.value.trim();
      if (!val) return;
      timer = setTimeout(function() {
        var session = getSession();
        if (!session) return;
        logActivity(session.user.id, '검색', val, '');
      }, 1000);
    });
  }

  function exchangeCode(code) {
    var verifier = localStorage.getItem('pkce_v');
    localStorage.removeItem('pkce_v');
    if (!verifier) { showLoginBtn(); return; }
    fetch(SB_URL + '/auth/v1/token?grant_type=pkce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.access_token) { showLoginBtn(); return; }
      handleOAuthCallback(data.access_token);
    })
    .catch(function() { showLoginBtn(); });
  }

  function init() {
    hookLogs();
    showRegStep('login');
    var params = new URLSearchParams(window.location.search);
    var code = params.get('code');
    if (code) {
      history.replaceState(null, '', window.location.pathname);
      exchangeCode(code); return;
    }
    var hash = new URLSearchParams(window.location.hash.slice(1));
    var token = hash.get('access_token');
    if (token) {
      history.replaceState(null, '', window.location.pathname);
      handleOAuthCallback(token); return;
    }
    var session = getSession();
    if (session) { applyAuth(session); } else { showLoginBtn(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
</script>
"""

# ── HTML + CSS ──────────────────────────────────────────────
PANEL = r"""
<!-- ===== 시간표 검색 패널 ===== -->
<div id="tt-panel" style="display:none;position:fixed;top:44px;left:0;right:0;z-index:1500;background:#fff;border-bottom:2px solid #1a3a6b;box-shadow:0 8px 28px rgba(0,0,0,0.18);max-height:82vh;overflow-y:auto;">
  <div style="max-width:960px;margin:0 auto;padding:14px 22px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <h3 id="tt-panel-title" style="margin:0;font-size:.97rem;color:#1a3a6b;font-weight:700;"></h3>
        <span id="tt-panel-sub" style="font-size:.75rem;color:#6b7280;"></span>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button id="tt-view-today" onclick="ttShowView('today')" class="tt-hdr-btn tt-hdr-active">📅 오늘</button>
        <button id="tt-view-week"  onclick="ttShowView('week')"  class="tt-hdr-btn">📋 전체 주간</button>
        <button id="tt-move-btn"   onclick="ttToggleMove()"      class="tt-hdr-btn" style="display:none;">🔄 이동 시뮬레이션</button>
        <button onclick="ttClose()" class="tt-hdr-btn tt-close-btn">✕ 닫기</button>
      </div>
    </div>
    <div id="tt-move-hint" style="display:none;background:#eff6ff;border:1px solid #93c5fd;border-radius:7px;padding:7px 13px;margin-bottom:10px;font-size:.76rem;color:#1e40af;">
      🖱 수업 셀을 <strong>클릭</strong>하면 모든 이동 가능 시간을 시각적으로 확인합니다. 원하는 목적지로 <strong>드래그</strong>하면 해당 시간 상세 분석을 보여줍니다.
    </div>
    <div id="tt-today-view"><div id="tt-today-day-label" style="font-size:.8rem;font-weight:700;color:#2563eb;margin-bottom:7px;"></div><div id="tt-today-content"></div></div>
    <div id="tt-week-view" style="display:none;"><div id="tt-week-content"></div></div>
  </div>
</div>
<div id="tt-backdrop" onclick="ttClose()" style="display:none;position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,0.16);"></div>

<!-- ===== 드래그앤드롭 분석 모달 ===== -->
<div id="tt-drop-modal" style="display:none;position:fixed;inset:0;z-index:3000;align-items:center;justify-content:center;">
  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.4);" onclick="ttDropClose()"></div>
  <div style="position:relative;background:#fff;border-radius:14px;padding:0;max-width:420px;width:92%;box-shadow:0 20px 50px rgba(0,0,0,0.28);">
    <div id="tt-drop-header" style="padding:16px 20px 12px;border-radius:14px 14px 0 0;"></div>
    <div id="tt-drop-body" style="padding:0 20px 16px;font-size:.83rem;"></div>
  </div>
</div>

<!-- ===== 시뮬레이션 그리드 모달 ===== -->
<div id="tt-sim-modal" style="display:none;position:fixed;inset:0;z-index:3000;align-items:flex-start;justify-content:center;padding-top:52px;overflow-y:auto;">
  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.42);" onclick="ttSimClose()"></div>
  <div style="position:relative;background:#fff;border-radius:14px;padding:0;max-width:660px;width:96%;max-height:88vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,0.28);margin-bottom:30px;">
    <div style="background:linear-gradient(135deg,#1a3a6b,#2563eb);color:#fff;padding:16px 20px;border-radius:14px 14px 0 0;position:sticky;top:0;z-index:5;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div><div id="tt-sim-title" style="font-size:.92rem;font-weight:700;"></div>
          <div id="tt-sim-badges" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;"></div></div>
        <button onclick="ttSimClose()" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:.85rem;flex-shrink:0;">✕</button>
      </div>
    </div>
    <div style="padding:16px 20px;">
      <div id="tt-sim-grid-wrap" style="overflow-x:auto;"></div>
      <div id="tt-sim-detail" style="margin-top:14px;min-height:60px;"></div>
    </div>
  </div>
</div>

<style>
.tt-hdr-btn{height:27px;padding:0 11px;font-size:.72rem;font-weight:600;font-family:inherit;background:#fff;color:#1a3a6b;border:1px solid #1a3a6b;border-radius:20px;cursor:pointer;white-space:nowrap;}
.tt-hdr-btn.tt-hdr-active{background:#1a3a6b;color:#fff;}
.tt-close-btn{background:#f3f4f6;color:#374151;border-color:#d1d5db;}
/* 주간표 */
.tt-table{width:100%;border-collapse:collapse;font-size:.78rem;}
.tt-table th{background:#1a3a6b;color:#fff;padding:6px 8px;text-align:center;font-weight:600;}
.tt-table td{padding:5px 8px;border:1px solid #e5e7eb;text-align:center;vertical-align:middle;min-width:65px;}
.tt-table tr:nth-child(even) td{background:#f8faff;}
.tt-period{background:#f0f4fb!important;font-weight:700;color:#1a3a6b;width:40px;min-width:40px!important;font-size:.72rem;}
.tt-today-col{background:#fffbeb!important;}
.tt-subj{font-weight:600;color:#111827;font-size:.78rem;}
.tt-meta{font-size:.67rem;color:#6b7280;margin-top:1px;}
.tt-empty{color:#d1d5db;font-size:.72rem;}
.tt-today-badge{display:inline-block;background:#fbbf24;color:#78350f;font-size:.62rem;font-weight:700;padding:0 5px;border-radius:10px;margin-left:4px;}
/* 자동완성 */
#tt-suggest div{padding:6px 12px;font-size:.79rem;cursor:pointer;color:#374151;border-bottom:1px solid #f3f4f6;}
#tt-suggest div:last-child{border-bottom:none;}
#tt-suggest div:hover,.tt-ac-act{background:#eff6ff;color:#1a3a6b;font-weight:600;}
/* 이동 모드 드래그 */
.tt-drag{cursor:pointer!important;}
.tt-drag:hover{background:#dbeafe!important;outline:2px solid #3b82f6;}
.tt-dragging{opacity:.3;}
.tt-dst-empty{background:#f0fdf4!important;outline:2px dashed #22c55e;}
.tt-dst-filled{background:#fef9c3!important;outline:2px dashed #eab308;}
.tt-drop-over{background:#bfdbfe!important;}
/* 시뮬레이션 그리드 */
.sg-wrap{border-collapse:collapse;font-size:.75rem;width:100%;}
.sg-wrap th{background:#1a3a6b;color:#fff;padding:6px 8px;text-align:center;font-weight:600;font-size:.72rem;}
.sg-cell{width:80px;min-width:72px;height:52px;text-align:center;vertical-align:middle;border:1px solid #e5e7eb;cursor:pointer;transition:opacity .12s;padding:4px;}
.sg-cell:hover:not(.sg-blk):not(.sg-inv):not(.sg-cur){opacity:.72;}
.sg-ok {background:#dcfce7;color:#166534;}
.sg-swap{background:#dbeafe;color:#1e40af;}
.sg-neg {background:#fef9c3;color:#854d0e;}
.sg-blk {background:#fee2e2;color:#b91c1c;cursor:default;}
.sg-inv {background:#f3f4f6;color:#9ca3af;cursor:default;}
.sg-cur {background:#eff6ff;color:#1e40af;outline:2px solid #3b82f6;cursor:default;}
.sg-sel {outline:3px solid #1a3a6b!important;}
.sg-icon{font-size:.95rem;display:block;}
.sg-txt{font-size:.62rem;line-height:1.2;margin-top:1px;}
/* 상세 패널 */
.sg-detail-card{background:#f8faff;border:1px solid #e0e7ff;border-radius:10px;padding:12px 15px;}
.sg-detail-card.ok {background:#f0fdf4;border-color:#86efac;}
.sg-detail-card.swap{background:#eff6ff;border-color:#93c5fd;}
.sg-detail-card.neg {background:#fefce8;border-color:#fde047;}
.sg-detail-card.blk {background:#fff1f2;border-color:#fca5a5;}
/* 드롭 모달 */
.dm-ok  {background:linear-gradient(135deg,#166534,#16a34a);}
.dm-swap{background:linear-gradient(135deg,#1e40af,#2563eb);}
.dm-neg {background:linear-gradient(135deg,#92400e,#d97706);}
.dm-blk {background:linear-gradient(135deg,#991b1b,#ef4444);}
.dm-title{color:#fff;font-size:.9rem;font-weight:700;margin:0 0 4px;}
.dm-sub  {color:rgba(255,255,255,.85);font-size:.76rem;}
.dm-row  {display:flex;align-items:flex-start;gap:6px;margin-bottom:9px;font-size:.81rem;line-height:1.5;}
.dm-label{color:#6b7280;white-space:nowrap;width:80px;flex-shrink:0;font-size:.75rem;}
.dm-chip {display:inline-flex;align-items:center;background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;border-radius:20px;padding:2px 9px;font-size:.71rem;font-weight:600;margin:2px;white-space:nowrap;cursor:pointer;}
.dm-chip:hover{background:#0ea5e9;color:#fff;}
.dm-chip.g{background:#dcfce7;color:#166534;border-color:#86efac;}
.dm-chip.g:hover{background:#16a34a;color:#fff;}
.dm-btn{height:30px;padding:0 14px;font-size:.78rem;font-weight:600;font-family:inherit;border:none;border-radius:20px;cursor:pointer;margin-right:6px;}
.dm-btn.p{background:#1a3a6b;color:#fff;}
.dm-btn.s{background:#f3f4f6;color:#374151;}
@media(max-width:640px){.sg-cell{min-width:52px;height:44px;}.sg-icon{font-size:.82rem;}.sg-txt{font-size:.56rem;}.tt-table th,.tt-table td{padding:4px 5px;font-size:.7rem;}}
</style>
"""

# ── JavaScript ──────────────────────────────────────────────
JS = f"""
<script>
(function(){{
  'use strict';
  const TT={TT_JSON};
  const ALI={ALI_JSON};
  const DAYS=['월','화','수','목','금'];
  const P=7;
  const NO7=[2]; // 수요일 7교시 없음

  function R(n){{return ALI[n]||n;}}
  function todayIdx(){{const d=new Date().getDay();return d>=1&&d<=5?d-1:-1;}}
  function validSlot(d,p){{return!(NO7.includes(d)&&p===6);}}

  /* ── 타입 전환 ─────────────────────────── */
  window.ttTypeChange=function(){{
    const t=document.getElementById('tt-type').value;
    document.getElementById('tt-teacher-wrap').style.display=t==='teacher'?'':'none';
    document.getElementById('tt-class-select').style.display=t==='class'?'':'none';
    document.getElementById('tt-input').value='';
    document.getElementById('tt-suggest').style.display='none';
  }};

  /* ── 자동완성 ──────────────────────────── */
  const TL={teachers_json};
  window.ttSuggest=function(){{
    const q=document.getElementById('tt-input').value.trim().toLowerCase();
    const box=document.getElementById('tt-suggest');
    if(!q){{box.style.display='none';return;}}
    const m=TL.filter(n=>n.toLowerCase().includes(q)).slice(0,12);
    if(!m.length){{box.style.display='none';return;}}
    box.innerHTML=m.map(n=>`<div onclick="ttSelect('${{n}}')">${{n}}</div>`).join('');
    box.style.display='block';
  }};
  window.ttSelect=function(n){{document.getElementById('tt-input').value=n;document.getElementById('tt-suggest').style.display='none';ttSearch();}};
  let _ki=-1;
  window.ttKeydown=function(e){{
    const box=document.getElementById('tt-suggest'),items=box.querySelectorAll('div');
    if(e.key==='ArrowDown'){{_ki=Math.min(_ki+1,items.length-1);_hl(items);e.preventDefault();}}
    else if(e.key==='ArrowUp'){{_ki=Math.max(_ki-1,-1);_hl(items);e.preventDefault();}}
    else if(e.key==='Enter'){{if(_ki>=0&&items[_ki])items[_ki].click();else ttSearch();_ki=-1;}}
    else if(e.key==='Escape'){{box.style.display='none';_ki=-1;}}
  }};
  function _hl(items){{items.forEach((el,i)=>el.classList.toggle('tt-ac-act',i===_ki));if(_ki>=0&&items[_ki])items[_ki].scrollIntoView({{block:'nearest'}});}}

  function isLoggedIn(){{try{{return!!JSON.parse(localStorage.getItem('dr_sess_v1'));}}catch{{return false;}}}}

  /* ── 검색 ──────────────────────────────── */
  let _name='',_type='';
  window.ttSearch=function(){{
    document.getElementById('tt-suggest').style.display='none';
    const type=document.getElementById('tt-type').value;
    let name='';
    if(type==='teacher'){{
      name=document.getElementById('tt-input').value.trim();
      if(!name){{alert('교사 이름을 입력하세요.');return;}}
      if(!TT.t[name]){{const f=Object.keys(TT.t).find(k=>k.includes(name));if(!f){{alert('교사를 찾을 수 없습니다: '+name);return;}}name=f;document.getElementById('tt-input').value=name;}}
    }}else{{
      name=document.getElementById('tt-class-select').value;
      if(!name){{alert('학반을 선택하세요.');return;}}
    }}
    _name=name;_type=type;_moveMode=false;
    document.getElementById('tt-move-btn').style.display=type==='teacher'?'':'none';
    document.getElementById('tt-move-btn').textContent='🔄 이동 시뮬레이션';
    document.getElementById('tt-move-btn').classList.remove('tt-hdr-active');
    document.getElementById('tt-move-hint').style.display='none';
    document.getElementById('tt-panel-title').textContent=type==='teacher'?'🧑‍🏫 '+name+' 선생님 시간표':'🏫 '+name+' 시간표';
    document.getElementById('tt-panel-sub').textContent='';
    document.getElementById('tt-panel').style.display='block';
    document.getElementById('tt-backdrop').style.display='block';
    ttShowView('today');
  }};
  window.ttClose=function(){{
    document.getElementById('tt-panel').style.display='none';
    document.getElementById('tt-backdrop').style.display='none';
    _moveMode=false;
  }};

  /* ── 뷰 전환 ───────────────────────────── */
  window.ttShowView=function(v){{
    const tv=document.getElementById('tt-today-view'),wv=document.getElementById('tt-week-view');
    const bt=document.getElementById('tt-view-today'),bw=document.getElementById('tt-view-week');
    if(v==='today'){{tv.style.display='';wv.style.display='none';bt.classList.add('tt-hdr-active');bw.classList.remove('tt-hdr-active');_renderToday();}}
    else{{tv.style.display='none';wv.style.display='';bw.classList.add('tt-hdr-active');bt.classList.remove('tt-hdr-active');_renderWeek();}}
  }};

  function _slots(day){{
    if(_type==='teacher')return TT.t[_name]?TT.t[_name][day]:null;
    return TT.c[_name]?TT.c[_name].s[day]:null;
  }}
  function _parseSub(raw){{const[s,m]=(raw||'').split('|');return{{s:s||'',m:m||''}};}}
  function _hasSub(raw){{const{{s}}=_parseSub(raw);return!!(s&&s.trim());}}
  function _isBlock(raw){{return(raw||'').startsWith('│');}}
  // 블록타임(│|▽)이면 이전 교시 raw로 대체, 아니면 그대로 반환
  function _resolveRaw(slots,p){{
    if(!slots)return'';
    const raw=slots[p]||'';
    if(_isBlock(raw)&&p>0)return slots[p-1]||'';
    return raw;
  }}

  /* ── 오늘 시간표 ────────────────────────── */
  function _renderToday(){{
    const di=todayIdx();
    const lbl=document.getElementById('tt-today-day-label'),cnt=document.getElementById('tt-today-content');
    if(di<0){{lbl.textContent='오늘은 주말입니다.';cnt.innerHTML='<p style="color:#6b7280;font-size:.84rem;">전체 주간을 보려면 [📋 전체 주간] 버튼을 클릭하세요.</p>';return;}}
    const now=new Date();
    lbl.innerHTML=`${{now.getMonth()+1}}월 ${{now.getDate()}}일 (${{DAYS[di]}}요일) <span class="tt-today-badge">TODAY</span>`;
    const sl=_slots(DAYS[di]);
    const col=_type==='teacher'?'수업 (담당 학반)':'수업 (담당 교사)';
    let rows='';
    for(let p=0;p<P;p++){{
      if(!validSlot(di,p))continue; // 수 7교시 생략
      const{{s,m}}=_parseSub(_resolveRaw(sl,p));
      rows+=`<tr><td class="tt-period">${{p+1}}교시</td><td>${{s?`<div class="tt-subj">${{s}}</div><div class="tt-meta">${{m}}</div>`:'<span class="tt-empty">—</span>'}}</td></tr>`;
    }}
    cnt.innerHTML=`<div style="overflow-x:auto;"><table class="tt-table"><thead><tr><th>교시</th><th>${{col}}</th></tr></thead><tbody>${{rows}}</tbody></table></div>`;
  }}

  /* ── 전체 주간 ──────────────────────────── */
  function _renderWeek(){{
    const di=todayIdx();
    const cnt=document.getElementById('tt-week-content');
    const col=_type==='teacher'?'학반':'교사';
    let th='<tr><th style="width:38px;">교시</th>'+DAYS.map((d,i)=>`<th${{i===di?' style="background:#2563eb;"':''}}>${{d}}</th>`).join('')+'</tr>';
    let rows='';
    for(let p=0;p<P;p++){{
      const isNoSlot=NO7.every(wd=>p===6&&wd===wd); // 7교시 행에 수요일만 제외
      let row=`<td class="tt-period">${{p+1}}</td>`;
      for(let d=0;d<5;d++){{
        const day=DAYS[d];
        const sl=_slots(day);
        const{{s,m}}=_parseSub(_resolveRaw(sl,p));
        const isT=d===di;
        const inv=!validSlot(d,p);
        const hasCnt=!inv&&!!(s&&s.trim());
        const id=`tt-cell-${{d}}-${{p}}`;
        const moveCls=_moveMode&&hasCnt?' tt-drag':'';
        const dropCls=_moveMode&&!hasCnt&&!inv?' tt-dst-empty':(_moveMode&&hasCnt?' tt-dst-filled':'');
        row+=`<td id="${{id}}" data-day="${{d}}" data-period="${{p}}" class="${{isT?'tt-today-col':''}}${{inv?' tt-empty':''}}${{moveCls}}${{dropCls}}"${{_moveMode&&hasCnt?' draggable="true"':''}}>`;
        if(inv)row+='<span class="tt-empty" style="font-size:.68rem;">—</span>';
        else if(s)row+=`<div class="tt-subj">${{s}}</div><div class="tt-meta">${{m}}</div>`;
        else row+='<span class="tt-empty">—</span>';
        row+='</td>';
      }}
      rows+=`<tr>${{row}}</tr>`;
    }}
    cnt.innerHTML=`<div style="overflow-x:auto;"><table class="tt-table" id="tt-week-tbl"><thead>${{th}}</thead><tbody>${{rows}}</tbody></table></div>`;
    if(_moveMode)_bindDrag();
  }}

  /* ══════════════════════════════════════════
     이동 시뮬레이션 모드
  ══════════════════════════════════════════ */
  let _moveMode=false,_dragSrc=null;

  window.ttToggleMove=function(){{
    _moveMode=!_moveMode;
    const btn=document.getElementById('tt-move-btn');
    btn.classList.toggle('tt-hdr-active',_moveMode);
    btn.textContent=_moveMode?'✕ 시뮬레이션 종료':'🔄 이동 시뮬레이션';
    document.getElementById('tt-move-hint').style.display=_moveMode?'':'none';
    ttShowView('week');
  }};

  function _bindDrag(){{
    const tbl=document.getElementById('tt-week-tbl');
    if(!tbl)return;
    tbl.addEventListener('click',function(e){{
      if(_dragSrc!==null)return;
      const td=e.target.closest('td.tt-drag');
      if(!td)return;
      _showSimGrid(+td.dataset.day,+td.dataset.period);
    }});
    tbl.addEventListener('dragstart',function(e){{
      const td=e.target.closest('td.tt-drag');
      if(!td){{e.preventDefault();return;}}
      _dragSrc={{d:+td.dataset.day,p:+td.dataset.period}};
      td.classList.add('tt-dragging');
      e.dataTransfer.effectAllowed='move';
    }});
    tbl.addEventListener('dragend',function(){{
      document.querySelectorAll('.tt-dragging,.tt-drop-over').forEach(el=>el.classList.remove('tt-dragging','tt-drop-over'));
      setTimeout(()=>{{_dragSrc=null;}},60);
    }});
    tbl.addEventListener('dragover',function(e){{
      const td=e.target.closest('td[data-day]');
      if(!td||!_dragSrc)return;
      e.preventDefault();e.dataTransfer.dropEffect='move';
      document.querySelectorAll('.tt-drop-over').forEach(el=>el.classList.remove('tt-drop-over'));
      if(+td.dataset.day!==_dragSrc.d||+td.dataset.period!==_dragSrc.p)td.classList.add('tt-drop-over');
    }});
    tbl.addEventListener('dragleave',function(e){{
      const td=e.target.closest('td[data-day]');
      if(td)td.classList.remove('tt-drop-over');
    }});
    tbl.addEventListener('drop',function(e){{
      e.preventDefault();
      const td=e.target.closest('td[data-day]');
      if(!td||!_dragSrc)return;
      const dD=+td.dataset.day,dP=+td.dataset.period;
      if(dD===_dragSrc.d&&dP===_dragSrc.p)return;
      _showDropModal(_dragSrc.d,_dragSrc.p,dD,dP);
    }});
  }}

  /* ── 데이터 헬퍼 ────────────────────────── */
  function _teacherFreeAt(tName,day,p){{
    if(!tName||!TT.t[tName])return true;
    return!_hasSub((TT.t[tName][day]||[])[p]);
  }}
  function _classFreeAt(cls,day,p){{
    if(!cls||!TT.c[cls])return true;
    return!_hasSub((TT.c[cls].s[day]||[])[p]);
  }}
  function _classTeacherAt(cls,day,p){{
    if(!cls||!TT.c[cls])return'';
    const raw=(TT.c[cls].s[day]||[])[p]||'';
    const[,t]=raw.split('|');return R(t||'');
  }}
  function _classSubjAt(cls,day,p){{
    if(!cls||!TT.c[cls])return'';
    const raw=(TT.c[cls].s[day]||[])[p]||'';
    const[s]=raw.split('|');return s||'';
  }}

  // Teacher B가 Class X 수업을 옮길 수 있는 시간 (맞교대 가능 시간)
  // 조건: Teacher B 가 비어있음 AND Class X 가 비어있음
  //       (단, Teacher A의 원래 자리(srcD,srcP)는 이동 후 빌 예정이므로 후보 포함)
  function _swapSlots(tB,cls,srcD,srcP,N){{
    const res=[];
    for(let d=0;d<5&&res.length<N;d++){{
      for(let p=0;p<P&&res.length<N;p++){{
        if(!validSlot(d,p))continue;
        if(!_teacherFreeAt(tB,DAYS[d],p))continue;
        // Class X는 비어있거나, 이동 후 빌 자리(srcD,srcP)인 경우 포함
        const clsFree=_classFreeAt(cls,DAYS[d],p)||(d===srcD&&p===srcP);
        if(clsFree)res.push({{d,p,label:DAYS[d]+' '+(p+1)+'교시'}});
      }}
    }}
    return res;
  }}

  /* ══════════════════════════════════════════
     드래그앤드롭 분석 모달
  ══════════════════════════════════════════ */
  function _showDropModal(srcD,srcP,dstD,dstP){{
    if(!validSlot(dstD,dstP)){{alert('수요일 7교시는 수업이 없습니다.');return;}}
    const teacher=_name;
    const srcDay=DAYS[srcD],dstDay=DAYS[dstD];
    const srcRaw=(TT.t[teacher][srcDay]||[])[srcP]||'';
    const dstRaw=(TT.t[teacher][dstDay]||[])[dstP]||'';
    const{{s:srcS,m:srcC}}=_parseSub(_resolveRaw(TT.t[teacher][srcDay]||[],srcP));
    const{{s:dstS,m:dstC}}=_parseSub(_resolveRaw(TT.t[teacher][dstDay]||[],dstP));
    const tFree=!_hasSub(dstRaw);      // 교사 자신이 목적지에 비어있는지
    const cxFree=_classFreeAt(srcC,dstDay,dstP); // 담당 학반이 목적지에 비어있는지

    // 헤더 색상 및 상태 결정
    let status,clsName,hdrCls;
    if(tFree&&cxFree){{status='✅ 즉시 이동 가능';clsName='ok';hdrCls='dm-ok';}}
    else if(!tFree&&cxFree){{status='🔄 맞바꾸기 가능';clsName='swap';hdrCls='dm-swap';}}
    else if(tFree&&!cxFree){{status='💬 학반 협의 필요';clsName='neg';hdrCls='dm-neg';}}
    else{{status='⚠️ 이동 어려움';clsName='blk';hdrCls='dm-blk';}}

    // 헤더
    const hdr=document.getElementById('tt-drop-header');
    hdr.className=hdrCls;hdr.style.borderRadius='14px 14px 0 0';hdr.style.padding='14px 18px';
    hdr.innerHTML=`<p class="dm-title">${{status}}</p>
      <p class="dm-sub">${{srcDay}} ${{srcP+1}}교시 ${{srcS}}${{srcC?' ('+srcC+'반)':''}} → ${{dstDay}} ${{dstP+1}}교시</p>`;

    let body='';

    /* Case 1: 즉시 이동 */
    if(tFree&&cxFree){{
      body+=`<div class="dm-row"><span class="dm-label">이동할 수업</span><strong>${{srcS}}</strong>&nbsp;${{srcC?'('+srcC+'반)':''}}</div>
      <div class="dm-row"><span class="dm-label">목적지</span>${{dstDay}} ${{dstP+1}}교시 — 비어있음</div>
      <div style="margin-top:12px;">
        <button class="dm-btn p" onclick="ttApplyMove('${{srcDay}}',${{srcP}},'${{dstDay}}',${{dstP}})">✅ 이동 확정</button>
        <button class="dm-btn s" onclick="ttDropClose()">취소</button>
      </div>`;
    }}
    /* Case 2: 교사 자신의 다른 수업과 맞바꾸기 */
    else if(!tFree&&cxFree){{
      const cyFree=_classFreeAt(dstC,srcDay,srcP);
      if(cyFree){{
        body+=`<div class="dm-row"><span class="dm-label">이동할 수업</span><strong>${{srcS}}</strong> (${{srcC||'—'}}반)</div>
        <div class="dm-row"><span class="dm-label">현재 수업</span><strong>${{dstS}}</strong> (${{dstC||'—'}}반)</div>
        <div style="background:#eff6ff;border-radius:8px;padding:9px 12px;margin:10px 0;font-size:.79rem;">
          두 수업을 서로 맞바꿉니다.<br>
          <b>${{srcC}}반</b> ${{dstDay}} ${{dstP+1}}교시 ← ${{srcS}}<br>
          <b>${{dstC}}반</b> ${{srcDay}} ${{srcP+1}}교시 ← ${{dstS}}
        </div>
        <div><button class="dm-btn p" onclick="ttApplySwap('${{srcDay}}',${{srcP}},'${{dstDay}}',${{dstP}})">🔄 맞바꾸기 확정</button>
        <button class="dm-btn s" onclick="ttDropClose()">취소</button></div>`;
      }}else{{
        // 맞바꾸기 불가 - 대안 시간 제시
        const alts=[];
        for(let d=0;d<5&&alts.length<5;d++)for(let p=0;p<P&&alts.length<5;p++){{
          if(!validSlot(d,p))continue;
          if(_teacherFreeAt(teacher,DAYS[d],p)&&_classFreeAt(srcC,DAYS[d],p))
            alts.push({{d,p,label:DAYS[d]+' '+(p+1)+'교시'}});
        }}
        body+=`<div class="dm-row"><span class="dm-label">현재 수업</span><strong>${{dstS}}</strong> (${{dstC||'—'}}반) — 맞바꾸기 시 ${{dstC}}반 충돌</div>
        ${{alts.length?'<div style="font-size:.77rem;color:#374151;margin-bottom:5px;">대신 이동 가능한 시간:</div><div>'
          +alts.map(a=>`<span class="dm-chip g" onclick="ttDropClose();_quickMove('${{srcDay}}',${{srcP}},'${{DAYS[a.d]}}',${{a.p}})">${{a.label}}</span>`).join('')+'</div>':
          '<p style="color:#6b7280;font-size:.79rem;">대안 시간이 없습니다.</p>'}}
        <div style="margin-top:10px;"><button class="dm-btn s" onclick="ttDropClose()">닫기</button></div>`;
      }}
    }}
    /* Case 3: 교사 O, 학반 X — 맞교대 협의 */
    else if(tFree&&!cxFree){{
      const bName=_classTeacherAt(srcC,dstDay,dstP);
      const bSubj=_classSubjAt(srcC,dstDay,dstP);
      // Teacher B가 Class X 수업을 옮길 수 있는 시간
      // (Teacher B 비어있음 + Class X 비어있음 or 이동 후 빌 자리)
      const swapSlots=_swapSlots(bName,srcC,srcD,srcP,7);
      body+=`<div class="dm-row"><span class="dm-label">이동할 수업</span><strong>${{srcS}}</strong> (${{srcC}}반)</div>
      <div style="background:#fef9c3;border-radius:8px;padding:9px 12px;margin:8px 0;font-size:.79rem;">
        ⚠️ <b>${{srcC}}반</b> ${{dstDay}} ${{dstP+1}}교시: <b>${{bName||'—'}}</b> 선생님의 <b>${{bSubj}}</b> 수업이 있습니다.
      </div>`;
      if(bName){{
        body+=`<div style="font-size:.77rem;color:#374151;margin-bottom:5px;"><b>${{bName}}</b> 선생님이 해당 수업을 옮길 수 있는 시간:</div>`;
        if(swapSlots.length){{
          body+=`<div>${{swapSlots.map(s=>`<span class="dm-chip">${{s.label}}</span>`).join('')}}</div>`;
        }}else{{
          body+='<p style="color:#6b7280;font-size:.78rem;">공통 빈 시간이 없습니다.</p>';
        }}
      }}
      body+=`<div style="margin-top:10px;"><button class="dm-btn s" onclick="ttDropClose()">닫기</button></div>`;
    }}
    /* Case 4: 양측 충돌 */
    else{{
      body+=`<p style="font-size:.8rem;color:#374151;">교사 스케줄과 학반 스케줄 모두 충돌합니다.</p>
      <div style="margin-top:10px;"><button class="dm-btn s" onclick="ttDropClose()">닫기</button></div>`;
    }}

    document.getElementById('tt-drop-body').innerHTML=body;
    document.getElementById('tt-drop-modal').style.display='flex';
  }}
  window.ttDropClose=function(){{document.getElementById('tt-drop-modal').style.display='none';}};

  window.ttApplyMove=function(srcDay,srcP,dstDay,dstP){{
    TT.t[_name][dstDay][dstP]=TT.t[_name][srcDay][srcP];
    TT.t[_name][srcDay][srcP]='|';
    ttDropClose();_renderWeek();_bindDrag();
  }};
  window.ttApplySwap=function(srcDay,srcP,dstDay,dstP){{
    const tmp=TT.t[_name][srcDay][srcP];
    TT.t[_name][srcDay][srcP]=TT.t[_name][dstDay][dstP];
    TT.t[_name][dstDay][dstP]=tmp;
    ttDropClose();_renderWeek();_bindDrag();
  }};
  window._quickMove=function(srcDay,srcP,dstDay,dstP){{
    TT.t[_name][dstDay][dstP]=TT.t[_name][srcDay][srcP];
    TT.t[_name][srcDay][srcP]='|';
    ttSimClose();ttDropClose();_renderWeek();_bindDrag();
  }};

  /* ══════════════════════════════════════════
     시뮬레이션 그리드 (클릭 시)
  ══════════════════════════════════════════ */
  function _cellType(srcD,srcP,d,p){{
    const teacher=_name;
    const srcDay=DAYS[srcD],dstDay=DAYS[d];
    const srcRaw=(TT.t[teacher][srcDay]||[])[srcP]||'';
    const{{m:srcC}}=_parseSub(srcRaw);

    const dstRaw=(TT.t[teacher][dstDay]||[])[p]||'';
    const tFree=!_hasSub(dstRaw);
    const{{s:dstS,m:dstC}}=_parseSub(_resolveRaw(TT.t[teacher][dstDay]||[],p));
    const cxFree=_classFreeAt(srcC,dstDay,p);

    if(tFree&&cxFree)return{{type:'ok',dstS,dstC,cxFree}};
    if(!tFree&&cxFree){{
      const cyFree=_classFreeAt(dstC,srcDay,srcP);
      return{{type:'swap',dstS,dstC,cyFree}};
    }}
    if(tFree&&!cxFree){{
      const bName=_classTeacherAt(srcC,dstDay,p);
      return{{type:'neg',bName,bSubj:_classSubjAt(srcC,dstDay,p),srcC}};
    }}
    return{{type:'blk'}};
  }}

  function _showSimGrid(srcD,srcP){{
    const teacher=_name;
    const srcDay=DAYS[srcD];
    const srcRaw=(TT.t[teacher][srcDay]||[])[srcP]||'';
    const{{s:srcS,m:srcC}}=_parseSub(srcRaw);

    // 요약 카운트
    let nOk=0,nSwap=0,nNeg=0;
    for(let d=0;d<5;d++)for(let p=0;p<P;p++){{
      if(d===srcD&&p===srcP)continue;
      if(!validSlot(d,p))continue;
      const{{type}}=_cellType(srcD,srcP,d,p);
      if(type==='ok')nOk++;else if(type==='swap')nSwap++;else if(type==='neg')nNeg++;
    }}

    document.getElementById('tt-sim-title').textContent=
      `${{srcDay}} ${{srcP+1}}교시 ${{srcS}}${{srcC?' ('+srcC+'반)':''}} 이동 시뮬레이션`;
    document.getElementById('tt-sim-badges').innerHTML=
      `<span style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);border-radius:12px;padding:2px 10px;font-size:.72rem;">✅ 즉시 ${{nOk}}</span>`+
      `<span style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);border-radius:12px;padding:2px 10px;font-size:.72rem;">🔄 맞바꾸기 ${{nSwap}}</span>`+
      `<span style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);border-radius:12px;padding:2px 10px;font-size:.72rem;">💬 협의 ${{nNeg}}</span>`;

    // 그리드 빌드
    let th='<tr><th style="width:36px;">교시</th>'+DAYS.map(d=>`<th>${{d}}</th>`).join('')+'</tr>';
    let rows='';
    for(let p=0;p<P;p++){{
      let row=`<td style="background:#f0f4fb;font-weight:700;color:#1a3a6b;font-size:.72rem;text-align:center;">${{p+1}}</td>`;
      for(let d=0;d<5;d++){{
        if(d===srcD&&p===srcP){{
          row+=`<td class="sg-cell sg-cur"><span class="sg-icon">📍</span><span class="sg-txt">현재</span></td>`;
          continue;
        }}
        if(!validSlot(d,p)){{
          row+=`<td class="sg-cell sg-inv"><span class="sg-txt">—</span></td>`;
          continue;
        }}
        const ci=_cellType(srcD,srcP,d,p);
        let icon='',cls2='',txt='';
        if(ci.type==='ok'){{icon='✅';cls2='sg-ok';txt='즉시';}}
        else if(ci.type==='swap'){{icon='🔄';cls2='sg-swap';txt=ci.cyFree?'맞바꾸기':'제한';}}
        else if(ci.type==='neg'){{icon='💬';cls2='sg-neg';txt=ci.bName?ci.bName.slice(0,3):'협의';}}
        else{{icon='✕';cls2='sg-blk';txt='불가';}}
        const onclick=ci.type!=='blk'?`onclick="_simCellClick(${{srcD}},${{srcP}},${{d}},${{p}},${{JSON.stringify(ci).replace(/"/g,'&quot;')}})"`:'';
        row+=`<td class="sg-cell ${{cls2}}" ${{onclick}}><span class="sg-icon">${{icon}}</span><span class="sg-txt">${{txt}}</span></td>`;
      }}
      rows+=`<tr>${{row}}</tr>`;
    }}

    const legend='<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;font-size:.72rem;">'
      +'<span><span style="background:#dcfce7;padding:1px 6px;border-radius:4px;">✅</span> 즉시 이동</span>'
      +'<span><span style="background:#dbeafe;padding:1px 6px;border-radius:4px;">🔄</span> 맞바꾸기</span>'
      +'<span><span style="background:#fef9c3;padding:1px 6px;border-radius:4px;">💬</span> 협의 필요</span>'
      +'<span><span style="background:#fee2e2;padding:1px 6px;border-radius:4px;">✕</span> 이동 불가</span>'
      +'</div>';

    document.getElementById('tt-sim-grid-wrap').innerHTML=
      legend+`<table class="sg-wrap"><thead>${{th}}</thead><tbody>${{rows}}</tbody></table>`;
    document.getElementById('tt-sim-detail').innerHTML=
      '<p style="color:#6b7280;font-size:.8rem;text-align:center;margin:8px 0;">셀을 클릭하면 상세 분석이 표시됩니다.</p>';
    document.getElementById('tt-sim-modal').style.display='flex';
  }}

  window._simCellClick=function(srcD,srcP,dstD,dstP,ci){{
    const srcDay=DAYS[srcD],dstDay=DAYS[dstD];
    const srcRaw=(TT.t[_name][srcDay]||[])[srcP]||'';
    const{{s:srcS,m:srcC}}=_parseSub(srcRaw);
    const label=`${{dstDay}} ${{dstP+1}}교시`;

    document.querySelectorAll('.sg-sel').forEach(el=>el.classList.remove('sg-sel'));
    const cell=document.querySelector(`.sg-cell[onclick*="${{dstD}},${{dstP}}"]`);
    if(cell)cell.classList.add('sg-sel');

    let html='',cardCls='';
    if(ci.type==='ok'){{
      cardCls='ok';
      html=`<div class="dm-row"><span class="dm-label">이동 위치</span><strong>${{label}}</strong> — 빈 시간</div>
        <div style="margin-top:10px;">
          <button class="dm-btn p" onclick="ttSimClose();_quickMove('${{srcDay}}',${{srcP}},'${{dstDay}}',${{dstP}})">✅ 이동 확정</button>
        </div>`;
    }}else if(ci.type==='swap'){{
      cardCls='swap';
      html=`<div class="dm-row"><span class="dm-label">교환 수업</span><strong>${{ci.dstS}}</strong> ${{ci.dstC?'('+ci.dstC+'반)':''}}</div>`;
      if(ci.cyFree){{
        html+=`<div style="background:#eff6ff;border-radius:7px;padding:8px 11px;margin:7px 0;font-size:.78rem;">
          ${{srcC||'—'}}반 ${{label}} ← ${{srcS}} / ${{ci.dstC||'—'}}반 ${{srcDay}} ${{srcP+1}}교시 ← ${{ci.dstS}}</div>
          <button class="dm-btn p" onclick="ttSimClose();ttApplySwap('${{srcDay}}',${{srcP}},'${{dstDay}}',${{dstP}})">🔄 맞바꾸기 확정</button>`;
      }}else{{
        html+=`<p style="font-size:.78rem;color:#b45309;">${{ci.dstC}}반의 ${{srcDay}} ${{srcP+1}}교시에 다른 수업이 있어 맞바꾸기 불가</p>`;
      }}
    }}else if(ci.type==='neg'){{
      cardCls='neg';
      const swapSlots=_swapSlots(ci.bName,ci.srcC,srcD,srcP,6);
      html=`<div class="dm-row"><span class="dm-label">충돌</span>${{ci.srcC}}반 ${{label}}: <b>${{ci.bName}}</b> ${{ci.bSubj}}</div>
        <div style="font-size:.76rem;color:#374151;margin-bottom:5px;">${{ci.bName}} 선생님이 해당 수업을 옮길 수 있는 시간:</div>
        ${{swapSlots.length?'<div>'+swapSlots.map(s=>`<span class="dm-chip">${{s.label}}</span>`).join('')+'</div>':
          '<p style="color:#6b7280;font-size:.77rem;">맞교대 가능 시간 없음</p>'}}`;
    }}

    document.getElementById('tt-sim-detail').innerHTML=
      `<div class="sg-detail-card ${{cardCls}}"><div style="font-weight:700;font-size:.82rem;margin-bottom:8px;">${{label}}</div>${{html}}</div>`;
  }};

  window.ttSimClose=function(){{document.getElementById('tt-sim-modal').style.display='none';}};

  /* ── 외부 클릭 자동완성 닫기 ────────────── */
  document.addEventListener('click',function(e){{
    const w=document.getElementById('tt-teacher-wrap');
    if(w&&!w.contains(e.target)){{document.getElementById('tt-suggest').style.display='none';_ki=-1;}}
  }});
}})();
</script>

</body>
</html>
"""

html = html + PANEL + AUTH_JS + JS

with open(HTML_PATH, 'w', encoding='utf-8') as f:
    f.write(html)
print("[완료]", HTML_PATH)
print("     줄수:", html.count('\n'), "/ 크기:", round(len(html)/1024), "KB")
