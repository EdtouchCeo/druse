# -*- coding: utf-8 -*-
"""curr_search.json → curr_struct.json (교육과정 내용 체계 구조화 사전).

목적
  RAG 검색이 과목을 구분하지 못하고 엉뚱한 과목의 핵심 아이디어/성취기준을 올리는 문제를
  해결하기 위한 결정적(deterministic) 구조화 사전을 생성한다.
  RagChat이 질문의 (핵심 아이디어|내용 체계|내용 요소|성취기준)+과목명 의도를 감지하면
  이 사전에서 해당 과목 블록을 근거 최상단에 원문 그대로 주입한다.

입력  : curr_search.json  {"docs":[라벨..], "chunks":[[docIdx, ref, text], ...]}
출력  : curr_struct.json  (스키마는 _workspace/20_curr_struct_plan.md 계약 준수)

핵심 원칙
  - 원본(curr_search.json·emb.bin)은 절대 수정하지 않는다. 읽기 전용.
  - 텍스트는 PDF 추출물이라 문장 중간 줄바꿈·페이지 푸터(교과명+쪽번호)·⋅불릿이 섞여 있다.
    → 페이지 푸터 제거 + 공백 정규화만 수행. 의미·문자는 원문 보존.
  - 모든 coreIdea/standard.text는 (푸터 제거·공백 정규화 후) 원본 연결 텍스트의
    부분 문자열이어야 한다(할루시네이션 방지). 위반 항목은 struct에서 제외하고 리포트에 명시.

사용법
  python scripts/build_curr_struct.py \
      "output/web/data/curr_search.json" "output/web/data/curr_struct.json"
  (인자 생략 시 위 기본 경로 사용)

문서 구조(2022 개정 교육과정 별책 공통 포맷)
  <과목명>                     ← 이 줄이 과목 제목 (페이지 푸터 다음 줄)
  1. 성격 및 목표
     가. 성격 / 나. 목표 ...
  2. 내용 체계 및 성취기준
     가. 내용 체계
        (N) <영역명>
        핵심 아이디어
        ⋅<핵심 아이디어 1>
        ⋅<핵심 아이디어 2>
        구분 / 범주 / 내용 요소       ← 표 헤더
        [학교급/학년군 라벨]          ← 다학년군 공통 교육과정에서만 등장(선택)
        지식⋅이해  ⋅... 과정⋅기능 ⋅... 가치⋅태도 ⋅...
        (N+1) <영역명> ...
     나. 성취기준
        (N) <영역명>
        [코드] <성취기준 전문>
        (가) 성취기준 해설            ← 스킵
        (나) 성취기준 적용 시 고려 사항 ← 스킵
        (N+1) <영역명> ...
"""
import sys, os, re, json, bisect
from collections import defaultdict, Counter

# ---- 경로 기본값 ---------------------------------------------------------
DEF_IN  = "output/web/data/curr_search.json"
DEF_OUT = "output/web/data/curr_struct.json"

# ---- 성취기준 코드 → 학교급 --------------------------------------------
# 코드 선두 숫자: 2/4/6=초등 학년군, 9=중학교, 10/11/12=고등학교
LEVEL_SCHOOL = {2: "초등학교", 4: "초등학교", 6: "초등학교",
                9: "중학교", 10: "고등학교", 11: "고등학교", 12: "고등학교"}

# [코드] 두 형식 지원:
#   표준형   [12정01-01]        = [<lvl><과목><영역2>-<번호2>]
#   공통과목형 [10공국1-01-01]   = [<lvl><과목+과목숫자>-<영역2>-<번호2>]
# g1=학교급숫자, g2=과목약칭(로마자 Ⅰ~Ⅳ·숫자 접미 허용, 예:미적Ⅰ·공국1), g3=영역번호, g4=번호
# 예) [12정01-01]  [10공국1-01-01]  [12미적Ⅰ-01-01]
CODE_RE = re.compile(r'\[(\d{1,2})([가-힣]{1,4}[ⅠⅡⅢⅣ\d]?)-?(\d{2})-(\d{2})\]')

