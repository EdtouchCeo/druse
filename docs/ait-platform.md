# Dave AIT Class 작업 인계 문서

2026-11-23 기준. 다른 컴퓨터나 원격 세션에서 이어 작업할 때 먼저 읽는다. 이 저장소는 공개 저장소이므로 열쇠, 교과서 그림, 학생 기록은 여기에 두지 않는다.

## 무엇인가

Dave AIT Class는 교사의 AI·IT·Tech 수업 플랫폼이다(`/ait/`). 교사가 진행 화면에서 슬라이드를 넘기면 학생 기기가 따라오고, 교과서 쪽, 브라우저 파이썬 실습(Pyodide), 경쟁 퀴즈, 의견 나눔, AI 튜터(학생은 힌트만)를 한 화면에서 진행한다. 학생은 참여 코드만으로 익명 참여한다.

## 상태

| 항목 | 상태 |
| --- | --- |
| 화면, 서버 함수, Supabase 연결 | 배포됨(커밋 `0831f9f`까지) |
| 교사 기능 권한 | 사이트 관리자 계정만(로그인 쿠키의 `adm` 표시) |
| 차시 자료 | 2단원 4개 차시(l01, l01p, l02, l03), 퀴즈 2개(l01, l02). **모두 승인 전 초안** |
| 수업 보관함(`ait-content`) | **아직 비어 있음**. 교사가 승인 뒤 "자료 올리기"로 올려야 함 |
| 관리자 계정으로 실제 사이트 시험 | 아직 안 함(교사 계정이 필요) |

## 남은 일

1. 교사 검토 뒤 차시·퀴즈 승인(`build_lesson.py approve`, `approve --quiz`) → `catalog` → 자료 올리기. 01 퀴즈에서 정답으로 더 받는 표기(범주형 데이터, 결측값, 소문자 eda)는 교사 확인 대기.
2. 관리자 계정으로 사이트에서 수업 열기 → 휴대폰으로 참여해 따라가기, 퀴즈, 의견 나눔, 튜터 확인. 이어서 한 반 규모 교실 시험.
3. 익명 로그인 보안 문자(CAPTCHA) 여부: 교실 시험 뒤 판단.
4. 오래된 익명 계정 정리: pg_cron이 없어 자동 정리가 없다. 방 기록은 수업을 열 때 하루 지난 것을 지운다.
5. 퀴즈 응답과 의견 글은 서버 표에 저장하지 않고 교사 화면에서 CSV·JSON으로 내려받는다(`ait_quiz_answers`, `ait_talk_*` 표는 비어 있음). 튜터 질문만 `ait_tutor_logs`에 남는다.
6. 다른 교사에게 열 때: 허용 계정을 Netlify 환경 변수로 받도록 `netlify/functions/_lib/ait.js`의 `teacherClaims`와 엣지 게이트의 `admin` 분기를 바꾼다.

## 구조

```
브라우저(교사)  ──소켓──▶ Supabase Realtime 비공개 채널 ──▶ 브라우저(학생)
     ▲                     ait:<방> / ait:<방>:p:<참가자>
     └── ait:<방>:teacher ◀── /ait-api/relay(학생 → 교사, 서버가 보낸 사람을 채움)
자료: /ait-api/asset/<경로> → 비공개 버킷 ait-content(그림은 2분짜리 주소, 학생 lesson.json은 노트 제거)
```

