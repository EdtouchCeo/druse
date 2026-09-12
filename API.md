# 대륜고 상담 API v1

상태: 구현된 API 계약이며 실제 운영 배포·점검 결과는 별도 배포 기록에 남긴다. 상담 참여·관리 요청은 `Authorization: Bearer <대륜고 Supabase access token>`을 보낸다. 기존 로그인 저장값은 `dr_sess_v1.token`이며 역할·승인은 서버에서 재확인한다. 오류는 `{error:{code,message}}`이다. 만료 401, 권한 없음 403, 접근할 수 없는 기록 404, 버전 충돌 409, 설정 미준비 503이다.

기본 상담 저장소는 서버 전용 Netlify Blobs `daeryun-counseling-v1`이다. 기존 Supabase Auth와 `users`는 그대로 사용하며 이 경로에는 새 DB 테이블·DDL 적용이 필요하지 않다. `COUNSELING_STORAGE=supabase`를 명시한 경우에만 별도 SQL migration 경로를 사용한다. 오류가 나면 다른 저장소로 자동 전환하지 않으며 두 저장소의 자료는 자동 동기화되지 않는다.

상담 5개 함수와 `admin-update`는 `.mjs`의 Netlify Functions Request/Response 진입점을 사용한다. 내부 기존 handler와 요청·응답 계약은 유지한다. SDK 11.0.3의 `connectLambda`는 강한 읽기에 필요한 `uncachedEdgeURL`을 누락하므로 호출하지 않고, 플랫폼이 제공하는 자동 실행 컨텍스트로 `consistency:"strong"`을 사용한다. 브라우저가 보낸 헤더·본문을 저장소 자격으로 읽지 않는다. [Netlify Functions 공식 실행 방식](https://docs.netlify.com/build/functions/get-started/), [SDK Lambda 호환 구현](https://github.com/netlify/primitives/blob/main/packages/blobs/src/lambda_compat.ts).

권한·학생 등록·학번 이력·배정·권한 이력은 하나의 설정 문서에서 ETag 조건부 쓰기로 함께 변경한다. 상담은 변경 불가 버전을 먼저 저장하고 조건부 head 변경으로 공개한다. 충돌한 쓰기는 409이며 연결되지 않은 버전·목록 표식은 조회 결과에 나타나지 않는다. 학교 승인과 배정은 변경 전 다시 확인한다. 설정과 상담 head 사이에 SQL과 같은 다중 문서 트랜잭션이 있는 것은 아니며, 접근 요청마다 현재 권한을 검사한다. 설정 문서가 10 MiB를 넘으면 기존 자료를 보존하고 관리 변경을 거절한다.

저장소 객체를 공개 URL로 제공하지 않는다. 승인된 계정만 상담 API에서 허용 범위의 자료를 읽으며, Netlify 운영 계정의 저장소 접근은 별도 관리 권한이다. site-wide 저장소는 배포 간 공유되므로 운영 사이트의 미리보기 배포도 같은 자료에 접근할 수 있는 신뢰된 서버 코드로 취급해야 한다. [Netlify Blobs 저장소·접근 범위](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

Case는 `counseling_local/CONTRACT.md`와 같되 `privacy:"standard"`다. `record`, `analysis`는 항상 null이다. `local_only` 또는 학생부 원문·분석이 포함된 입력과 백업은 거절한다. 실제 학생 정보는 서버가 등록한 고정 student_id로만 선택한다. 학번은 학년도별 이력이다.

## 세션

`GET /.netlify/functions/counseling-session` → `{user:{id,role:"teacher"|"student"|"manager",approved:true,can_manage:boolean,display_name,student_id?},ai:{server:boolean},students:[{student_id,student_number,academic_year,school_stage,grade,name}]}`.

`can_manage`는 별도 승인된 manager 역할이 있을 때만 true다. 교사+관리자는 role teacher를 유지한다. 관리자 역할만 있으면 role manager, students 빈 목록, ai.server false이며 상담 본문 API에는 접근할 수 없다. 관리 화면은 can_manage로 표시하고 관리자만 있는 세션에서는 상담 목록 호출을 생략한다.

승인된 상담 역할이 필요하다. 교사는 유효한 배정 학생만, 학생은 본인만 반환한다. 설정되거나 배정된 계정이 없으면 빈 목록/접근 거절을 반환하며 임의로 학생을 만들지 않는다. 로컬 앱의 교사 인증에도 이 고정 endpoint를 사용한다.

## 상담

기본 URL은 `/.netlify/functions/counseling-cases`다. 아래 `?id=`는 Case ID다.

| 요청 | 입력 | 응답 |
|---|---|---|
| GET | 없음 | `{cases:[Case]}` 접근 가능한 목록 |
| GET `?id=UUID` | 없음 | `{case:Case}` |
| POST | `{student:{student_id},teacher?:{display_name}}` | `{case:Case}`. 배정 교사만, 학생·교사 정보는 서버가 채움 |
| PUT `?id=UUID` | `{case:Case}` | `{case:Case}`. 기존 revision 필요. 수정한 미확정 회차의 검토·확정 무효화 |
| POST `?action=next&id=UUID` | `{revision}` | `{case:Case}`. 이전 회차를 유지하고 새 회차 추가 |
| POST `?action=review&id=UUID` | `{revision,session_id}` | `{case:Case,review}`. 동기 문체·필수항목 점검. 교사가 확정 전 직접 확인 |
| POST `?action=confirm&id=UUID` | `{revision,session_id,review_acknowledged:true}` | `{case:Case}`. 같은 본문 해시의 최신 검토가 필요 |
| POST `?action=import` | `{bundle:{format:"daeryun-counseling",version:1,case:Case},student_id,student_confirmed:true}` | `{case:Case}`. 등록 학생 확인 후 새 사본. 과거 검토/확정은 참고 이력에 보관하고 현재 확인으로 승계하지 않음 |
| GET `?action=export&id=UUID` | 없음 | JSON 첨부 `{format:"daeryun-counseling",version:1,case:Case}` |
| GET `?action=report&id=UUID&session_id=UUID` | 없음 | 인증된 HTML. Bearer fetch 후 Blob 새창/브라우저 인쇄로 PDF 저장. 미확정은 초안 표기 |

학생은 공동 보관함의 목록·상세·출력만 이용한다. 상담 작성·새 회차·검토·확정·반입은 승인 교사와 현재 담당 관계가 필요하다. 직접 PUT으로 학생·교사·privacy·버전·검토·확정 이력을 바꿀 수 없다. 확정 회차를 고치려면 다음 회차를 만든다.

## 일반 AI

`POST /.netlify/functions/counseling-ai` → `{text}`.

입력은 `{case_id,session_id,revision,privacy:"standard",purpose:"counseling"|"style",instruction?:string}`이다. 서버가 접근 가능한 저장 상담에서 본문을 구성한다. 브라우저가 임의 prompt/history/첨부/PDF/분석을 보내는 범용 릴레이가 아니다. 승인된 담당 교사만 호출한다. 서버 자격은 기존 `_lib/vertex.js`를 사용하고 개인 키를 요청으로 받지 않는다. 서버 모드 실패 시 제공자를 자동 전환하지 않는다.

공통 설정은 `_lib/counseling-ai-config.js`의 `getCounselingAiConfig()`가 반환하는 `{enabled,model}`이다. 기존 Gemini 키 또는 완성된 Vertex 설정이 있고 `COUNSELING_SERVER_AI_ENABLED`가 명시적으로 `false`가 아니면 사용 가능하다. 모델은 `LLM_MODEL` 또는 기존 사이트 기본값 `gemini-2.5-flash`다. 명시 비활성은 `AI_DISABLED`, 자격 설정 누락은 `AI_CONFIG` 503이며 상담 내용은 변경되지 않는다.

일반 개인 Gemini/Ollama 연결은 프론트의 명시 선택 경로다. 프리미엄 학생부 작업은 온라인 앱에서 제공하지 않는다. 로컬 프리미엄 작업의 외부 호출·온라인 반입은 금지한다.

## 운영자 등록

`GET`과 `POST /.netlify/functions/counseling-admin`는 승인된 `manager` 상담 권한만 허용한다.

GET 응답은 `{users:[{id,name,role,approved}],roles:[{user_id,role,approved}],students:[{id,user_id,name,active}],numbers:[{student_id,academic_year,student_number,school_stage,grade}],assignments:[{student_id,teacher_user_id,active}]}`다. 이메일·인증 UID·활동 로그·상담 본문은 반환하지 않는다. 목록은 서버가 500개씩 읽어 합치며 목록별 10,000개를 넘으면 일부만 표시하지 않고 `ADMIN_LIST_LIMIT` 오류를 반환한다.

- `{action:"student",user_id,student_id?,student_number,academic_year,school_stage,grade,name}` → `{student_id}`. 인증된 기존 학생 계정을 고정 학생 ID·학번 이력에 연결.
- `{action:"role",user_id,role:"teacher"|"student"|"manager",approved:boolean}` → `{ok:true}`. 이전 상태와 행위자를 이력에 기록.
- `{action:"assign",student_id,teacher_user_id,active:boolean}` → `{ok:true}`. 학생과 승인 교사를 연결하거나 철회.

기본 Blobs 경로의 최초 manager는 기존 사이트 관리자와 일치하는 검증된 Supabase Auth 이메일·이메일 확인 상태·Auth UID와 연결된 기존 승인 회원을 서버가 함께 확인한 뒤, 해당 계정의 첫 `counseling-session` 접속에서 한 번만 등록하고 이력을 남긴다. 학교 회원 구분이 교사일 때는 teacher도 함께 등록한다. 초기화 후 권한을 철회해도 로그인으로 다시 생기지 않는다. 임의 이메일·요청 본문으로 최초 관리자를 지정하거나 자기 승격하는 API는 없다. 이후 학교 계정 승인과 상담 역할 승인은 별개이며 관리 화면에서 대상 계정을 선택해 등록한다. 선택 SQL 경로는 별도 migration과 검증된 최초 manager의 수동 설정이 필요하다.

## 공개 준비 상태

`GET /.netlify/functions/counseling-health`는 인증 없이 저장소 읽기 가능 여부와 기존 학교 회원 스키마 조회 가능 여부를 확인한다. 응답은 `{service,version,storage,storage_ready,storage_diagnostic,school_auth_ready,record_analysis:"local-ollama-only",server_ai_configured}`이며 준비되면 200, 실패하면 503이다. 자료·이메일·계정·키를 반환하지 않고 점검용 레코드를 쓰지 않는다. AI 설정 존재 여부만 확인하며 실제 모델 호출 성공을 보증하지 않는다.