# 영역 헤더  "(1) 컴퓨팅 시스템"
AREA_RE = re.compile(r'^\((\d{1,2})\)\s*(.+?)\s*$')

# 단일 한글 괄호 헤더  "(가) 성취기준 해설" / "(나) 고려 사항" / "(마) ..." → 성취기준 본문 종료 신호
SUBHDR_RE = re.compile(r'^\([가-하]\)')

# 표 헤더/범주 키워드
CAT_KEYS = ["지식⋅이해", "지식·이해", "과정⋅기능", "과정·기능", "가치⋅태도", "가치·태도"]
CAT_CANON = {"지식⋅이해": "지식·이해", "지식·이해": "지식·이해",
             "과정⋅기능": "과정·기능", "과정·기능": "과정·기능",
             "가치⋅태도": "가치·태도", "가치·태도": "가치·태도"}
TABLE_HDR = ("구분", "범주", "내용 요소", "내용요소")

# 학교급/학년군 라벨(내용 요소 표의 열 구분·성취기준 앞 라벨) — 스킵 대상
GRADEBAND_RE = re.compile(
    r'^\[?\s*(초등학교|중학교|고등학교)?\s*\d?\s*[~∼]?\s*\d?\s*학년(군)?\s*\]?$')
GRADEBAND_SIMPLE = {"초등학교", "중학교", "고등학교"}

# 과목 제목 앞 페이지 푸터(러닝 헤더) — 이 줄 + 뒤따르는 쪽번호 줄 제거
FOOTER_HDR = re.compile(
    r'^(.*교육과정|[가-힣]{1,6}과|공통 교육과정.*|선택 중심 교육과정.*|'
    r'선택 ?[–\-].*|창의적 체험활동|\[별표.*|[ⅠⅡⅢⅣⅤ].*|생활 ?[가-힣]*|'
    r'공통 교육과정 ?[–\-].*)$')
KO_SUBJ_FOOTER = {"국어", "수학", "과학", "사회", "체육", "음악", "미술", "도덕",
                  "영어", "정보", "한문", "교양", "실과", "기술⋅가정", "기술·가정",
                  "제2외국어", "창의적 체험활동", "보건", "환경"}

BULLET_CHARS = "⋅·•∙・"


# ---- 유틸 ---------------------------------------------------------------
def collapse_ws(s):
    """공백(스페이스/탭/개행) 1칸화. 검증·저장 공통 정규화."""
    return re.sub(r'\s+', ' ', s).strip()


def nospace(s):
    """모든 공백 제거 — 부분 문자열 검증용(줄바꿈 위치 space/nospace 차이 무시)."""
    return re.sub(r'\s+', '', s)


def strip_footers(seg):
    """페이지 푸터 제거: 단독 쪽번호 줄 + (그 앞이 러닝헤더면) 헤더 줄."""
    lines = seg.split("\n")
    drop = set()
    for i, l in enumerate(lines):
        s = l.strip()
        if re.fullmatch(r'\d{1,4}', s):
            drop.add(i)
            if i - 1 >= 0:
                p = lines[i - 1].strip()
                if p in KO_SUBJ_FOOTER or FOOTER_HDR.match(p):
                    drop.add(i - 1)
    return "\n".join(lines[i] for i in range(len(lines)) if i not in drop)


def collect_bullets(block):
    """서브블록 텍스트에서 ⋅불릿 항목 리스트 추출.
    비불릿 줄은 직전 항목의 PDF 줄바꿈 연속으로 간주해 이어붙인다.
    학교급/학년군 라벨 줄은 스킵(다열 표 열 구분)."""
    items = []
    for raw in block.split("\n"):
        s = raw.strip()
        if not s:
            continue
        if s in TABLE_HDR or s in GRADEBAND_SIMPLE or GRADEBAND_RE.match(s):
            continue
        if s[0] in BULLET_CHARS:
            items.append(s[1:].strip())
        else:
            if items:
                items[-1] = collapse_ws(items[-1] + " " + s)
            # 항목 없이 시작하는 비불릿 줄은 무시(표 헤더 잔여 등)
    return [collapse_ws(x) for x in items if x.strip()]


