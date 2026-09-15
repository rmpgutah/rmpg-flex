# RMPG Flex — Flex Kiosk Mode (Windows / FZ-55) Recovery SOP

**Applies to:** Panasonic Toughbook FZ-55 and other Windows units running the RMPG Flex desktop app as the Windows shell ("Flex Kiosk Mode" / FlexOS).
**Audience:** Officers, dispatchers, supervisors, IT/Fleet support.
**Source of truth:** `desktop/main.js`, `desktop/kioskShell.js`, `desktop/crashRecovery.js`, `desktop/scripts/enable-kiosk.cmd`, `desktop/scripts/disable-kiosk.cmd`, and `docs/superpowers/specs/2026-07-21-desktop-kiosk-shell-mode-design.md`. If this SOP and the code disagree, the code wins — update this document.

---

## 1. How Kiosk Mode works (what you are recovering)

- Kiosk Mode makes RMPG Flex the **Windows shell** for the signed-in user: Windows launches `RMPG Flex.exe --kiosk-shell` instead of Explorer, so there is no Start menu, taskbar, or desktop.
- The in-app toggle (**Settings → OS → Kiosk Mode**, admin login required) writes the Shell value under **HKCU** `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`. HKCU is per-user, needs no UAC, and overrides HKLM. This is the current, preferred mechanism.
- The older scripts `enable-kiosk.cmd` / `disable-kiosk.cmd` write **HKLM** `...\Winlogon\Shell` and must be run as Administrator.
- Because an IT recovery account has its **own** HKCU with no Shell override, signing in as a different Windows user always boots to normal Explorer. This is the simplest recovery path.

## 2. Built-in safety nets (know these before touching anything)

| Safety net | Behavior |
|---|---|
| **Escape hotkey** | `Ctrl+Alt+Shift+F12` (fallbacks `Ctrl+Alt+Shift+F11`, then `Ctrl+Alt+Shift+K` if the first is taken by another program). Opens the escape window; requires a current **admin or manager** Flex login (accounts that require 2FA cannot be used here). On success Flex reverts the shell and restarts the machine. |
| **Boot-failure self-revert** | Every kiosk boot increments a counter. If the app fails to reach `ready-to-show` on **more than 3 consecutive boots**, the next boot deletes the HKCU Shell value, disables Kiosk Mode in config, shows the dialog *"RMPG Flex Kiosk Mode Disabled — failed to start 3 times in a row"*, and still opens a normal Flex window. Windows uses the normal desktop from the **next** sign-in. |
| **Boot counter reset** | The counter resets when the window shows successfully, or after the process stays alive **60 seconds**. Transient one-off failures therefore never accumulate to a self-revert. |
| **Never-exit-as-shell rule** | While the Shell key points at Flex, closing the last window **relaunches** Flex instead of exiting (an exited shell = black screen). Only an admin-initiated disable bypasses this. |
| **Renderer/GPU crash recovery** | If the page process crashes (`crashed`, `oom`, `abnormal-exit`, `killed`, `launch-failed`, `integrity-failure`), Flex auto-reloads the window. After **3 recoveries within 5 minutes** it stops and shows the black **"RMPG Flex Needs a Restart"** screen ("display driver or hardware problem on this unit"). |
| **No-escape fallback** | If none of the three escape hotkeys can be registered, Flex refuses to enter frameless kiosk chrome and shows a normal window instead, so the operator is never locked in. |

## 3. Symptom → action

### 3.1 Dialog: "RMPG Flex Kiosk Mode Disabled … failed to start 3 times in a row"
The self-revert already fired. Kiosk Mode is **off** for this user.
1. Click OK — Flex is running as a normal window. Use it normally.
2. Restart the unit at end of shift; it will boot to the Windows desktop.
3. **Do not** re-enable Kiosk Mode until the cause is found. Pull `rmpg-flex.log` from the app's userData folder (`%APPDATA%\RMPG Flex\` on a standard install) and look at the three failed boots. Common causes: no network at boot (offline auth not primed), pending Windows update reboot, disk full, corrupted userData config.
4. Fix the cause, verify Flex launches cleanly three times as a normal app, then re-enable via **Settings → OS → Kiosk Mode → Enable** and restart when prompted.

### 3.2 Dialog: "RMPG Flex Kiosk Mode Could Not Be Disabled"
Self-revert **attempted but the registry delete failed**. The machine is still set to boot into Flex.
1. Press **`Ctrl+Alt+Shift+F12`** and sign in with admin/manager credentials → Flex reverts and restarts.
2. If the hotkey does not open the escape window, try `Ctrl+Alt+Shift+F11`, then `Ctrl+Alt+Shift+K`.
3. If all fail, use **§4 Manual registry revert**.

