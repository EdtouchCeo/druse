# 대륜고 학종 전략 API v1

상태: 구현된 API 계약이며 실제 운영 배포·점검 결과는 별도 배포 기록에 남긴다. 상담 참여·관리 요청은 `Authorization: Bearer <대륜고 Supabase access token>`을 보낸다. 기존 로그인 저장값은 `dr_sess_v1.token`이며 역할·승인은 서버에서 재확인한다. 오류는 `{error:{code,message}}`이다. 만료 401, 권한 없음 403, 접근할 수 없는 기록 404, 버전 충돌 409, 설정 미준비 503이다.

기본 상담 저장소는 서버 전용 Netlify Blobs `daeryun-counseling-v1`이다. 기존 Supabase Auth와 `users`는 그대로 사용하며 이 경로에는 새 DB 테이블·DDL 적용이 필요하지 않다. `COUNSELING_STORAGE=supabase`를 명시한 경우에만 별도 SQL migration 경로를 사용한다. 오류가 나면 다른 저장소로 자동 전환하지 않으며 두 저장소의 자료는 자동 동기화되지 않는다.

상담 5개 함수와 `admin-update`는 `.mjs`의 Netlify Functions Request/Response 진입점을 사용한다. 내부 기존 handler와 요청·응답 계약은 유지한다. SDK 11.0.3의 `connectLambda`는 강한 읽기에 필요한 `uncachedEdgeURL`을 누락하므로 호출하지 않고, 플랫폼이 제공하는 자동 실행 컨텍스트로 `consistency:"strong"`을 사용한다. 브라우저가 보낸 헤더·본문을 저장소 자격으로 읽지 않는다. [Netlify Functions 공식 실행 방식](https://docs.netlify.com/build/functions/get-started/), [SDK Lambda 호환 구현](https://github.com/netlify/primitives/blob/main/packages/blobs/src/lambda_compat.ts).

운영 함수의 npm 모듈 누락을 방지하기 위해 runtime은 `_lib/vendor/netlify-blobs.cjs`의 정적 상대경로를 사용한다. 설치된 SDK 11.0.3과 실제 참조 의존성만 esbuild로 묶으며 환경값을 삽입하지 않는다. 같은 폴더의 manifest에 버전·패키지 무결성·생성 파일 SHA256, `LICENSES.txt`에 배포 라이선스를 보존한다. `scripts/build-counseling-blobs-vendor.cjs`로 재생성하고, Node 내장 외의 외부 의존성이 남으면 생성을 거절한다. 빌드 점검 플러그인은 기존 npm SDK를 사용한다.

권한·학생 등록·학번 이력·배정·권한 이력은 하나의 설정 문서에서 ETag 조건부 쓰기로 함께 변경한다. 상담은 변경 불가 버전을 먼저 저장하고 조건부 head 변경으로 공개한다. 충돌한 쓰기는 409이며 연결되지 않은 버전·목록 표식은 조회 결과에 나타나지 않는다. 학교 승인과 배정은 변경 전 다시 확인한다. 설정과 상담 head 사이에 SQL과 같은 다중 문서 트랜잭션이 있는 것은 아니며, 접근 요청마다 현재 권한을 검사한다. 설정 문서가 10 MiB를 넘으면 기존 자료를 보존하고 관리 변경을 거절한다.

저장소 객체를 공개 URL로 제공하지 않는다. 승인된 계정만 상담 API에서 허용 범위의 자료를 읽으며, Netlify 운영 계정의 저장소 접근은 별도 관리 권한이다. site-wide 저장소는 배포 간 공유되므로 운영 사이트의 미리보기 배포도 같은 자료에 접근할 수 있는 신뢰된 서버 코드로 취급해야 한다. [Netlify Blobs 저장소·접근 범위](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

Case는 `counseling_local/CONTRACT.md`와 같되 `privacy:"standard"`다. `record`, `analysis`는 항상 null이다. `local_only` 또는 학생부 원문·분석이 포함된 입력과 백업은 거절한다. 실제 학생 정보는 서버가 등록한 고정 student_id로만 선택한다. 학번은 학년도별 이력이다.

서버 0.5.0은 교사의 학생 자료 입력·분석 → 사전 전략 수립 → 학생 상담 → 상담을 반영한 최종 전략·PDF 결과물을 연결한다. 각 Session에 `strategy:{target_major,target_path,strengths,gaps,subject_plan,inquiry_plan,activity_plan,semester_plan,student_message}`가 있으며 9개 값은 각각 12,000자 이내 문자열이다. 과거 자료에 strategy가 없으면 빈 기본값을 반환한다. `guidance`는 null 또는 서버가 부여한 `{published_at,published_by}`이며 PUT으로 변경할 수 없다. 자료 형식 `schema_version:1`은 유지한다.

새 create·next 회차에는 `workflow_version:2`, `preparation:null`, 빈 `consultation`을 부여한다. workflow_version이 없는 과거 회차는 기존 검토·확정·학생 PDF 규칙을 유지하며 자동으로 새 절차에 편입하지 않는다. 과거 미확정 회차도 prepare를 요청하면 버전 2로 전환할 수 있다. workflow_version과 preparation은 서버 보호 필드이며 직접 PUT으로 부여·제거·수정할 수 없다.

`preparation`은 null 또는 `{prepared_at,prepared_by,topic,strategy,actions}`다. prepare는 현재 주제·전략·과제를 한 번 복사하고 현재 인증 교사의 ID와 서버 시각을 기록한다. 200자 이내의 비어 있지 않은 주제 및 subject_plan·inquiry_plan·activity_plan·semester_plan 중 하나 이상이 필요하다. 확정된 회차 또는 이미 준비한 회차의 재준비는 409다. 준비가 끝나면 원안을 유지하면서 현재 strategy·actions를 상담 결과에 따라 수정한다. 준비본은 workflow_version 2에서만 허용한다.

`consultation`은 `{status:"not_started"|"in_progress"|"completed",date,student_response,agreed_direction,adjustments,summary}`다. 기본 상태는 not_started, 나머지는 빈 문자열이며 각 문자열은 6,000자 이내, NUL 금지다. date는 비어 있거나 실제 달력에 존재하는 YYYY-MM-DD다. 준비 전에는 상담 상태 변경과 날짜·본문 입력을 허용하지 않는다. prepare는 status를 in_progress로 바꾸며 이후 not_started로 되돌릴 수 없다. 교사가 PUT으로 completed를 저장할 때 유효한 date·공백만 아닌 student_response·agreed_direction이 필요하다. 상담을 완료한 뒤 최종 전략을 다듬어도 completed는 유지하고 내용의 검토는 초기화한다.

버전 2의 confirm·publish·학생용 PDF는 preparation과 completed 상담이 모두 필요하다. 준비 누락은 `PREPARATION_REQUIRED`, 미완료 상담은 `CONSULTATION_REQUIRED` 409다. 학생용 PDF는 교사가 미리 보는 경우에도 현재 본문 해시와 일치하는 confirmed가 필요하며, 미확정·해시 불일치는 `CONFIRM_REQUIRED` 409다. 별도의 문체·근거 검토와 교사 확인, 학생 안내 문장·실행 과제 조건도 유지한다. 교사용 보고서는 미완료·미확정 초안에서도 볼 수 있으며 학생 입력 자료, 사전 전략 스냅샷, 상담 반영 사항, 현재 최종 전략 초안을 구분한다. 학생용 결과물에는 현재 전략·실행 과제만 포함하고 preparation·consultation의 키와 내용은 학생 API·JSON·PDF에서 전부 제외한다.

명시된 workflow_version 2, preparation, 값이 있는 consultation은 본문 해시에 포함한다. 과거 버전 부재 회차에 preparation null·빈 상담 기본값을 추가해도 이전 해시를 유지한다. 상담이나 최종 전략을 수정하면 검토가 무효화되며 확정된 회차는 변경할 수 없다. next는 전략·profile·미완료 과제만 이어받고 preparation·consultation을 초기화한다.

import는 사전 전략의 전체 strategy·actions 형식과 prepared_at의 시간대 있는 ISO timestamp(최대 100자), prepared_by의 비어 있지 않은 NUL 없는 문자열(최대 160자)을 검증한다. 가져온 prepared_by·prepared_at은 현재 인증 교사의 검증된 준비 이력으로 취급하지 않는다. 준비본이 있는 사본은 내용을 참고용으로 보존하고 `imported_history.preparation_imported:true`, consultation.status in_progress를 부여하며 보고서에 **가져온 사전 전략 참고본**으로 표시한다. 과거 review·confirmed·guidance는 현재 신뢰로 승계하지 않는다. 준비본 없는 legacy 사본에는 workflow_version 2를 강제로 부여하지 않는다.

`Session.profile`은 교사가 입력한 자료이며 학생에게 공개하는 전략과 분리한다. 과거 자료에서 없거나 일부 항목만 제공되면 나머지는 아래 빈 기본값으로 정규화한다. 제공된 잘못된 자료형과 알 수 없는 항목은 거절한다. 서술·과목·성취도 앞뒤 공백을 정리하고 NUL 문자는 거절한다. 선택 과목은 공백 정리 후 빈 이름·중복을 허용하지 않는다. 작성 중인 성적 행의 빈 과목명은 백업·복원할 수 있으며 교사용 PDF에 과목 미입력으로 표시한다.

| profile 항목 | 형식·범위 | 빈 기본값 |
|---|---|---|
| target_major, interests, learning_concerns, study_habits, activities, reading, attendance_notes, teacher_observations | 각각 6,000자 이내 문자열 | 빈 문자열 |
| selected_subjects | 문자열 배열, 최대 20개, 과목당 최대 100자 | `[]` |
| weekly_minutes | 0~2400 정수 또는 null. 0도 입력값으로 보존 | null |
| grades | 아래 성적 행 배열, 최대 60개, 중복 ID 금지 | `[]` |

성적 행은 `{id,subject,academic_year,semester,grade_scale,rank_grade,score,achievement}`다. id는 UUID, subject는 100자 이내 문자열, academic_year는 1990~2100 정수, semester는 1 또는 2다. grade_scale은 문자열 `"5"`, `"9"`, `"achievement"`, `"unknown"` 중 하나이며 rank_grade는 해당 5·9등급 범위의 정수 또는 null이다. 성취도·미확인 척도에서는 rank_grade가 반드시 null이어야 한다. score는 0~100 숫자(소수 허용) 또는 null이고 achievement는 20자 이내 문자열이다. 일부 자료만 입력된 상태도 정상이며 입력되지 않은 값을 점수나 약점으로 추정하지 않는다.

profile이 완전히 비어 있으면 기존 해시를 유지한다. 값이 있으면 본문 해시에 포함하므로 수정 시 검토가 무효화되고 확정 회차는 변경할 수 없다. next와 검증된 import는 profile을 이어받지만 새 회차·가져온 사본의 guidance는 초기화한다. 교사 백업과 교사용 PDF에는 입력 자료 요약·척도를 구분한 성적표를 포함한다. 학생 list/get/export와 학생용 PDF(교사의 학생용 미리보기 포함)에서는 profile 키와 자료를 전부 제외한다. 성적·출결·교사 관찰을 학생에게 자동 공개하지 않는다.

전략은 본문 해시에 포함되고 guidance는 제외된다. 전략 값이 모두 비어 있으면 기존 본문 해시 형식을 유지해 과거 검토·확정의 무결성을 보존한다. 전략을 수정하면 미확정 회차의 검토를 무효화하며 확정한 내용은 다음 전략 개정 회차에서 수정한다. 전략이 있는 회차의 검토에는 주제·학생 안내 문장·실행 과제가 필요하다. 빈 전략의 기존 수기 기록은 과거 검토 규칙을 유지하지만, 학생에게 공개하려면 학생 안내 문장과 실행 과제를 갖춰야 한다.

## 세션

`GET /.netlify/functions/counseling-session` → `{user:{id,role:"teacher"|"student"|"manager",approved:true,can_manage:boolean,display_name,student_id?},ai:{server:boolean},students:[{student_id,student_number,academic_year,school_stage,grade,name}]}`.

`can_manage`는 별도 승인된 manager 역할이 있을 때만 true다. 교사+관리자는 role teacher를 유지한다. 관리자 역할만 있으면 role manager, students 빈 목록, ai.server false이며 상담 본문 API에는 접근할 수 없다. 관리 화면은 can_manage로 표시하고 관리자만 있는 세션에서는 상담 목록 호출을 생략한다.

승인된 상담 역할이 필요하다. 교사는 유효한 배정 학생만, 학생은 본인만 반환한다. 설정되거나 배정된 계정이 없으면 빈 목록/접근 거절을 반환하며 임의로 학생을 만들지 않는다. 로컬 앱의 교사 인증에도 이 고정 endpoint를 사용한다.

## 상담

기본 URL은 `/.netlify/functions/counseling-cases`다. 아래 `?id=`는 Case ID다.

| 요청 | 입력 | 응답 |
|---|---|---|
| GET | 없음 | `{cases:[Case]}`. 교사는 담당 학생 목록, 학생은 명시적으로 안내된 회차가 있는 사례만 |
| GET `?id=UUID` | 없음 | `{case:Case}` |
| POST | `{student:{student_id},teacher?:{display_name}}` | `{case:Case}`. 배정 교사만, 학생·교사 정보는 서버가 채움 |
| PUT `?id=UUID` | `{case:Case}` | `{case:Case}`. 기존 revision 필요. 수정한 미확정 회차의 검토·확정 무효화 |
| POST `?action=next&id=UUID` | `{revision}` | `{case:Case}`. 전략과 미완료 과제를 새 과제 ID로 이어받으며 기본 주제는 전략 개정. 이전 주제·학생 안내 요약은 교사 context에 보존. 새 회차 검토·확정·안내는 초기화 |
| POST `?action=prepare&id=UUID` | `{revision,session_id}` | `{case:Case}`. 현재 배정과 revision을 재확인해 교사의 사전 전략을 한 번 저장하고 상담 시작. 최소 주제·전략 계획 필요 |
| POST `?action=review&id=UUID` | `{revision,session_id}` | `{case:Case,review}`. 동기 문체·필수항목 점검. 교사가 확정 전 직접 확인 |
| POST `?action=confirm&id=UUID` | `{revision,session_id,review_acknowledged:true}` | `{case:Case}`. 같은 본문 해시의 최신 검토가 필요. 버전 2는 사전 준비·상담 완료 필수 |
| POST `?action=publish&id=UUID` | `{revision,session_id}` | `{case:Case}`. 현재 해시와 일치하는 확정 회차를 학생에게 명시적으로 안내. 현재 담당 배정을 다시 확인하며 학생 안내 문장·실행 과제 필요. 중복 공개는 409 |
| POST `?action=import` | `{bundle:{format:"daeryun-counseling",version:1,case:Case},student_id,student_confirmed:true}` | `{case:Case}`. 등록 학생 확인 후 새 사본. 과거 검토/확정은 참고 이력에 보관하고 현재 확인으로 승계하지 않음 |
| GET `?action=export&id=UUID` | 없음 | JSON 첨부 `{format:"daeryun-counseling",version:1,case:Case}` |
| GET `?action=report&id=UUID&session_id=UUID&audience=student` | 없음 | 인증된 HTML. audience는 student 또는 teacher. 학생 요청은 항상 학생용. 담당 교사는 공개 전 학생용 PDF도 확인 가능하되 버전 2는 사전 준비·상담 완료·현재 해시의 교사 확정 후에만 허용. 교사용 초안과 legacy 미리보기는 유지 |

확정과 학생 안내는 별도다. 학생 list/get/export/report는 guidance가 있고 확정 해시가 유효한 회차만 반환한다. 공개 회차가 없으면 목록에서 제외하고 상세·백업·출력은 404다. current_session_id는 마지막 공개 회차를 가리킨다. 학생의 `student_question`, `context`, `evidence_notes`, `teacher_opinion`은 빈 문자열, record·analysis·review·confirmed는 null이며 imported_history·imported_from과 교사 내부 메타는 제거한다. 학생 응답은 전략·실행 과제·주제·날짜·다음 점검일 중심의 허용 목록으로 생성한다. 과거 수기 기록도 자동 공개하지 않는다.

교사의 `audience=student` 출력은 공개 여부와 별개로 내부 메모를 제거하며 확정한 초안은 확정 상태로 표시한다. PDF 생성만으로 온라인 공개 상태가 바뀌지 않는다. 학생의 `audience=teacher` 요청으로 내부 내용을 읽을 수 없다. 상담 작성·전략 개정·검토·확정·공개·반입은 승인 교사와 현재 담당 관계가 필요하다. 반입은 전략을 이어받되 guidance·review·confirmed를 항상 초기화한다. 직접 PUT으로 학생·교사·privacy·버전·검토·확정·공개 이력을 바꿀 수 없다.

선택 SQL 저장소를 사용하려면 `202609110001_counseling.sql` 뒤에 `202609120001_strategy_publication.sql`까지 적용·검증해야 한다. 기존 초안/과거 버전 JSON에는 교사 메모가 있으므로 raw cases/versions의 anon·authenticated SELECT와 기존 읽기 정책을 제거하고 service_role API로만 읽는다. 새 설치 migration도 같은 정책이다. 추가 migration은 기존 users·학교 Auth·다른 등록 테이블 권한을 바꾸지 않으며 적용하지 않은 SQL 전환은 지원하지 않는다. 현재 기본 Blobs 운영에는 이 DDL을 적용하지 않는다.

## 일반 AI

`POST /.netlify/functions/counseling-ai` → `{text}`.

입력은 `{case_id,session_id,revision,privacy:"standard",purpose:"counseling"|"style",instruction?:string}`이다. 서버가 접근 가능한 저장 상담에서 본문을 구성한다. 브라우저가 임의 prompt/history/첨부/PDF/분석을 보내는 범용 릴레이가 아니다. 승인된 담당 교사만 호출한다. 서버 자격은 기존 `_lib/vertex.js`를 사용하고 개인 키를 요청으로 받지 않는다. 서버 모드 실패 시 제공자를 자동 전환하지 않는다.

승인된 담당 교사의 AI 요청에는 서버가 읽은 profile·저장 전략·사전 전략 원안·상담 내용을 함께 제공한다. 사전 전략의 작성자·시각 메타는 프롬프트에서 제외한다. 교사가 학생 자료를 근거로 전략부터 수립하고 상담 질문은 그 전략을 확인하는 부속 자료로 작성하도록 요청한다. 상담 전에는 학생 반응·합의를 만들지 않으며 상담 후에는 기록된 반응·합의·조정을 최종 전략·실행 과제에 반영하도록 명시한다. 일반 분석의 입력 근거에 따른 관찰 → 확인이 필요한 자료 → 교과 연결 → 다음 상담 질문 → 실행 제안 순서를 구체적인 교과·탐구·활동·학기별 계획으로 연결한다. 입력되지 않은 정보를 약점이나 역량 부족으로 판단하거나 근거 없는 합격 가능성·합격 등급을 만들지 않도록 명시한다. 서로 다른 5·9등급·성취도 척도를 하나의 평균 등급으로 합치지 않는다. 이는 교사 검토용 생성 초안이며 모델의 판단 정확도를 보증하지 않는다. 문체 점검은 전략과 학생 안내 문장을 포함하고 인용·수치·일정, 계획과 실제 수행의 차이를 보존한다. 비공개 상담 원문을 학생 안내 문장에 자동 전재하지 않으며 AI 응답은 자동으로 전략을 저장·확정·공개하지 않는다.

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
