"""
시간표 기능 전면 재구성 스크립트
- 학급별 검색: select 드롭다운으로 변경 (담임 표시 삭제)
- 로그인 후 검색 활성화
- 교사 시간표 이동 모드 (드래그앤드롭 + 충돌 분석)
"""
import json, sys, os, re
sys.stdout.reconfigure(encoding='utf-8')

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTML_PATH = os.path.join(BASE, 'output', 'web', 'index.html')
JSON_PATH = os.path.join(BASE, 'output', 'web', '_timetable_compact.json')

with open(JSON_PATH, encoding='utf-8') as f:
    raw = json.load(f)

TT_JSON = json.dumps(raw, ensure_ascii=False, separators=(',', ':'))

# 교사 약어→정식 이름 매핑 (학반 시간표의 약어 vs 교사 시간표의 정식명)
ALIAS_MAP = {}
for full_name in raw['t'].keys():
    # 성(1자) + 이름첫글자(1자) + 접미(A/B/C 등) 패턴 처리
    # 예: 김기철A → 김기A / 최유리B → 최유B
    if len(full_name) >= 3:
        prefix = full_name[:2] + full_name[-1] if full_name[-1].isalpha() and not full_name[-1].isalnum() is False and full_name[-1] in 'ABCDEFGHIJ' else full_name[:2]
        # 실제 약어 추측: 성(1) + 이름(1) + 접미(1)
        if len(full_name) == 4 and full_name[-1] in 'ABCDEFGHIJ':
            short = full_name[0] + full_name[2] + full_name[3]  # 예: 김기철A → 김기A 아님
        # 직접 매핑이 더 안전
        pass

# 알려진 약어 매핑 (검증 결과에서 발견된 것들)
KNOWN_ALIASES = {
    '김기A': '김기철A',
    '김기B': '김기철B',
    '최유B': '최유리B',
}
ALIAS_JSON = json.dumps(KNOWN_ALIASES, ensure_ascii=False, separators=(',', ':'))

# 정렬된 학반 목록
classes_sorted = sorted(raw['c'].keys(), key=lambda x: (int(x.split('-')[0]), int(x.split('-')[1])))
class_options_html = '\n'.join(
    f'<option value="{c}">{c}</option>' for c in classes_sorted
)

# ── 교사 목록 (자동완성용) ─────────────────────────────────
teachers_json = json.dumps(sorted(raw['t'].keys()), ensure_ascii=False, separators=(',', ':'))

with open(HTML_PATH, encoding='utf-8') as f:
    html = f.read()

# ═══════════════════════════════════════════════════════════
# STEP 1: auth-bar 시간표 위젯 교체
# ═══════════════════════════════════════════════════════════
OLD_WIDGET = '''    <!-- 시간표 검색 위젯 -->
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
    </div>'''

NEW_WIDGET = f'''    <!-- 시간표 검색 위젯 -->
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
{class_options_html}
      </select>
      <button onclick="ttSearch()" style="height:30px;padding:0 14px;font-size:0.75rem;font-weight:600;font-family:inherit;background:#1a3a6b;color:#fff;border:none;border-radius:20px;cursor:pointer;white-space:nowrap;">검색</button>
    </div>'''

assert OLD_WIDGET in html, "시간표 위젯을 찾을 수 없습니다"
html = html.replace(OLD_WIDGET, NEW_WIDGET, 1)
print("[1] 시간표 위젯 교체 완료")

# ═══════════════════════════════════════════════════════════
# STEP 2: 기존 시간표 패널 + CSS + JS 전체 교체
# ═══════════════════════════════════════════════════════════
PANEL_START = '\n<!-- ===== 시간표 검색 패널 ===== -->'
PANEL_END   = '</script>\n\n</body>'

idx_start = html.find(PANEL_START)
idx_end   = html.find(PANEL_END, idx_start)
assert idx_start >= 0, "패널 시작 마커를 찾을 수 없습니다"
assert idx_end   >= 0, "패널 종료 마커를 찾을 수 없습니다"

