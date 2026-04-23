"""
index.html에 시간표 검색 기능 삽입
- auth-bar 좌측에 검색 위젯 추가
- 시간표 패널 모달 추가
- CSS + JS (데이터 포함) 추가
"""
import json
import sys
import os

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTML_PATH = os.path.join(BASE, 'output', 'web', 'index.html')
JSON_PATH = os.path.join(BASE, 'output', 'web', '_timetable_compact.json')

# ─── 1. 데이터 로드 ───────────────────────────────────────
with open(JSON_PATH, encoding='utf-8') as f:
    tt_json = f.read()

# ─── 2. HTML 로드 ─────────────────────────────────────────
with open(HTML_PATH, encoding='utf-8') as f:
    html = f.read()

# ─── 3. auth-bar 내부 div 수정 ────────────────────────────
# justify-content:flex-end → space-between, 시간표 검색 위젯 삽입
OLD_AUTH_INNER = '  <div style="max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;height:44px;">'
NEW_AUTH_INNER = '''  <div style="max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;height:44px;">
    <!-- 시간표 검색 위젯 -->
    <div id="tt-search-wrap" style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
      <span style="font-size:0.8rem;font-weight:700;color:#1a3a6b;white-space:nowrap;">🗓 시간표</span>
      <select id="tt-type" onchange="ttTypeChange()" style="height:30px;border:1px solid #d1d5db;border-radius:20px;font-size:0.75rem;padding:0 10px;cursor:pointer;background:#fff;color:#374151;font-family:inherit;outline:none;">
        <option value="teacher">교사별</option>
        <option value="class">학급별</option>
      </select>
      <div style="position:relative;">
        <input id="tt-input" type="text" placeholder="이름 또는 학반..." autocomplete="off"
          oninput="ttSuggest()" onkeydown="ttKeydown(event)"
          style="height:30px;border:1px solid #d1d5db;border-radius:20px;font-size:0.75rem;padding:0 12px;width:150px;font-family:inherit;outline:none;color:#374151;">
        <div id="tt-suggest" style="display:none;position:absolute;top:34px;left:0;z-index:2000;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.13);max-height:220px;overflow-y:auto;width:180px;"></div>
      </div>
      <button onclick="ttSearch()" style="height:30px;padding:0 14px;font-size:0.75rem;font-weight:600;font-family:inherit;background:#1a3a6b;color:#fff;border:none;border-radius:20px;cursor:pointer;white-space:nowrap;">검색</button>
    </div>
    <!-- 우측 인증 영역 -->
    <div style="display:flex;align-items:center;gap:8px;">'''

OLD_AUTH_END = '  </div>\n</div>\n\n<!-- ===== 탭 네비게이션 ====='
NEW_AUTH_END = '''    </div><!-- /auth-right -->
  </div>
</div>

<!-- ===== 탭 네비게이션 ====='''

assert OLD_AUTH_INNER in html, "auth-bar inner div를 찾을 수 없습니다"
assert OLD_AUTH_END in html, "auth-bar 종료 태그를 찾을 수 없습니다"

html = html.replace(OLD_AUTH_INNER, NEW_AUTH_INNER, 1)
html = html.replace(OLD_AUTH_END, NEW_AUTH_END, 1)

