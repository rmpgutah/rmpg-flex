@echo off
REM ============================================================
REM  RMPG Flex OS — no-USB installer launcher
REM ============================================================
REM  Exists because a .ps1 cannot be launched by double-clicking: Windows
REM  opens it in Notepad by default, and even "Run with PowerShell" is blocked
REM  by the default Restricted execution policy. This wrapper self-elevates and
REM  runs the installer with -ExecutionPolicy Bypass, scoped to this one
REM  process only — the machine-wide policy is never changed.

setlocal
set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%Install-RmpgFlexOS.ps1"

if not exist "%PS1%" (
    echo.
    echo ERROR: Install-RmpgFlexOS.ps1 was not found next to this file.
    echo Extract the whole .zip and run this from inside the extracted folder.
    echo.
    pause
    exit /b 1
)

REM Already elevated? net session only succeeds for an administrator.
net session >nul 2>&1
if %errorlevel% equ 0 goto :run

echo Requesting administrator rights...
REM Re-launch this same .bat elevated. -Verb RunAs triggers the UAC prompt.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 0

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
