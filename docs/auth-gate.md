# 로그인 게이트

로그인이 필요한 화면은 브라우저가 아니라 서버(Netlify Edge)에서 막는다.

- 원본 `output/web/index.html`은 전체 내용을 유지한다. Netlify 빌드에서 `scripts/build_auth_gate.cjs`가 공개본, 회원본, 교사본으로 나눈다.
- 공개본에서 빠지는 것: `teacher-content`, `photos-content`, `ai-content`, `admin-body`, 교사 시간표 데이터.
- 보호 경로는 `netlify/edge-functions/auth-gate.js`의 `requiredTier`에 있다. 새 교사 전용 앱을 추가하면 이 목록과 `tests/auth-gate.test.cjs`에 함께 추가한다.
- 등급은 `netlify/functions/auth-session.js`가 Supabase 토큰과 users 테이블로 정하고, HttpOnly 쿠키로 24시간 유지한다.
- 공개본에 보호 표식이 남으면 빌드가 실패해 배포되지 않는다. 표식은 `build_auth_gate.cjs`의 `CANARIES`에 있다.