NEW_TIMETABLE_BLOCK = f'''
<!-- ===== 시간표 검색 패널 ===== -->
<div id="tt-panel" style="display:none;position:fixed;top:44px;left:0;right:0;z-index:1500;background:#fff;border-bottom:2px solid #1a3a6b;box-shadow:0 8px 32px rgba(0,0,0,0.18);max-height:82vh;overflow-y:auto;">
  <div style="max-width:960px;margin:0 auto;padding:18px 24px;">
    <!-- 패널 헤더 -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <h3 id="tt-panel-title" style="margin:0;font-size:1rem;color:#1a3a6b;font-weight:700;"></h3>
        <span id="tt-panel-sub" style="font-size:0.78rem;color:#6b7280;"></span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <button id="tt-view-today" onclick="ttShowView(\'today\')" class="tt-hdr-btn tt-hdr-active">📅 오늘</button>
        <button id="tt-view-week"  onclick="ttShowView(\'week\')"  class="tt-hdr-btn">📋 전체 주간</button>
        <button id="tt-move-btn"   onclick="ttToggleMove()"       class="tt-hdr-btn" style="display:none;">🔄 이동 모드</button>
        <button onclick="ttClose()" class="tt-hdr-btn tt-close-btn">✕ 닫기</button>
      </div>
    </div>
    <!-- 이동 모드 안내 -->
    <div id="tt-move-hint" style="display:none;background:#fffbeb;border:1px solid #fbbf24;border-radius:8px;padding:9px 14px;margin-bottom:12px;font-size:0.8rem;color:#78350f;">
      🔄 <strong>이동 모드:</strong> 수업 셀을 드래그하여 다른 시간대로 놓으세요.
      비어있는 시간대는 <span style="border:2px dashed #22c55e;padding:0 4px;border-radius:4px;">초록 테두리</span>로 표시됩니다.
    </div>
    <!-- 뷰 영역 -->
    <div id="tt-today-view"><div id="tt-today-day-label" style="font-size:0.82rem;font-weight:700;color:#2563eb;margin-bottom:8px;"></div><div id="tt-today-content" style="overflow-x:auto;"></div></div>
    <div id="tt-week-view" style="display:none;"><div id="tt-week-content" style="overflow-x:auto;"></div></div>
  </div>
</div>
<div id="tt-backdrop" onclick="ttClose()" style="display:none;position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,0.18);"></div>

<!-- ===== 시간표 이동 충돌 분석 모달 ===== -->
<div id="tt-move-modal" style="display:none;position:fixed;inset:0;z-index:3000;align-items:center;justify-content:center;">
  <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);" onclick="ttMoveCancel()"></div>
  <div style="position:relative;background:#fff;border-radius:16px;padding:24px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
    <h3 id="tt-mm-title" style="margin:0 0 16px;font-size:1rem;color:#1a3a6b;"></h3>
    <div id="tt-mm-body" style="font-size:0.85rem;color:#374151;line-height:1.7;"></div>
    <div id="tt-mm-actions" style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap;"></div>
  </div>
</div>

<style>
/* ── 시간표 공통 ── */
.tt-hdr-btn {{height:28px;padding:0 12px;font-size:0.74rem;font-weight:600;font-family:inherit;background:#fff;color:#1a3a6b;border:1px solid #1a3a6b;border-radius:20px;cursor:pointer;white-space:nowrap;}}
.tt-hdr-btn.tt-hdr-active {{background:#1a3a6b;color:#fff;border-color:#1a3a6b;}}
.tt-close-btn {{background:#f3f4f6;color:#374151;border-color:#d1d5db;}}
.tt-table {{width:100%;border-collapse:collapse;font-size:0.8rem;}}
.tt-table th {{background:#1a3a6b;color:#fff;padding:7px 10px;text-align:center;font-weight:600;position:sticky;top:0;z-index:10;}}
.tt-table td {{padding:6px 10px;border:1px solid #e5e7eb;text-align:center;vertical-align:middle;min-width:72px;}}
.tt-table tr:nth-child(even) td {{background:#f8faff;}}
.tt-period {{background:#f0f4fb!important;font-weight:700;color:#1a3a6b;width:44px;min-width:44px!important;font-size:0.75rem;}}
.tt-today-col {{background:#fffbeb!important;}}
.tt-today-col .tt-subj {{color:#b45309;}}
.tt-subj {{font-weight:600;color:#111827;font-size:0.8rem;}}
.tt-meta {{font-size:0.7rem;color:#6b7280;margin-top:1px;}}
.tt-empty {{color:#d1d5db;font-size:0.75rem;}}
.tt-today-badge {{display:inline-block;background:#fbbf24;color:#78350f;font-size:0.65rem;font-weight:700;padding:0 5px;border-radius:10px;margin-left:4px;}}
/* ── 자동완성 ── */
#tt-suggest div {{padding:6px 13px;font-size:0.8rem;cursor:pointer;color:#374151;border-bottom:1px solid #f3f4f6;}}
#tt-suggest div:last-child {{border-bottom:none;}}
#tt-suggest div:hover,.tt-active {{background:#eff6ff;color:#1a3a6b;font-weight:600;}}
/* ── 이동 모드 드래그 ── */
.tt-draggable {{cursor:grab;transition:opacity 0.15s;}}
.tt-draggable:hover {{background:#dbeafe!important;}}
.tt-dragging {{opacity:0.4;cursor:grabbing;}}
.tt-drop-ok {{background:#dcfce7!important;outline:2px dashed #22c55e;}}
.tt-drop-conflict {{background:#fef3c7!important;outline:2px dashed #f59e0b;}}
.tt-drop-over {{background:#bfdbfe!important;}}
/* ── 모달 버튼 ── */
.tt-mm-btn {{padding:8px 18px;border:none;border-radius:20px;font-size:0.82rem;font-weight:600;font-family:inherit;cursor:pointer;}}
.tt-mm-btn.primary {{background:#1a3a6b;color:#fff;}}
.tt-mm-btn.secondary {{background:#f3f4f6;color:#374151;}}
.tt-mm-btn.warning {{background:#ef4444;color:#fff;}}
@media (max-width:700px) {{
  #tt-search-wrap {{gap:3px;}}
  #tt-input {{width:90px;}}
  .tt-table th,.tt-table td {{padding:4px 5px;font-size:0.7rem;min-width:54px;}}
  .tt-period {{min-width:36px!important;}}
}}
</style>

<script>
/* ═══ 시간표 검색 & 이동 기능 ═══ */
(function(){{
  'use strict';
  const TT  = {TT_JSON};
  const ALI = {ALIAS_JSON};   // 학반 시간표 약어 → 교사 정식명
  const DAYS = ['월','화','수','목','금'];
  const P = 7;  // 교시 수

  // ── 이름 정규화 ──────────────────────────────────────────
  function resolveName(n) {{ return ALI[n] || n; }}

  // ── 오늘 요일 인덱스 (0=월, 4=금, 주말=-1) ───────────────
  function todayIdx() {{
    const d = new Date().getDay();
    return (d>=1&&d<=5) ? d-1 : -1;
  }}

  // ── 타입 전환 ─────────────────────────────────────────────
  window.ttTypeChange = function() {{
    const t = document.getElementById('tt-type').value;
    document.getElementById('tt-teacher-wrap').style.display = t==='teacher' ? '' : 'none';
    document.getElementById('tt-class-select').style.display = t==='class'   ? '' : 'none';
    document.getElementById('tt-input').value = '';
    document.getElementById('tt-suggest').style.display = 'none';
  }};

  // ── 자동완성 ─────────────────────────────────────────────
  window.ttSuggest = function() {{
    const q = document.getElementById('tt-input').value.trim().toLowerCase();
    const box = document.getElementById('tt-suggest');
    if (!q) {{ box.style.display='none'; return; }}
    const matches = {teachers_json}.filter(n=>n.toLowerCase().includes(q)).slice(0,12);
    if (!matches.length) {{ box.style.display='none'; return; }}
    box.innerHTML = matches.map(n=>`<div onclick="ttSelect('${{n}}')">${{n}}</div>`).join('');
    box.style.display='block';
  }};
  window.ttSelect = function(n) {{
    document.getElementById('tt-input').value=n;
    document.getElementById('tt-suggest').style.display='none';
    ttSearch();
  }};
  let _ki=-1;
  window.ttKeydown = function(e) {{
    const box=document.getElementById('tt-suggest');
    const items=box.querySelectorAll('div');
    if(e.key==='ArrowDown'){{_ki=Math.min(_ki+1,items.length-1);_hl(items);e.preventDefault();}}
    else if(e.key==='ArrowUp'){{_ki=Math.max(_ki-1,-1);_hl(items);e.preventDefault();}}
    else if(e.key==='Enter'){{ if(_ki>=0&&items[_ki]) items[_ki].click(); else ttSearch(); _ki=-1; }}
    else if(e.key==='Escape'){{ box.style.display='none';_ki=-1; }}
  }};
  function _hl(items){{ items.forEach((el,i)=>el.classList.toggle('tt-active',i===_ki)); if(_ki>=0&&items[_ki]) items[_ki].scrollIntoView({{block:'nearest'}}); }}

  // ── 로그인 체크 ──────────────────────────────────────────
  function isLoggedIn() {{
    const b = document.getElementById('user-badge');
    return b && (b.style.display==='flex'||b.style.display==='inline-flex'||b.style.display==='block'||b.offsetParent!==null);
  }}

  // ── 검색 ─────────────────────────────────────────────────
  let _name='', _type='';
  window.ttSearch = function() {{
    document.getElementById('tt-suggest').style.display='none';
    if(!isLoggedIn()) {{
      alert('시간표 검색은 로그인 후 이용 가능합니다.\\n우측 상단에서 Google 로그인하세요.');
      return;
    }}
    const type = document.getElementById('tt-type').value;
    let name = '';
    if(type==='teacher') {{
      name = document.getElementById('tt-input').value.trim();
      if(!name) {{ alert('교사 이름을 입력하세요.'); return; }}
      if(!TT.t[name]) {{
        const f=Object.keys(TT.t).find(k=>k.includes(name));
        if(!f){{ alert('교사를 찾을 수 없습니다: '+name); return; }}
        name=f; document.getElementById('tt-input').value=name;
      }}
    }} else {{
      name = document.getElementById('tt-class-select').value;
      if(!name) {{ alert('학반을 선택하세요.'); return; }}
    }}
    _name=name; _type=type;
    _moveMode=false;
    _openPanel();
  }};

  function _openPanel() {{
    const isTeacher = _type==='teacher';
    document.getElementById('tt-panel-title').textContent =
      isTeacher ? '🧑‍🏫 '+_name+' 선생님 시간표' : '🏫 '+_name+' 시간표';
    document.getElementById('tt-panel-sub').textContent = '';
    document.getElementById('tt-move-btn').style.display = isTeacher ? '' : 'none';
    document.getElementById('tt-move-btn').textContent = '🔄 이동 모드';
    document.getElementById('tt-move-btn').classList.remove('tt-hdr-active');
    document.getElementById('tt-move-hint').style.display='none';
    document.getElementById('tt-panel').style.display='block';
    document.getElementById('tt-backdrop').style.display='block';
    ttShowView('today');
  }}

  window.ttClose = function() {{
    document.getElementById('tt-panel').style.display='none';
    document.getElementById('tt-backdrop').style.display='none';
    _moveMode=false;
  }};

  // ── 뷰 전환 ──────────────────────────────────────────────
  window.ttShowView = function(v) {{
    const tv=document.getElementById('tt-today-view');
    const wv=document.getElementById('tt-week-view');
    const bt=document.getElementById('tt-view-today');
    const bw=document.getElementById('tt-view-week');
    if(v==='today') {{
      tv.style.display=''; wv.style.display='none';
      bt.classList.add('tt-hdr-active'); bw.classList.remove('tt-hdr-active');
      _renderToday();
    }} else {{
      tv.style.display='none'; wv.style.display='';
      bw.classList.add('tt-hdr-active'); bt.classList.remove('tt-hdr-active');
      _renderWeek();
    }}
  }};

  // ── 오늘 시간표 ──────────────────────────────────────────
  function _renderToday() {{
    const di=todayIdx();
    const lbl=document.getElementById('tt-today-day-label');
    const cnt=document.getElementById('tt-today-content');
    if(di<0) {{
      lbl.textContent='오늘은 주말입니다.';
      cnt.innerHTML='<p style="color:#6b7280;font-size:0.85rem;">전체 주간을 보려면 [📋 전체 주간] 버튼을 클릭하세요.</p>';
      return;
    }}
    const now=new Date();
    lbl.innerHTML=`${{now.getMonth()+1}}월 ${{now.getDate()}}일 (${{DAYS[di]}}요일) <span class="tt-today-badge">TODAY</span>`;
    const col = _type==='teacher' ? '수업(담당 학반)' : '수업(담당 교사)';
    const slots=_getSlots(DAYS[di]);
    let rows='';
    for(let p=0;p<P;p++) {{
      const s=slots?slots[p]:'';
      const [sub,meta]=s.split('|');
      rows+=`<tr><td class="tt-period">${{p+1}}교시</td><td>${{sub?`<div class="tt-subj">${{sub}}</div><div class="tt-meta">${{meta||''}}</div>`:'<span class="tt-empty">—</span>'}}</td></tr>`;
    }}
    cnt.innerHTML=`<table class="tt-table"><thead><tr><th>교시</th><th>${{col}}</th></tr></thead><tbody>${{rows}}</tbody></table>`;
  }}

  // ── 전체 주간 시간표 ─────────────────────────────────────
  function _renderWeek() {{
    const di=todayIdx();
    const cnt=document.getElementById('tt-week-content');
    const col = _type==='teacher' ? '담당 학반' : '담당 교사';
    let th='<tr><th style="width:44px;">교시</th>'+DAYS.map((d,i)=>`<th${{i===di?' style="background:#2563eb;"':''}}>${{d}}</th>`).join('')+'</tr>';
    let rows='';
    for(let p=0;p<P;p++) {{
      let row=`<td class="tt-period">${{p+1}}</td>`;
      for(let d=0;d<5;d++) {{
        const day=DAYS[d];
        const slots=_getSlots(day);
        const s=slots?slots[p]:'';
        const [sub,meta]=s.split('|');
        const isT=d===di;
        const hasContent=!!(sub&&sub.trim()&&sub.trim()!=='');
        const id=`tt-cell-${{d}}-${{p}}`;
        const drag=_moveMode&&hasContent?' draggable="true" class="tt-draggable"':'';
        const dropzone=_moveMode&&!hasContent?' class="tt-drop-ok"':'';
        const dropconflict=_moveMode&&hasContent&&_moveMode?' class="tt-drop-conflict"':'';
        row+=`<td id="${{id}}" data-day="${{d}}" data-period="${{p}}"${{_moveMode?(hasContent?' draggable="true"':''):''}}>`;
        row+=`${{sub?`<div class="tt-subj">${{sub}}</div><div class="tt-meta">${{meta||''}}</div>`:'<span class="tt-empty">—</span>'}}`;
        row+='</td>';
      }}
      rows+=`<tr>${{row}}</tr>`;
    }}
    cnt.innerHTML=`<table class="tt-table" id="tt-week-table"><thead>${{th}}</thead><tbody>${{rows}}</tbody></table>`;
    if(_moveMode) _bindDragEvents();
  }}

  function _getSlots(day) {{
    if(_type==='teacher') return TT.t[_name]?TT.t[_name][day]:null;
    return TT.c[_name]?TT.c[_name].s[day]:null;
  }}

  // ══════════════════════════════════════════════════════════
  // 이동 모드
  // ══════════════════════════════════════════════════════════
  let _moveMode=false;
  let _dragSrc=null;  // {{dayIdx, periodIdx}}

  window.ttToggleMove = function() {{
    _moveMode=!_moveMode;
    const btn=document.getElementById('tt-move-btn');
    btn.classList.toggle('tt-hdr-active',_moveMode);
    btn.textContent=_moveMode?'✕ 이동 모드 종료':'🔄 이동 모드';
    document.getElementById('tt-move-hint').style.display=_moveMode?'':'none';
    // 주간 뷰로 전환
    ttShowView('week');
  }};

  function _bindDragEvents() {{
    const table=document.getElementById('tt-week-table');
    if(!table) return;

    // 셀 스타일 업데이트
    for(let d=0;d<5;d++) for(let p=0;p<P;p++) {{
      const cell=document.getElementById(`tt-cell-${{d}}-${{p}}`);
      if(!cell) continue;
      const slots=_getSlots(DAYS[d]);
      const s=slots?slots[p]:'';
      const [sub]=s.split('|');
      const hasContent=!!(sub&&sub.trim());
      cell.classList.remove('tt-draggable','tt-drop-ok','tt-drop-conflict');
      if(hasContent) {{
        cell.classList.add('tt-draggable');
        cell.setAttribute('draggable','true');
      }} else {{
        cell.classList.add('tt-drop-ok');
        cell.removeAttribute('draggable');
      }}
    }}

    table.addEventListener('dragstart',function(e) {{
      const td=e.target.closest('td[data-day]');
      if(!td||!td.classList.contains('tt-draggable')) {{ e.preventDefault(); return; }}
      _dragSrc={{d:+td.dataset.day, p:+td.dataset.period}};
      td.classList.add('tt-dragging');
      e.dataTransfer.effectAllowed='move';
    }});
    table.addEventListener('dragend',function(e) {{
      document.querySelectorAll('.tt-dragging,.tt-drop-over').forEach(el=>el.classList.remove('tt-dragging','tt-drop-over'));
    }});
    table.addEventListener('dragover',function(e) {{
      const td=e.target.closest('td[data-day]');
      if(!td||!_dragSrc) return;
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      document.querySelectorAll('.tt-drop-over').forEach(el=>el.classList.remove('tt-drop-over'));
      if(td.dataset.day!=_dragSrc.d||td.dataset.period!=_dragSrc.p) td.classList.add('tt-drop-over');
    }});
    table.addEventListener('dragleave',function(e) {{
      const td=e.target.closest('td[data-day]');
      if(td) td.classList.remove('tt-drop-over');
    }});
    table.addEventListener('drop',function(e) {{
      e.preventDefault();
      const td=e.target.closest('td[data-day]');
      if(!td||!_dragSrc) return;
      const dstD=+td.dataset.day, dstP=+td.dataset.period;
      if(dstD===_dragSrc.d&&dstP===_dragSrc.p) return;
      _analyzeMove(_dragSrc.d,_dragSrc.p,dstD,dstP);
    }});
  }}

  // ── 이동 분석 ────────────────────────────────────────────
  function _analyzeMove(srcD,srcP,dstD,dstP) {{
    const teacher = _name;
    const srcDay=DAYS[srcD], dstDay=DAYS[dstD];

    const srcSlots=TT.t[teacher][srcDay]||[];
    const dstSlots=TT.t[teacher][dstDay]||[];
    const srcRaw=srcSlots[srcP]||''; const [srcSub,srcCls]=srcRaw.split('|');
    const dstRaw=dstSlots[dstP]||''; const [dstSub,dstCls]=dstRaw.split('|');

    // 이동할 학반이 목적지 시간에 다른 수업이 있는지
    let clsConflict='';  // "과목|교사"
    let teacherBName='';
    let teacherBFree=[];
    if(srcCls&&TT.c[srcCls]) {{
      const clsSlot=(TT.c[srcCls].s[dstDay]||[])[dstP]||'';
      if(clsSlot) {{
        const [cs,ct]=clsSlot.split('|');
        if(cs&&cs.trim()) {{
          clsConflict=clsSlot;
          teacherBName=resolveName(ct||'');
          if(teacherBName&&TT.t[teacherBName]) {{
            DAYS.forEach((day,di)=>{{
              (TT.t[teacherBName][day]||[]).forEach((slot,pi)=>{{
                const [s]=slot.split('|');
                if(!s||!s.trim()) teacherBFree.push(`${{day}} ${{pi+1}}교시`);
              }});
            }});
          }}
        }}
      }}
    }}

    // 교사 자신의 목적지 충돌
    const selfConflict=!!(dstSub&&dstSub.trim());

    _showMoveModal({{
      teacher,srcDay,srcP:srcP+1,srcSub,srcCls,
      dstDay,dstP:dstP+1,dstSub,dstCls,
      selfConflict,clsConflict,teacherBName,teacherBFree,
      srcD,srcP_idx:srcP,dstD,dstP_idx:dstP
    }});
  }}

  // ── 이동 모달 표시 ───────────────────────────────────────
  function _showMoveModal(info) {{
    const m=document.getElementById('tt-move-modal');
    const title=document.getElementById('tt-mm-title');
    const body=document.getElementById('tt-mm-body');
    const actions=document.getElementById('tt-mm-actions');

    title.textContent=`시간표 이동 검토: ${{info.srcDay}} ${{info.srcP}}교시 → ${{info.dstDay}} ${{info.dstP}}교시`;

    let html=`<div style="background:#f0f4fb;border-radius:8px;padding:10px 14px;margin-bottom:12px;">`;
    html+=`<div>📌 <strong>이동할 수업:</strong> ${{info.srcSub||'(과목명 없음)'}} ${{info.srcCls?'('+info.srcCls+'반)':''}}</div>`;
    html+=`<div>📍 <strong>이동할 위치:</strong> ${{info.dstDay}} ${{info.dstP}}교시</div></div>`;

    if(info.selfConflict) {{
      html+=`<div style="background:#fef3c7;border-radius:8px;padding:10px 14px;margin-bottom:10px;">⚠️ <strong>${{info.teacher}} 선생님</strong>의 ${{info.dstDay}} ${{info.dstP}}교시에 이미 수업이 있습니다.<br>`;
      html+=`&nbsp;&nbsp;→ ${{info.dstSub}} ${{info.dstCls?'('+info.dstCls+'반)':''}}</div>`;
    }}

    if(info.clsConflict) {{
      const [cs,ct]=info.clsConflict.split('|');
      html+=`<div style="background:#fee2e2;border-radius:8px;padding:10px 14px;margin-bottom:10px;">⛔ <strong>${{info.srcCls}}반</strong>의 ${{info.dstDay}} ${{info.dstP}}교시에 다른 수업이 있습니다.<br>`;
      html+=`&nbsp;&nbsp;→ 과목: <strong>${{cs}}</strong>, 담당: <strong>${{info.teacherBName||ct}}</strong></div>`;
      if(info.teacherBFree.length) {{
        html+=`<div style="background:#f0fdf4;border-radius:8px;padding:10px 14px;margin-bottom:10px;">`;
        html+=`✅ <strong>${{info.teacherBName}}</strong> 선생님의 이동 가능 시간대:<br>`;
        html+=`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">`;
        html+=info.teacherBFree.map(t=>`<span style="background:#dcfce7;border:1px solid #86efac;border-radius:12px;padding:2px 9px;font-size:0.75rem;font-weight:600;">${{t}}</span>`).join('');
        html+='</div></div>';
      }} else if(info.teacherBName) {{
        html+=`<div style="background:#fef3c7;border-radius:8px;padding:8px 14px;margin-bottom:10px;">⚠️ ${{info.teacherBName}} 선생님의 빈 시간이 없습니다.</div>`;
      }}
    }}

    if(!info.selfConflict&&!info.clsConflict) {{
      html+=`<div style="background:#f0fdf4;border-radius:8px;padding:10px 14px;margin-bottom:10px;">✅ 충돌 없이 이동 가능합니다.</div>`;
    }}

    body.innerHTML=html;

    // 버튼
    let btns='';
    if(!info.selfConflict&&!info.clsConflict) {{
      btns+=`<button class="tt-mm-btn primary" onclick="ttMoveConfirm(${{JSON.stringify(info)}})">✅ 이동 확정</button>`;
    }} else if(!info.selfConflict&&info.clsConflict) {{
      btns+=`<button class="tt-mm-btn warning" onclick="ttMoveConfirm(${{JSON.stringify(info)}})">⚠️ 강제 이동</button>`;
      btns+=`<button class="tt-mm-btn secondary" onclick="ttMoveBogang(${{JSON.stringify(info)}})">📝 보강으로 처리</button>`;
    }}
    btns+=`<button class="tt-mm-btn secondary" onclick="ttMoveCancel()">취소</button>`;
    actions.innerHTML=btns;

    m.style.display='flex';
  }}

  window.ttMoveCancel=function(){{
    document.getElementById('tt-move-modal').style.display='none';
  }};

  window.ttMoveConfirm=function(info){{
    document.getElementById('tt-move-modal').style.display='none';
    // 시각적 업데이트 (실제 서버 저장은 없음 — 화면 내 임시 적용)
    const teacherData=TT.t[_name];
    const srcDay=DAYS[info.srcD], dstDay=DAYS[info.dstD];
    const tmp=teacherData[srcDay][info.srcP_idx];
    teacherData[srcDay][info.srcP_idx]=teacherData[dstDay][info.dstP_idx];
    teacherData[dstDay][info.dstP_idx]=tmp;
    _renderWeek();
    _bindDragEvents();
    // 안내
    setTimeout(()=>alert(`✅ 시간표 이동이 화면에 적용되었습니다.\\n${{info.srcDay}} ${{info.srcP}}교시 ↔ ${{info.dstDay}} ${{info.dstP}}교시\\n(새로고침하면 원래 시간표로 복원됩니다)`),100);
  }};

  window.ttMoveBogang=function(info){{
    document.getElementById('tt-move-modal').style.display='none';
    alert(`📝 보강 처리 안내\\n\\n${{info.srcSub}} (${{info.srcCls}}반) 수업을 ${{info.dstDay}} ${{info.dstP}}교시로 보강 처리합니다.\\n${{info.dstDay}} ${{info.dstP}}교시의 기존 수업(${{info.dstSub||'—'}})은 유지됩니다.\\n\\n실제 보강은 학교 시간표 관리 시스템에서 처리하세요.`);
  }};

  // ── 외부 클릭 자동완성 닫기 ─────────────────────────────
  document.addEventListener('click',function(e){{
    const wrap=document.getElementById('tt-teacher-wrap');
    if(wrap&&!wrap.contains(e.target)) {{
      document.getElementById('tt-suggest').style.display='none';
      _ki=-1;
    }}
  }});
}})();
</script>
'''

html = html[:idx_start] + NEW_TIMETABLE_BLOCK + '\n</body>'
print("[2] 패널 + CSS + JS 전체 교체 완료")

# ─── 저장 ─────────────────────────────────────────────────
with open(HTML_PATH, 'w', encoding='utf-8') as f:
    f.write(html)
print("[완료] 저장:", HTML_PATH)
print("      줄 수:", html.count('\n'))
print("      크기:", round(len(html)/1024), "KB")
