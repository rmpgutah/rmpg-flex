# Desktop Shut Down / Restart / Return to Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OS-level Shut Down, Restart, and Return to Windows actions to the FlexOS Power Menu in the Electron desktop app.

**Architecture:** Three new IPC handlers in `desktop/main.js` (`os:shutdown`, `os:restart`, `os:return-to-windows`) backed by `shutdown.exe` and the existing `deleteHkcuShell()` + credential-validation path. Three new `window.electron` methods in `desktop/preload.js`. `FlexOSPowerMenu.tsx` gains Win32-gated OS power buttons plus an inline credential sub-panel for Return to Windows.

**Tech Stack:** Electron (IPC, dialog, child_process), React 18 + TypeScript, Vitest + React Testing Library (client tests), Node.js built-in `test`/`assert` (desktop tests).

## Global Constraints

- All three IPC handlers must return `{ ok: false, error: 'not_supported' }` immediately on non-win32 platforms — no native calls.
- Shut Down and Restart confirmation dialogs live in the main process (`dialog.showMessageBox`) — the renderer has no confirm state.
- `os:return-to-windows` always validates credentials live against the API (same policy as `kiosk:attempt-escape` — offline credentials never accepted).
- Rate limiter for `os:return-to-windows`: 5 calls per 60 seconds, independent of `kioskEscapeRateLimiter`.
- `kioskDeliberatelyReverting` must be set to `true` before the registry delete and un-latched if the delete fails — same invariant as every other revert path.
- No new `npm` packages. All imports already present in `main.js`.
- Design tokens only — no hardcoded hex in the React component (`var(--token)` for all colours).
- Company name in all UI copy: Rocky Mountain Protective Group. Short reference: RMPG.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `desktop/main.js` | Modify (lines ~1992, ~1564, ~2091) | Three new IPC handlers + rate limiter |
| `desktop/preload.js` | Modify (after line 100) | Expose `shutdownOs`, `restartOs`, `returnToWindows` |
| `client/src/components/desktop/FlexOSPowerMenu.tsx` | Modify (full component rewrite) | New buttons + Return to Windows sub-panel |
| `client/src/components/desktop/__tests__/FlexOSPowerMenu.test.tsx` | Create | React component tests |

---

### Task 1: IPC Handlers in `desktop/main.js`

**Files:**
- Modify: `desktop/main.js` — three insertions

**Interfaces:**
- Produces (used by Task 2): `os:shutdown` channel, `os:restart` channel, `os:return-to-windows` channel
- Consumes (already in main.js): `dialog`, `net`, `createRateLimiter`, `validateKioskEscapeCredentials`, `validateEscapeLoginResponse`, `deleteHkcuShell`, `KIOSK_ESCAPE_API_BASE`, `KIOSK_ESCAPE_API_HOSTNAME`, `isAllowedApiHost`, `withRequestTimeout`, `DEFAULT_IPC_REQUEST_TIMEOUT_MS`, `logSecurityAuditEvent`, `getConfig`, `setConfig`, `resetBootAttemptState`, `kioskDeliberatelyReverting`, `guardedHandle`

- [ ] **Step 1: Add the Return to Windows rate limiter**

In `desktop/main.js`, find the block at around line 1992–1993 that reads:
```js
const kioskEscapeRateLimiter = createRateLimiter(5, 60_000);
const splashAuthRateLimiter  = createRateLimiter(5, 60_000);
```

Insert one new line immediately after those two:
```js
const returnToWindowsRateLimiter = createRateLimiter(5, 60_000);
```

- [ ] **Step 2: Add `os:shutdown` and `os:restart` handlers**

In `desktop/main.js`, find the `sys:restart` handler (around line 1561):
```js
guardedHandle('sys:restart', () => {
  app.relaunch();
  app.exit();
});
```

Insert the following block **immediately after** those four lines (after the closing `});`):

