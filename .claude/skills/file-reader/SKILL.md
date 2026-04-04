# file-reader 스킬

## 역할

입력 소스(파일 또는 URL)를 감지하여 적절한 파서 스크립트를 호출하고, 텍스트를 추출한다.

## 지원 형식

| 입력 유형 | 판별 기준 | 스크립트 | 라이브러리 |
|---------|---------|---------|----------|
| `.docx` | 확장자 | `scripts/read_docx.py` | python-docx |
| `.pdf` | 확장자 | `scripts/read_pdf.py` | pymupdf (fitz) |
| `.txt` | 확장자 | `scripts/read_txt.py` | 내장 |
| URL | `http://` 또는 `https://` 시작 | `scripts/read_url.py` | 내장 (urllib, html.parser) |

## 호출 방법

```bash
python .claude/skills/file-reader/scripts/read_docx.py "input/teacher/파일.docx"
python .claude/skills/file-reader/scripts/read_pdf.py "input/student/파일.pdf"
python .claude/skills/file-reader/scripts/read_txt.py "input/teacher/파일.txt"
python .claude/skills/file-reader/scripts/read_url.py "https://example.com/page"
```

## URL 입력 특이사항

- 외부 인터넷 연결 필요
- 추출 텍스트 앞에 `[페이지 제목]`과 `[출처]` 자동 포함
- script/style/nav/footer 등 비본문 태그 자동 제거
- HTTP 인코딩 헤더 → meta charset 순서로 인코딩 자동 감지 (한국어 사이트 CP949/EUC-KR 포함)
- 접속 타임아웃: 15초

## 출력

- stdout에 추출된 텍스트 출력
- 오류 시 stderr에 메시지 출력 후 exit code 1

## 전제조건 설치

```bash
pip install python-docx pymupdf
```

URL 입력은 추가 설치 불필요 (Python 내장 모듈 사용)
