@echo off
rem Stops only this folder's server. run-server.cmd uses the full path to server.js;
rem a manual start can be just ".\server.js", so that form is stopped too.
rem The restart loop is stopped first, otherwise it would start node again.
set "SITE_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = $env:SITE_DIR.ToLower(); Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.ToLower().Contains($d + 'run-server.cmd') -or ($_.Name -eq 'node.exe' -and $_.CommandLine.ToLower().Contains($d + 'server.js')) -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match '(?i)(?<![\\/\w])(\./|\.\\)?server\.js(?!\w)' -and $_.CommandLine -notmatch 'tsserver|vite')) } | Sort-Object { $_.Name -eq 'node.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