```js
guardedHandle('os:shutdown', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'not_supported' };
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Shut Down',
    message: 'Shut down this computer?',
    detail: 'The computer will shut down in 5 seconds. To cancel, run: shutdown /a',
    buttons: ['Shut Down', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return { ok: false, error: 'cancelled' };
  try {
    await execFileAsync('shutdown.exe', ['/s', '/t', '5'], { windowsHide: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

guardedHandle('os:restart', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'not_supported' };
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Restart',
    message: 'Restart this computer?',
    detail: 'The computer will restart in 5 seconds. To cancel, run: shutdown /a',
    buttons: ['Restart', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return { ok: false, error: 'cancelled' };
  try {
    await execFileAsync('shutdown.exe', ['/r', '/t', '5'], { windowsHide: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
```

- [ ] **Step 3: Add `os:return-to-windows` handler**

In `desktop/main.js`, find the end of the `kiosk:attempt-escape` handler (around line 2090), which closes with:
```js
  } catch (err) {
    logSecurityAuditEvent('kiosk:attempt-escape', 'error', { error: err.message });
    return { ok: false, error: 'Could not reach the server — check network connectivity and try again.' };
  }
});
```

Insert the following block **immediately after** that closing `});`:

```js
// Renderer-initiated kiosk revert (from FlexOSPowerMenu) — counterpart to
// kiosk:attempt-escape (which is called from the kioskEscape.html file://
// window). Uses guardedHandle (trusted remote origin) not guardedLocalFileHandle.
guardedHandle('os:return-to-windows', async (event, username, password) => {
  if (process.platform !== 'win32') return { ok: false, error: 'not_supported' };
  if (getConfig('kiosk_shell_enabled') !== true) return { ok: false, error: 'not_in_kiosk_mode' };

  const rateCheck = returnToWindowsRateLimiter.checkRateLimit('os:return-to-windows');
  if (!rateCheck.ok) {
    logSecurityAuditEvent('os:return-to-windows', 'denied', { reason: 'rate_limited' });
    return rateCheck;
  }

  const shapeCheck = validateKioskEscapeCredentials(username, password);
  if (!shapeCheck.ok) return shapeCheck;

  try {
    const loginUrl = `${KIOSK_ESCAPE_API_BASE}/api/auth/login`;
    if (!isAllowedApiHost(loginUrl, [KIOSK_ESCAPE_API_HOSTNAME])) {
      logSecurityAuditEvent('os:return-to-windows', 'error', { reason: 'host_not_allowlisted' });
      return { ok: false, error: 'Could not reach the server — check network connectivity and try again.' };
    }
    const result = await withRequestTimeout(
      new Promise((resolve, reject) => {
        const request = net.request({ method: 'POST', url: loginUrl });
        request.setHeader('Content-Type', 'application/json');
        let body = '';
        request.on('response', (response) => {
          response.on('data', (chunk) => { body += chunk.toString(); });
          response.on('end', () => resolve(body));
        });
        request.on('error', reject);
        request.write(JSON.stringify({ username, password }));
        request.end();
      }),
      DEFAULT_IPC_REQUEST_TIMEOUT_MS,
      setTimeout
    );
    const validation = validateEscapeLoginResponse(result);
    logSecurityAuditEvent('os:return-to-windows', validation.ok ? 'success' : 'denied', { username });
    if (!validation.ok) return validation;

    kioskDeliberatelyReverting = true;
    const revert = await deleteHkcuShell();
    if (!revert.ok) {
      kioskDeliberatelyReverting = false;
      logSecurityAuditEvent('os:return-to-windows', 'error', { reason: 'registry_revert_failed', error: revert.error });
      return { ok: false, error: `Could not restore the Windows desktop shell: ${revert.error}. Contact IT support for a manual registry revert.` };
    }
    setConfig('kiosk_shell_enabled', false);
    setConfig('kiosk_boot_attempts', resetBootAttemptState());
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Kiosk Mode Disabled',
      message: 'Kiosk Mode has been disabled. Restart the computer to return to the normal Windows desktop.',
    });
    return { ok: true };
  } catch (err) {
    logSecurityAuditEvent('os:return-to-windows', 'error', { error: err.message });
    return { ok: false, error: 'Could not reach the server — check network connectivity and try again.' };
  }
});
```

- [ ] **Step 4: Run Worker typecheck to verify no regressions**

```bash
npm run typecheck
```

