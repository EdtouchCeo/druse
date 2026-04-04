"""build_html.py — 탭 콘텐츠 블록 + 셸 템플릿 → output/web/index.html

사용법:
  python .claude/skills/html-writer/scripts/build_html.py \
    "output/web/_teacher_content.html" \
    "output/web/_student_content.html"
"""
import sys
import os

TEMPLATE = os.path.join(".claude", "skills", "html-writer", "references", "shell_template.html")
OUTPUT = os.path.join("output", "web", "index.html")

TEACHER_PLACEHOLDER = "<!-- TEACHER_CONTENT_PLACEHOLDER -->"
STUDENT_PLACEHOLDER = "<!-- STUDENT_CONTENT_PLACEHOLDER -->"


def build(teacher_file: str, student_file: str):
    # 셸 템플릿 읽기
    if not os.path.exists(TEMPLATE):
        print(f"오류: 셸 템플릿을 찾을 수 없습니다 — {TEMPLATE}", file=sys.stderr)
        sys.exit(1)

    with open(TEMPLATE, "r", encoding="utf-8") as f:
        template = f.read()

    # 교사 탭 콘텐츠 읽기
    if not os.path.exists(teacher_file):
        print(f"오류: 교사 탭 콘텐츠 파일 없음 — {teacher_file}", file=sys.stderr)
        sys.exit(1)

    with open(teacher_file, "r", encoding="utf-8") as f:
        teacher_content = f.read()

    # 학생·학부모 탭 콘텐츠 읽기
    if not os.path.exists(student_file):
        print(f"오류: 학생 탭 콘텐츠 파일 없음 — {student_file}", file=sys.stderr)
        sys.exit(1)

    with open(student_file, "r", encoding="utf-8") as f:
        student_content = f.read()

    # 플레이스홀더 치환
    if TEACHER_PLACEHOLDER not in template:
        print(f"오류: 템플릿에 {TEACHER_PLACEHOLDER} 마커가 없습니다.", file=sys.stderr)
        sys.exit(1)

    if STUDENT_PLACEHOLDER not in template:
        print(f"오류: 템플릿에 {STUDENT_PLACEHOLDER} 마커가 없습니다.", file=sys.stderr)
        sys.exit(1)

    html = template.replace(TEACHER_PLACEHOLDER, teacher_content)
    html = html.replace(STUDENT_PLACEHOLDER, student_content)

    # 출력
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"HTML 생성 완료: {OUTPUT}")

    # 임시 콘텐츠 파일 삭제
    for tmp in [teacher_file, student_file]:
        try:
            os.remove(tmp)
        except OSError:
            pass

    return OUTPUT


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("사용법: python build_html.py <teacher_content.html> <student_content.html>", file=sys.stderr)
        sys.exit(1)

    build(sys.argv[1], sys.argv[2])
