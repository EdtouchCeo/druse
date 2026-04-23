"""
시간표 이동 시뮬레이션 전면 재설계
- 셀 클릭 → 해당 수업의 모든 이동 경우의 수 분류 및 제시
- 드래그앤드롭 → 특정 목적지 상세 분석 + 대안 제시
- 4단계 경우의 수: 즉시이동 / 맞바꾸기 / 협의필요 / 복합충돌
"""
import json, sys, os
sys.stdout.reconfigure(encoding='utf-8')

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTML_PATH = os.path.join(BASE, 'output', 'web', 'index.html')
JSON_PATH = os.path.join(BASE, 'output', 'web', '_timetable_compact.json')

with open(JSON_PATH, encoding='utf-8') as f:
    raw = json.load(f)
TT_JSON = json.dumps(raw, ensure_ascii=False, separators=(',', ':'))

KNOWN_ALIASES = {'김기A': '김기철A', '김기B': '김기철B', '최유B': '최유리B'}
ALIAS_JSON = json.dumps(KNOWN_ALIASES, ensure_ascii=False, separators=(',', ':'))

classes_sorted = sorted(raw['c'].keys(), key=lambda x: (int(x.split('-')[0]), int(x.split('-')[1])))
class_options_html = '\n'.join(f'        <option value="{c}">{c}</option>' for c in classes_sorted)
teachers_json = json.dumps(sorted(raw['t'].keys()), ensure_ascii=False, separators=(',', ':'))

with open(HTML_PATH, encoding='utf-8') as f:
    html = f.read()

# ── 시간표 패널 이하 전체 교체 ─────────────────────────────
PANEL_MARKER = '\n<!-- ===== 시간표 검색 패널 ===== -->'
idx = html.find(PANEL_MARKER)
assert idx >= 0, "패널 마커를 찾을 수 없음"
html = html[:idx]   # 패널 이전 부분만 유지