# ─── 4. 시간표 패널 모달 삽입 (</body> 직전) ─────────────
TIMETABLE_PANEL = '''
<!-- ===== 시간표 검색 패널 ===== -->
<div id="tt-panel" style="display:none;position:fixed;top:44px;left:0;right:0;z-index:1500;background:#fff;border-bottom:2px solid #1a3a6b;box-shadow:0 8px 32px rgba(0,0,0,0.18);max-height:80vh;overflow-y:auto;">
  <div style="max-width:900px;margin:0 auto;padding:20px 24px;">
    <!-- 패널 헤더 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <h3 id="tt-panel-title" style="margin:0;font-size:1.05rem;color:#1a3a6b;font-weight:700;"></h3>
        <span id="tt-panel-sub" style="font-size:0.8rem;color:#6b7280;"></span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button id="tt-view-today" onclick="ttShowView('today')" style="height:28px;padding:0 12px;font-size:0.75rem;font-weight:600;font-family:inherit;background:#1a3a6b;color:#fff;border:none;border-radius:20px;cursor:pointer;">📅 오늘</button>
        <button id="tt-view-week" onclick="ttShowView('week')" style="height:28px;padding:0 12px;font-size:0.75rem;font-weight:600;font-family:inherit;background:#fff;color:#1a3a6b;border:1px solid #1a3a6b;border-radius:20px;cursor:pointer;">📋 전체 주간</button>
        <button onclick="ttClose()" style="height:28px;width:28px;font-size:1rem;font-family:inherit;background:#f3f4f6;color:#374151;border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
    </div>
    <!-- 오늘 시간표 -->
    <div id="tt-today-view" style="display:block;">
      <div id="tt-today-day-label" style="font-size:0.85rem;font-weight:700;color:#2563eb;margin-bottom:10px;"></div>
      <div id="tt-today-content" style="overflow-x:auto;"></div>
    </div>
    <!-- 주간 시간표 -->
    <div id="tt-week-view" style="display:none;">
      <div id="tt-week-content" style="overflow-x:auto;"></div>
    </div>
  </div>
</div>
<div id="tt-backdrop" onclick="ttClose()" style="display:none;position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,0.15);"></div>

<style>
#tt-suggest div { padding:7px 14px;font-size:0.82rem;cursor:pointer;color:#374151;border-bottom:1px solid #f3f4f6; }
#tt-suggest div:last-child { border-bottom:none; }
#tt-suggest div:hover, #tt-suggest div.tt-active { background:#eff6ff;color:#1a3a6b;font-weight:600; }
.tt-table { width:100%;border-collapse:collapse;font-size:0.82rem; }
.tt-table th { background:#1a3a6b;color:#fff;padding:8px 12px;text-align:center;font-weight:600; }
.tt-table td { padding:8px 12px;border:1px solid #e5e7eb;text-align:center;vertical-align:middle; }
.tt-table tr:nth-child(even) td { background:#f8faff; }
.tt-table td.tt-period { background:#f0f4fb;font-weight:700;color:#1a3a6b;width:50px; }
.tt-table td.tt-today-col { background:#fffbeb; }
.tt-table td.tt-empty { color:#d1d5db; }
.tt-subj { font-weight:600;color:#111827; }
.tt-meta { font-size:0.72rem;color:#6b7280;margin-top:2px; }
.tt-today-badge { display:inline-block;background:#fbbf24;color:#78350f;font-size:0.68rem;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:4px;vertical-align:middle; }
@media (max-width:700px) {
  #tt-search-wrap { gap:4px; }
  #tt-input { width:100px; }
  .tt-table th, .tt-table td { padding:5px 6px;font-size:0.72rem; }
}
</style>
'''

