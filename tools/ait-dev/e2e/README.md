# Dave AIT Class 화면 시험

Playwright(`playwright-core`)와 Microsoft Edge로 실제 화면을 돌린다. 결과 파일(`*_results.txt`)과 화면 사진은 `AIT_E2E_OUT`(없으면 임시 폴더의 `ait-e2e`)에 남는다.

## 준비

- `playwright-core` 경로를 `PW` 환경 변수로 준다. 예: `PW=<어딘가>/node_modules/playwright-core`
- 차시 자료를 `output/web/ait/content/`에 둔다(교사 OneDrive의 `수업플랫폼/content`를 복사, 커밋 금지).

## 로컬 미리보기(같은 브라우저 탭끼리 연결) — 포트 8765

```
AIT_ENV_FILE=<GEMINI_API_KEY가 있는 .env> node tools/ait-dev/server.cjs 8765
```

| 파일 | 확인하는 것 |
| --- | --- |
| `check_stage1.cjs` | 진행·학생 화면, 따라가기, 둘러보기, 교과서 |
| `check_stage2.cjs` | 실습(Pyodide), 발표 화면, 리모컨 키 |
| `check_stage3.cjs` | 경쟁 퀴즈 전체 흐름, 내보내기, 시상대, 결과 내려받기 (l02 퀴즈) |
| `check_stage4.cjs` | AI 튜터(실제 Gemini 호출), 의견 나눔, 비속어 거르기 |
| `check_quiz_end.cjs` | 대화명·단답형 입력 보존(다른 학생 응답, 10초 더, 일시 정지), 퀴즈 끝내기, 종료 화면 (l01 퀴즈) |
| `check_l01quiz.cjs` | l01 퀴즈 문항 형식과 채점 |
| `check_labs.cjs` | 코랩 노트북 실습, 내 코랩에서 열기, 실습 탭. 3번째 부분은 l03에 시험용 외부 실습을 붙인 사본이 있어야 함 |
| `check_mobile.cjs` | 휴대폰 화면 넘침(결과는 측정값 목록) |
| `check_guard.cjs` | 학생 화면 그림 저장 막기 |
| `check_entry.cjs`, `check_aicard.cjs` | 사용 설명서의 학생 입장 칸, 샛별AI 칸 |
| `check_ink.cjs` | 판서(줌잇식 단축키)와 발표 화면 따라 그리기, 무대·교과서 확대, 학생 화면 확대 (l03) |
| `check_media.cjs` | 장 위의 GIF·동영상: PPT 자리에 겹치기, 진행 화면 재생·멈춤·위치를 발표 화면이 따르기, 판서 캔버스가 위, 교과서 모드에서 지우기, 학생 화면(소리 끔). 로컬 content의 l02·l03에 media가 있어야 한다 |
| `check_practice2.cjs` | l02 실습 2(교과서 98~101쪽 선형 회귀, jeans.csv): 44장 실습 모드에서 9셀 전체 실행, 회귀계수·결정계수·예측값을 교과서 결과와 대조 |
| `check_cnn.cjs` | 합성곱 신경망 5분 실습 페이지(`/ait/labs/cnn/`) 세 단계, 좁은 칸·넓은 화면 |

## 서버 연결(가짜 Supabase) — 포트 8766

```
AIT_FAKE_SB=1 AIT_ENV_FILE=<.env> node tools/ait-dev/server.cjs 8766
node tools/ait-dev/e2e/check_server.cjs   # 교사 1명·학생 3명 끝까지(34항목)
node tools/ait-dev/e2e/check_upload.cjs   # 자료 올리기(잘못된 폴더 거부, 바뀐 파일만)
```

가짜 Supabase(`tools/ait-dev/fake-supabase.cjs`)는 서버를 다시 띄울 때까지 기록을 쌓는다. 시험은 참여 코드로 자기 방을 골라 확인한다. 화면 쪽은 `localStorage.ait_fake_sb = '1'`일 때만 가짜 연결을 쓴다(시험 스크립트가 넣는다).

## 실제 Supabase

`node tools/ait-dev/e2e/rt_live.mjs` — 익명 로그인 1회, 공개 시험 채널 주고받기, 비공개 `ait:` 채널 거절. 익명 계정이 하나 생긴다.