def split_areas(text):
    """텍스트를 (영역번호, 영역명, 본문) 리스트로 분할. 영역 헤더 '(N) 이름' 기준."""
    lines = text.split("\n")
    idxs = []
    for i, l in enumerate(lines):
        m = AREA_RE.match(l.strip())
        if m and not l.strip().startswith("(가)"):
            # 영역명이 너무 길거나 문장형이면 실제 영역이 아님(오탐 방지)
            name = m.group(2).strip()
            if len(name) <= 30 and not name.endswith(("다.", "다", "함", "음")):
                idxs.append((i, int(m.group(1)), name))
    areas = []
    for k, (i, num, name) in enumerate(idxs):
        j = idxs[k + 1][0] if k + 1 < len(idxs) else len(lines)
        body = "\n".join(lines[i + 1:j])
        areas.append((num, name, body))
    return areas


def extract_area_body(body):
    """한 영역 본문 → {name(빈값), coreIdeas, elements}. name은 호출측에서 채움."""
    # 핵심 아이디어 서브블록
    core = []
    mci = re.search(r'핵심\s*아이디어', body)
    if mci:
        after = body[mci.end():]
        end = len(after)
        for kw in ("구분", "범주", "내용 요소", "내용요소") + tuple(CAT_KEYS):
            p = after.find(kw)
            if p != -1:
                end = min(end, p)
        core = collect_bullets(after[:end])
    # 내용 요소(범주 3구분)
    elements = {"지식·이해": [], "과정·기능": [], "가치·태도": []}
    cat_pos = []
    for kw in CAT_KEYS:
        for m in re.finditer(re.escape(kw), body):
            cat_pos.append((m.start(), m.end(), CAT_CANON[kw]))
    cat_pos.sort()
    for ci, (st, en, canon) in enumerate(cat_pos):
        nxt = cat_pos[ci + 1][0] if ci + 1 < len(cat_pos) else len(body)
        elements[canon] += collect_bullets(body[en:nxt])
    for k in elements:  # 다열 표 중복 제거
        seen, uniq = set(), []
        for it in elements[k]:
            if it not in seen:
                seen.add(it); uniq.append(it)
        elements[k] = uniq
    return {"name": "", "coreIdeas": core, "elements": elements}


def parse_content_system(seg):
    """'가. 내용 체계' 블록 → {영역번호: {name, coreIdeas, elements}}.
    '(N) 영역명' 헤더가 있으면 번호별로, 없으면(단일 영역 과목) {0: ...} 반환."""
    areas = split_areas(seg)
    if areas:
        out = {}
        for num, name, body in areas:
            a = extract_area_body(body)
            a["name"] = name
            out[num] = a
        return out
    # 단일 영역(번호 헤더 없음) — 세그먼트 전체를 하나로
    if re.search(r'핵심\s*아이디어', seg) or any(k in seg for k in CAT_KEYS):
        return {0: extract_area_body(seg)}
    return {}


