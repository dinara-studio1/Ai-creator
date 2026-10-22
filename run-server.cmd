@echo off
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\cursor\_\resources\app\resources\helpers\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\cursor\_\resources\app\resources\helpers\node.exe"
if not defined NODE_EXE (
  echo Node.js not found 1>&2
  exit /b 1
)

:loop
echo [%date% %time%] start
"%NODE_EXE%" "%~dp0server.js"
if "%errorlevel%"=="0" exit /b 0
if "%errorlevel%"=="1" exit /b 1
if "%errorlevel%"=="2" exit /b 0
echo Сервер остановился с кодом %errorlevel%. Повтор через 3 секунды.
ping -n 4 127.0.0.1 >nul
goto loop