| 경로 | 내용 |
| --- | --- |
| `output/web/ait/` | 화면(정적, 모듈 JS). `index.html` 첫 화면, `teach.html` 진행, `present.html` 발표, `room.html` 학생, `upload.html` 자료 올리기 |
| `output/web/ait/js/sync.js` | 교사·학생 연결. 로컬 미리보기는 BroadcastChannel, 사이트는 Supabase |
| `output/web/ait/js/rt.js` | Realtime 소켓(Phoenix 규약 직접 구현), 교사·학생 토큰 |
| `netlify/functions/ait-room.js` | 방 열기·이어 열기·닫기·모드 기록·내보내기, 학생 참여(참여 증표 쿠키 `ait_room`, `/ait-api` 경로 한정) |
| `netlify/functions/ait-relay.js` | 학생 메시지 중계 |
| `netlify/functions/ait-asset.js` | 자료 문지기 |
| `netlify/functions/ait-upload.js` | 자료 올리기(한 번 쓰는 올리기 주소, `_manifest.json`) |
| `netlify/functions/ait-tutor.js` | AI 튜터. 학생은 열린 방·튜터 켜짐·퀴즈 아님·8초 간격을 서버가 확인 |
| `netlify/functions/_lib/ait.js` | 공용(REST·Storage·Realtime, 참여 증표 서명) |
| `netlify/edge-functions/auth-gate.js` | `/ait/teach·present·upload`는 관리자만 |
| `tools/ait-dev/` | 로컬 미리보기 서버, 가짜 Supabase, 화면 시험(`e2e/`) |
| `tests/ait-server.test.cjs` | 서버 함수 시험(빌드 때 실행) |

차시 자료를 만드는 도구(`build_lesson.py`)와 원본 자료(`content/`)는 이 저장소가 아니라 교사 OneDrive의 `수업 평가 설계 에이전트/수업플랫폼/`에 있다. PPT를 그림으로 바꾸는 단계는 파워포인트가 있는 교사 PC에서만 된다.

## Supabase(프로젝트 `aafpkfcxzdrguuctdwth`)

- 표: `ait_rooms`, `ait_members`, `ait_quiz_answers`, `ait_talk_topics`, `ait_talk_messages`, `ait_talk_likes`, `ait_tutor_logs`. RLS 켜짐, 정책 없음(서비스 키로만 접근).
- Realtime 정책 2개가 `ait_private.can_use_topic` 함수(보안 정의자)를 부른다. 원래 요청서의 정책은 RLS 때문에 모든 채널을 거부해서, 설정 담당자가 이 함수로 고쳐 적용했다. 실제 적용된 SQL은 Supabase에서 확인한다(OneDrive의 `ait_schema.sql`은 고치기 전 원본).
- 채널 권한: `ait:<방>` 교사 받기·보내기, 학생 받기 / `ait:<방>:teacher` 교사만 / `ait:<방>:p:<본인>` 교사 받기·보내기, 그 학생 받기.
- 익명 로그인 켜짐(IP당 시간당 300회). 무료 요금제: 동시 접속 200, 초당 메시지 100 → 퀴즈 0.8초, 의견 0.6초 간격으로 모아 보냄, 학생 ping 20초.
- 버킷 `ait-content`(비공개, 파일당 10MB).

Netlify 환경 변수: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`(기존). 선택: `AIT_TUTOR_MODEL`. `LLM_MODEL`은 없음.

## 시험

```
node --test tests/ait-server.test.cjs                 # 서버 함수(가짜 fetch)
AIT_FAKE_SB=1 node tools/ait-dev/server.cjs 8766      # 가짜 Supabase로 화면+함수 끝까지
node tools/ait-dev/e2e/check_server.cjs               # 교사 1·학생 3, 34항목 (PW=playwright-core 경로)
```

자세한 방법은 `tools/ait-dev/e2e/README.md`. 사이트 배포 뒤에는 로그인 없이 `/ait-api/room`, `/ait-api/asset/...`, `/ait/teach.html`이 401로 막히는지, 익명 로그인으로 없는 코드에 참여하면 404 `NO_ROOM`이 오는지 확인한다.

## 지켜야 할 것

- AI가 만든 문항·해설·쪽 대응은 초안이다. 승인은 교사가 한다.
- 교과서 그림이 든 `output/web/ait/content/`는 커밋하지 않는다(`.gitignore`).
- 학생 학번·이름은 받지 않는다. 대화명과 참가자 번호만 둔다.
- 학생 화면에 정답(발표 노트, 퀴즈 파일)이 가지 않게 한다. 정답은 공개 전까지 학생 기기로 보내지 않는다.
- DOM에 `null`을 그대로 넣으면 "null" 글자가 찍힌다. `replaceChildren(...[...].filter(Boolean))` 또는 `el()` 사용.
