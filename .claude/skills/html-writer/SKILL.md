# html-writer 스킬

## 역할

세 개의 스크립트로 HTML 생성·파싱·백업을 처리한다.

## 스크립트 목록

| 스크립트 | 역할 | 호출 시점 |
|---------|------|----------|
| `backup_html.py` | 기존 index.html을 versions/ 폴더에 백업 | STEP 2 — 기존 HTML 존재 직후 |
| `parse_html.py` | 기존 index.html에서 탭 콘텐츠 블록 추출 | STEP 2 — 백업 직후 |
| `build_html.py` | 탭 콘텐츠 블록 + 셸 템플릿 → index.html | STEP 5 — 콘텐츠 검증 통과 후 |

## 셸 템플릿

위치: `.claude/skills/html-writer/references/shell_template.html`

## 호출 방법

```bash
# 백업 (기존 index.html 존재 시)
python .claude/skills/html-writer/scripts/backup_html.py

# 기존 탭 블록 추출
python .claude/skills/html-writer/scripts/parse_html.py

# HTML 조립 (LLM이 생성한 콘텐츠 파일을 인자로 전달)
python .claude/skills/html-writer/scripts/build_html.py \
  "output/web/_teacher_content.html" \
  "output/web/_student_content.html"
```

## 중간 콘텐츠 파일 규칙

LLM은 STEP 3 완료 후 탭 콘텐츠 블록을 다음 위치에 저장:
- 교사 탭: `output/web/_teacher_content.html`
- 학생·학부모 탭: `output/web/_student_content.html`

`build_html.py` 실행 후 이 임시 파일들은 자동 삭제된다.
