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

## 직관적인 입력·실행 화면 기준 (2026-09-14)

화면 관련 작업 전에 `../../../docs/interface-standard.md`를 읽는다. 행동과 입력을 먼저 보이고 설명은 최소로 유지한다. 각 입력의 예시는 항상 보이는 라벨을 대신하지 않으며 실제 값으로 자동 저장하지 않는다. 필수 권한·형식·데이터 조건은 관련 행동 가까이에 두고, 상세 절차는 매뉴얼의 해당 절로 연결한다. 모바일·키보드·한글 줄바꿈, 학생 결과의 구체성, 기존 기능·권한·데이터 경계를 함께 확인한다. 참조 경로는 프로젝트 루트의 `docs/interface-standard.md`다. 매뉴얼 생성 전 상세 절차와 업무 화면의 짧은 안내를 구분하고, 기존 탭·검색·로그인 기능을 함께 보존한다.
