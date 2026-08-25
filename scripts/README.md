# 통합검색 데이터 생성 스크립트

업무 매뉴얼(교사 전용) → 🔎 통합검색의 **법령·지침 검색기 / 교육과정 검색기**가 사용하는
검색 인덱스 JSON을 생성·갱신하는 스크립트입니다.

## 파이프라인

```
input/teacher/법령지침/*.{pdf,pptx,hwpx}   ──┐
input/teacher/교육과정/*.pdf                 ─┤ (1) extract_folder.py
                                              ▼
            data/법령지침_raw.md  /  data/교육과정_raw.md   ← 검색용 raw 텍스트
                                              │ (2) build_index.py
                                              ▼
   output/web/data/law_search.json  /  output/web/data/curr_search.json   ← 웹페이지가 fetch
```

## 사용법

### 1) 원본 문서 → raw md 추출
PDF / PPTX / HWPX에서 텍스트를 뽑아 폴더당 하나의 md로 정리합니다.

```bash
python scripts/extract_folder.py "input/teacher/법령지침" "data/법령지침_raw.md" "법령 · 지침 검색 데이터"
python scripts/extract_folder.py "input/teacher/교육과정" "data/교육과정_raw.md" "교육과정 검색 데이터"
```

⚠️ **글자가 이미지·도형뿐인 인쇄물**(리플렛 등)은 여기서 0자가 나와 "추출하지 못했습니다" 자리표시자 청크가 만들어진다.
그런 파일은 `extract_folder.py` 맨 위 `SKIP`에 등록해 건너뛰고, 쪽을 판독한 문면을 `data/sources/*.json`에 두어
`build_law_extras.py`가 덧붙이게 한다(현재 등록: 교육활동 보호 가이드 리플렛).

### 2) raw md → 검색 인덱스 JSON
조문(`제N조`) 단위 또는 페이지/길이 기준으로 청크를 만들어 검색용 JSON을 생성합니다.

```bash
python scripts/build_index.py "data/법령지침_raw.md" "output/web/data/law_search.json"
python scripts/build_index.py "data/교육과정_raw.md" "output/web/data/curr_search.json"
```

### 2-1) 웹에서 수집한 소스 덧붙이기 (law 전용)
`input/` 폴더의 파일이 아니라 웹에서 수집한 자료(국가법령정보센터 조문, 교육청 Q&A 사이트)는
`data/sources/*.json`에 원본 형태로 보관하고, 아래 스크립트가 `law_search.json` **맨 뒤에** 문서로 덧붙입니다.

```bash
python scripts/build_law_extras.py     # ← 반드시 build_index.py 다음에
python scripts/build_law_struct.py     # 조문 결정 주입 사전 재생성
```

⚠️ `build_index.py`를 다시 돌리면 덧붙인 문서가 사라집니다. **(2) → (2-1) → (2-2) 순서를 항상 지킬 것.**
맨 뒤에만 붙으므로 앞선 청크 순서가 보존되고, 임베딩은 새 청크만 이어서 생성됩니다.