NEW_BLOCK = r"""
<!-- ===== 시간표 검색 패널 ===== -->
<div id="tt-panel" style="display:none;position:fixed;top:44px;left:0;right:0;z-index:1500;background:#fff;border-bottom:2px solid #1a3a6b;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-height:82vh;overflow-y:auto;">
  <div style="max-width:980px;margin:0 auto;padding:16px 24px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <h3 id="tt-panel-title" style="margin:0;font-size:1rem;color:#1a3a6b;font-weight:700;"></h3>
        <span id="tt-panel-sub" style="font-size:0.78rem;color:#6b7280;"></span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <button id="tt-view-today" onclick="ttShowView('today')" class="tt-hdr-btn tt-hdr-active">📅 오늘</button>
        <button id="tt-view-week"  onclick="ttShowView('week')"  class="tt-hdr-btn">📋 전체 주간</button>
        <button id="tt-move-btn"   onclick="ttToggleMove()"      class="tt-hdr-btn" style="display:none;">🔄 이동 시뮬레이션</button>
        <button onclick="ttClose()" class="tt-hdr-btn tt-close-btn">✕ 닫기</button>
      </div>
    </div>
    <div id="tt-move-hint" style="display:none;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:0.78rem;color:#1e40af;">
      🖱️ <strong>이동 시뮬레이션 모드:</strong> 수업 셀을 <strong>클릭</strong>하면 이동 가능한 모든 경우의 수를 분석합니다. 셀을 <strong>드래그</strong>하면 특정 목적지와의 비교 분석을 볼 수 있습니다.
    </div>
    <div id="tt-today-view"><div id="tt-today-day-label" style="font-size:0.82rem;font-weight:700;color:#2563eb;margin-bottom:8px;"></div><div id="tt-today-content" style="overflow-x:auto;"></div></div>
    <div id="tt-week-view" style="display:none;"><div id="tt-week-content" style="overflow-x:auto;"></div></div>
  </div>
</div>
<div id="tt-backdrop" onclick="ttClose()" style="display:none;position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,0.18);"></div>

<!-- ===== 시간표 시뮬레이션 모달 ===== -->
<div id="tt-sim-modal" style="display:none;position:fixed;inset:0;z-index:3000;align-items:flex-start;justify-content:center;padding-top:60px;overflow-y:auto;">
  <div style="position:fixed;inset:0;background:rgba(0,0,0,0.45);" onclick="ttSimClose()"></div>
  <div style="position:relative;background:#fff;border-radius:16px;padding:0;max-width:680px;width:94%;max-height:88vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.3);margin-bottom:40px;">
    <div style="background:linear-gradient(135deg,#1a3a6b,#2563eb);color:#fff;padding:18px 22px;border-radius:16px 16px 0 0;position:sticky;top:0;z-index:5;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div><div id="tt-sim-title" style="font-size:0.95rem;font-weight:700;margin-bottom:2px;"></div>
          <div id="tt-sim-subtitle" style="font-size:0.75rem;opacity:0.85;"></div></div>
        <button onclick="ttSimClose()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <div id="tt-sim-summary" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;"></div>
    </div>
    <div id="tt-sim-body" style="padding:18px 22px;"></div>
  </div>
</div>

<style>
.tt-hdr-btn{height:28px;padding:0 12px;font-size:0.74rem;font-weight:600;font-family:inherit;background:#fff;color:#1a3a6b;border:1px solid #1a3a6b;border-radius:20px;cursor:pointer;white-space:nowrap;}
.tt-hdr-btn.tt-hdr-active{background:#1a3a6b;color:#fff;}
.tt-close-btn{background:#f3f4f6;color:#374151;border-color:#d1d5db;}
.tt-table{width:100%;border-collapse:collapse;font-size:0.79rem;}
.tt-table th{background:#1a3a6b;color:#fff;padding:7px 9px;text-align:center;font-weight:600;position:sticky;top:0;z-index:10;}
.tt-table td{padding:6px 9px;border:1px solid #e5e7eb;text-align:center;vertical-align:middle;min-width:68px;}
.tt-table tr:nth-child(even) td{background:#f8faff;}
.tt-period{background:#f0f4fb!important;font-weight:700;color:#1a3a6b;width:42px;min-width:42px!important;font-size:0.73rem;}
.tt-today-col{background:#fffbeb!important;}
.tt-subj{font-weight:600;color:#111827;font-size:0.79rem;}
.tt-meta{font-size:0.68rem;color:#6b7280;margin-top:1px;}
.tt-empty{color:#d1d5db;font-size:0.73rem;}
.tt-today-badge{display:inline-block;background:#fbbf24;color:#78350f;font-size:0.62rem;font-weight:700;padding:0 5px;border-radius:10px;margin-left:4px;}
#tt-suggest div{padding:6px 13px;font-size:0.8rem;cursor:pointer;color:#374151;border-bottom:1px solid #f3f4f6;}
#tt-suggest div:last-child{border-bottom:none;}
#tt-suggest div:hover,.tt-ac-active{background:#eff6ff;color:#1a3a6b;font-weight:600;}
/* 이동 모드 */
.tt-draggable{cursor:pointer;transition:background 0.12s;}
.tt-draggable:hover{background:#dbeafe!important;outline:2px solid #3b82f6;}
.tt-dragging{opacity:0.35;}
.tt-drop-empty{background:#f0fdf4!important;outline:2px dashed #22c55e;}
.tt-drop-conflict{background:#fef9c3!important;outline:2px dashed #eab308;}
.tt-drop-over{background:#bfdbfe!important;}
/* 시뮬레이션 모달 */
.tt-sim-section{margin-bottom:18px;}
.tt-sim-section-hdr{display:flex;align-items:center;gap:8px;padding:9px 13px;border-radius:8px 8px 0 0;font-size:0.83rem;font-weight:700;cursor:pointer;user-select:none;}
.tt-sim-section-body{border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:12px;}
.tt-sim-chip{display:inline-flex;align-items:center;background:#e0f2fe;color:#0369a1;border:1px solid #7dd3fc;border-radius:20px;padding:3px 11px;font-size:0.74rem;font-weight:600;cursor:pointer;margin:3px;white-space:nowrap;transition:all 0.12s;}
.tt-sim-chip:hover{background:#0ea5e9;color:#fff;}
.tt-sim-chip.green{background:#dcfce7;color:#166534;border-color:#86efac;}
.tt-sim-chip.green:hover{background:#16a34a;color:#fff;}
.tt-sim-chip.orange{background:#fef3c7;color:#92400e;border-color:#fcd34d;}
.tt-sim-chip.orange:hover{background:#f59e0b;color:#fff;}
.tt-sim-chip.red{background:#fee2e2;color:#991b1b;border-color:#fca5a5;}
.tt-sim-tbl{width:100%;border-collapse:collapse;font-size:0.77rem;margin-top:6px;}
.tt-sim-tbl th{background:#f3f4f6;padding:5px 8px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;}
.tt-sim-tbl td{padding:5px 8px;border-bottom:1px solid #f3f4f6;vertical-align:top;}
.tt-sim-tbl tr:hover td{background:#f8faff;}
.tt-cnt-badge{display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.35);color:#fff;border-radius:20px;padding:1px 9px;font-size:0.73rem;font-weight:700;margin-left:4px;}
.tt-summary-card{background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:10px;padding:5px 12px;font-size:0.75rem;color:#fff;text-align:center;cursor:pointer;}
.tt-summary-card:hover{background:rgba(255,255,255,0.28);}
.tt-summary-card .n{font-size:1.2rem;font-weight:800;display:block;}
.tt-free-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;}
@media(max-width:700px){#tt-input{width:90px;}.tt-table th,.tt-table td{padding:4px 5px;font-size:0.7rem;min-width:50px;}.tt-period{min-width:34px!important;}}
</style>
"""

