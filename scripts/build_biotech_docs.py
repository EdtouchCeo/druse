"""build_biotech_docs.py — 학생 제출 문서(hwp/docx)를 /biotech/docs/ 웹 페이지로 변환.

입력: input/ai기반생명공학문제해결활동/ 의 원본 문서
출력: output/web/biotech/docs/*.html (+ 원본 PDF 복사)

사용법: python scripts/build_biotech_docs.py
새 문서 추가 시 맨 아래 build() 안에 항목 하나를 추가한다.
갤러리 카드(보조 링크)는 output/web/biotech/index.html 의 PROJECTS 배열에서 관리한다.
"""
import io
import os
import re
import html
import zlib
import struct
import shutil

BASE = os.path.join("input", "ai기반생명공학문제해결활동")
OUT = os.path.join("output", "web", "biotech", "docs")

# ---------------------------------------------------------------- 페이지 셸
SHELL = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="{desc}">
<title>{title} | 대륜고등학교 AI 기반 생명공학 문제해결활동</title>
<link rel="canonical" href="{ogurl}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="대륜고 사용 설명서">
<meta property="og:locale" content="ko_KR">
<meta property="og:url" content="{ogurl}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="https://daeryun.life/biotech/og-biotech.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="https://daeryun.life/biotech/og-biotech.jpg">
<style>
:root{{--brand:#4f46e5;--brand-dark:#3730a3;--brand-soft:#eef2ff;--ink:#172033;--muted:#64748b;--line:#e2e8f0;--surface:#fff;--bg:#f8fafc}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:Pretendard,"Noto Sans KR",system-ui,-apple-system,sans-serif;line-height:1.72;word-break:keep-all;overflow-wrap:break-word}}
a{{color:var(--brand-dark)}}
.wrap{{width:min(880px,calc(100% - 32px));margin:auto}}
header{{background:linear-gradient(135deg,#312e81,#4f46e5 58%,#0f766e);color:#fff;padding:18px 0 46px}}
.top{{display:flex;align-items:center;justify-content:space-between;gap:20px}}
.identity{{display:flex;align-items:center;gap:12px;text-decoration:none;color:#fff}}
.identity img{{width:64px;height:46px;object-fit:contain;filter:drop-shadow(0 5px 12px rgba(0,0,0,.22))}}
.identity-name{{display:block;font-size:.98rem;font-weight:900;letter-spacing:-.02em}}
.identity-desc{{display:block;margin-top:1px;font-size:.74rem;color:#c7d2fe}}
.back{{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid rgba(255,255,255,.28);border-radius:999px;text-decoration:none;font-size:.84rem;color:#eef2ff;background:rgba(255,255,255,.08);white-space:nowrap}}
.back:hover{{background:rgba(255,255,255,.16)}}
.hero{{padding-top:34px}}
.eyebrow{{margin:0 0 8px;font-size:.8rem;font-weight:800;letter-spacing:.12em;color:#a7f3d0}}
h1{{margin:0;font-size:clamp(1.5rem,3.6vw,2.1rem);line-height:1.25;letter-spacing:-.03em}}
.sub{{margin:12px 0 0;color:#e0e7ff;font-size:1rem}}
main{{padding:0 0 64px}}
.doc{{margin-top:-26px;padding:38px 40px 44px;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 10px 32px rgba(15,23,42,.07)}}
.doc h2{{margin:38px 0 14px;padding-left:13px;border-left:5px solid var(--brand);font-size:1.32rem;letter-spacing:-.02em}}
.doc h2:first-child{{margin-top:0}}
.doc h3{{margin:26px 0 10px;font-size:1.08rem;color:var(--brand-dark);letter-spacing:-.01em}}
.doc h4{{margin:20px 0 8px;font-size:1rem;color:var(--brand-dark)}}
.doc p{{margin:0 0 14px}}
.doc ul,.doc ol{{margin:0 0 16px;padding-left:22px}}
.doc li{{margin-bottom:8px}}
.doc li>strong:first-child{{color:var(--brand-dark)}}
.doc table{{width:100%;margin:0 0 18px;border-collapse:collapse;font-size:.93rem}}
.doc th,.doc td{{padding:9px 11px;border:1px solid var(--line);text-align:left;vertical-align:top}}
.doc th{{background:var(--brand-soft);font-weight:800}}
.doc pre{{margin:0 0 18px;padding:16px;overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:#0f172a;color:#e2e8f0;font-size:.84rem;line-height:1.5}}
.doc code{{padding:1px 5px;border-radius:5px;background:#f1f5f9;font-size:.92em}}
.doc pre code{{padding:0;background:none;color:inherit}}
.pages{{display:flex;flex-direction:column;gap:20px}}
.pages figure{{margin:0}}
.pages img{{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:12px;box-shadow:0 6px 20px rgba(15,23,42,.08);background:#fff}}
.pages figcaption{{margin-top:6px;text-align:right;font-size:.78rem;color:var(--muted)}}
.origin{{margin:0 0 22px;padding:11px 14px;border-radius:11px;background:var(--brand-soft);font-size:.87rem;color:var(--brand-dark)}}
.notice{{margin-top:30px;padding:16px 18px;border-left:4px solid #f59e0b;border-radius:12px;background:#fffbeb;font-size:.86rem;color:#744210}}
.notice strong{{display:block;margin-bottom:3px;color:#713f12}}
.docfoot{{margin-top:18px;font-size:.85rem;color:var(--muted)}}
footer{{padding:24px 0;border-top:1px solid var(--line);color:var(--muted);text-align:center;font-size:.8rem}}
@media(max-width:640px){{.top{{flex-direction:column;align-items:flex-start}}.doc{{padding:26px 20px 30px}}}}
@media print{{header,.back,footer{{display:none}}.doc{{margin:0;border:0;box-shadow:none;padding:0}}}}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <div class="top">
      <a class="identity" href="../" aria-label="학생 결과물 전시관으로">
        <img src="../../logo.png" alt="대륜고등학교 로고">
        <span><span class="identity-name">대륜고 사용 설명서</span><span class="identity-desc">DAERYUN HIGH SCHOOL · 학생 결과물 전시관</span></span>
      </a>
      <a class="back" href="../">← 결과물 갤러리</a>
    </div>
    <div class="hero">
      <p class="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {subhtml}
    </div>
  </div>
</header>
<main class="wrap">
  <article class="doc">
{body}
    <aside class="notice">
      <strong>이용 안내</strong>
      이 문서는 교육 목적의 학생 프로젝트 산출물입니다. 사업성 추정, 건강·의료 관련 서술은 학생이 학습 과정에서 조사·작성한 내용이며 전문적인 조언이나 검증된 사실을 대신하지 않습니다.
    </aside>
  </article>
</main>
<footer><div class="wrap"><strong>대륜고 사용 설명서</strong><br>대륜고등학교 · AI 기반 생명공학 문제해결활동</div></footer>
{fbscript}</body>
</html>
"""


def esc(s):
    return html.escape(s, quote=False)


def inline(s):
    """**굵게**, *기울임*, `코드` 만 처리."""
    s = esc(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)", r"<em>\1</em>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


def page(name, title, eyebrow, sub, desc, body, slug=None, fbtitle=None):
    """문서 페이지 1개 생성. slug를 주면 갤러리와 같은 피드백 위젯이 함께 붙는다."""
    path = os.path.join(OUT, name)
    subhtml = '<p class="sub">%s</p>' % esc(sub) if sub else ""
    fbscript = ""
    if slug:
        fbscript = ('<script src="/biotech/feedback.js" data-fb-slug="%s" '
                    'data-fb-title="%s"></script>\n' % (slug, esc(fbtitle or title)))
    ogurl = "https://daeryun.life/biotech/docs/" + name
    os.makedirs(OUT, exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        SHELL.format(title=esc(title), eyebrow=esc(eyebrow), subhtml=subhtml,
                     desc=esc(desc), body=body, fbscript=fbscript, ogurl=ogurl))
    print("생성:", path)


# ---------------------------------------------------------------- hwp 본문 추출
def hwp_text(path):
    import olefile
    ole = olefile.OleFileIO(path)
    comp = bool(ole.openstream("FileHeader").read()[36] & 1)
    parts = {}
    for s in ole.listdir():
        if s[0] != "BodyText":
            continue
        d = ole.openstream(s).read()
        if comp:
            try:
                d = zlib.decompress(d, -15)
            except Exception:
                pass
        i, txt = 0, []
        while i + 4 <= len(d):
            h = struct.unpack("<I", d[i:i + 4])[0]
            tag, size = h & 0x3ff, (h >> 20) & 0xfff
            i += 4
            if size == 0xfff:
                size = struct.unpack("<I", d[i:i + 4])[0]
                i += 4
            if tag == 67:  # PARA_TEXT
                t = d[i:i + size].decode("utf-16le", "ignore")
                txt.append("".join(c if ord(c) > 31 else "\n" for c in t))
            i += size
        parts[s[1]] = "".join(txt)
    text = "\n".join(parts[k] for k in sorted(parts))
    # 스트림 머리에 섞여 나오는 제어 문자 잔재 제거
    junk = ("捤獥", "汤捯")
    return "\n".join(l.rstrip() for l in text.split("\n") if l.strip() not in junk)


def drop_lines(text, drop=(), between=None):
    lines = text.split("\n")
    if between:
        start, end = between
        try:
            i = next(n for n, l in enumerate(lines) if start in l)
            j = next(n for n, l in enumerate(lines) if n > i and end in l)
            lines = lines[:i] + lines[j + 1:]
        except StopIteration:
            pass
    return "\n".join(l for l in lines if not any(d in l for d in drop))


# ---------------------------------------------------------------- 마크다운 → HTML
def md_to_html(md):
    out, code = [], False
    ul = ol = quote = False
    table = []

    def close():
        nonlocal ul, ol, quote
        if ul:
            out.append("</ul>")
            ul = False
        if ol:
            out.append("</ol>")
            ol = False
        if quote:
            out.append("</blockquote>")
            quote = False

    def flush_table():
        """모아 둔 마크다운 표 줄을 <table>로 내보낸다(구분선 행은 헤더 판정에만 사용)."""
        if not table:
            return
        rows = [[c.strip() for c in r.strip().strip("|").split("|")] for r in table]
        sep = len(rows) > 1 and all(re.fullmatch(r":?-{2,}:?", c or "") for c in rows[1])
        out.append("<table>")
        for i, cells in enumerate(rows):
            if sep and i == 1:
                continue
            tag = "th" if (sep and i == 0) else "td"
            out.append("<tr>" + "".join("<%s>%s</%s>" % (tag, inline(c), tag) for c in cells) + "</tr>")
        out.append("</table>")
        table.clear()

    lines = md.split("\n")
    for raw in lines:
        line = raw.rstrip()

        # 표(| a | b |)는 연속 줄을 모아 한 번에 처리
        if not code and line.strip().startswith("|") and line.strip().endswith("|"):
            close()
            table.append(line.strip())
            continue
        if table:
            flush_table()

        if not code and re.fullmatch(r"\s*(-{3,}|\*{3,}|_{3,})\s*", line):
            close()
            continue

        if not code and line.lstrip().startswith(">"):
            body = line.lstrip()[1:].strip()
            if not quote:
                close()
                out.append("<blockquote>")
                quote = True
            if body:
                out.append("<p>%s</p>" % inline(body))
            continue
        if quote:  # 인용 블록은 '>' 가 끊기는 줄에서 닫는다
            close()
        if line.strip().startswith("```"):
            close()
            out.append("</pre>" if code else "<pre>")
            code = not code
            continue
        if code:
            out.append(esc(raw))
            continue
        if not line.strip():
            close()
            continue
        m = re.match(r"^\s*(#{1,4})\s+(.*)$", line)
        if m:
            close()
            level = min(max(len(m.group(1)), 2), 4)  # ## → h2 (h1은 페이지 제목이 사용)
            text = re.sub(r"^[\[\]📑\s]*", "", m.group(2)).strip()
            out.append("<h%d>%s</h%d>" % (level, inline(text), level))
            continue
        m = re.match(r"^\s*[*\-]\s+(.*)$", line)
        if m:
            if ol:
                out.append("</ol>")
                ol = False
            if not ul:
                out.append("<ul>")
                ul = True
            out.append("<li>%s</li>" % inline(m.group(1)))
            continue
        m = re.match(r"^\s*\d+[.)]\s+(.*)$", line)
        if m:
            if ul:
                out.append("</ul>")
                ul = False
            if not ol:
                out.append("<ol>")
                ol = True
            out.append("<li>%s</li>" % inline(m.group(1)))
            continue
        close()
        out.append("<p>%s</p>" % inline(line.strip()))
    flush_table()
    close()
    if code:
        out.append("</pre>")
    return "\n".join("    " + l for l in out)


# ---------------------------------------------------------------- 번호식 보고서 → HTML
def numbered_to_html(text, h2=r"^\d+\.\s", h3=r"^[가-하]\.\s"):
    out = []
    ul = False

    def close():
        nonlocal ul
        if ul:
            out.append("</ul>")
            ul = False

    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if re.match(h2, line):
            close()
            out.append("<h2>%s</h2>" % inline(line))
            continue
        if re.match(h3, line):
            close()
            out.append("<h3>%s</h3>" % inline(line))
            continue
        m = re.match(r"^[-•]\s*(.*)$", line)
        if m:
            if not ul:
                out.append("<ul>")
                ul = True
            out.append("<li>%s</li>" % inline(m.group(1)))
            continue
        m = re.match(r"^\d+\)\s*(.*)$", line)
        if m:
            if not ul:
                out.append("<ul>")
                ul = True
            out.append("<li>%s</li>" % inline(m.group(1)))
            continue
        close()
        out.append("<p>%s</p>" % inline(line))
    close()
    return "\n".join("    " + l for l in out)


# ---------------------------------------------------------------- docx → HTML
def docx_to_html(path, skip_first=0, h2_re=r"^\d+\.\s", h3_re=r"^\d+\.\d+\s?"):
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    from docx.oxml.ns import qn

    document = docx.Document(path)

    def blocks(parent):
        for child in parent.element.body.iterchildren():
            if child.tag == qn("w:p"):
                yield Paragraph(child, parent)
            elif child.tag == qn("w:tbl"):
                yield Table(child, parent)

    out, idx = [], 0
    ul = False

    def close():
        nonlocal ul
        if ul:
            out.append("</ul>")
            ul = False

    for b in blocks(document):
        if isinstance(b, Table):
            close()
            out.append("<table>")
            for r, row in enumerate(b.rows):
                cells = [esc(c.text.strip()).replace("\n", "<br>") for c in row.cells]
                tag = "th" if r == 0 else "td"
                out.append("<tr>" + "".join("<%s>%s</%s>" % (tag, c, tag) for c in cells) + "</tr>")
            out.append("</table>")
            continue
        text = b.text.strip()
        if not text:
            continue
        idx += 1
        if idx <= skip_first:
            continue
        style = (b.style.name if b.style is not None else "") or ""
        is_list = b._p.pPr is not None and b._p.pPr.numPr is not None
        if style.startswith("Heading 1") or re.match(h2_re, text):
            close()
            out.append("<h2>%s</h2>" % inline(text))
            continue
        if style.startswith("Heading 2") or re.match(h3_re, text):
            close()
            out.append("<h3>%s</h3>" % inline(text))
            continue
        if is_list or style == "List Paragraph" or re.match(r"^[-•]\s", text):
            if not ul:
                out.append("<ul>")
                ul = True
            out.append("<li>%s</li>" % inline(re.sub(r"^[-•]\s*", "", text)))
            continue
        close()
        out.append("<p>%s</p>" % inline(text))
    close()
    return "\n".join("    " + l for l in out)


def P(*parts):
    """OneDrive 동기화 파일명이 NFD로 저장된 경우가 있어, 정규화 무시 경로 탐색."""
    import unicodedata

    def norm(s):
        return unicodedata.normalize("NFC", s)

    cur = ""
    flat = [seg for part in parts for seg in re.split(r"[\\/]", part) if seg]
    for part in flat:
        candidates = os.listdir(cur if cur else ".")
        match = next((c for c in candidates if norm(c) == norm(part)), None)
        if match is None:
            raise FileNotFoundError(os.path.join(cur, part))
        cur = os.path.join(cur, match)
    return cur


def pdf_to_html(src, slug, scale=2.0, quality=80):
    """PDF의 각 쪽을 이미지로 렌더해 웹 페이지 본문 HTML을 만든다.

    디자인이 들어간 계획서·발표자료는 글자만 뽑으면 자간·배치가 깨지므로
    쪽 이미지를 그대로 싣고, 원본 PDF는 내려받기 링크로 함께 남긴다.
    """
    import fitz

    doc = fitz.open(src)
    imgdir = os.path.join(OUT, slug)
    os.makedirs(imgdir, exist_ok=True)
    for old in os.listdir(imgdir):           # 재실행 시 이전 산출 정리
        os.remove(os.path.join(imgdir, old))

    ext, total = "webp", 0
    out = ['<p class="origin">원본 PDF가 필요하면 '
           '<a href="./%s.pdf" download>여기서 내려받을 수 있습니다</a>.</p>' % slug,
           '<div class="pages">']
    for i, pg in enumerate(doc, 1):
        pix = pg.get_pixmap(matrix=fitz.Matrix(scale, scale))
        try:
            data = pix.tobytes(ext, jpg_quality=quality)
        except Exception:                     # webp 미지원 빌드 → jpeg
            ext = "jpg"
            data = pix.tobytes(ext, jpg_quality=quality)
        name = "p%02d.%s" % (i, ext)
        with open(os.path.join(imgdir, name), "wb") as f:
            f.write(data)
        total += len(data)
        out.append(
            '<figure><img src="./%s/%s" width="%d" height="%d" loading="lazy" '
            'alt="%d쪽" decoding="async"><figcaption>%d / %d</figcaption></figure>'
            % (slug, name, pix.width, pix.height, i, i, len(doc)))
    out.append("</div>")
    print("  쪽 이미지 %d장 (%s, %.1f MB)" % (len(doc), ext, total / 1048576))
    return "\n".join("    " + l for l in out)


def copy_pdf(src, name):
    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, name)
    shutil.copyfile(src, dst)
    print("복사:", dst, "(%.1f MB)" % (os.path.getsize(dst) / 1048576))


# ---------------------------------------------------------------- 실행
def build():
    # 1) 프로젝트 미러 — hwp(마크다운 서식) 기획·사업 계획 보고서
    src = P(BASE, "(B분반)김도윤(1학년), 박시윤(2-1), 하정재(2-2), 김태현(2-4)",
                       "(B분반)김도윤(1학년), 박시윤(2-1), 하정재(2-2), 김태현(2-4).hwp")
    text = drop_lines(hwp_text(src),
                      drop=("최종 결과물 링크", "10.88.183.33", "[최종 기획 및 사업 계획 보고서]"))
    page("mirror-plan.html",
         "프로젝트 미러 (Project Mirror)",
         "사업계획서",
         "생성형 AI 기반 치료 은닉형 기능성 게임 플랫폼",
         "고립 청년을 위한 치료 은닉형 힐링 RPG 《프로젝트 미러》 사업계획서",
         md_to_html(text),
         slug='mirror', fbtitle='프로젝트 미러')

    # 2) 세이프스캔 — hwp 사업 보고서(목차 블록 제거)
    src = P(BASE, "채준서,김성엽,변승현,정지우 AI기반 생명공학문제해결활동 결과물",
                       "사업계획서", "세이프스캔_사업보고서.hwp")
    text = drop_lines(hwp_text(src),
                      drop=("AI 식품 성분표 스캐너 '세이프스캔(SafeScan)' 사업 보고서",),
                      between=("[ 목차 ]", "9. 기대 효과 및 결론"))
    page("safescan-report.html",
         "세이프스캔(SafeScan) 사업계획서",
         "사업계획서",
         "AI 식품 성분표 스캐너 — 성분표를 찍으면 우리 가족이 먹어도 되는지",
         "AI 식품 성분표 스캐너 세이프스캔 사업계획서",
         numbered_to_html(text),
         slug='safescan', fbtitle='알레르기 세이프스캔')

    # 3) DERMATWIN — docx 사업계획서(제목 3줄 제외)
    src = P(BASE, "DERMATWIN_AI_Digital_Skin_Twin_사업계획서 (1).docx")
    page("dermatwin-plan.html",
         "DERMATWIN 사업계획서",
         "사업계획서",
         "AI 기반 Digital Skin Twin — 화장품 연구개발을 위한 가상 피부 모델",
         "AI 기반 디지털 피부 트윈 플랫폼 DERMATWIN 사업계획서",
         docx_to_html(src, skip_first=3),
         slug='dermatwin', fbtitle='디지털 피부 트윈')

    # 4) GenoTrack — docx 사업계획서(표지 5줄 제외)
    src = P(BASE, "TalkFile_AI 기반 개인 DNA 변화 추적 및 예방 의료 관리 플랫폼 (개정본).docx")
    page("genotrack-plan.html",
         "GenoTrack 사업계획서",
         "사업계획서",
         "AI 기반 개인 DNA 변화 추적 및 예방 의료 관리 플랫폼",
         "유전체 기준선과 후성유전·액체생검 종단 추적을 통합한 AI 정밀·예방의료 플랫폼 사업계획서",
         docx_to_html(src, skip_first=5),
         slug='genotrack', fbtitle='GenoTrack')

    # 5) 급식표 알레르겐 도구 — 마크다운 사업기획안
    src = P(BASE, "보고서 자료", "클로드", "급식-알레르기-교차반응-사업기획안.md")
    text = io.open(src, encoding="utf-8").read()
    text = drop_lines(text, drop=("# 사업기획안: 학교급식 알레르겐 확장 표시 도구",))
    page("mealcheck-plan.html",
         "학교급식 알레르겐 확장 표시 도구 사업계획서",
         "사업계획서",
         "법정 19종 밖 알레르겐 — 급식표가 말하지 않는 것",
         "학교급식 알레르기 표시 19종 밖 알레르겐과 교차반응을 보여주는 도구의 사업계획서",
         md_to_html(text),
         slug='mealcheck', fbtitle='급식표가 말하지 않는 것')

    # 6) PDF는 쪽 이미지로 렌더한 웹 페이지로 변환(원본은 내려받기 링크로 함께 게시)
    src = P(BASE, "aerovital (김민준, 한연우, 이준희)",
            "aerovital (김민준, 한연우, 이준희)", "AEROVITAL_사업계획서(디자인).pdf")
    copy_pdf(src, "aerovital-plan.pdf")
    page("aerovital-plan.html",
         "AEROVITAL 사업계획서",
         "사업계획서",
         "항공 종사자 생체 신호 모니터링 웨어러블",
         "항공 종사자의 건강과 안전을 지원하는 웨어러블 헬스케어 AEROVITAL 사업계획서",
         pdf_to_html(src, "aerovital-plan", scale=2.0),
         slug='aerovital', fbtitle='AEROVITAL')

    src = P(BASE, "채준서,김성엽,변승현,정지우 AI기반 생명공학문제해결활동 결과물",
            "사업계획서", "발표자료", "세이프스캔_발표.pdf")
    copy_pdf(src, "safescan-deck.pdf")
    page("safescan-deck.html",
         "세이프스캔 발표 자료",
         "발표 자료",
         "성분표를 찍으면, 우리 가족이 먹어도 되는지 3초 안에",
         "AI 식품 성분표 스캐너 세이프스캔 발표 자료",
         pdf_to_html(src, "safescan-deck", scale=2.0),
         slug='safescan', fbtitle='알레르기 세이프스캔')


if __name__ == "__main__":
    build()