def parse_standards_groups(seg):
    """'나. 성취기준' 블록 → 등장 순서 그룹 리스트:
        [{"name": 영역명|None, "digit": 코드영역자리, "standards": [{code,text}]}, ...]
    '(N) 영역명' 헤더마다 새 그룹을 연다. 해설/고려사항 '(가)(나)…'·<탐구활동>·학년군
    라벨에서 성취기준 본문 누적을 끊고, 해설 구간의 코드 인용은 담지 않는다.
    반환된 그룹으로 호출측이 (a)내용체계 영역번호에 코드자리로 병합(공유영역 과목) 또는
    (b)순차 영역으로 사용(매트릭스·과목별 영역상이) 을 결정한다."""
    seg = re.split(r'\n\s*3\.\s', seg, maxsplit=1)[0]   # 3. 교수·학습 및 평가 이전까지
    groups = []
    cur_g = None
    cur = None
    in_notes = False
    seen = set()          # 전체 코드 중복 방지(해설 인용 재등장 등)

    def open_group(name):
        nonlocal cur_g
        cur_g = {"name": name, "digit": None, "standards": []}
        groups.append(cur_g)

    def flush():
        nonlocal cur, cur_g
        if cur is not None:
            if cur["code"] not in seen:
                seen.add(cur["code"])
                if cur_g is None:
                    open_group(None)
                cur_g["standards"].append(
                    {"code": cur["code"], "text": collapse_ws(cur["text"])})
                if cur_g["digit"] is None:
                    cur_g["digit"] = cur["_area"]
            cur = None

    for l in seg.split("\n"):
        s = l.strip()
        if not s:
            continue
        ma = AREA_RE.match(s)
        if ma:                              # (N) 영역명 → 새 영역 그룹
            flush(); in_notes = False
            open_group(ma.group(2).strip())
            continue
        if SUBHDR_RE.match(s):              # (가) 해설 / (나) 고려사항
            flush(); in_notes = True; continue
        m = CODE_RE.match(s)
        if m:
            # 줄머리 비불릿 코드 = 주 성취기준 문장(해설의 코드 인용은 '• [코드]' 불릿이라
            # CODE_RE.match 실패로 이미 걸러짐). 해설/고려사항 뒤에 이어지는 주 성취기준
            # 배치(예: 고급 물리학 02-04~06)를 놓치지 않도록 in_notes와 무관하게 새로 연다.
            # 고려사항의 비불릿 코드 '인용'(이미 앞서 등장)은 flush()의 코드 중복 검사로 배제.
            flush(); in_notes = False
            cur = {"code": s[1:m.end() - 1], "text": s[m.end():].strip(),
                   "_area": int(m.group(3))}
            continue
        if s.startswith("[") or s.startswith("<") or s in GRADEBAND_SIMPLE \
                or GRADEBAND_RE.match(s):
            flush(); continue
        if cur is not None and not in_notes and s[0] not in BULLET_CHARS:
            cur["text"] = collapse_ws(cur["text"] + " " + s)
    flush()
    return [g for g in groups if g["standards"]]


def build_doc_text(chunks):
    """청크(ref,text) 리스트 → (연결텍스트, [(offset, page)])."""
    buf = []
    offmap = []
    pos = 0
    for ref, text in chunks:
        offmap.append((pos, ref))
        buf.append(text)
        pos += len(text) + 1  # '\n'
    return "\n".join(buf), offmap


def page_at(offmap, off):
    starts = [o for o, _ in offmap]
    k = bisect.bisect_right(starts, off) - 1
    k = max(0, k)
    return offmap[k][1]


# ---- 과목명 유효성·복원 ---------------------------------------------------
# 과목명이 아닌 러닝 헤더/학년군 라벨/그림 캡션/설명 문장 등을 배제하고, 가능하면 복원.
# 원인: '1. 성격' 앞에 (교육과정 설계 개요) 그림·표가 끼면 마지막 줄이 캡션/학년군 라벨이 됨.
SCHOOL_ONLY = {"초등학교", "중학교", "고등학교", "공통 교육과정", "선택 중심 교육과정",
               "공통 과목", "일반 선택 과목", "진로 선택 과목", "융합 선택 과목",
               "목표", "성격", "내용 체계", "성취기준", "생활외국어"}
GRADEBAND2 = re.compile(r'^(초등학교|중학교|고등학교)?\s*\d?\s*[~∼]?\s*\d?\s*학년(군)?$')
# 과목명일 수 없는 신호(그림/표 캡션·설계 개요·설명 문장 등). '설계/구성' 단독은 실제
# 과목명('창의 공학 설계' 등)에도 쓰이므로 제외하고, 캡션·문장 특유의 다어절 신호만 사용.
NOT_NAME = re.compile(r'설계의 개요|설계의 기본|교육과정의 구성|학년군별|영역별 핵심|'
                      r'핵심 개념 및|교과 역량|도식|그림\]|\[그림|\[표|나타낼|권장|'
                      r'하였다|하였음|제시하|진술하|강조하|함양하도록|설계하도록|접근')
# 푸터 조각이 과목명으로 새는 경우: "- 융합 선택 과목 -", "진로 선택 과목 - 인간과 철학" 등
FOOTER_FRAG = re.compile(r'(공통|일반|진로|융합)?\s*선택\s*(중심\s*)?(교육과정|과목)|'
                         r'^[–\-]|[–\-]\s*$|교육과정$')