# ── JavaScript 블록 ─────────────────────────────────────────
NEW_JS = f"""
<script>
/* ════ 시간표 검색 & 이동 시뮬레이션 ════ */
(function(){{
  'use strict';
  const TT  = {TT_JSON};
  const ALI = {ALIAS_JSON};
  const DAYS=['월','화','수','목','금'];
  const P=7;

  function resolveName(n){{return ALI[n]||n;}}
  function todayIdx(){{const d=new Date().getDay();return(d>=1&&d<=5)?d-1:-1;}}

  /* ── 타입 전환 ─────────────────────────────────────────── */
  window.ttTypeChange=function(){{
    const t=document.getElementById('tt-type').value;
    document.getElementById('tt-teacher-wrap').style.display=t==='teacher'?'':'none';
    document.getElementById('tt-class-select').style.display=t==='class'?'':'none';
    document.getElementById('tt-input').value='';
    document.getElementById('tt-suggest').style.display='none';
  }};

  /* ── 자동완성 ──────────────────────────────────────────── */
  const TEACHERS={teachers_json};
  window.ttSuggest=function(){{
    const q=document.getElementById('tt-input').value.trim().toLowerCase();
    const box=document.getElementById('tt-suggest');
    if(!q){{box.style.display='none';return;}}
    const m=TEACHERS.filter(n=>n.toLowerCase().includes(q)).slice(0,12);
    if(!m.length){{box.style.display='none';return;}}
    box.innerHTML=m.map(n=>`<div onclick="ttSelect('${{n}}')">${{n}}</div>`).join('');
    box.style.display='block';
  }};
  window.ttSelect=function(n){{
    document.getElementById('tt-input').value=n;
    document.getElementById('tt-suggest').style.display='none';
    ttSearch();
  }};
  let _ki=-1;
  window.ttKeydown=function(e){{
    const box=document.getElementById('tt-suggest');
    const items=box.querySelectorAll('div');
    if(e.key==='ArrowDown'){{_ki=Math.min(_ki+1,items.length-1);_hl(items);e.preventDefault();}}
    else if(e.key==='ArrowUp'){{_ki=Math.max(_ki-1,-1);_hl(items);e.preventDefault();}}
    else if(e.key==='Enter'){{if(_ki>=0&&items[_ki])items[_ki].click();else ttSearch();_ki=-1;}}
    else if(e.key==='Escape'){{box.style.display='none';_ki=-1;}}
  }};
  function _hl(items){{items.forEach((el,i)=>el.classList.toggle('tt-ac-active',i===_ki));if(_ki>=0&&items[_ki])items[_ki].scrollIntoView({{block:'nearest'}});}}

  /* ── 로그인 체크 ───────────────────────────────────────── */
  function isLoggedIn(){{
    const b=document.getElementById('user-badge');
    return b&&(b.style.display==='flex'||b.style.display==='inline-flex'||b.style.display==='block');
  }}

  /* ── 검색 실행 ─────────────────────────────────────────── */
  let _name='',_type='';
  window.ttSearch=function(){{
    document.getElementById('tt-suggest').style.display='none';
    if(!isLoggedIn()){{
      alert('시간표 검색은 로그인 후 이용 가능합니다.\\n우측 상단에서 Google 로그인하세요.');
      return;
    }}
    const type=document.getElementById('tt-type').value;
    let name='';
    if(type==='teacher'){{
      name=document.getElementById('tt-input').value.trim();
      if(!name){{alert('교사 이름을 입력하세요.');return;}}
      if(!TT.t[name]){{
        const f=Object.keys(TT.t).find(k=>k.includes(name));
        if(!f){{alert('교사를 찾을 수 없습니다: '+name);return;}}
        name=f;document.getElementById('tt-input').value=name;
      }}
    }}else{{
      name=document.getElementById('tt-class-select').value;
      if(!name){{alert('학반을 선택하세요.');return;}}
    }}
    _name=name;_type=type;_moveMode=false;
    _openPanel();
  }};

  function _openPanel(){{
    const isTch=_type==='teacher';
    document.getElementById('tt-panel-title').textContent=isTch?'🧑‍🏫 '+_name+' 선생님 시간표':'🏫 '+_name+' 시간표';
    document.getElementById('tt-panel-sub').textContent='';
    document.getElementById('tt-move-btn').style.display=isTch?'':'none';
    document.getElementById('tt-move-btn').textContent='🔄 이동 시뮬레이션';
    document.getElementById('tt-move-btn').classList.remove('tt-hdr-active');
    document.getElementById('tt-move-hint').style.display='none';
    document.getElementById('tt-panel').style.display='block';
    document.getElementById('tt-backdrop').style.display='block';
    ttShowView('today');
  }}
  window.ttClose=function(){{
    document.getElementById('tt-panel').style.display='none';
    document.getElementById('tt-backdrop').style.display='none';
    _moveMode=false;
  }};

  /* ── 뷰 전환 ───────────────────────────────────────────── */
  window.ttShowView=function(v){{
    const tv=document.getElementById('tt-today-view');
    const wv=document.getElementById('tt-week-view');
    const bt=document.getElementById('tt-view-today');
    const bw=document.getElementById('tt-view-week');
    if(v==='today'){{tv.style.display='';wv.style.display='none';bt.classList.add('tt-hdr-active');bw.classList.remove('tt-hdr-active');_renderToday();}}
    else{{tv.style.display='none';wv.style.display='';bw.classList.add('tt-hdr-active');bt.classList.remove('tt-hdr-active');_renderWeek();}}
  }};

  /* ── 오늘 시간표 ───────────────────────────────────────── */
  function _renderToday(){{
    const di=todayIdx();
    const lbl=document.getElementById('tt-today-day-label');
    const cnt=document.getElementById('tt-today-content');
    if(di<0){{lbl.textContent='오늘은 주말입니다.';cnt.innerHTML='<p style="color:#6b7280;font-size:0.85rem;">전체 주간을 보려면 [📋 전체 주간] 버튼을 클릭하세요.</p>';return;}}
    const now=new Date();
    lbl.innerHTML=`${{now.getMonth()+1}}월 ${{now.getDate()}}일 (${{DAYS[di]}}요일) <span class="tt-today-badge">TODAY</span>`;
    const slots=_getSlots(DAYS[di]);
    let rows='';
    for(let p=0;p<P;p++){{
      const s=slots?slots[p]:'';
      const [sub,meta]=(s||'').split('|');
      rows+=`<tr><td class="tt-period">${{p+1}}교시</td><td>${{sub&&sub.trim()?`<div class="tt-subj">${{sub}}</div><div class="tt-meta">${{meta||''}}</div>`:'<span class="tt-empty">—</span>'}}</td></tr>`;
    }}
    const col=_type==='teacher'?'수업 (담당 학반)':'수업 (담당 교사)';
    cnt.innerHTML=`<table class="tt-table"><thead><tr><th>교시</th><th>${{col}}</th></tr></thead><tbody>${{rows}}</tbody></table>`;
  }}

  /* ── 전체 주간 ─────────────────────────────────────────── */
  function _renderWeek(){{
    const di=todayIdx();
    const cnt=document.getElementById('tt-week-content');
    let th='<tr><th style="width:42px;">교시</th>'+DAYS.map((d,i)=>`<th${{i===di?' style="background:#2563eb;"':''}}>${{d}}</th>`).join('')+'</tr>';
    let rows='';
    for(let p=0;p<P;p++){{
      let row=`<td class="tt-period">${{p+1}}</td>`;
      for(let d=0;d<5;d++){{
        const day=DAYS[d];
        const slots=_getSlots(day);
        const s=slots?slots[p]:'';
        const [sub,meta]=(s||'').split('|');
        const hasCnt=!!(sub&&sub.trim());
        const isT=d===di;
        const id=`tt-cell-${{d}}-${{p}}`;
        const moveCls=_moveMode?(hasCnt?' tt-draggable':''):'';
        const dropCls=_moveMode&&!hasCnt?' tt-drop-empty':(_moveMode&&hasCnt?' tt-drop-conflict':'');
        const dayAttr=`data-day="${{d}}" data-period="${{p}}"`;
        row+=`<td id="${{id}}" ${{dayAttr}} class="${{isT?'tt-today-col':''}}${{moveCls}}${{dropCls}}" ${{_moveMode&&hasCnt?'draggable="true"':''}}>`;
        row+=hasCnt?`<div class="tt-subj">${{sub}}</div><div class="tt-meta">${{meta||''}}</div>`:'<span class="tt-empty">—</span>';
        row+='</td>';
      }}
      rows+=`<tr>${{row}}</tr>`;
    }}
    cnt.innerHTML=`<table class="tt-table" id="tt-week-tbl"><thead>${{th}}</thead><tbody>${{rows}}</tbody></table>`;
    if(_moveMode)_bindDrag();
  }}

  function _getSlots(day){{
    if(_type==='teacher')return TT.t[_name]?TT.t[_name][day]:null;
    return TT.c[_name]?TT.c[_name].s[day]:null;
  }}

  /* ══════════════════════════════════════════════════════════
     이동 시뮬레이션 모드
  ══════════════════════════════════════════════════════════ */
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

    // 클릭 → 전체 경우의 수 분석
    tbl.addEventListener('click',function(e){{
      if(_dragSrc!==null)return; // 드래그 중이면 무시
      const td=e.target.closest('td.tt-draggable');
      if(!td)return;
      _showFullSimulation(+td.dataset.day,+td.dataset.period);
    }});

    // 드래그앤드롭 → 특정 목적지 분석
    tbl.addEventListener('dragstart',function(e){{
      const td=e.target.closest('td.tt-draggable');
      if(!td){{e.preventDefault();return;}}
      _dragSrc={{d:+td.dataset.day,p:+td.dataset.period}};
      td.classList.add('tt-dragging');
      e.dataTransfer.effectAllowed='move';
    }});
    tbl.addEventListener('dragend',function(){{
      document.querySelectorAll('.tt-dragging,.tt-drop-over').forEach(el=>el.classList.remove('tt-dragging','tt-drop-over'));
      setTimeout(()=>{{_dragSrc=null;}},50);
    }});
    tbl.addEventListener('dragover',function(e){{
      const td=e.target.closest('td[data-day]');
      if(!td||!_dragSrc)return;
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
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
      const dstD=+td.dataset.day,dstP=+td.dataset.period;
      if(dstD===_dragSrc.d&&dstP===_dragSrc.p)return;
      _showDropAnalysis(_dragSrc.d,_dragSrc.p,dstD,dstP);
    }});
  }}

  /* ══════════════════════════════════════════════════════════
     핵심 분석 엔진
  ══════════════════════════════════════════════════════════ */

  // 빈 슬롯 목록 반환
  function _getFreeSlots(teacherName){{
    if(!teacherName||!TT.t[teacherName])return[];
    const free=[];
    DAYS.forEach((day,di)=>{{
      (TT.t[teacherName][day]||[]).forEach((slot,pi)=>{{
        const[s]=(slot||'').split('|');
        if(!s||!s.trim())free.push({{day,di,period:pi+1,label:day+' '+(pi+1)+'교시'}});
      }});
    }});
    return free;
  }}

  // 특정 (day,period) 슬롯이 해당 교사에게 비어있는지
  function _isTeacherFreeAt(teacherName,day,period){{
    if(!teacherName||!TT.t[teacherName])return true;
    const s=(TT.t[teacherName][day]||[])[period]||'';
    const[sub]=(s||'').split('|');
    return!sub||!sub.trim();
  }}

  // 특정 (day,period) 슬롯이 해당 학반에게 비어있는지
  function _isClassFreeAt(cls,day,period){{
    if(!cls||!TT.c[cls])return true;
    const s=(TT.c[cls].s[day]||[])[period]||'';
    const[sub]=(s||'').split('|');
    return!sub||!sub.trim();
  }}

  // 학반의 특정 슬롯 교사 이름 반환
  function _getClassTeacher(cls,day,period){{
    if(!cls||!TT.c[cls])return'';
    const s=(TT.c[cls].s[day]||[])[period]||'';
    const[,t]=(s||'').split('|');
    return resolveName(t||'');
  }}

  // 학반의 특정 슬롯 과목 반환
  function _getClassSubject(cls,day,period){{
    if(!cls||!TT.c[cls])return'';
    const s=(TT.c[cls].s[day]||[])[period]||'';
    const[sub]=(s||'').split('|');
    return sub||'';
  }}

  /* ── 전체 경우의 수 계산 ───────────────────────────────── */
  function _computeAllOptions(srcD,srcP){{
    const teacher=_name;
    const srcDay=DAYS[srcD];
    const srcRaw=(TT.t[teacher][srcDay]||[])[srcP]||'';
    const[srcSub,srcCls]=(srcRaw||'').split('|');

    const immediate=[];   // ✅ 즉시 이동 (교사 O, 학반 O)
    const swappable=[];   // 🔄 맞바꾸기 (교사 X→맞교환, 학반 O)
    const negotiate=[];   // 💬 협의 필요 (교사 O, 학반 X)
    const complex=[];     // ⚠️ 복합 충돌 (교사 X, 학반 X)

    for(let d=0;d<5;d++){{
      for(let p=0;p<P;p++){{
        if(d===srcD&&p===srcP)continue;
        const dstDay=DAYS[d];

        // 교사 A의 목적지 상태
        const tRaw=(TT.t[teacher][dstDay]||[])[p]||'';
        const[tSub,tCls]=(tRaw||'').split('|');
        const tFree=!tSub||!tSub.trim();

        // 학반 X의 목적지 상태
        const cxFree=_isClassFreeAt(srcCls,dstDay,p);
        const cxTeacher=cxFree?'':_getClassTeacher(srcCls,dstDay,p);
        const cxSubject=cxFree?'':_getClassSubject(srcCls,dstDay,p);

        if(tFree&&cxFree){{
          // 즉시 이동 가능
          immediate.push({{d,p,dstDay,label:dstDay+' '+(p+1)+'교시'}});
        }}else if(!tFree&&cxFree){{
          // 교사 A의 목적지에 다른 수업 → 맞바꾸기 검토
          // 조건: 목적지 학반(tCls)이 원래 자리(srcD,srcP)에 비어있어야
          const otherCls=tCls||'';
          const otherClsFreeAtSrc=_isClassFreeAt(otherCls,srcDay,srcP);
          if(otherClsFreeAtSrc){{
            swappable.push({{d,p,dstDay,label:dstDay+' '+(p+1)+'교시',dstSub:tSub||'',dstCls:otherCls}});
          }}else{{
            const otherConflict=_getClassSubject(otherCls,srcDay,srcP);
            complex.push({{d,p,dstDay,label:dstDay+' '+(p+1)+'교시',reason:'교사와 '+otherCls+'반 모두 충돌',dstSub:tSub||'',dstCls:otherCls,otherConflict}});
          }}
        }}else if(tFree&&!cxFree){{
          // 교사 A 가능, 학반 X 불가 → 교사 B와 협의
          const bName=cxTeacher;
          const bFreeAll=_getFreeSlots(bName);
          // 교사 A도 비어있는 시간대로 필터
          const bFreeAndAFree=bFreeAll.filter(s=>_isTeacherFreeAt(teacher,s.day,s.period-1));
          negotiate.push({{d,p,dstDay,label:dstDay+' '+(p+1)+'교시',cxSubject,cxTeacher:bName,bFreeAll,bFreeAndAFree}});
        }}else{{
          // 둘 다 충돌
          complex.push({{d,p,dstDay,label:dstDay+' '+(p+1)+'교시',reason:'교사와 학반 모두 충돌',dstSub:tSub||'',dstCls:tCls||'',otherConflict:''}});
        }}
      }}
    }}
    return{{srcSub:srcSub||'',srcCls:srcCls||'',srcDay,srcP:srcP+1,immediate,swappable,negotiate,complex}};
  }}

  /* ── 전체 시뮬레이션 모달 (클릭) ──────────────────────── */
  function _showFullSimulation(srcD,srcP){{
    const o=_computeAllOptions(srcD,srcP);

    document.getElementById('tt-sim-title').textContent=
      `🔄 이동 시뮬레이션: ${{o.srcDay}} ${{o.srcP}}교시 — ${{o.srcSub}}${{o.srcCls?' ('+o.srcCls+'반)':''}}`;
    document.getElementById('tt-sim-subtitle').textContent=
      `${{_name}} 선생님 수업 · 가능한 모든 이동 경우의 수 분석`;

    // 요약 카드
    const sumHtml=[
      `<div class="tt-summary-card" onclick="document.getElementById('tt-sec-imm').scrollIntoView({{behavior:'smooth'}})"><span class="n">${{o.immediate.length}}</span>즉시 이동</div>`,
      `<div class="tt-summary-card" onclick="document.getElementById('tt-sec-swap').scrollIntoView({{behavior:'smooth'}})"><span class="n">${{o.swappable.length}}</span>맞바꾸기</div>`,
      `<div class="tt-summary-card" onclick="document.getElementById('tt-sec-neg').scrollIntoView({{behavior:'smooth'}})"><span class="n">${{o.negotiate.length}}</span>협의 필요</div>`,
      `<div class="tt-summary-card" onclick="document.getElementById('tt-sec-cpx').scrollIntoView({{behavior:'smooth'}})"><span class="n">${{o.complex.length}}</span>복합 충돌</div>`,
    ].join('');
    document.getElementById('tt-sim-summary').innerHTML=sumHtml;

    document.getElementById('tt-sim-body').innerHTML=_buildSimBody(o,null);
    document.getElementById('tt-sim-modal').style.display='flex';
  }}

  /* ── 드롭 특정 분석 모달 (드래그앤드롭) ───────────────── */
  function _showDropAnalysis(srcD,srcP,dstD,dstP){{
    const o=_computeAllOptions(srcD,srcP);
    const dstDay=DAYS[dstD];
    const dstLabel=dstDay+' '+(dstP+1)+'교시';

    document.getElementById('tt-sim-title').textContent=
      `📍 이동 분석: ${{o.srcDay}} ${{o.srcP}}교시 → ${{dstLabel}}`;
    document.getElementById('tt-sim-subtitle').textContent=
      `${{_name}} 선생님 ${{o.srcSub}}${{o.srcCls?' ('+o.srcCls+'반)':''}} · 목적지 상세 분석 + 전체 대안`;

    const sumHtml=[
      `<div class="tt-summary-card"><span class="n">${{o.immediate.length}}</span>즉시 가능</div>`,
      `<div class="tt-summary-card"><span class="n">${{o.swappable.length}}</span>맞바꾸기</div>`,
      `<div class="tt-summary-card"><span class="n">${{o.negotiate.length}}</span>협의 필요</div>`,
    ].join('');
    document.getElementById('tt-sim-summary').innerHTML=sumHtml;

    document.getElementById('tt-sim-body').innerHTML=_buildSimBody(o,{{d:dstD,p:dstP,label:dstLabel}});
    document.getElementById('tt-sim-modal').style.display='flex';
  }}

  /* ── 모달 본문 빌더 ─────────────────────────────────────── */
  function _buildSimBody(o,target){{
    let html='';

    // ─ 0. 드롭 목적지 상세 분석 (드래그앤드롭 전용) ────────
    if(target){{
      const tRaw=(TT.t[_name][DAYS[target.d]]||[])[target.p]||'';
      const[tSub,tCls]=(tRaw||'').split('|');
      const tFree=!tSub||!tSub.trim();
      const cxFree=_isClassFreeAt(o.srcCls,DAYS[target.d],target.p);
      const cxTeacher=cxFree?'':_getClassTeacher(o.srcCls,DAYS[target.d],target.p);
      const cxSubject=cxFree?'':_getClassSubject(o.srcCls,DAYS[target.d],target.p);

      let statusCls=tFree&&cxFree?'#dcfce7':'#fef3c7';
      let statusIcon=tFree&&cxFree?'✅':'⚠️';
      let statusText=tFree&&cxFree?'이동 가능 — 충돌 없음':'충돌 있음 — 아래 내용 확인 필요';
      html+=`<div style="background:${{statusCls}};border-radius:10px;padding:13px 16px;margin-bottom:16px;">`;
      html+=`<div style="font-size:0.82rem;font-weight:700;margin-bottom:8px;">${{statusIcon}} 목적지 분석: ${{target.label}}</div>`;
      html+=`<table style="font-size:0.79rem;width:100%;"><tr><td style="width:120px;color:#6b7280;">이동할 수업</td><td><strong>${{o.srcSub}}</strong> ${{o.srcCls?'('+o.srcCls+'반)':''}}</td></tr>`;
      if(!tFree)html+=`<tr><td style="color:#6b7280;">교사 현 수업</td><td><strong>${{tSub}}</strong> ${{tCls?'('+tCls+'반)':''}}&nbsp;⚠️ 교사 스케줄 충돌</td></tr>`;
      if(!cxFree)html+=`<tr><td style="color:#6b7280;">${{o.srcCls}}반 현 수업</td><td><strong>${{cxSubject}}</strong> (담당: <strong>${{cxTeacher}}</strong>)&nbsp;⚠️ 학반 스케줄 충돌</td></tr>`;
      html+='</table>';
      if(!cxFree&&cxTeacher&&TT.t[cxTeacher]){{
        const bFree=_getFreeSlots(cxTeacher).filter(s=>_isTeacherFreeAt(_name,s.day,s.period-1));
        if(bFree.length){{
          html+=`<div style="margin-top:8px;font-size:0.77rem;color:#065f46;">💡 ${{cxTeacher}} 선생님과 ${{_name}} 선생님이 <u>동시에</u> 비어있는 협의 가능 시간:</div>`;
          html+=`<div class="tt-free-chips">${{bFree.slice(0,10).map(s=>`<span class="tt-sim-chip green">${{s.label}}</span>`).join('')}}</div>`;
        }}
      }}
      html+='</div>';
    }}

    // ─ 1. 즉시 이동 가능 ─────────────────────────────────
    html+=`<div class="tt-sim-section" id="tt-sec-imm">`;
    html+=`<div class="tt-sim-section-hdr" style="background:#f0fdf4;color:#166534;" onclick="_toggleSec(this)">`;
    html+=`✅ 즉시 이동 가능<span class="tt-cnt-badge" style="background:#16a34a;">${{o.immediate.length}}건</span>`;
    html+=`<span style="margin-left:auto;font-size:0.7rem;opacity:0.7;">▾ 클릭하여 접기/펼치기</span></div>`;
    html+=`<div class="tt-sim-section-body">`;
    if(o.immediate.length===0){{
      html+=`<p style="color:#6b7280;font-size:0.8rem;margin:0;">즉시 이동 가능한 시간대가 없습니다.</p>`;
    }}else{{
      html+=`<p style="font-size:0.77rem;color:#374151;margin:0 0 8px;">${{o.srcCls?o.srcCls+'반과':''}} ${{_name}} 선생님 모두 비어 있는 시간대입니다. 클릭하면 이동이 적용됩니다.</p>`;
      html+=`<div class="tt-free-chips">`;
      o.immediate.forEach(s=>{{
        html+=`<span class="tt-sim-chip green" onclick="ttApplyMove(${{JSON.stringify(o)}},${{s.d}},${{s.p}},'${{s.dstDay}}')">${{s.label}}</span>`;
      }});
      html+='</div>';
    }}
    html+='</div></div>';

    // ─ 2. 맞바꾸기 가능 ─────────────────────────────────
    html+=`<div class="tt-sim-section" id="tt-sec-swap">`;
    html+=`<div class="tt-sim-section-hdr" style="background:#eff6ff;color:#1e40af;" onclick="_toggleSec(this)">`;
    html+=`🔄 맞바꾸기 가능<span class="tt-cnt-badge" style="background:#2563eb;">${{o.swappable.length}}건</span>`;
    html+=`<span style="margin-left:auto;font-size:0.7rem;opacity:0.7;">▾</span></div>`;
    html+=`<div class="tt-sim-section-body">`;
    if(o.swappable.length===0){{
      html+=`<p style="color:#6b7280;font-size:0.8rem;margin:0;">맞바꾸기 가능한 시간대가 없습니다.</p>`;
    }}else{{
      html+=`<p style="font-size:0.77rem;color:#374151;margin:0 0 8px;">해당 시간대에 ${{_name}} 선생님의 다른 수업이 있지만, 두 수업을 서로 교환할 수 있습니다.</p>`;
      html+=`<table class="tt-sim-tbl"><thead><tr><th>이동 목적지</th><th>교환할 수업</th><th>담당 학반</th><th></th></tr></thead><tbody>`;
      o.swappable.forEach(s=>{{
        html+=`<tr>
          <td><strong>${{s.label}}</strong></td>
          <td>${{s.dstSub||'—'}}</td>
          <td>${{s.dstCls||'—'}}</td>
          <td><span class="tt-sim-chip" style="font-size:0.7rem;padding:2px 8px;" onclick="ttApplySwap(${{JSON.stringify(o)}},${{s.d}},${{s.p}})">맞바꾸기</span></td>
        </tr>`;
      }});
      html+='</tbody></table>';
    }}
    html+='</div></div>';

    // ─ 3. 협의 필요 ──────────────────────────────────────
    html+=`<div class="tt-sim-section" id="tt-sec-neg">`;
    html+=`<div class="tt-sim-section-hdr" style="background:#fffbeb;color:#92400e;" onclick="_toggleSec(this)">`;
    html+=`💬 담당 교사 협의 필요<span class="tt-cnt-badge" style="background:#f59e0b;">${{o.negotiate.length}}건</span>`;
    html+=`<span style="margin-left:auto;font-size:0.7rem;opacity:0.7;">▾</span></div>`;
    html+=`<div class="tt-sim-section-body">`;
    if(o.negotiate.length===0){{
      html+=`<p style="color:#6b7280;font-size:0.8rem;margin:0;">협의 필요 케이스가 없습니다.</p>`;
    }}else{{
      html+=`<p style="font-size:0.77rem;color:#374151;margin:0 0 8px;">${{_name}} 선생님은 이동 가능하나, <strong>${{o.srcCls||''}}반</strong>의 해당 시간에 다른 교사 수업이 있어 해당 교사와 협의가 필요합니다.</p>`;
      html+=`<table class="tt-sim-tbl"><thead><tr><th>목적지</th><th>충돌 수업</th><th>담당 교사</th><th>협의 가능 시간 (양측 빈 시간)</th></tr></thead><tbody>`;
      o.negotiate.forEach(s=>{{
        const chips=s.bFreeAndAFree.slice(0,8).map(f=>`<span class="tt-sim-chip orange" style="padding:2px 7px;font-size:0.7rem;">${{f.label}}</span>`).join('');
        const noneMsg='<span style="color:#6b7280;font-size:0.75rem;">빈 공통 시간 없음</span>';
        html+=`<tr>
          <td><strong>${{s.label}}</strong></td>
          <td>${{s.cxSubject||'—'}}</td>
          <td><strong>${{s.cxTeacher||'—'}}</strong></td>
          <td><div class="tt-free-chips">${{s.bFreeAndAFree.length?chips:noneMsg}}</div></td>
        </tr>`;
      }});
      html+='</tbody></table>';
    }}
    html+='</div></div>';

    // ─ 4. 복합 충돌 (접힌 상태로) ─────────────────────────
    html+=`<div class="tt-sim-section" id="tt-sec-cpx">`;
    html+=`<div class="tt-sim-section-hdr" style="background:#fef2f2;color:#991b1b;" onclick="_toggleSec(this)">`;
    html+=`⚠️ 복합 충돌 (이동 어려움)<span class="tt-cnt-badge" style="background:#ef4444;">${{o.complex.length}}건</span>`;
    html+=`<span style="margin-left:auto;font-size:0.7rem;opacity:0.7;">▸ 클릭하여 펼치기</span></div>`;
    html+=`<div class="tt-sim-section-body" style="display:none;">`;
    if(o.complex.length===0){{
      html+=`<p style="color:#6b7280;font-size:0.8rem;margin:0;">복합 충돌 케이스가 없습니다.</p>`;
    }}else{{
      html+=`<p style="font-size:0.77rem;color:#374151;margin:0 0 8px;">교사와 학반 양측에 모두 충돌이 있어 이동이 어렵습니다.</p>`;
      html+=`<table class="tt-sim-tbl"><thead><tr><th>목적지</th><th>충돌 내용</th></tr></thead><tbody>`;
      o.complex.forEach(s=>{{
        html+=`<tr><td>${{s.label}}</td><td style="color:#6b7280;">${{s.reason||'교사/학반 모두 충돌'}}</td></tr>`;
      }});
      html+='</tbody></table>';
    }}
    html+='</div></div>';

    return html;
  }}

  /* ── 접기/펼치기 ────────────────────────────────────────── */
  window._toggleSec=function(hdr){{
    const body=hdr.nextElementSibling;
    const isOpen=body.style.display!=='none';
    body.style.display=isOpen?'none':'';
    const arr=hdr.querySelector('span:last-child');
    if(arr)arr.textContent=isOpen?'▸ 클릭하여 펼치기':'▾ 클릭하여 접기';
  }};

  /* ── 이동 적용 (시각적) ──────────────────────────────────── */
  window.ttApplyMove=function(o,dstD,dstP,dstDay){{
    if(!confirm(`${{o.srcDay}} ${{o.srcP}}교시 → ${{dstDay}} ${{dstP+1}}교시로 이동하시겠습니까?\\n(화면 내 임시 적용, 새로고침 시 원복됩니다)`))return;
    const t=TT.t[_name];
    const srcDay=o.srcDay;
    const moved=t[srcDay][o.srcP-1];
    t[srcDay][o.srcP-1]='|';
    t[dstDay][dstP]=moved;
    ttSimClose();_renderWeek();_bindDrag();
    alert(`✅ 시뮬레이션 적용: ${{o.srcDay}} ${{o.srcP}}교시 → ${{dstDay}} ${{dstP+1}}교시`);
  }};

  window.ttApplySwap=function(o,dstD,dstP){{
    const dstDay=DAYS[dstD];
    if(!confirm(`${{o.srcDay}} ${{o.srcP}}교시와 ${{dstDay}} ${{dstP+1}}교시를 서로 맞바꾸시겠습니까?\\n(화면 내 임시 적용)`))return;
    const t=TT.t[_name];
    const srcDay=o.srcDay;
    const tmp=t[srcDay][o.srcP-1];
    t[srcDay][o.srcP-1]=t[dstDay][dstP];
    t[dstDay][dstP]=tmp;
    ttSimClose();_renderWeek();_bindDrag();
    alert(`✅ 맞바꾸기 적용: ${{o.srcDay}} ${{o.srcP}}교시 ↔ ${{dstDay}} ${{dstP+1}}교시`);
  }};

  window.ttSimClose=function(){{
    document.getElementById('tt-sim-modal').style.display='none';
  }};

  /* ── 외부 클릭 자동완성 닫기 ────────────────────────────── */
  document.addEventListener('click',function(e){{
    const w=document.getElementById('tt-teacher-wrap');
    if(w&&!w.contains(e.target)){{document.getElementById('tt-suggest').style.display='none';_ki=-1;}}
  }});
}})();
</script>

</body>
</html>
"""

html = html + NEW_BLOCK + NEW_JS

# ── 저장 ──────────────────────────────────────────────────
with open(HTML_PATH, 'w', encoding='utf-8') as f:
    f.write(html)
print("[완료] 저장:", HTML_PATH)
print("      줄 수:", html.count('\n'))
print("      크기:", round(len(html)/1024), "KB")
