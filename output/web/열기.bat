@echo off
chcp 65001 > nul
echo 대륜고 사용설명서를 시작합니다...

:: 포트 8787이 사용 중이면 기존 서버 종료
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8787 "') do (
    taskkill /PID %%a /F > nul 2>&1
)

:: 로컬 서버 백그라운드 실행
start /b python -m http.server 8787 --directory "%~dp0" > nul 2>&1

:: 서버 기동 대기
timeout /t 1 /nobreak > nul

:: 브라우저 열기
start http://localhost:8787/index.html

echo 브라우저가 열리면 급식/학사일정 정보가 정상 표시됩니다.
echo 창을 닫으면 서버가 종료됩니다.
echo.
pause

:: 서버 종료
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8787 "') do (
    taskkill /PID %%a /F > nul 2>&1
)
