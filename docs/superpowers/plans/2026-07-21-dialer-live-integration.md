# Dialer (Dial Connect) Live Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed Dial Connect (`dialer.rmpgutah.us`) live inside RMPG Flex and surface an alert when a call is ringing, without any backend changes in this repo.

**Architecture:** A persistent, always-mounted `DialerPanel` React component holds an iframe of `https://dialer.rmpgutah.us/dialer`. It listens for `window.postMessage` events sent by Dial Connect's own frontend (a separate, small PR in the `dispatch-app` repo, not built here) and reacts to `call_status: ringing` / `duress_alert` by expanding the panel and firing a toast, using a heartbeat message to drive a connectivity indicator.

**Tech Stack:** React 18 + TypeScript (client), Vitest + `@testing-library/react` for component tests, existing `ToastProvider`/`useToast` for alerts, existing `useAuth` for auth gating.

## Global Constraints

- Dial Connect's origin is exactly `https://dialer.rmpgutah.us` — the message listener must reject anything else, including messages missing the `source: 'dial-connect'` discriminant (spec: "Message contract" section).
- No Worker/backend changes, no D1 schema changes, no new API routes in this repo (spec: "Non-goals").
- Never hardcode hex — use the existing `bg-surface-raised` / `border-border-subtle` Tailwind tokens (CLAUDE.md Design tokens section), except for the connectivity dot color which needs a fixed green/gray regardless of theme (small, deliberate exception, same as severity colors in CLAUDE.md).
- Radius: 2px everywhere, never `rounded-lg` (CLAUDE.md) — this is enforced globally via `!important` in `client/src/index.css`, so no action needed as long as no component opts out.
- The iframe must never be conditionally unmounted when the panel is "collapsed" — only visually hidden (0-size + `overflow: hidden`) — because its embedded `EventSource` needs to keep running for the heartbeat/ring alerts to keep working (spec: "Renders... default collapsed... Collapsing hides the iframe visually... but never unmounts it").
- `client-typecheck` (`cd client && npx tsc --noEmit`) and `client-tests` (`cd client && npx vitest run`) must both stay green (CI gates in `.github/workflows/pr-tests.yml`).

---

### Task 1: `DialerPanel` component — message listener, connectivity state, expand/collapse UI

**Files:**
- Create: `client/src/components/DialerPanel.tsx`
- Test: `client/src/components/DialerPanel.test.tsx`

**Interfaces:**
- Produces: `export const DIALER_ORIGIN = 'https://dialer.rmpgutah.us'` (a string constant, importable so the test and any future consumer share one source of truth for the origin check).
- Produces: `export default function DialerPanel(props: DialerPanelProps): JSX.Element` where
  ```ts
  interface DialerPanelProps {
    onRinging?: (message: string) => void;
    onDuress?: (message: string) => void;
  }
  ```
  `onRinging`/`onDuress` are plain callbacks (not a direct `useToast()` call inside this component) so the component has zero dependency on `ToastProvider`'s context and can be rendered standalone in tests. Task 2 wires these to `addToast`.

- [ ] **Step 1: Write the failing test file**

```tsx
// client/src/components/DialerPanel.test.tsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DialerPanel, { DIALER_ORIGIN } from './DialerPanel';

function postDialConnectMessage(data: unknown, origin: string = DIALER_ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DialerPanel', () => {
  test('renders collapsed by default, disconnected', () => {
    render(<DialerPanel />);
    expect(screen.getByLabelText('Open dialer (disconnected)')).toBeInTheDocument();
  });

  test('ignores messages from a non-Dial-Connect origin', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage(
      { source: 'dial-connect', type: 'call_status', status: 'ringing', callSid: 'CA1', from: '+18015551234' },
      'https://evil.example.com',
    );
    expect(onRinging).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Open dialer (disconnected)')).toBeInTheDocument();
  });

  test('ignores same-origin-shaped messages missing the dial-connect source discriminant', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ type: 'call_status', status: 'ringing', callSid: 'CA1' });
    expect(onRinging).not.toHaveBeenCalled();
  });

  test('a ringing call_status expands the panel and fires onRinging with the caller number', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({
      source: 'dial-connect',
      type: 'call_status',
      status: 'ringing',
      callSid: 'CA123',
      from: '+18015551234',
    });
    expect(onRinging).toHaveBeenCalledWith('Inbound call from +18015551234');
    expect(screen.getByLabelText('Collapse dialer panel')).toBeInTheDocument();
  });

  test('a ringing call_status with no From falls back to "unknown number"', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ source: 'dial-connect', type: 'call_status', status: 'ringing', callSid: 'CA123' });
    expect(onRinging).toHaveBeenCalledWith('Inbound call from unknown number');
  });

  test('a non-ringing call_status does not expand the panel or fire onRinging', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ source: 'dial-connect', type: 'call_status', status: 'completed', callSid: 'CA123' });
    expect(onRinging).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Open dialer/)).toBeInTheDocument();
  });

  test('duress_alert expands the panel and fires onDuress', () => {
    const onDuress = vi.fn();
    render(<DialerPanel onDuress={onDuress} />);
    postDialConnectMessage({
      source: 'dial-connect',
      type: 'duress_alert',
      dispatcherName: 'J. Rivera',
      timestamp: '2026-07-21T00:00:00Z',
    });
    expect(onDuress).toHaveBeenCalledWith('Duress alert: J. Rivera');
    expect(screen.getByLabelText('Collapse dialer panel')).toBeInTheDocument();
  });

  test('any dial-connect message marks the panel connected, and it reverts to disconnected after the heartbeat timeout', () => {
    vi.useFakeTimers();
    render(<DialerPanel />);
    postDialConnectMessage({ source: 'dial-connect', type: 'heartbeat' });
    expect(screen.getByLabelText('Open dialer (connected)')).toBeInTheDocument();

    vi.advanceTimersByTime(46_000);
    expect(screen.getByLabelText('Open dialer (disconnected)')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/components/DialerPanel.test.tsx`
