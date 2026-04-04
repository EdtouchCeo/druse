# 탭별 권장 섹션 구조 참고

## 교사 탭 (5개 필수 섹션)

### 1. 목적 소개 카드
- UI: `.card` with border-left accent
- 내용: 2줄 요약, 업무 경감 효과 수치/효과 강조
- 예: "반복 매뉴얼 제작 시간을 90% 단축합니다"

### 2. 단계별 사용법
- UI: `.flow-steps` (numbered step)
- 각 단계에 명령어가 있으면 `<pre><code>` 블록 포함
- 최소 3단계, 최대 8단계 권장

### 3. 산출물 구조
- UI: `.data-table`
- 컬럼: 파일명 | 위치 | 설명
- 생성되는 모든 파일 나열

### 4. 설치 전제조건
- UI: `.install-grid`
- 항목: Python 버전, 라이브러리, 설치 명령어
- 설치 확인 명령어 코드 블록 포함

### 5. 오류 대처
- UI: `.data-table`
- 컬럼: 상황 | 에이전트 동작 | 직접 조치 방법
- 실제 발생 가능한 오류 5가지 이상 기술

---

## 학생·학부모 탭 (5개 카테고리, 탭 내 네비게이션)

카테고리 간 이동은 `.sub-nav` + `.sub-nav-btn` + `.sub-panel` 구조 사용.
각 카테고리 panel id: `sub-rules`, `sub-life`, `sub-subject`, `sub-counsel`, `sub-univ`

### 1. 📜 규정·기준 (`sub-rules`)
- UI: `.accordion`
- 아코디언 항목: 각 규정 제목 → 펼치면 세부 내용
- 교복 규정, 출결 기준, 상벌점 등

### 2. 🏫 학교생활 (`sub-life`)
- UI: `.card-grid` (4칸)
- 핵심 수치를 `.value` + `.label` 형식으로 강조
- 예: 수업 시간, 급식 시간, 동아리 수, 학급 수

### 3. 📚 과목 선택 (`sub-subject`)
- UI: `.flow-steps`
- 순서가 있는 절차 (수강신청, 상담, 확정 단계 등)

### 4. 💬 상담 방법 (`sub-counsel`)
- UI: `.contact-grid`
- 상담 유형별 담당자, 연락처, 운영 시간

### 5. 🎓 진학 정보 (`sub-univ`)
- UI: `.card-grid` + `.data-table` (일정 표)
- 카드: 입시 유형별 요약
- 표: 주요 일정 (날짜 | 항목 | 내용)

---

## 플레이스홀더 사용 기준

자료가 없는 카테고리에는 반드시 다음 블록을 삽입:

```html
<div class="placeholder-card">
  <div class="placeholder-icon">📂</div>
  <p class="placeholder-title">자료 준비 중</p>
  <p class="placeholder-desc">
    해당 내용은 아직 업로드되지 않았습니다.<br>
    <code>/input/student/</code> 폴더에 파일을 추가한 후<br>
    "웹페이지 만들어" 명령으로 갱신하세요.
  </p>
</div>
```

---

## HTML 컴포넌트 클래스 빠른 참조

| 컴포넌트 | 클래스 | 설명 |
|---------|--------|------|
| 기본 카드 | `.card` | 좌측 border accent 카드 |
| 섹션 제목 | `.section-title` | 구분선 포함 큰 제목 |
| 카드 그리드 | `.card-grid` > `.grid-card` | 수치 강조 그리드 |
| 단계 흐름 | `.flow-steps` > `.flow-step` | 번호 순서 카드 |
| 아코디언 | `.accordion` > `.accordion-item` | 펼침/접힘 항목 |
| 연락처 그리드 | `.contact-grid` > `.contact-card` | 연락처 카드 |
| 데이터 표 | `.data-table` | 헤더 컬러 표 |
| 설치 그리드 | `.install-grid` > `.install-item` | 설치 항목 좌측 녹색 border |
| 플레이스홀더 | `.placeholder-card` | 자료 없음 안내 |
| 학생 탭 내 네비 | `.sub-nav` > `.sub-nav-btn` | 카테고리 전환 버튼 |
| 학생 탭 패널 | `.sub-panel` | 카테고리별 콘텐츠 영역 |
