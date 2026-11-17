# 학종 전략실 전략 생성의 서버 AI(Claude) 연결

2026-11-17 · 서버 함수 변경. 로컬 실행 묶음(1.1.2)과 화면은 바꾸지 않았다.

대학별 준비 전략·질문 중심 학습 보고서(`counseling-strategy`)가 문서작성 AI·평가계획과 같은 서버 AI(Claude)를 먼저 사용한다. Claude API 키는 EdTouch 서버에만 있고 Netlify 환경변수에는 추가하지 않는다.

## 동작

1. 교사 로그인과 승인 여부, 요청 형식 검증은 기존과 같다. 통과한 비식별 요청으로 만든 프롬프트와 응답 형식만 Claude 서버로 보낸다.
2. Claude 서버는 요청에 실린 교사 세션 토큰으로 승인 교사인지 다시 확인한다. 토큰은 승인 확인에만 쓰이고 프롬프트에 들어가지 않는다.
3. 응답은 기존 형식·분량·식별정보 검증을 그대로 거친다. 기준에 못 미치면 시간이 남을 때 한 번 다시 작성한다.
4. Claude가 응답하지 못했고 Gemini 설정과 시간(15초 이상)이 남아 있으면 같은 요청을 Gemini로 한 번 넘긴다. 보고서의 `model`에는 실제로 답한 쪽이 기록된다.

학생부 PDF·추출문·분석은 계속 교사 PC의 로컬 Ollama만 사용한다. 이번 변경은 그 경계를 바꾸지 않는다.

## 설정

| 환경변수 | 값 | 뜻 |
| --- | --- | --- |
| `COUNSELING_STRATEGY_PROVIDER` | 없음 또는 `claude` | Claude 우선(기본) |
| `COUNSELING_STRATEGY_PROVIDER` | `gemini` | Claude 연결을 쓰지 않고 이전처럼 Gemini만 사용 |
| `COUNSELING_CLAUDE_RELAY_URL` | https 주소 | Claude 서버 주소를 바꿀 때만 지정 |
| `COUNSELING_SERVER_AI_ENABLED` | `false` | 전략 생성의 외부 AI 전체 중지(기존과 같음) |

상태 API(`counseling-health`)의 `strategy_provider`가 `claude-server` 또는 `gemini`로 현재 설정을 알려 준다.

## 검증과 남은 확인

합성 자료로 전달 내용(프롬프트·형식·승인용 토큰만), 오류 본문 비노출, Claude 우선, Gemini 키 없이 동작, 전환 스위치, Claude 실패 시 Gemini 인계, 품질 보완 재작성을 검사했다(`tests/counseling-private-strategy.test.cjs`, `tests/counseling-runtime.test.cjs`).

실제 Claude 서버 호출은 시험하지 않았다. 배포 후 승인 교사 계정으로 다음을 확인한다.

- 전략 한 페이지가 Netlify 함수 제한(60초) 안에 완성되는지. Claude에는 최대 45초를 준다.
- Claude 서버가 전략실 로그인 토큰을 승인 교사로 받아들이는지.
- 응답이 느리거나 거절되면 `COUNSELING_STRATEGY_PROVIDER=gemini`로 되돌린다.

구현은 `netlify/functions/_lib/counseling-claude-relay.js`, `_lib/handlers/counseling-strategy.js`, `_lib/counseling-ai-config.js`에 있다.
