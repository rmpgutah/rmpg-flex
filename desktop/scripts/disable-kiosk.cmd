@echo off
:: ============================================================
:: RMPG Flex — Disable Kiosk Shell Mode (FZ-55 / Windows)
:: ============================================================
:: Run this script AS ADMINISTRATOR from Command Prompt.
:: Restores Windows Explorer as the default shell.
::
:: Run this if the FZ-55 is in an unrecoverable kiosk state
:: and you cannot reach the in-app disable toggle.
:: ============================================================

setlocal EnableDelayedExpansion

:: ── Admin check ──────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: This script must be run as Administrator.
    echo  Right-click disable-kiosk.cmd and choose "Run as administrator".
    echo.
    pause
    exit /b 1
)

:: ── Restore Explorer ─────────────────────────────────────────
echo.
echo  [KIOSK] Restoring explorer.exe as Windows shell...
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" ^
    /v Shell /t REG_SZ /d "explorer.exe" /f >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: reg add failed ^(exit code %errorlevel%^).
    echo  Make sure you are running as Administrator.
    pause
    exit /b 1
)

:: ── Clean up auto-generated launcher (if any) ────────────────
set "LAUNCHER=%~dp0rmpg-flex-kiosk-launcher.cmd"
if exist "!LAUNCHER!" (
    del /f /q "!LAUNCHER!" >nul 2>&1
    echo  [KIOSK] Removed source-run launcher.
)

:: ── Verify ───────────────────────────────────────────────────
for /f "tokens=3*" %%a in (
    'reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell 2^>nul'
) do set "SHELL_VALUE=%%a %%b"
echo.
echo  [KIOSK] Registry updated.
echo  [KIOSK] Shell = !SHELL_VALUE!
echo.
echo  ============================================================
echo   Kiosk Mode DISABLED
echo  ============================================================
echo   Windows Explorer will load on next restart.
echo  ============================================================
echo.
set /p "RESTART=Restart now to apply? [Y/N]: "
if /i "!RESTART!"=="Y" shutdown /r /t 5 /c "Restoring Windows Explorer shell"

endlocal
