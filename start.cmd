@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Собираю сайт...
where npm >nul 2>nul
if errorlevel 1 (
  if not exist "%~dp0dist\index.html" (
    echo Нужен Node.js с npm, чтобы собрать сайт. Установите Node.js и выполните npm install.
    pause
    exit /b 1
  )
  echo npm не найден, запускаю уже собранный сайт.
) else (
  call npm run build
  if errorlevel 1 (
    echo Не удалось собрать сайт. Проверьте, что выполнен npm install.
    pause
    exit /b 1
  )
)

echo Перезапускаю сервер сайта...
call "%~dp0stop-server.cmd"
wscript.exe "%~dp0start-hidden.vbs"
ping -n 3 127.0.0.1 >nul
start "" http://localhost:3000
echo Готово. Сервер работает в фоне, это окно можно закрыть.
ping -n 3 127.0.0.1 >nul