Expected: 0 errors. (main.js is plain JS — typecheck runs tsc on `/src/`, not desktop. This step verifies nothing in the Worker was accidentally changed.)

- [ ] **Step 5: Commit**

```bash
git add desktop/main.js
git commit -m "feat(desktop): add os:shutdown, os:restart, os:return-to-windows IPC handlers"
```

---

### Task 2: Preload Bridge in `desktop/preload.js`

**Files:**
- Modify: `desktop/preload.js`

**Interfaces:**
- Consumes (from Task 1): `os:shutdown`, `os:restart`, `os:return-to-windows` IPC channels
- Produces (used by Task 3): `window.electron.shutdownOs()`, `window.electron.restartOs()`, `window.electron.returnToWindows(username, password)`

- [ ] **Step 1: Add three new methods to the contextBridge object**

In `desktop/preload.js`, find the line (around line 100):
```js
  restartApp: () => ipcRenderer.invoke('sys:restart'),
```

Insert the following three lines **immediately after** it:

```js
  shutdownOs: () => ipcRenderer.invoke('os:shutdown'),
  restartOs: () => ipcRenderer.invoke('os:restart'),
  returnToWindows: (username, password) => ipcRenderer.invoke('os:return-to-windows', username, password),
```

- [ ] **Step 2: Run desktop tests to verify nothing is broken**

```bash
cd desktop && npm test
```

Expected: all tests pass. (Preload changes don't affect existing pure-helper tests.)

- [ ] **Step 3: Commit**

```bash
cd ..
git add desktop/preload.js
git commit -m "feat(desktop): expose shutdownOs, restartOs, returnToWindows on window.electron"
```

---

### Task 3: FlexOSPowerMenu UI + Tests

**Files:**
- Modify: `client/src/components/desktop/FlexOSPowerMenu.tsx`
- Create: `client/src/components/desktop/__tests__/FlexOSPowerMenu.test.tsx`

**Interfaces:**
- Consumes (from Task 2): `window.electron.shutdownOs()`, `window.electron.restartOs()`, `window.electron.returnToWindows(username, password)`, `window.electron.getKioskShellState()`, `window.electron.platform`
- Props signature (unchanged from existing): `{ onClose: () => void; onLock: () => void; onSignOut: () => void }`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/desktop/__tests__/FlexOSPowerMenu.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FlexOSPowerMenu from '../FlexOSPowerMenu';

const noop = () => {};

function mockElectron(overrides: Record<string, unknown> = {}) {
  (window as any).electron = {
    platform: 'win32',
    isElectron: true,
    restartApp: vi.fn(),
    shutdownOs: vi.fn().mockResolvedValue({ ok: true }),
    restartOs: vi.fn().mockResolvedValue({ ok: true }),
    returnToWindows: vi.fn().mockResolvedValue({ ok: true }),
    getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: false }),
    ...overrides,
  };
}

describe('FlexOSPowerMenu — base buttons', () => {
  beforeEach(() => mockElectron());

  it('always shows Lock, Sign Out, Restart App buttons', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    expect(screen.getByRole('button', { name: /lock/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restart app/i })).toBeInTheDocument();
  });

  it('calls onLock when Lock is clicked and then onClose', () => {
    const onLock = vi.fn();
    const onClose = vi.fn();
    render(<FlexOSPowerMenu onClose={onClose} onLock={onLock} onSignOut={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /lock/i }));
    expect(onLock).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onSignOut when Sign Out is clicked and then onClose', () => {
    const onSignOut = vi.fn();
    const onClose = vi.fn();
    render(<FlexOSPowerMenu onClose={onClose} onLock={noop} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls electron.restartApp when Restart App is clicked', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /restart app/i }));
    expect((window as any).electron.restartApp).toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<FlexOSPowerMenu onClose={onClose} onLock={noop} onSignOut={noop} />);
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed from the main menu', () => {
    const onClose = vi.fn();
    render(<FlexOSPowerMenu onClose={onClose} onLock={noop} onSignOut={noop} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('FlexOSPowerMenu — Windows OS power buttons', () => {
  beforeEach(() => mockElectron({ platform: 'win32' }));

  it('shows Shut Down and Restart buttons on win32', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    expect(screen.getByRole('button', { name: /shut down/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeInTheDocument();
  });

  it('does NOT show Shut Down or Restart buttons on darwin', () => {
    mockElectron({ platform: 'darwin' });
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    expect(screen.queryByRole('button', { name: /shut down/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^restart$/i })).not.toBeInTheDocument();
  });

  it('calls electron.shutdownOs when Shut Down is clicked', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /shut down/i }));
    expect((window as any).electron.shutdownOs).toHaveBeenCalled();
  });

  it('calls electron.restartOs when Restart is clicked', () => {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /^restart$/i }));
    expect((window as any).electron.restartOs).toHaveBeenCalled();
  });
});

