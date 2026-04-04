"""parse_html.py — 기존 index.html에서 교사/학생 탭 콘텐츠 블록 추출

출력:
  output/web/_teacher_content.html  — 교사 탭 내부 콘텐츠
  output/web/_student_content.html  — 학생·학부모 탭 내부 콘텐츠
"""
import sys
import os
import re

SOURCE = os.path.join("output", "web", "index.html")
TEACHER_OUT = os.path.join("output", "web", "_teacher_content.html")
STUDENT_OUT = os.path.join("output", "web", "_student_content.html")


def extract_tab_content(html: str, tab_id: str) -> str:
    """id="tab-{tab_id}" 패널 내부 콘텐츠 추출"""
    pattern = rf'<div[^>]+id=["\']tab-{re.escape(tab_id)}["\'][^>]*>(.*?)</div\s*>\s*(?=<div[^>]+id=["\']tab-|</main>)',
    # 더 안정적인 방법: 마커 주석 기반 추출
    start_marker = f'<!-- TAB:{tab_id}:START -->'
    end_marker = f'<!-- TAB:{tab_id}:END -->'

    start_idx = html.find(start_marker)
    end_idx = html.find(end_marker)

    if start_idx != -1 and end_idx != -1:
        return html[start_idx + len(start_marker):end_idx].strip()

    # 마커 없으면 id 기반 div 추출 시도
    pattern = rf'<div[^>]+id=["\']tab-{re.escape(tab_id)}["\'][^>]*>'
    match = re.search(pattern, html, re.IGNORECASE)
    if not match:
        return ""

    start = match.end()
    # 중첩 div 깊이 추적
    depth = 1
    pos = start
    while pos < len(html) and depth > 0:
        open_tag = html.find('<div', pos)
        close_tag = html.find('</div>', pos)
        if close_tag == -1:
            break
        if open_tag != -1 and open_tag < close_tag:
            depth += 1
            pos = open_tag + 4
        else:
            depth -= 1
            if depth == 0:
                return html[start:close_tag].strip()
            pos = close_tag + 6

    return ""


def parse():
    if not os.path.exists(SOURCE):
        print(f"오류: {SOURCE}를 찾을 수 없습니다.", file=sys.stderr)
        sys.exit(1)

    with open(SOURCE, "r", encoding="utf-8") as f:
        html = f.read()

    teacher_content = extract_tab_content(html, "teacher")
    student_content = extract_tab_content(html, "student")

    os.makedirs(os.path.dirname(TEACHER_OUT), exist_ok=True)

    with open(TEACHER_OUT, "w", encoding="utf-8") as f:
        f.write(teacher_content)
    print(f"교사 탭 추출 완료: {TEACHER_OUT} ({len(teacher_content)}자)")

    with open(STUDENT_OUT, "w", encoding="utf-8") as f:
        f.write(student_content)
    print(f"학생·학부모 탭 추출 완료: {STUDENT_OUT} ({len(student_content)}자)")


if __name__ == "__main__":
    parse()