# 성취기준 코드 약칭 → 대표 교과명(핵심 공통 교과만; 그 외는 캡션/줄에서 복원)
CODE_SUBJECT = {
    "국": "국어", "수": "수학", "사": "사회", "과": "과학", "도": "도덕", "체": "체육",
    "음": "음악", "미": "미술", "영": "영어", "실": "실과", "기가": "기술⋅가정",
    "한": "한문", "정": "정보", "환": "환경", "보": "보건", "역": "역사",
    "바": "바른 생활", "슬": "슬기로운 생활", "즐": "즐거운 생활",
    "진로": "진로와 직업", "삶종": "삶과 종교",
}
# 정당한 콤마 포함 과목명은 'X1, X2'(공통국어1, 공통국어2)류 뿐 — 양쪽이 숫자로 끝남
COURSE_PAIR = re.compile(r'.+\d\s*,\s*.+\d\s*$')


def is_valid_name(nm):
    """추출된 과목명이 실제 과목명으로 타당한지."""
    if not nm or nm in SCHOOL_ONLY:
        return False
    if len(nm) < 2 or len(nm) > 25:
        return False
    if GRADEBAND2.match(nm) or NOT_NAME.search(nm) or FOOTER_FRAG.search(nm):
        return False
    if nm[0] in "[(<":
        return False
    # 콤마 나열(그림 역량 라벨 '평가, 구성, 지속' 등) 배제 — 단 'X1, X2' 과목쌍은 허용
    if "," in nm and not COURSE_PAIR.match(nm):
        return False
    # 문장형 배제: 2022 개정 과목명은 종결어미 '다'로 끝나지 않음(설명 문장만 해당)
    if nm.endswith(("다", "다.", "함.", "임.", "음.")):
        return False
    return True


def footer_prefixed_name(line):
    """'진로 선택 과목 - 삶과 종교' 류 러닝 헤더에서 실제 과목명 복원."""
    m = re.search(r'(공통|일반|진로|융합)\s*선택[^\n]*?[–\-]\s*([가-힣][가-힣A-Za-z0-9·\s]+)$',
                  line)
    if m:
        nm = collapse_ws(m.group(2))
        if is_valid_name(nm):
            return nm
    return None


def caption_embedded_name(line):
    """그림 캡션 안에 든 실제 과목명 복원: <논리와 사고>, ‘진로와 직업’ 등."""
    for pat in (r'<\s*([가-힣A-Za-z0-9·\s]{2,20})\s*>',
                r'[‘’\'"“”]\s*([가-힣A-Za-z0-9·\s]{2,20})\s*[‘’\'"“”]'):
        m = re.search(pat, line)
        if m:
            nm = collapse_ws(m.group(1))
            if is_valid_name(nm):
                return nm
    return None


def code_abbrev(codes):
    """성취기준 코드들의 과목 약칭(선두 숫자 뒤 한글)을 다수결로."""
    ab = Counter()
    for c in codes:
        m = re.match(r'\d{1,2}([가-힣]{1,4})', c)
        if m:
            ab[m.group(1)] += 1
    return ab.most_common(1)[0][0] if ab else None


def derive_subject_name(head_lines, codes, area_names=()):
    """과목명 결정: ① 성격 앞 최근 줄 중 타당한 것(영역명과 동일하면 오염으로 보고 스킵) →
    ② 러닝 헤더 '…선택 과목 - X' 복원 → ③ 그림 캡션 내 <이름>·'이름' 복원 →
    ④ 성취기준 코드 약칭 → 대표 교과명. 모두 실패면 None(제외)."""
    anames = set(area_names)
    # ① 마지막 4줄 안에서 타당한 과목명 줄(단, 자기 영역명이 새어나온 경우는 제외)
    for line in reversed(head_lines[-4:]):
        if is_valid_name(line) and line not in anames:
            return line
    # ② '진로/융합/일반 선택 과목 - <과목명>' 러닝 헤더에서 복원
    for line in reversed(head_lines[-3:]):
        nm = footer_prefixed_name(line)
        if nm:
            return nm
    # ③ 그림 캡션 내 <이름>·'이름' 복원(교양 과목 등) — 성격 본문 문장의 인용부호
    #    오추출 방지 위해 실제 그림 캡션 줄(‘[그림…’ 포함)만 대상, 자기 영역명은 제외
    for line in reversed(head_lines[-3:]):
        if "[그림" not in line and "그림]" not in line:
            continue
        nm = caption_embedded_name(line)
        if nm and nm not in anames:
            return nm
    # ④ 코드 약칭 → 교과명(초·중 공통 과목이 설계 그림에 가려진 경우)
    ab = code_abbrev(codes)
    if ab and ab in CODE_SUBJECT:
        return CODE_SUBJECT[ab]
    return None