# ─── 5. 시간표 JavaScript 삽입 (</body> 직전) ────────────
TIMETABLE_JS = f'''
<script>
(function(){{
  'use strict';
  const TT_DATA = {tt_json};
  const DAYS = ['월','화','수','목','금'];
  const PERIODS = 7;

  // 오늘 요일 (0=월, 4=금, 주말이면 -1)
  function todayDayIdx() {{
    const d = new Date().getDay(); // 0=일,1=월...6=토
    return (d >= 1 && d <= 5) ? d - 1 : -1;
  }}

  // ── 자동완성 제안 ──
  window.ttTypeChange = function() {{
    document.getElementById('tt-input').value = '';
    document.getElementById('tt-suggest').style.display = 'none';
  }};

  window.ttSuggest = function() {{
    const type = document.getElementById('tt-type').value;
    const q = document.getElementById('tt-input').value.trim().toLowerCase();
    const box = document.getElementById('tt-suggest');
    if (!q) {{ box.style.display='none'; return; }}
    const pool = type === 'teacher' ? Object.keys(TT_DATA.t) : Object.keys(TT_DATA.c);
    const matches = pool.filter(n => n.toLowerCase().includes(q)).slice(0, 15);
    if (!matches.length) {{ box.style.display='none'; return; }}
    box.innerHTML = matches.map(n => `<div onclick="ttSelect('${{n}}')">${{n}}${{type==='class'?' (담임: '+TT_DATA.c[n].h+')':''}}</div>`).join('');
    box.style.display = 'block';
  }};

  window.ttSelect = function(name) {{
    document.getElementById('tt-input').value = name;
    document.getElementById('tt-suggest').style.display = 'none';
    ttSearch();
  }};

  // 키보드 탐색
  let _ttIdx = -1;
  window.ttKeydown = function(e) {{
    const box = document.getElementById('tt-suggest');
    const items = box.querySelectorAll('div');
    if (e.key === 'ArrowDown') {{ _ttIdx = Math.min(_ttIdx+1, items.length-1); ttHighlight(items); e.preventDefault(); }}
    else if (e.key === 'ArrowUp') {{ _ttIdx = Math.max(_ttIdx-1, -1); ttHighlight(items); e.preventDefault(); }}
    else if (e.key === 'Enter') {{
      if (_ttIdx >= 0 && items[_ttIdx]) {{ items[_ttIdx].click(); }}
      else {{ ttSearch(); }}
      _ttIdx = -1;
    }} else if (e.key === 'Escape') {{
      box.style.display='none'; _ttIdx=-1;
    }}
  }};
  function ttHighlight(items) {{
    items.forEach((el,i) => el.classList.toggle('tt-active', i===_ttIdx));
    if (_ttIdx>=0 && items[_ttIdx]) items[_ttIdx].scrollIntoView({{block:'nearest'}});
  }}

  // ── 검색 실행 ──
  let _currentName = '', _currentType = '';
  window.ttSearch = function() {{
    document.getElementById('tt-suggest').style.display='none';
    const type = document.getElementById('tt-type').value;
    const name = document.getElementById('tt-input').value.trim();
    if (!name) {{ alert('이름 또는 학반을 입력하세요.'); return; }}
    const pool = type === 'teacher' ? TT_DATA.t : null;
    if (type === 'teacher' && !TT_DATA.t[name]) {{
      // 부분 일치 시도
      const found = Object.keys(TT_DATA.t).find(k => k.includes(name));
      if (!found) {{ alert('교사를 찾을 수 없습니다: ' + name); return; }}
      document.getElementById('tt-input').value = found;
      _currentName = found;
    }} else if (type === 'class' && !TT_DATA.c[name]) {{
      const found = Object.keys(TT_DATA.c).find(k => k.includes(name));
      if (!found) {{ alert('학반을 찾을 수 없습니다: ' + name); return; }}
      document.getElementById('tt-input').value = found;
      _currentName = found;
    }} else {{
      _currentName = name;
    }}
    _currentType = type;
    ttOpenPanel();
  }};

  function ttOpenPanel() {{
    const panel = document.getElementById('tt-panel');
    const backdrop = document.getElementById('tt-backdrop');
    // 제목
    if (_currentType === 'teacher') {{
      document.getElementById('tt-panel-title').textContent = '🧑‍🏫 ' + _currentName + ' 선생님 시간표';
      document.getElementById('tt-panel-sub').textContent = '';
    }} else {{
      const info = TT_DATA.c[_currentName];
      document.getElementById('tt-panel-title').textContent = '🏫 ' + _currentName + ' 시간표';
      document.getElementById('tt-panel-sub').textContent = info ? '담임: ' + info.h : '';
    }}
    panel.style.display = 'block';
    backdrop.style.display = 'block';
    ttShowView('today');
  }};

  window.ttClose = function() {{
    document.getElementById('tt-panel').style.display = 'none';
    document.getElementById('tt-backdrop').style.display = 'none';
  }};

  window.ttShowView = function(view) {{
    const todayV = document.getElementById('tt-today-view');
    const weekV  = document.getElementById('tt-week-view');
    const btnToday = document.getElementById('tt-view-today');
    const btnWeek  = document.getElementById('tt-view-week');
    if (view === 'today') {{
      todayV.style.display='block'; weekV.style.display='none';
      btnToday.style.background='#1a3a6b'; btnToday.style.color='#fff'; btnToday.style.border='none';
      btnWeek.style.background='#fff'; btnWeek.style.color='#1a3a6b'; btnWeek.style.border='1px solid #1a3a6b';
      renderToday();
    }} else {{
      todayV.style.display='none'; weekV.style.display='block';
      btnWeek.style.background='#1a3a6b'; btnWeek.style.color='#fff'; btnWeek.style.border='none';
      btnToday.style.background='#fff'; btnToday.style.color='#1a3a6b'; btnToday.style.border='1px solid #1a3a6b';
      renderWeek();
    }}
  }};

  // ── 오늘 시간표 렌더링 ──
  function renderToday() {{
    const di = todayDayIdx();
    const dayName = di >= 0 ? DAYS[di] : null;
    const label = document.getElementById('tt-today-day-label');
    const content = document.getElementById('tt-today-content');

    if (!dayName) {{
      label.textContent = '오늘은 주말입니다.';
      content.innerHTML = '<p style="color:#6b7280;font-size:0.9rem;">평일 시간표를 보려면 [📋 전체 주간] 버튼을 클릭하세요.</p>';
      return;
    }}

    const today = new Date();
    label.innerHTML = `${{today.getMonth()+1}}월 ${{today.getDate()}}일 (${{dayName}}요일) <span class="tt-today-badge">TODAY</span>`;

    const slots = getSlots(dayName);
    if (!slots) {{ content.innerHTML='<p style="color:#6b7280">시간표 데이터 없음</p>'; return; }}

    let rows = '';
    for (let p = 0; p < PERIODS; p++) {{
      const s = slots[p] || '';
      const [subj, meta] = s.split('|');
      rows += `<tr>
        <td class="tt-period">${{p+1}}교시</td>
        <td>${{subj ? `<div class="tt-subj">${{subj}}</div><div class="tt-meta">${{meta||''}}</div>` : '<span class="tt-empty">-</span>'}}</td>
      </tr>`;
    }}
    content.innerHTML = `<table class="tt-table"><thead><tr><th>교시</th><th>${{_currentType==='teacher'?'수업 내용 (담당 학반)':'수업 내용 (담당 교사)'}}</th></tr></thead><tbody>${{rows}}</tbody></table>`;
  }}

  // ── 전체 주간 시간표 렌더링 ──
  function renderWeek() {{
    const content = document.getElementById('tt-week-content');
    const di = todayDayIdx();

    let header = '<tr><th>교시</th>' + DAYS.map((d,i) => `<th${{i===di?' style="background:#2563eb;"':''}}>${{d}}</th>`).join('') + '</tr>';
    let rows = '';
    for (let p = 0; p < PERIODS; p++) {{
      let row = `<td class="tt-period">${{p+1}}</td>`;
      for (let d = 0; d < 5; d++) {{
        const day = DAYS[d];
        const slots = getSlots(day);
        const s = slots ? (slots[p]||'') : '';
        const [subj, meta] = s.split('|');
        const isToday = d === di;
        row += `<td class="${{isToday?'tt-today-col':''}}">${{subj?`<div class="tt-subj">${{subj}}</div><div class="tt-meta">${{meta||''}}</div>`:'<span class="tt-empty">-</span>'}}</td>`;
      }}
      rows += `<tr>${{row}}</tr>`;
    }}
    content.innerHTML = `<table class="tt-table"><thead>${{header}}</thead><tbody>${{rows}}</tbody></table>`;
  }}

  function getSlots(day) {{
    if (_currentType === 'teacher') {{
      return TT_DATA.t[_currentName] ? TT_DATA.t[_currentName][day] : null;
    }} else {{
      return TT_DATA.c[_currentName] ? TT_DATA.c[_currentName].s[day] : null;
    }}
  }}

  // 외부 클릭 시 자동완성 닫기
  document.addEventListener('click', function(e) {{
    if (!document.getElementById('tt-input').contains(e.target)) {{
      document.getElementById('tt-suggest').style.display='none';
      _ttIdx=-1;
    }}
  }});
}})();
</script>
'''

# </body> 직전에 삽입
assert '</body>' in html, "</body> 태그를 찾을 수 없습니다"
html = html.replace('</body>', TIMETABLE_PANEL + TIMETABLE_JS + '\n</body>', 1)

# ─── 6. 저장 ──────────────────────────────────────────────
with open(HTML_PATH, 'w', encoding='utf-8') as f:
    f.write(html)

print("✅ 시간표 기능 삽입 완료:", HTML_PATH)
print("   줄 수:", html.count('\\n'))
