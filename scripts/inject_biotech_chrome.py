"""inject_biotech_chrome.py — 학생 결과물 페이지에 공통 요소를 넣는다(멱등).

넣는 것
  1) 파비콘   : 모든 /biotech/ 페이지 <head>
  2) 홈 링크  : 학생이 만든 프로젝트 페이지에만(갤러리로 돌아가는 떠 있는 알약)
                문서 페이지(docs/*.html)는 셸 머리말에 '← 결과물 갤러리'가 이미 있어 제외한다.

새 학생 페이지를 복사해 넣은 뒤 이 스크립트를 다시 실행하면 된다.
사용법: python scripts/inject_biotech_chrome.py
"""
import io
import os
import re

ROOT = os.path.join("output", "web", "biotech")

FAVICON = '<link rel="icon" href="/favicon.ico" sizes="any">'
HOME = '<script src="/biotech/home-link.js" data-dr-home%s defer></script>'

# 홈 링크를 넣을 페이지 → 알약 위치("" = 왼쪽 아래 기본)
# 아래쪽이 자기 UI로 가려지는 페이지만 왼쪽 위로 올린다.
PROJECT_PAGES = {
    "aerovital.html": "",
    "dermatwin.html": "",
    "ectoine.html": "",
    "resismap.html": "",
    "resismap-plan.html": "",
    "wheelchair.html": "",
    "mealcheck/index.html": "",
    "safescan/index.html": "",
    "safescan/app.html": "",
    "mirror/index.html": ' data-pos="top-left"',   # 하단 전체 폭 대화창
}


def read(path):
    return io.open(path, encoding="utf-8").read()


def write(path, s):
    io.open(path, "w", encoding="utf-8", newline="").write(s)


def add_favicon(s):
    if 'rel="icon"' in s or 'rel="shortcut icon"' in s:
        return s, False
    m = re.search(r"</title>", s) or re.search(r"<head[^>]*>", s, re.I)
    if not m:
        return s, False
    return s[:m.end()] + "\n" + FAVICON + s[m.end():], True


def add_home(s, pos):
    if "home-link.js" in s:
        return s, False
    tag = HOME % pos
    m = re.search(r"</body>", s, re.I)
    if m:
        return s[:m.start()] + tag + "\n" + s[m.start():], True
    return s + "\n" + tag + "\n", True


def main():
    fav = home = 0
    for dirpath, _, names in os.walk(ROOT):
        for n in sorted(names):
            if not n.endswith(".html"):
                continue
            path = os.path.join(dirpath, n)
            rel = os.path.relpath(path, ROOT).replace("\\", "/")
            s = orig = read(path)
            s, a = add_favicon(s)
            fav += a
            if rel in PROJECT_PAGES:
                s, b = add_home(s, PROJECT_PAGES[rel])
                home += b
                if b:
                    print("  홈 링크:", rel)
            if s != orig:
                write(path, s)
    missing = [p for p in PROJECT_PAGES if not os.path.exists(os.path.join(ROOT, p))]
    print("파비콘 %d건 추가 · 홈 링크 %d건 추가" % (fav, home))
    if missing:
        print("경고: 목록에 있으나 파일이 없음 →", ", ".join(missing))


if __name__ == "__main__":
    main()
