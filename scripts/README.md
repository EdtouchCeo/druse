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

### 2) raw md → 검색 인덱스 JSON
조문(`제N조`) 단위 또는 페이지/길이 기준으로 청크를 만들어 검색용 JSON을 생성합니다.

```bash
python scripts/build_index.py "data/법령지침_raw.md" "output/web/data/law_search.json"
python scripts/build_index.py "data/교육과정_raw.md" "output/web/data/curr_search.json"
```

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
- 모델: 기본 `text-embedding-004`(768차원). 바꾸려면 `EMBED_MODEL`·`EMBED_DIM` 환경변수와
  Netlify의 `EMBED_MODEL`을 **동일하게** 맞추고, 프론트(`output/web/index.html`)의 `EMB_DIM`도 일치시킬 것.
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