describe('FlexOSPowerMenu — Return to Windows button visibility', () => {
  it('shows Return to Windows when getKioskShellState resolves enabled:true', async () => {
    mockElectron({ getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: true }) });
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    expect(await screen.findByRole('button', { name: /return to windows/i })).toBeInTheDocument();
  });

  it('does NOT show Return to Windows when kiosk is disabled', async () => {
    mockElectron({ getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: false }) });
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    // give state time to settle
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /return to windows/i })).not.toBeInTheDocument();
    });
  });

  it('does NOT show Return to Windows when getKioskShellState rejects', async () => {
    mockElectron({ getKioskShellState: vi.fn().mockRejectedValue(new Error('IPC closed')) });
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /return to windows/i })).not.toBeInTheDocument();
    });
  });
});

describe('FlexOSPowerMenu — Return to Windows credential sub-panel', () => {
  beforeEach(() =>
    mockElectron({ getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: true }) })
  );

  async function openRtw() {
    render(<FlexOSPowerMenu onClose={noop} onLock={noop} onSignOut={noop} />);
    fireEvent.click(await screen.findByRole('button', { name: /return to windows/i }));
  }

  it('switches to the credential sub-panel when Return to Windows is clicked', async () => {
    await openRtw();
    expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
  });

  it('Back button returns to the main menu', async () => {
    await openRtw();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.queryByPlaceholderText(/username/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lock/i })).toBeInTheDocument();
  });

  it('Escape from the sub-panel returns to the main menu (not closing the overlay)', async () => {
    const onClose = vi.fn();
    render(<FlexOSPowerMenu onClose={onClose} onLock={noop} onSignOut={noop} />);
    fireEvent.click(await screen.findByRole('button', { name: /return to windows/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /lock/i })).toBeInTheDocument();
  });

  it('submit button is disabled when username or password is empty', async () => {
    await openRtw();
    const submit = screen.getByRole('button', { name: /return to windows/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'pass' } });
    expect(submit).not.toBeDisabled();
  });

  it('calls electron.returnToWindows with the entered credentials on submit', async () => {
    await openRtw();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /return to windows/i }));
    await waitFor(() =>
      expect((window as any).electron.returnToWindows).toHaveBeenCalledWith('admin', 'secret')
    );
  });

  it('shows an inline error when returnToWindows returns ok:false', async () => {
    (window as any).electron.returnToWindows = vi.fn().mockResolvedValue({ ok: false, error: 'Invalid credentials' });
    await openRtw();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /return to windows/i }));
    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('re-enables the form after an error so the operator can retry', async () => {
    (window as any).electron.returnToWindows = vi.fn().mockResolvedValue({ ok: false, error: 'Bad password' });
    await openRtw();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /return to windows/i }));
    await screen.findByText(/bad password/i);
    expect(screen.getByRole('button', { name: /return to windows/i })).not.toBeDisabled();
  });

  it('Enter key in the password field submits the form', async () => {
    await openRtw();
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'pass' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/password/i), { key: 'Enter' });
    await waitFor(() =>
      expect((window as any).electron.returnToWindows).toHaveBeenCalledWith('admin', 'pass')
    );
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they all fail**

```bash
cd client && npx vitest run src/components/desktop/__tests__/FlexOSPowerMenu.test.tsx
```

Expected: multiple failures — `shutdownOs`, `restartOs`, `returnToWindows` are not on `window.electron` yet and the component has no OS power buttons.

- [ ] **Step 3: Rewrite `FlexOSPowerMenu.tsx`**

