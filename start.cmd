@echo off
rem ============================================================
rem  One-click launcher for the cafe-preorder project.
rem  Double-click this file, or run it with arguments:
rem      start.cmd -Port 3100 -NoBrowser
rem  It calls start.ps1 in the same folder.
rem ============================================================
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start.ps1" %*
echo.
pause
