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

## 서버 AI 계약

- 교사: `Authorization: Bearer <Supabase access token>`과 `x-auth-site: daeryun`을 보낸다.
- 개인 키: `/backward/`는 `x-user-gemini-key`만 보낸다. `/evalplan/`과 `/record/`는 브라우저에서 Gemini를 바로 호출한다.
- 로그인도 개인 키도 없으면 요청을 보내지 않는다.
- 401이면 세션을 갱신해 한 번만 다시 보낸다.
- 실패 문구는 서버의 `error`를 그대로 보인다.
- `/record/`의 첨부는 `body.image`(여러 장이면 `body.images`도)로 함께 보낸다.
- `/record/`의 연결 저장 키는 `edtouch-record-llm`이다. 여기에 `server`를 저장해도 다른 화면이 깨지지 않는다. `/evalplan/`만 이 키를 시드로 읽고 서버 선택을 이해하며, `/schedule/`과 `lib/dr-ai.js`(`dr_tt_llm_v1`)는 읽지 않는다.