Expected: FAIL — `Cannot find module './DialerPanel'` (the component doesn't exist yet).

- [ ] **Step 3: Write the `DialerPanel` component**

```tsx
// client/src/components/DialerPanel.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneCall, X } from 'lucide-react';
import IconButton from './IconButton';

export const DIALER_ORIGIN = 'https://dialer.rmpgutah.us';

const HEARTBEAT_TIMEOUT_MS = 45_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 5_000;

type DialConnectMessage =
  | { source: 'dial-connect'; type: 'call_status'; callSid: string; status: string; from?: string }
  | { source: 'dial-connect'; type: 'duress_alert'; dispatcherName: string; timestamp: string }
  | { source: 'dial-connect'; type: 'heartbeat' };

function isDialConnectMessage(data: unknown): data is DialConnectMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === 'dial-connect' &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

interface DialerPanelProps {
  onRinging?: (message: string) => void;
  onDuress?: (message: string) => void;
}

export default function DialerPanel({ onRinging, onDuress }: DialerPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [connected, setConnected] = useState(false);
  const lastSeenRef = useRef(0);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== DIALER_ORIGIN) return;
      if (!isDialConnectMessage(event.data)) return;

      lastSeenRef.current = Date.now();
      setConnected(true);

      const message = event.data;
      if (message.type === 'call_status' && message.status === 'ringing') {
        setCollapsed(false);
        onRinging?.(`Inbound call from ${message.from ?? 'unknown number'}`);
      } else if (message.type === 'duress_alert') {
        setCollapsed(false);
        onDuress?.(`Duress alert: ${message.dispatcherName}`);
      }
    },
    [onRinging, onDuress],
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (lastSeenRef.current === 0) return;
      if (Date.now() - lastSeenRef.current > HEARTBEAT_TIMEOUT_MS) setConnected(false);
    }, HEARTBEAT_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex flex-col items-end">
      <div
        style={{
          width: collapsed ? 0 : 360,
          height: collapsed ? 0 : 520,
          overflow: 'hidden',
          transition: 'width 0.2s ease, height 0.2s ease',
        }}
        className="bg-surface-raised border border-border-subtle shadow-lg mb-2"
      >
        <div className="flex items-center justify-between px-2 py-1 border-b border-border-subtle">
          <span className="text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: connected ? '#4ade80' : '#6b7280' }}
            />
            Dialer {connected ? 'Connected' : 'Disconnected'}
          </span>
          <IconButton aria-label="Collapse dialer panel" onClick={() => setCollapsed(true)}>
            <X className="w-3.5 h-3.5" />
          </IconButton>
        </div>
        <iframe
          title="Dial Connect"
          src={`${DIALER_ORIGIN}/dialer`}
          className="w-full border-0"
          style={{ height: 'calc(100% - 28px)' }}
        />
      </div>
      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="bg-surface-raised border border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5"
          aria-label={`Open dialer (${connected ? 'connected' : 'disconnected'})`}
        >
          <PhoneCall className="w-3.5 h-3.5" />
          Dialer
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: connected ? '#4ade80' : '#6b7280' }}
          />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/components/DialerPanel.test.tsx`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/DialerPanel.tsx client/src/components/DialerPanel.test.tsx
git commit -m "feat(dialer): add DialerPanel iframe + postMessage bridge listener"
```

---

### Task 2: Mount `DialerPanel` in the app shell, wired to toasts, gated on auth

**Files:**
- Modify: `client/src/App.tsx:1-20` (imports), `client/src/App.tsx:725-748` (the `App` component body)

**Interfaces:**
- Consumes: `DialerPanel` from Task 1 (`onRinging`, `onDuress` props), `useToast()` from `client/src/components/ToastProvider.tsx` (`addToast(message: string, type: ToastType, duration?: number): void`), `useAuth()` from `client/src/context/AuthContext.tsx` (`isAuthenticated: boolean`).
- Produces: nothing new — this task only wires existing pieces together in `App.tsx`.

- [ ] **Step 1: Add a small wrapper component that reads auth + toast context and renders `DialerPanel`**

Add this above the `App` component in `client/src/App.tsx` (near the other small top-level components like `AppRoutes`):

```tsx
function DialerPanelMount() {
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();
  if (!isAuthenticated) return null;
  return (
    <DialerPanel
      onRinging={(message) => addToast(message, 'warning')}
      onDuress={(message) => addToast(message, 'error')}
    />
  );
}
```

Add the two new imports near the top of `client/src/App.tsx` (alongside the existing `ToastProvider`/`WebUpdateBanner` imports):

```tsx
import DialerPanel from './components/DialerPanel';
import { useToast } from './components/ToastProvider';
```

- [ ] **Step 2: Mount `DialerPanelMount` inside the provider tree**

In the `App` component's JSX (`client/src/App.tsx:733-739`), add `<DialerPanelMount />` alongside the other always-on global widgets, inside `ToastProvider` (needed for `useToast`) and `AuthProvider` (needed for `useAuth`) — both already wrap this point:

```tsx
                <ContextMenuProvider>
                  <ErrorBoundary>
                    <WebUpdateBanner />
                    <MDTBridge />
                    <AndroidUpdateChecker />
                    <ButtonHealthOverlay />
                    <DialerPanelMount />
                    <AppRoutes />
                  </ErrorBoundary>
                </ContextMenuProvider>
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors (project has pre-existing errors unrelated to this change per CLAUDE.md's session log — confirm the count doesn't increase by diffing against a run on `main` if in doubt, but a clean run with 0 errors is the expected outcome here since this is new, fully-typed code).

- [ ] **Step 4: Run the full client test suite to confirm nothing else broke**

Run: `cd client && npx vitest run`
Expected: PASS (same pass count as before this task, plus the 8 new `DialerPanel` tests from Task 1).

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(dialer): mount DialerPanel in the app shell, wired to toasts"
```

---

### Task 3: Manual verification in the browser preview

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start the client dev server and open it in the browser preview**

Use the `run`/preview tooling to start `cd client && npm run dev` and navigate to it, logged in as an authenticated user.

- [ ] **Step 2: Confirm the collapsed "Dialer" tab renders bottom-right**

Expected: a small "Dialer" button with a gray dot (disconnected) is visible in the bottom-right corner, and does **not** render for a logged-out session.

- [ ] **Step 3: Confirm the panel expands and the iframe loads**

Click the "Dialer" tab. Expected: the panel expands to 360×520 and `https://dialer.rmpgutah.us/dialer` loads inside the iframe (it will likely show Dial Connect's own login screen the first time, in the current browser session — that is expected per the spec's "First-time / logged-out state" note).

- [ ] **Step 4: Confirm the collapse button works and the iframe stays mounted**

Click "Collapse dialer panel". Expected: the panel shrinks to 0×0 (still in the DOM — verify via devtools that the `<iframe>` element is still present, not removed).

- [ ] **Step 5: Confirm alert wiring with a synthetic message (Dial Connect's real bridge patch isn't built yet)**

In the browser devtools console, run:

```js
window.postMessage({ source: 'dial-connect', type: 'call_status', status: 'ringing', callSid: 'test', from: '+18015551234' }, window.location.origin);
```

Note this uses `window.location.origin` as the *target* origin for `postMessage` (required since the page can only send to itself here) — but `DialerPanel`'s listener filters on `event.origin`, which for a same-page `window.postMessage` call is the page's own origin, not `https://dialer.rmpgutah.us`. **This synthetic call will correctly be ignored** — this is expected and confirms the origin filter works. To actually see the toast/expand behavior fire without the real Dial Connect bridge, temporarily edit `DIALER_ORIGIN` in a local scratch copy of the check, or skip this observation and rely on Task 1's automated tests (which construct the `MessageEvent` with an explicit `origin` field) as the authoritative proof of the alert path. Document this limitation to the user rather than fighting it — full end-to-end verification requires the companion `dispatch-app` bridge patch described in the design spec.

---

## Self-Review Notes

- **Spec coverage:** iframe embed + collapse (Task 1 Steps 3/1), origin+source filtering (Task 1 tests 2/3), ringing → toast + expand (Task 1 test 4/5, Task 2 wiring), duress → toast + expand (Task 1 test 6, Task 2 wiring), heartbeat-driven connectivity indicator (Task 1 test 7), auth gating (Task 2 Step 1), no backend changes (confirmed — no `src/` changes anywhere in this plan). The Dial Connect-side bridge and CSP-safety check remain explicitly out of this plan's scope, as agreed in the spec.
- **Placeholder scan:** no TBD/TODO; the one caveat in Task 3 Step 5 is a real, explained limitation (can't fire a genuine cross-origin message from the same-origin devtools console) rather than a deferred implementation detail.
- **Type consistency:** `DialConnectMessage`, `DIALER_ORIGIN`, and the `onRinging`/`onDuress` signatures are defined once in Task 1 and referenced identically (same names, same shapes) in Task 2.
