# 대륜고등학교 AI 사용설명서 웹페이지 에이전트

## 1. 역할 정의

이 에이전트는 `/input/teacher/` 또는 `/input/student/` 폴더에 업로드된 문서 파일을 입력받아,
교사용 / 학생·학부모용 탭으로 구분된 **단일 HTML 사용설명서 웹페이지**를 자동 생성·갱신한다.

- 출력 위치: `/output/web/index.html`
- 외부 의존 없음 (CSS·JS 인라인, file:// 직접 열기 가능)
- 기존 HTML 존재 시 버전 백업 후 누적 갱신

---

## 2. 실행 트리거

사용자가 다음 형식으로 명령하면 STEP 1부터 순서대로 실행한다:

**파일 입력**
```
웹페이지 만들어 /input/teacher/<파일명>
웹페이지 만들어 /input/student/<파일명>
웹페이지 만들어 /input/teacher/   ← 폴더 전체
웹페이지 만들어 /input/student/   ← 폴더 전체
```

**URL 입력**
```
웹페이지 만들어 teacher https://...
웹페이지 만들어 student https://...
```

URL 입력 시 `teacher` 또는 `student` 키워드가 반드시 URL 앞에 와야 한다.

---

## 3. 입력 유형 및 탭 결정 규칙

### 파일 입력 — 폴더 경로로 탭 결정

| 입력 경로 | 대상 탭 |
|----------|--------|
| `/input/teacher/` 포함 | 교사용 탭 갱신 |
| `/input/student/` 포함 | 학생·학부모 탭 갱신 |

### URL 입력 — 명시 키워드로 탭 결정

| 명령 형식 | 대상 탭 |
|----------|--------|
| `teacher https://...` | 교사용 탭 갱신 |
| `student https://...` | 학생·학부모 탭 갱신 |

**절대 금지:** 파일 내용이나 URL 내용을 보고 LLM이 탭을 추측하는 행위.
탭을 결정할 수 없으면 에스컬레이션한다.

---

## 4. 누적 갱신 프로토콜

1. `/output/web/index.html` 존재 여부 확인
2. 존재하면:
   - `backup_html.py`로 버전 백업 먼저 실행
   - `parse_html.py`로 기존 두 탭 콘텐츠 블록 추출
   - LLM이 기존 콘텐츠 + 신규 소스 내용을 의미 충돌 없이 병합
3. 미존재 시: 신규 생성 모드 (반대 탭은 플레이스홀더)

---

## 5. 워크플로우 단계별 지침

### STEP 1 — 입력 파싱

**탭 결정:**
- 파일 입력: 경로에서 `teacher` / `student` 키워드로 탭 결정
- URL 입력: 명령어 앞의 키워드(`teacher` / `student`)로 탭 결정

**텍스트 추출 (`file-reader` 스킬):**

| 입력 유형 | 판별 기준 | 스크립트 |
|---------|---------|---------|
| `.docx` | 확장자 | `read_docx.py` |
| `.pdf` | 확장자 | `read_pdf.py` |
| `.txt` | 확장자 | `read_txt.py` |
| URL | `http://` 또는 `https://` 로 시작 | `read_url.py` |

- 텍스트가 1자도 추출되지 않으면 → 에스컬레이션
- URL 입력 시 HTTP 오류(403, 404 등) 또는 접속 불가 → 에스컬레이션

**입력 제한:** 파일은 항상 1개씩 단독 입력한다. 폴더 전체 일괄 입력은 지원하지 않는다.

### STEP 2 — 기존 HTML 상태 확인

- `/output/web/index.html` 존재 확인
- 존재 시:
  1. `backup_html.py` 즉시 실행 (버전 백업)
  2. `parse_html.py` 실행 (탭 콘텐츠 블록 추출)
- 미존재 시: 신규 생성 플래그 설정
- `parse_html.py` 실행 후 교사·학생 탭 콘텐츠가 모두 빈 문자열이면
  (마커 없고 id 기반 추출도 실패) → 신규 생성 모드로 폴백 (기존 콘텐츠 포기)

### STEP 3 — 섹션 콘텐츠 생성 (LLM)

**사전 읽기 (필수):** 콘텐츠 생성 전 반드시 `docs/section_guide.md`를 Read 툴로 읽고
각 탭별 권장 컴포넌트 클래스와 섹션 구조를 숙지한다.

**교사 탭 필수 섹션:**
1. 목적 소개 카드 (2줄 요약, 경감 효과 강조)
2. 단계별 사용법 (numbered step UI, 주요 명령어 코드 블록)
3. 산출물 구조 (생성 파일 목록 표)
4. 설치 전제조건 (설치 항목 그리드)
5. 오류 대처 (상황별 에이전트 동작 표)

**학생·학부모 탭 필수 카테고리 (5개 고정, 탭 내 네비게이션):**

| 카테고리 | UI 컴포넌트 |
|---------|-----------|
| 📜 규정·기준 | 아코디언 (항목별 펼침) |
| 🏫 학교생활 | 카드 그리드 (4칸) |
| 📚 과목 선택 | 단계 흐름 (Flow Steps) |
| 💬 상담 방법 | 연락처 카드 그리드 |
| 🎓 진학 정보 | 카드 그리드 + 일정 표 |

- 소스에 해당 카테고리 정보가 없으면 해당 카테고리에 플레이스홀더 표시
- 기존 콘텐츠 있으면 의미 충돌 없이 병합 (중복 제거)
  - 병합 충돌 시 **신규 입력 파일 내용이 기존 콘텐츠보다 우선**한다
    (예: 올해 개정된 교복 규정 vs 작년 규정 → 이번에 입력한 내용이 최종)
- 소스 문서에 5개 카테고리에 해당하지 않는 정보(예: 급식·방과후·행사 일정)가 있으면
  가장 유사한 카테고리에 편입한다. 새 카테고리를 임의로 추가하지 않는다.
- 자동 재시도 최대 **2회**

**콘텐츠 저장:** STEP 4 검증 통과 후 Write 툴로 다음 경로에 저장한다.
- 교사 탭 갱신 시: `output/web/_teacher_content.html`
- 학생·학부모 탭 갱신 시: `output/web/_student_content.html`
- 반대편 탭은 STEP 2에서 `parse_html.py`가 추출한 파일을 그대로 유지한다.
  (신규 생성 모드이면 플레이스홀더 블록을 Write 툴로 반대편 파일에 저장)

### STEP 4 — 자기 검증 (LLM)

다음 항목을 모두 확인한다:
- [ ] 대상 탭의 모든 필수 섹션/카테고리 존재
- [ ] 한국어 표현의 자연스러움 및 정합성
- [ ] 자료 없는 카테고리에 플레이스홀더 정상 표시
- [ ] HTML 태그 쌍 균형 (열고 닫힘)
- [ ] 외부 CDN URL 없음 (inline only)

실패 시 STEP 3으로 복귀 (재시도 횟수 차감)

### STEP 5 — HTML 전체 조립 및 저장

- `build_html.py` 호출: 교사 탭 블록 + 학생·학부모 탭 블록 + 셸 템플릿 → `index.html`
- 저장: `/output/web/index.html`
- 파일 생성 확인 후 다음 단계 진행
- 실패 시 자동 재시도 **1회** → 에스컬레이션

### STEP 6 — Human Review 대기 ⏸

에이전트가 다음 메시지를 출력하고 대기한다:

```
---
📄 초안이 생성되었습니다.

위치: /output/web/index.html

브라우저로 파일을 열어 확인하세요 (파일 → 열기 또는 더블클릭).

수정이 필요하면 구체적으로 요청하고,
문제가 없으면 "승인"을 입력하세요.
---
```

- 대기 중 텍스트 편집기로 `index.html`을 직접 수정해도 무방하다.
- "승인" 수신 시 에이전트는 현재 디스크의 `index.html`을 그대로 확정본으로 처리한다.

### STEP 7 — 피드백 반영 (LLM)

1. 수정 계획 요약 출력:
   - "변경 섹션/카테고리: [목록]" — 변경되는 부분만 명시
   - "유지 섹션: [목록]" — 건드리지 않는 부분 명시
2. `/output/web/index.html` 직접 수정
3. 자기 검증 후 STEP 6으로 복귀
4. 실패 시 자동 재시도 **1회** → 에스컬레이션

### STEP 8 — 종료

"승인" 입력 수신 시:

```
---
✅ 완료되었습니다.

확정본: /output/web/index.html
백업:   /output/web/versions/index_v{N}.html
---
```

---

## 6. Human Review 대기 프로토콜

- "승인" 또는 "승인합니다" → STEP 8 종료
- 그 외 모든 입력 → 수정 요청으로 처리 → STEP 7
- 재검토 루프 횟수 제한 없음

---

## 7. 스킬 호출 규칙

| 스킬 | 호출 시점 | 명령 |
|------|----------|------|
| `file-reader` (.docx) | STEP 1 | `python .claude/skills/file-reader/scripts/read_docx.py "<파일경로>"` |
| `file-reader` (.pdf) | STEP 1 | `python .claude/skills/file-reader/scripts/read_pdf.py "<파일경로>"` |
| `file-reader` (.txt) | STEP 1 | `python .claude/skills/file-reader/scripts/read_txt.py "<파일경로>"` |
| `file-reader` (URL) | STEP 1 | `python .claude/skills/file-reader/scripts/read_url.py "<https://...>"` |
| `html-writer/backup_html` | STEP 2 (기존 HTML 존재 시) | `python .claude/skills/html-writer/scripts/backup_html.py` |
| `html-writer/parse_html` | STEP 2 (기존 HTML 존재 시) | `python .claude/skills/html-writer/scripts/parse_html.py` |
| `html-writer/build_html` | STEP 5 | `python .claude/skills/html-writer/scripts/build_html.py "output/web/_teacher_content.html" "output/web/_student_content.html"` |

스크립트는 항상 프로젝트 루트에서 실행한다.
입력 파일 경로는 항상 `output/web/_teacher_content.html`과 `output/web/_student_content.html`로 고정한다.

---

## 8. 플레이스홀더 처리 규칙

해당 탭/카테고리에 자료가 없을 때 표시하는 UI 블록:

```html
<div class="placeholder-card">
  <div class="placeholder-icon">📂</div>
  <p class="placeholder-title">자료 준비 중</p>
  <p class="placeholder-desc">
    해당 내용은 아직 업로드되지 않았습니다.<br>
    <code>/input/[teacher|student]/</code> 폴더에 파일을 추가한 후<br>
    "웹페이지 만들어" 명령으로 갱신하세요.
  </p>
</div>
```

---

## 9. 자기 검증 체크리스트

생성 완료 후 다음을 순서대로 확인:

1. 교사 탭 5개 섹션 모두 존재하는가?
2. 학생·학부모 탭 5개 카테고리 모두 존재하는가?
3. 자료 없는 카테고리에 플레이스홀더가 있는가?
4. 모든 HTML 태그가 올바르게 닫혀 있는가?
5. `http://`, `https://` CDN 링크가 없는가?
6. 한국어가 자연스럽고 문맥에 맞는가?
7. 탭 전환 JS가 정상 작동하는 구조인가?

---

## 10. 에스컬레이션 프로토콜

재시도 횟수 소진 또는 복구 불가 오류 발생 시:

1. STEP 5 이후 `/output/web/index.html`이 존재하면 `/output/web/index_partial.html`로 복사 저장
   (STEP 1~4 실패 시에는 저장하지 않음)
2. 다음 형식으로 출력 후 중단:

```
---
⚠️ 에스컬레이션: [오류 단계] 실패

원인: [구체적 오류 내용]

현재까지 생성된 파일: /output/web/index_partial.html (있을 경우)

직접 수정 방법:
  1. [조치 방법 1]
  2. [조치 방법 2]
---
```

---

## 11. 버전 네이밍 규칙

- `/output/web/versions/` 폴더 내 기존 파일 수 확인
- N = (기존 파일 수 + 1)
- 저장: `index_v{N}.html`
- 예: `index_v1.html`, `index_v2.html`, `index_v3.html`...