### 3.3 Black screen: "RMPG Flex Needs a Restart" (crash loop)
The renderer/GPU crashed ≥3 times in 5 minutes. This is almost always a **display driver or hardware** problem, not a config problem.
1. Fully close and reopen Flex. In kiosk mode: `Ctrl+Alt+Shift+F12` → admin login → restart, or hold the power button for a hard restart.
2. If it recurs on the same unit within a shift, take the unit out of service and ticket IT/Fleet with the unit ID. Do not keep restarting it in the field.
3. IT: check Windows Event Viewer for display driver resets (Event ID 4101), update the Intel/AMD GPU driver, and check the `rmpg-flex.log` `render-process-gone` reasons (`oom` → memory; `crashed` → driver).

### 3.4 Flex opens as a normal window instead of full-screen kiosk
Either a self-revert completed this boot (see 3.1), or **no escape hotkey could be registered** (another program owns all three combinations). Check for third-party hotkey/macro software or remote-support agents that bind `Ctrl+Alt+Shift+F12`. Remove/reconfigure it, then restart.

### 3.5 Windows boots to a completely black screen — no Flex, no desktop, no cursor response
The Shell key points at Flex but Flex is not starting at all (e.g. the .exe was moved/uninstalled, or the source-run launcher's `node` is missing).
1. Press `Ctrl+Alt+Del` → **Sign out**, then sign in as the **IT recovery / local admin account**. That account has its own HKCU and boots to Explorer normally.
2. From that account, fix the install (reinstall `RMPG Flex.exe` to `%ProgramFiles%\RMPG Flex\`), or run **§4** to clear the kiosk user's Shell key.
3. If no second account exists: `Ctrl+Alt+Del` → **Task Manager** → File → Run new task → `explorer.exe` (tick "Create this task with administrative privileges") to get a desktop, then do §4.

### 3.6 Kiosk boots, but Flex shows the login screen and cannot reach the server
This is a **network/auth** issue, not a kiosk issue. Note that the escape hotkey **also** needs the API (`api.rmpgutah.us`) to validate the admin login — so if the unit is fully offline, you cannot escape via hotkey. Restore connectivity (cellular/Wi-Fi/tether), then log in. If connectivity cannot be restored in the field, hard-restart; after 3 failed boots the self-revert will return the unit to the Windows desktop.

## 4. Manual registry revert (IT — use only when the hotkey and dialogs have failed)

**Preferred (current mechanism, HKCU):** signed in as the affected kiosk user, or targeting that user's hive:
```
reg delete "HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /f
```
Then sign out and back in (or restart).

**Legacy (HKLM, if `enable-kiosk.cmd` was used):** run as Administrator:
```
desktop\scripts\disable-kiosk.cmd
```
or equivalently
```
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /t REG_SZ /d "explorer.exe" /f
```

Check both locations if unsure — **HKCU wins over HKLM**, so a stale HKCU value will keep launching Flex even after HKLM is fixed:
```
reg query "HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell
```

Last resort with no desktop access: boot to **Safe Mode** (hold Shift while clicking Restart → Troubleshoot → Advanced → Startup Settings) and run the commands above.

## 5. Re-enabling Kiosk Mode after a recovery

1. Confirm the root cause is fixed and Flex launches normally at least three times.
2. Confirm the unit has network at boot and the escape hotkey works **before** enabling (open Flex normally, press `Ctrl+Alt+Shift+F12`, confirm the escape window appears, cancel).
3. **Settings → OS → Kiosk Mode → Enable** (admin login) → **Restart Now**.
4. Watch the first boot. Sign in and confirm Flex reaches the main screen within 60 seconds.

## 6. Escalation

| Situation | Escalate to |
|---|---|
| Repeated crash-loop screen on one unit | IT/Fleet — hardware/GPU ticket, pull unit from service |
| Self-revert firing across multiple units after a Flex release | Engineering — likely a startup regression; check the deploy in `.github/workflows/deploy.yml` history |
| Cannot escape and no recovery account on the unit | IT — Safe Mode registry revert (§4) |
| Admin/manager escape login rejected | Confirm the account is admin/manager **without 2FA**; 2FA accounts cannot complete the escape flow |

## 7. Log locations

- App log: `%APPDATA%\RMPG Flex\rmpg-flex.log` — look for lines tagged `[KIOSK]` (boot attempts, self-revert, escape) and `render-process-gone`.
- Security audit log (kiosk enable/disable/escape events): `%APPDATA%\RMPG Flex\rmpg-flex-security-audit.log`.
- Source-run launcher only: `desktop\kiosk-launcher.log` in the repo checkout.