def main():
    inp = sys.argv[1] if len(sys.argv) > 1 else DEF_IN
    out = sys.argv[2] if len(sys.argv) > 2 else DEF_OUT
    data = json.load(open(inp, encoding="utf-8"))
    docs = data["docs"]
    per = defaultdict(list)
    for c in data["chunks"]:
        per[c[0]].append((c[1], c[2]))

    subjects = []
    report = {"docs": [], "excluded": [], "subst_fail": []}

    for di in range(len(docs)):
        raw, offmap = build_doc_text(per[di])
        # 과목 경계 = "1. 성격" 위치
        sec_starts = [m.start() for m in re.finditer(r'\n1\.\s*성격', raw)]
        sec_bounds = sec_starts + [len(raw)]
        doc_subj = 0
        for si in range(len(sec_starts)):
            s0 = sec_starts[si]
            s1 = sec_bounds[si + 1]
            region = raw[s0:s1]
            # "1. 성격" 앞 줄들(푸터 제거) — 과목명 후보. 최종 결정은 코드 파싱 후.
            head = strip_footers(raw[max(0, s0 - 220):s0])
            head_lines = [collapse_ws(x) for x in head.split("\n") if x.strip()]
            # 내용 체계 / 성취기준 블록 위치
            mcs = re.search(r'가\.\s*내용\s*체계', region)
            mst = re.search(r'나\.\s*성취기준', region)
            if not mcs or not mst or mst.start() < mcs.start():
                continue
            ncs = len(re.findall(r'가\.\s*내용\s*체계', region))  # 절 내 내용체계 블록 수
            cs_seg = strip_footers(region[mcs.end():mst.start()])
            st_seg = strip_footers(region[mst.end():])
            cs = parse_content_system(cs_seg)
            groups = parse_standards_groups(st_seg)
            if not cs and not groups:
                continue
            # 과목명 결정(코드 약칭 복원 포함) + 유효성 가드 — 부적격이면 제외
            all_codes = [x["code"] for g in groups for x in g["standards"]]
            area_names = {v.get("name") for v in cs.values() if v.get("name")}
            area_names |= {g["name"] for g in groups if g.get("name")}
            title = derive_subject_name(head_lines, all_codes, area_names)
            if not title:
                report["excluded"].append(
                    {"doc": di, "title": (head_lines[-1] if head_lines else ""),
                     "reason": "과목명 판정 실패(캡션/학년군/문장)"})
                continue
            # 학교급 = 성취기준 코드 선두 숫자 다수결
            levels = Counter()
            for g in groups:
                for x in g["standards"]:
                    m = re.match(r'(\d{1,2})', x["code"])
                    if m:
                        levels[int(m.group(1))] += 1
            schools = Counter()
            for lv, n in levels.items():
                schools[LEVEL_SCHOOL.get(lv, "?")] += n
            school = schools.most_common(1)[0][0] if schools else "?"
            if school == "?":
                report["excluded"].append(
                    {"doc": di, "title": title, "reason": "학교급 판정 실패(코드 없음)"})
                continue
            ref = page_at(offmap, s0 + mcs.start())

            EMPTY_EL = lambda: {"지식·이해": [], "과정·기능": [], "가치·태도": []}
            cs_has_headers = bool(cs) and set(cs) != {0}
            areas = []
            if cs_has_headers:
                # 정상형: 내용체계 '(N) 영역명' 기준. 성취기준은 코드 영역자리로 병합
                # (공통국어1·2처럼 여러 과목이 동일 영역을 공유하는 경우 올바르게 합쳐짐).
                st_by_digit = defaultdict(list)
                st_seen = defaultdict(set)
                for g in groups:
                    for stx in g["standards"]:
                        dg = int(re.match(r'\d{1,2}[가-힣]{1,4}[ⅠⅡⅢⅣ\d]?-?(\d{2})',
                                          stx["code"]).group(1))
                        if stx["code"] not in st_seen[dg]:
                            st_seen[dg].add(stx["code"])
                            st_by_digit[dg].append(stx)
                for num in sorted(set(cs) | set(st_by_digit)):
                    a = cs.get(num, {"name": "", "coreIdeas": [], "elements": EMPTY_EL()})
                    areas.append({"name": a["name"] or title,
                                  "coreIdeas": a["coreIdeas"], "elements": a["elements"],
                                  "standards": st_by_digit.get(num, [])})
            elif len(groups) > 1 and all(g["name"] for g in groups):
                # 매트릭스형(내용체계에 '(N) 영역명' 헤더 없음, 핵심 아이디어가 2차원 표).
                # 영역명·성취기준은 코드/헤더 기반이라 정확. 내용 요소는 표가 매트릭스라
                # 영역별 귀속 불가 → 제외.
                # 핵심 아이디어: 내용체계 블록이 1개(단일 과목)면 전체 목록을 첫 영역에 묶어
                # 보존(영역별 분해는 표라 불가). 블록이 2개↑(통합과학1·2처럼 과목1·2 결합)면
                # 첫 블록만 잡혀 불완전하므로 아예 제외.
                core_all = cs.get(0, {}).get("coreIdeas", []) if cs else []
                keep_core = core_all if ncs == 1 else []
                for i, g in enumerate(groups):
                    areas.append({"name": g["name"],
                                  "coreIdeas": keep_core if i == 0 else [],
                                  "elements": EMPTY_EL(), "standards": g["standards"]})
                report.setdefault(
                    "matrix_single" if ncs == 1 else "matrix_multi", []).append(title)
            else:
                # 단일 영역 과목(화법과 언어 등): 내용체계 전체를 한 영역으로.
                a = cs.get(0, {"name": "", "coreIdeas": [], "elements": EMPTY_EL()})
                allstd = [stx for g in groups for stx in g["standards"]]
                areas.append({"name": a["name"] or title, "coreIdeas": a["coreIdeas"],
                              "elements": a["elements"], "standards": allstd})

            areas = [a for a in areas
                     if a["coreIdeas"] or a["standards"] or any(a["elements"].values())]
            if not areas:
                continue
            subjects.append({
                "subject": title,
                "school": school,
                "doc": di,
                "ref": ref,
                "areas": areas,
            })
            doc_subj += 1
        report["docs"].append({"doc": di, "label": docs[di], "subjects": doc_subj})

    # ---- 검증: 부분 문자열 존재 (푸터 제거·공백 제거 후) --------------------
    src_ns = {}
    for di in range(len(docs)):
        raw, _ = build_doc_text(per[di])
        src_ns[di] = nospace(strip_footers(raw))

    total_ci = total_st = fail_ci = fail_st = 0
    kept = []
    for subj in subjects:
        di = subj["doc"]
        src = src_ns[di]
        clean_areas = []
        for a in subj["areas"]:
            ci_ok = []
            for ci in a["coreIdeas"]:
                total_ci += 1
                if nospace(ci) in src:
                    ci_ok.append(ci)
                else:
                    fail_ci += 1
                    report["subst_fail"].append(
                        {"doc": di, "subject": subj["subject"], "kind": "coreIdea",
                         "text": ci[:60]})
            st_ok = []
            for stx in a["standards"]:
                total_st += 1
                if nospace(stx["text"]) in src:
                    st_ok.append(stx)
                else:
                    fail_st += 1
                    report["subst_fail"].append(
                        {"doc": di, "subject": subj["subject"], "kind": "standard",
                         "code": stx["code"], "text": stx["text"][:60]})
            # 내용 요소도 부분문자열 검증(할루시네이션·오조립 항목 제외)
            for cat in a["elements"]:
                a["elements"][cat] = [e for e in a["elements"][cat]
                                      if nospace(e) in src]
            a["coreIdeas"] = ci_ok
            a["standards"] = st_ok
            clean_areas.append(a)
        subj["areas"] = [a for a in clean_areas
                         if a["coreIdeas"] or a["standards"]
                         or any(a["elements"].values())]
        if subj["areas"]:
            kept.append(subj)

    # ---- 중복 제거: 같은 (과목명, 학교급)이 여러 별책에 등장 -------------------
    # 별책4(고등)·과목별 별책(국어/수학/…)이 동일 과목을 중복 수록.
    # 성취기준 수가 가장 많은(가장 완전한) 블록만 남긴다.
    def norm_key(s):
        return (re.sub(r'\s+', '', s["subject"]), s["school"])

    best = {}
    for s in kept:
        k = norm_key(s)
        score = (sum(len(a["standards"]) for a in s["areas"]),
                 sum(len(a["coreIdeas"]) for a in s["areas"]))
        if k not in best or score > best[k][0]:
            best[k] = (score, s)
    dedup_removed = len(kept) - len(best)
    kept = [v[1] for v in best.values()]
    kept.sort(key=lambda s: (s["doc"], s["subject"]))
    report["dedup_removed"] = dedup_removed

    result = {"version": 1, "generatedFrom": os.path.basename(inp),
              "subjects": kept}

    with open(out, "w", encoding="utf-8") as w:
        json.dump(result, w, ensure_ascii=False, separators=(",", ":"))

    # ---- 리포트 ---------------------------------------------------------
    n_subj = len(kept)
    n_area = sum(len(s["areas"]) for s in kept)
    n_std = sum(len(a["standards"]) for s in kept for a in s["areas"])
    n_ci = sum(len(a["coreIdeas"]) for s in kept for a in s["areas"])
    print("=" * 70)
    print(f"OUT {out}  ({os.path.getsize(out):,} bytes)")
    print(f"과목(subject 블록): {n_subj}")
    print(f"영역(area): {n_area}")
    print(f"핵심 아이디어: {n_ci} (검증실패 제외 {fail_ci}/{total_ci})")
    print(f"성취기준: {n_std} (검증실패 제외 {fail_st}/{total_st})")
    print("-" * 70)
    print("문서별 과목 수:")
    for d in report["docs"]:
        print(f"  doc{d['doc']:>2} {d['subjects']:>3}과목  {d['label'][:44]}")
    sc = Counter(s["school"] for s in kept)
    print("학교급 분포:", dict(sc))
    print(f"중복 제거(동일 과목·학교급): {report.get('dedup_removed', 0)}건")
    ms = sorted(set(report.get("matrix_single", [])))
    mm = sorted(set(report.get("matrix_multi", [])))
    if ms:
        print(f"매트릭스형·단일블록(핵심아이디어=첫 영역에 통합 보존, 내용요소 제외): "
              f"{len(ms)}과목")
    if mm:
        print(f"매트릭스형·다중블록(영역명+성취기준만, 핵심아이디어·내용요소 제외): "
              f"{len(mm)}과목")
        print("  " + ", ".join(mm))
    if report["excluded"]:
        print("-" * 70)
        print(f"제외(학교급 판정 실패 등): {len(report['excluded'])}건")
        for e in report["excluded"][:20]:
            print(f"  doc{e['doc']} {e['title']} — {e['reason']}")
    if report["subst_fail"]:
        print("-" * 70)
        print(f"부분문자열 검증 실패(제외됨): {len(report['subst_fail'])}건 (상위 15)")
        for f in report["subst_fail"][:15]:
            print(f"  doc{f['doc']} [{f['kind']}] {f.get('code','')} "
                  f"{f['subject'][:12]} :: {f['text']}")
    print("=" * 70)


def st_first_name(st_seg, num):
    """성취기준 블록에서 영역번호 num의 영역명을 보조 조회(내용체계에 없을 때)."""
    for n, nm, _ in split_areas(strip_footers(st_seg)):
        if n == num:
            return nm
    return ""


if __name__ == "__main__":
    main()
