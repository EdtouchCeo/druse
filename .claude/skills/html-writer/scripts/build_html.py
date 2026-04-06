"""build_html.py — 탭 콘텐츠 블록 + 셸 템플릿 → output/web/index.html

사용법:
  python .claude/skills/html-writer/scripts/build_html.py \
    "output/web/_teacher_content.html" \
    "output/web/_student_content.html" \
    ["output/web/_school_content.html"]   ← 선택 인수
"""
import sys
import os

TEMPLATE = os.path.join(".claude", "skills", "html-writer", "references", "shell_template.html")
OUTPUT = os.path.join("output", "web", "index.html")

SCHOOL_PLACEHOLDER  = "<!-- SCHOOL_CONTENT_PLACEHOLDER -->"
TEACHER_PLACEHOLDER = "<!-- TEACHER_CONTENT_PLACEHOLDER -->"
STUDENT_PLACEHOLDER = "<!-- STUDENT_CONTENT_PLACEHOLDER -->"

SCHOOL_CONTENT_DEFAULT = os.path.join("output", "web", "_school_content.html")


def _read(path: str, label: str) -> str:
    if not os.path.exists(path):
        print(f"오류: {label} 파일 없음 — {path}", file=sys.stderr)
        sys.exit(1)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def build(teacher_file: str, student_file: str, school_file: str = None):
    template = _read(TEMPLATE, "셸 템플릿")
    teacher_content = _read(teacher_file, "교사 탭 콘텐츠")
    student_content = _read(student_file, "학생 탭 콘텐츠")

    # 학교 소개 콘텐츠: 명시 파일 > 기존 저장 파일 > 빈 플레이스홀더
    if school_file and os.path.exists(school_file):
        with open(school_file, "r", encoding="utf-8") as f:
            school_content = f.read()
    elif os.path.exists(SCHOOL_CONTENT_DEFAULT):
        with open(SCHOOL_CONTENT_DEFAULT, "r", encoding="utf-8") as f:
            school_content = f.read()
    else:
        school_content = (
            '<div class="placeholder-card">'
            '<div class="placeholder-icon">🏫</div>'
            '<p class="placeholder-title">학교 소개 준비 중</p>'
            '<p class="placeholder-desc">학교알리미 URL을 입력하면 자동 생성됩니다.</p>'
            '</div>'
        )

    for marker, label in [(TEACHER_PLACEHOLDER, "TEACHER"), (STUDENT_PLACEHOLDER, "STUDENT"), (SCHOOL_PLACEHOLDER, "SCHOOL")]:
        if marker not in template:
            print(f"오류: 템플릿에 {label} 플레이스홀더가 없습니다.", file=sys.stderr)
            sys.exit(1)

    html = template.replace(SCHOOL_PLACEHOLDER,  school_content)
    html = html.replace(TEACHER_PLACEHOLDER, teacher_content)
    html = html.replace(STUDENT_PLACEHOLDER, student_content)

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"HTML 생성 완료: {OUTPUT}")

    # 임시 콘텐츠 파일 삭제 (school은 영구 보존)
    for tmp in [teacher_file, student_file]:
        try:
            os.remove(tmp)
        except OSError:
            pass

    return OUTPUT


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("사용법: python build_html.py <teacher_content.html> <student_content.html> [school_content.html]", file=sys.stderr)
        sys.exit(1)

    school_arg = sys.argv[3] if len(sys.argv) >= 4 else None
    build(sys.argv[1], sys.argv[2], school_arg)