Replace the entire contents of `client/src/components/desktop/FlexOSPowerMenu.tsx` with:

```tsx
/**
 * FlexOS Power Menu
 *
 * Shown on Ctrl+Alt+Delete (or from taskbar right-click). Full-screen dimmed
 * overlay with Lock, Sign Out, Restart App, and — on Windows — Shut Down,
 * Restart, and (kiosk mode only) Return to Windows.
 */
import React, { useEffect, useState } from 'react';
import { Lock, LogOut, RefreshCw, X, Shield, Power, RotateCcw, Monitor } from 'lucide-react';

export interface FlexOSPowerMenuProps {
  onClose: () => void;
  onLock: () => void;
  onSignOut: () => void;
}

type View = 'menu' | 'return-to-windows';

interface RtwState {
  username: string;
  password: string;
  error: string;
  loading: boolean;
}

export default function FlexOSPowerMenu({ onClose, onLock, onSignOut }: FlexOSPowerMenuProps) {
  const el = (window as any).electron;
  const isWin = el?.platform === 'win32';

  const [kioskActive, setKioskActive] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [rtw, setRtw] = useState<RtwState>({ username: '', password: '', error: '', loading: false });

  // Load kiosk state once on mount — determines whether Return to Windows is shown.
  useEffect(() => {
    el?.getKioskShellState?.()
      .then((s: { supported: boolean; enabled: boolean }) => setKioskActive(Boolean(s?.enabled)))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape key: back to menu from sub-panel; close overlay from main menu.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (view === 'return-to-windows') { setView('menu'); } else { onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, view]);

  const handleRestartApp = () => {
    if (el?.isElectron && el?.restartApp) { el.restartApp(); } else { window.location.reload(); }
    onClose();
  };

  const handleShutdown = () => { el?.shutdownOs?.(); };
  const handleRestartOs = () => { el?.restartOs?.(); };

  const handleReturnToWindows = async () => {
    if (rtw.loading) return;
    setRtw(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const result = await el?.returnToWindows?.(rtw.username, rtw.password);
      if (result?.ok) {
        // Main process shows a sync dialog then the OS begins shutting down.
        // Keep loading state — the operator will see the native dialog next.
      } else {
        setRtw(prev => ({ ...prev, loading: false, error: result?.error || 'An error occurred.' }));
      }
    } catch {
      setRtw(prev => ({ ...prev, loading: false, error: 'Could not reach the app.' }));
    }
  };

  const OVERLAY: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 9995,
    background: 'var(--modal-scrim)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  };

  const CARD: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
    minWidth: 280,
  };

  if (view === 'return-to-windows') {
    return (
      <div style={OVERLAY} onClick={onClose}>
        <div style={CARD} onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
            <Monitor style={{ width: 16, height: 16, color: 'var(--accent-silver-400)' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Return to Windows
            </span>
          </div>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, textAlign: 'center' }}>
            Admin or manager credentials required.
          </p>

          <input
            type="text"
            placeholder="Username"
            value={rtw.username}
            onChange={e => setRtw(prev => ({ ...prev, username: e.target.value }))}
            autoComplete="username"
            disabled={rtw.loading}
            style={{
              padding: '8px 10px',
              marginBottom: 8,
              background: 'rgba(var(--rmpg-800-rgb, 18 40 64), 0.9)',
              border: '1px solid rgba(195,204,214,0.2)',
              color: 'var(--text-primary)',
              fontSize: 13,
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={rtw.password}
            onChange={e => setRtw(prev => ({ ...prev, password: e.target.value }))}
            autoComplete="current-password"
            disabled={rtw.loading}
            onKeyDown={e => { if (e.key === 'Enter' && !rtw.loading) handleReturnToWindows(); }}
            style={{
              padding: '8px 10px',
              marginBottom: 8,
              background: 'rgba(var(--rmpg-800-rgb, 18 40 64), 0.9)',
              border: '1px solid rgba(195,204,214,0.2)',
              color: 'var(--text-primary)',
              fontSize: 13,
              width: '100%',
              boxSizing: 'border-box',
            }}
          />

          {rtw.error && (
            <p style={{ fontSize: 11, color: 'var(--sev-critical, #ef4444)', marginBottom: 8, width: '100%' }}>
              {rtw.error}
            </p>
          )}

          <button
            type="button"
            onClick={handleReturnToWindows}
            disabled={rtw.loading || !rtw.username || !rtw.password}
            style={{
              padding: '12px 20px',
              background: 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.7)',
              border: '1px solid rgba(195,204,214,0.12)',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontWeight: 600,
              cursor: rtw.loading || !rtw.username || !rtw.password ? 'not-allowed' : 'pointer',
              width: '100%',
              opacity: rtw.loading || !rtw.username || !rtw.password ? 0.5 : 1,
            }}
          >
            {rtw.loading ? 'Verifying…' : 'Return to Windows'}
          </button>

          <button
            type="button"
            onClick={() => setView('menu')}
            style={{
              marginTop: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              fontSize: 10,
              color: 'var(--text-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            <X style={{ width: 11, height: 11 }} />
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={CARD} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          <Shield style={{ width: 16, height: 16, color: 'var(--accent-silver-400)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            FlexOS
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <PowerButton icon={Lock} label="Lock" sublabel="Ctrl+L" onClick={() => { onLock(); onClose(); }} />
          <PowerButton icon={LogOut} label="Sign Out" sublabel="End session" onClick={() => { onSignOut(); onClose(); }} />
          <PowerButton icon={RefreshCw} label="Restart App" sublabel="Reload FlexOS" onClick={handleRestartApp} />

          {isWin && (
            <>
              <div style={{ height: 1, background: 'rgba(195,204,214,0.12)', margin: '4px 0' }} />
              <PowerButton icon={Power} label="Shut Down" sublabel="Shut down this computer" onClick={handleShutdown} />
              <PowerButton icon={RotateCcw} label="Restart" sublabel="Restart this computer" onClick={handleRestartOs} />
              {kioskActive && (
                <PowerButton
                  icon={Monitor}
                  label="Return to Windows"
                  sublabel="Requires admin credentials"
                  onClick={() => setView('return-to-windows')}
                />
              )}
            </>
          )}
        </div>

        {/* Cancel */}
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 16px',
            fontSize: 10,
            color: 'var(--text-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            letterSpacing: '0.04em',
          }}
        >
          <X style={{ width: 11, height: 11 }} />
          Cancel (Esc)
        </button>
      </div>
    </div>
  );
}

function PowerButton({
  icon: Icon,
  label,
  sublabel,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  sublabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 20px',
        background: 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.7)',
        border: '1px solid rgba(195,204,214,0.12)',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        transition: 'background 120ms',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.4)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.7)'; }}
    >
      <Icon style={{ width: 18, height: 18, color: 'var(--accent-silver-300)', flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, letterSpacing: '0.04em' }}>{sublabel}</div>
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run the new tests — all should pass**

```bash
cd client && npx vitest run src/components/desktop/__tests__/FlexOSPowerMenu.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Run the full client test suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass (same count as before, plus the new FlexOSPowerMenu tests). Zero new failures.

- [ ] **Step 6: Run client typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
cd ..
git add client/src/components/desktop/FlexOSPowerMenu.tsx \
        client/src/components/desktop/__tests__/FlexOSPowerMenu.test.tsx
git commit -m "feat(desktop): add Shut Down, Restart, Return to Windows to FlexOS Power Menu"
```

---

## Final Verification

- [ ] Run the full desktop test suite:
  ```bash
  cd desktop && npm test
  ```
  Expected: all existing tests pass.

- [ ] Run the full client test suite:
  ```bash
  cd client && npx vitest run
  ```
  Expected: all tests pass including the 13 new FlexOSPowerMenu tests.

- [ ] Run client + worker typechecks:
  ```bash
  cd client && npx tsc --noEmit && cd .. && npm run typecheck
  ```
  Expected: 0 errors on both.

- [ ] Open a PR against `main`. The PR diff should touch exactly four files: `desktop/main.js`, `desktop/preload.js`, `client/src/components/desktop/FlexOSPowerMenu.tsx`, `client/src/components/desktop/__tests__/FlexOSPowerMenu.test.tsx`.
