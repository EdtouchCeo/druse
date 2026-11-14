# /evalplan/·/record/·/backward/ 재빌드

`output/web/evalplan`, `output/web/record`, `output/web/backward`는 빌드 산출물이다. 원본은 다른 저장소에 있다.

| 화면 | 원본 | 이 폴더에 있는 것 |
|---|---|---|
| `/evalplan/` | edtouch01 `v2` (EvalPlanView, lib/evalPlan) | `evalplan/` 진입 파일·셸·서버 AI 연결, `patches.mjs` |
| `/record/` | edtouch01 `v2` (views/record, lib/record, useRecordLlm) | `record/` 진입 파일·셸·서버 AI 연결, `patches.mjs` |
| `/backward/` | data_analysis `src` (백워드 위저드) | `backward/` 진입 파일·셸·서버 AI 연결, `patches.mjs` |

세 화면이 함께 쓰는 교사 세션 코드는 `common/drSession.ts`다.

## 빌드

```
node apps/ai-ports/build.mjs all --edtouch <edtouch01 저장소> --data-analysis <data_analysis 저장소>
```

- `evalplan`, `record`, `backward` 가운데 하나만 지정할 수 있다.
- 원본 저장소의 작업 중인 파일은 쓰지 않는다. `HEAD`에 커밋된 내용을 꺼내 임시 폴더에서 빌드한다.
- 원본 폴더의 `node_modules`를 연결해 쓴다. 없으면 임시 폴더에서 `npm ci`를 실행한다.
- 원본이 바뀌어 `patches.mjs`의 기준 문자열을 찾지 못하면 빌드가 멈춘다. 기준 문자열을 고친 뒤 다시 실행한다.
- 번들에 firebase나 EdTouch 회원 안내가 섞이면 빌드가 멈춘다.
- 사용한 원본 커밋은 `BUILD-INVENTORY.json`에 남는다.

원본의 `EvalPlanView`·`lib/evalPlan`, 특기사항 화면·`lib/record`, 백워드 화면을 고치면 이 빌드를 다시 실행해야 대륜고 화면에 반영된다.

## 시험

```
node apps/ai-ports/smoke.mjs [스크린샷 폴더]
```

헤드리스 Chrome으로 비로그인·교사·개인 키 상태의 화면과 요청 헤더를 확인한다. Cloud Run·Supabase·Gemini 요청은 모두 가로채 가짜로 답하므로 실제 AI를 호출하지 않는다.

```
node apps/ai-ports/smoke-evalplan-form.mjs --edtouch <edtouch01 저장소> [--out <폴더>]
```

`/evalplan/` 결과 화면의 저장 묶음과 한글 양식을 1440·320px에서 확인한다. 결과 상태는 edtouch01 `_workspace/evalplan_form_fixtures.mjs`의 저장본으로 만든다. `--out`을 주면 내려받은 hwpx를 남긴다. 한글에서 열리는지는 edtouch01 작업 폴더의 `hwp_pdf.py`로 따로 확인한다.

```
node apps/ai-ports/smoke-record-form.mjs [--out <폴더>]
node apps/ai-ports/smoke-backward-export.mjs [--out <폴더>]
```

`/record/`는 시험용 누적 결과 두 줄로 학년도·학적변동 입력, 엑셀 내려받기(양식 채우기), 표 아래 MD 저장을 확인한다. 내려받은 xlsx의 모양은 openpyxl로 따로 본다. `/backward/`는 단원·차시 설계 저장본을 '이어서 하기'로 복원해 완료 화면의 MD 저장을 확인한다. 둘 다 1440·320px에서 본다.

## 저장 묶음(문서작성 AI 없음)

대륜고에는 문서작성 AI(`/docai`)가 없고, 대륜고 주소는 edtouch.ai 문서작성 AI가 받는 주소도 아니다. 그래서 세 화면 모두 문서작성 AI로 넘기는 단추와 안내 문구를 뺐다.

- 넘기기 모듈은 포트 파일로 바꿔 번들에 `docai?handoff`가 들어가지 않게 했다. `/evalplan/`·`/record/`는 `lib/export/handoff`를 `common/exportHandoff.ts`로, `/backward/`는 `lib/export/crossWindowHandoff`를 `backward/src/backward-standalone/exportHandoff.ts`로 바꾼다. 빌드 검사가 이 문자열을 금지한다.
- `/evalplan/`: 묶음은 MD 저장·PDF 저장·한글로 편집만 보인다. 한글로 편집은 양식 정보 창을 열고 창에서 한글 파일을 내려받는다. 창의 문서작성 AI 단추는 패치로 뺐다. 양식 틀은 `output/web/evalplan/evalplan-forms/`에 싣고 화면은 `/evalplan/evalplan-forms/2026/task1.hwpx`를 받는다.
- `/record/`: 표 위의 학년도·학적변동 입력과 '엑셀 내려받기'(양식 채우기)는 그대로다. 표 아래 묶음은 MD 저장만 남기고 넘기기 안내 줄을 뺐다. 양식은 `output/web/record/record-forms/`에 싣고 화면은 `/record/record-forms/2026/record-form.xlsx`를 받는다(원본이 `BASE_URL` 기준이라 주소 패치는 없다).
- `/backward/`: 단원·차시 완료 화면의 묶음은 MD 저장만 보이고 제목에서 '편집'을 뺐다. 기존 설계안·활동지 PDF는 그대로다.
- 양식 파일은 `patches.mjs`의 `staticFiles`로 지정하고, `build.mjs`가 커밋된 원본에서 꺼내 싣는다. 두 양식 모두 화면 폴더 아래라 화면과 같은 교사 게이트를 받는다.

## /backward/와 EdTouch 로그인

data_analysis 93b5fc1부터 원본은 EdTouch 로그인으로 서버 AI를 연다(`useLlmMode`의 `llmFetch`·`aiBlockReason`, `ServerAiGate`). 대륜고판은 그 자리를 `transport.ts`(교사 세션·개인 키)와 셸의 `AiAccessBar`로 바꾼다. 원본에서 이 부분이 다시 바뀌면 `backward/patches.mjs`의 `useBackwardApi.ts`·`WizardShell.vue` 기준 문자열부터 고친다.

## 서버 AI 계약

- 교사: `Authorization: Bearer <Supabase access token>`과 `x-auth-site: daeryun`을 보낸다.
- 개인 키: `/backward/`는 `x-user-gemini-key`만 보낸다. `/evalplan/`과 `/record/`는 브라우저에서 Gemini를 바로 호출한다.
- 로그인도 개인 키도 없으면 요청을 보내지 않는다.
- 401이면 세션을 갱신해 한 번만 다시 보낸다.
- 실패 문구는 서버의 `error`를 그대로 보인다.
- `/record/`의 첨부는 `body.image`(여러 장이면 `body.images`도)로 함께 보낸다.
- `/record/`의 연결 저장 키는 `edtouch-record-llm`이다. 여기에 `server`를 저장해도 다른 화면이 깨지지 않는다. `/evalplan/`만 이 키를 시드로 읽고 서버 선택을 이해하며, `/schedule/`과 `lib/dr-ai.js`(`dr_tt_llm_v1`)는 읽지 않는다.