현재 수록:
- `data/sources/hakpok_enforcement_decree.json` — 학교폭력예방 및 대책에 관한 법률 시행령(본칙 45개 조문)
- `data/sources/ddeqna_qa.json` — 든든첵 학교폭력 사안처리 Q&A 394건(대구광역시교육청, https://ddeqna.netlify.app/)
- `data/sources/dge_teacher_protection_guide.json` — 선생님을 위한 2026 교육활동 보호 가이드(대구광역시교육청 리플렛 11쪽)
  ※ 원본 PDF는 `input/teacher/법령지침/`에 있으나 **글자가 전부 이미지·도형이라 extract_folder.py가 0자를 뽑는다.**
  쪽을 판독해 옮긴 문면을 이 JSON에 보관한다. 같은 사정의 인쇄물이 또 생기면 같은 형식(`sections`)으로 추가하고
  `build_law_extras.py`의 `extras` 목록 **맨 뒤에** 등록한다(뒤에 붙어야 앞 청크 순서가 보존돼 임베딩 이어받기가 유효).

### 2-3) 임베딩 — 문서가 목록 가운데로 들어왔을 때
`build_embeddings.py`의 이어받기는 청크가 **뒤에만** 붙을 때만 유효하다. 파일명 정렬상 앞쪽에 새 문서가
들어오면 그 뒤 청크가 전부 밀려 이어받기를 못 쓰는데, 전부 다시 만들면 멀쩡한 벡터 수천 개를 버리게 된다.
이때는 **본문이 같으면 벡터도 같다**는 성질을 이용해 옛 짝에서 재사용한다.

```bash
cp output/web/data/law_search.json /tmp/prev.json   # 재빌드 전에 옛 짝을 반드시 보관
cp output/web/data/law_emb.bin     /tmp/prev.bin
#  (1)~(2-2) 재실행 후
python scripts/build_embeddings_reuse.py output/web/data/law_search.json output/web/data/law_emb.bin \n       --prev /tmp/prev.json /tmp/prev.bin --endpoint https://daeryun.life/.netlify/functions/embed
```
실제 사례: 개인정보 길잡이 1건 추가로 청크가 2,149→2,262가 됐지만 재사용 2,149 · 신규 113개만 생성.

### 3) 커밋 대상
- **반드시 커밋**: `output/web/data/law_search.json`, `output/web/data/curr_search.json`
  (Netlify publish 디렉터리가 `output/web`이므로 이 파일이 있어야 사이트에서 검색이 동작)
- 선택: `data/*_raw.md` (중간 산출물, 용량이 큼)

## 문서 추가/교체 시
1. `input/teacher/법령지침/` 또는 `input/teacher/교육과정/`에 파일 추가·교체
2. 위 (1) → (2) 순서로 재실행
3. `output/web/data/*_search.json` 커밋·푸시
4. (의미검색을 쓰는 경우) 아래 (3) 임베딩도 재생성·커밋

## (3) 임베딩 생성 → 의미검색 RAG (선택, 1회/데이터 갱신 시)
챗봇은 임베딩 `.bin`이 있으면 **의미검색**으로, 없으면 **키워드 검색**으로 자동 동작합니다.
의미검색을 켜려면 청크 임베딩을 만들어 커밋하세요. (Google API 키 필요)

```bash
# Windows CMD:  set GEMINI_API_KEY=...      bash:  export GEMINI_API_KEY=...
python scripts/build_embeddings.py "output/web/data/law_search.json"  "output/web/data/law_emb.bin"
python scripts/build_embeddings.py "output/web/data/curr_search.json" "output/web/data/curr_emb.bin"
```
- 생성된 `output/web/data/law_emb.bin`, `curr_emb.bin`을 **커밋·푸시**하면 자동으로 의미검색 전환.
- 모델: 기본 `gemini-embedding-001`, 출력 **768차원**(outputDimensionality). 바꾸려면
  `EMBED_MODEL`·`EMBED_DIM` 환경변수, Netlify의 `EMBED_MODEL`, 프론트의 `EMB_DIM`을 **모두 동일하게** 맞출 것.
- 이 모델은 동기 batch를 지원하지 않아 단건 호출을 스레드로 병렬화한다. 무료 한도(분당/일일 요청 수)에
  걸리면 자동 재시도하며, 끊겨도 같은 명령을 다시 실행하면 `.bin` 크기를 보고 **남은 청크만 이어서** 처리한다.
- 질문 임베딩은 `netlify/functions/embed.js`가 같은 `GEMINI_API_KEY`로 처리(서버에 키 보관).
- 청크 순서 = `_search.json`의 chunks 순서 = `.bin`의 벡터 순서(일대일). 한쪽만 바꾸면 안 됨.

## 필요 패키지
```
pip install pymupdf python-pptx lxml
```

## 참고
- HWPX는 ZIP(+XML) 구조를 직접 파싱합니다(`Contents/section*.xml`의 텍스트 런 추출).
- 표 이미지 위주의 PDF(예: 경조사별 휴가 일수표)는 텍스트가 거의 추출되지 않을 수 있습니다.
  이 경우 해당 표를 별도 텍스트로 정리하거나 OCR이 필요합니다.
- 검색 UI/엔진은 `output/web/index.html`의 `통합검색 엔진 JS` 블록에 인라인으로 들어 있습니다.
