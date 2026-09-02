// ============================================================
// uiTrapDiagnostic — capture state when the UI freezes
//
// Wired to a Ctrl+Alt+D keystroke. Document-level keyboard
// listeners fire before any focus-trap or pointer-events block,
// so the user can trigger this even when clicks/typing are dead.
//
// Captures every fixed-positioned overlay that could be trapping
// input, plus body.overflow lock state, focus state, voice channel
// state, recent navigation, and uploads to /api/diagnostics/ui-trap.
//
// Falls back to localStorage if the network call fails so the next
// page load can upload it.
// ============================================================

const LS_KEY = 'rmpg-ui-trap-pending';
const LS_HISTORY_KEY = 'rmpg-ui-trap-history';

interface OverlayInfo {
  tag: string;
  className: string;
  zIndex: string;
  width: number;
  height: number;
  visibility: string;
  opacity: string;
  pointerEvents: string;
  ariaLabel: string | null;
  role: string | null;
}

interface TrapPayload {
  capturedAt: string;
  url: string;
  userAgent: string;
  windowSize: { w: number; h: number };
  bodyOverflow: string;
  htmlOverflow: string;
  activeElement: { tag: string; className: string; id: string } | null;
  documentHasFocus: boolean;
  visibilityState: DocumentVisibilityState;
  // The big one — every fixed-positioned overlay
  fixedOverlays: OverlayInfo[];
  // High-z-index elements (catches absolutes that act like overlays)
  highZElements: OverlayInfo[];
  // Recent network errors / fetch failures captured by global handler
  recentErrors: string[];
  // App-specific state (read from localStorage where possible)
  voiceChannel: {
    enabled: string | null;
    confirmMode: string | null;
    listenMode: string | null;
    driveOverride: string | null;
  };
  notes?: string;
}

// ── Recent error capture (filled by window.onerror) ──────────
const recentErrors: string[] = [];
const MAX_RECENT_ERRORS = 20;

function captureError(err: string): void {
  recentErrors.push(`${new Date().toISOString()} ${err}`);
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift();
}

// ── Element snapshot ──────────────────────────────────────────
function snapshotElement(el: Element): OverlayInfo {
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    className: (typeof el.className === 'string' ? el.className : '').slice(0, 200),
    zIndex: s.zIndex,
    width: Math.round(r.width),
    height: Math.round(r.height),
    visibility: s.visibility,
    opacity: s.opacity,
    pointerEvents: s.pointerEvents,
    ariaLabel: el.getAttribute('aria-label'),
    role: el.getAttribute('role'),
  };
}

// ── Build the diagnostic payload ─────────────────────────────
export function buildTrapPayload(notes?: string): TrapPayload {
  const all = Array.from(document.querySelectorAll('*'));
  const fixedOverlays: OverlayInfo[] = [];
  const highZElements: OverlayInfo[] = [];

  for (const el of all) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // Only include things big enough to be a trap — skip 1px utility elements
    if (r.width < 100 || r.height < 100) continue;

    if (s.position === 'fixed') {
      fixedOverlays.push(snapshotElement(el));
    }
    const z = parseInt(s.zIndex, 10);
    if (Number.isFinite(z) && z >= 50 && s.pointerEvents !== 'none') {
      highZElements.push(snapshotElement(el));
    }
  }

  // Sort by z-index descending so the top trap is first
  fixedOverlays.sort((a, b) => (parseInt(b.zIndex) || 0) - (parseInt(a.zIndex) || 0));
  highZElements.sort((a, b) => (parseInt(b.zIndex) || 0) - (parseInt(a.zIndex) || 0));

  const ae = document.activeElement;
  return {
    capturedAt: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    windowSize: { w: window.innerWidth, h: window.innerHeight },
    bodyOverflow: document.body.style.overflow || getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    activeElement: ae ? {
      tag: ae.tagName,
      className: (typeof (ae as any).className === 'string' ? (ae as any).className : '').slice(0, 200),
      id: ae.id || '',
    } : null,
    documentHasFocus: document.hasFocus(),
    visibilityState: document.visibilityState,
    fixedOverlays,
    highZElements,
    recentErrors: [...recentErrors],
    voiceChannel: {
      enabled: localStorage.getItem('rmpg-voice-channel-enabled'),
      confirmMode: localStorage.getItem('rmpg-voice-confirm-mode'),
      listenMode: localStorage.getItem('rmpg-voice-listen-mode'),
      driveOverride: localStorage.getItem('rmpg-drive-mode-override'),
    },
    notes,
  };
}

// ── Upload, with localStorage fallback ───────────────────────
async function uploadPayload(payload: TrapPayload): Promise<boolean> {
  try {
    const token = localStorage.getItem('rmpg_token');
    const res = await fetch('/api/diagnostics/ui-trap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function persistToLocal(payload: TrapPayload): void {
  try {
    const pending = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    pending.push(payload);
    // Keep only the last 5 unsent payloads
    while (pending.length > 5) pending.shift();
    localStorage.setItem(LS_KEY, JSON.stringify(pending));

    // Also append to a longer-lived history (last 20)
    const history = JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || '[]');
    history.push({ at: payload.capturedAt, url: payload.url, top: payload.fixedOverlays[0]?.className });
    while (history.length > 20) history.shift();
    localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(history));
  } catch { /* localStorage full or unavailable */ }
}

// ── Public capture trigger ───────────────────────────────────
export async function captureUiTrap(notes?: string): Promise<void> {
  const payload = buildTrapPayload(notes);
  // Always persist locally first — uploads can fail, the data must survive
  persistToLocal(payload);

  // Fire-and-forget upload — already persisted locally
  uploadPayload(payload).then((ok) => {
    if (ok) {
      // Mark as uploaded by pruning from pending
      try {
        const pending = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
        const remaining = pending.filter((p: any) => p.capturedAt !== payload.capturedAt);
        localStorage.setItem(LS_KEY, JSON.stringify(remaining));
      } catch { /* ignore */ }
    }
  });
}

// ── Drain pending payloads on app load ───────────────────────
export async function flushPendingPayloads(): Promise<void> {
  try {
    const pending: TrapPayload[] = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    if (pending.length === 0) return;
    const remaining: TrapPayload[] = [];
    for (const p of pending) {
      const ok = await uploadPayload(p);
      if (!ok) remaining.push(p);
    }
    localStorage.setItem(LS_KEY, JSON.stringify(remaining));
  } catch { /* ignore */ }
}

// ── UI recovery: un-trap a frozen page ───────────────────────

/**
 * Detect genuine input-trapping overlays: fixed-position, ~full-viewport,
 * pointer-active elements that carry NO dialog semantics. A stuck modal backdrop
 * that never unmounted is the leading cause of "buttons stopped working", and
 * the leading cause of THAT is a 404/throw inside an async handler that skipped
 * the overlay's teardown. Legitimate dialogs/menus (role, aria-modal,
 * aria-label) and the app shell (#root) are deliberately excluded, as are
 * backdrops that host a real dialog. This is the SHARED predicate behind both
 * the manual Ctrl+Alt+D recovery and the automatic watchdog, so the two can
 * never disagree on what counts as a trap.
 */
export function findBlockingOverlays(): HTMLElement[] {
  const out: HTMLElement[] = [];
  try {
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const he = el as HTMLElement;
      const s = getComputedStyle(he);
      if (s.position !== 'fixed') continue;
      if (s.pointerEvents === 'none') continue;
      const r = he.getBoundingClientRect();
      if (!(r.width >= vw * 0.8 && r.height >= vh * 0.8)) continue;
      // Skip legitimate dialogs/menus and anything with a11y semantics.
      const role = he.getAttribute('role');
      if (role === 'dialog' || role === 'menu' || role === 'alertdialog' || role === 'listbox') continue;
      if (he.getAttribute('aria-modal') === 'true') continue;
      if (he.getAttribute('aria-label')) continue;
      // Skip app shell / known roots that should keep pointer events.
      if (he.id === 'root' || he.id === 'pre-splash') continue;
      if (he.querySelector('[role="dialog"],[aria-modal="true"]')) continue; // backdrop hosting a real dialog — leave it
      out.push(he);
    }
  } catch { /* best effort */ }
  return out;
}

/** Release a body/html scroll-lock if one is set. Returns the actions taken. */
function releaseOverflowLocks(): string[] {
  const actions: string[] = [];
  for (const el of [document.body, document.documentElement]) {
    if (el && el.style.overflow && el.style.overflow !== 'visible') {
      el.style.overflow = '';
      actions.push(`reset ${el.tagName.toLowerCase()} overflow lock`);
    }
  }
  return actions;
}

/** Neutralize an overlay's click-trap non-destructively (preserves DOM/state). */
function neutralizeOverlay(he: HTMLElement): string {
  const z = getComputedStyle(he).zIndex || '?';
  he.style.pointerEvents = 'none';
  return `neutralized fixed overlay z=${z} ${(he.className || '').toString().slice(0, 60)}`;
}

/**
 * Best-effort un-trap of a frozen UI (manual Ctrl+Alt+D path): unconditionally
 * release scroll/overflow locks, then neutralize every orphaned full-screen
 * click-blocking overlay. Non-destructive — sets pointer-events:none rather than
 * removing nodes, so component state survives. The user explicitly asked to
 * un-stick the page, so this is the aggressive variant.
 */
export function attemptTrapRecovery(): string[] {
  const actions: string[] = [];
  try {
    actions.push(...releaseOverflowLocks());
    for (const he of findBlockingOverlays()) actions.push(neutralizeOverlay(he));
  } catch {
    /* best effort */
  }
  return actions;
}

/**
 * Conservative auto-recovery used by the watchdog: act ONLY when a genuine
 * blocking overlay is present. Unlike attemptTrapRecovery, this performs ZERO
 * DOM mutation when nothing is trapped, so a routine API error that left the UI
 * perfectly usable triggers no side effects (no spurious overflow reset, no
 * fighting a legitimately-open overlay that simply has no a11y semantics yet).
 * Returns the actions taken (empty array when there was nothing to recover).
 */
export function recoverIfTrapped(): string[] {
  const actions: string[] = [];
  try {
    const blockers = findBlockingOverlays();
    if (blockers.length === 0) return actions;
    actions.push(...releaseOverflowLocks());
    for (const he of blockers) actions.push(neutralizeOverlay(he));
  } catch { /* best effort */ }
  return actions;
}

/**
 * Show a brief on-screen toast confirming diagnostic capture + recovery.
 * Inline-styled, pointer-events:none, high z-index — visible even when the
 * app CSS is broken. Auto-removes after 4 s.
 */
function showRecoveryToast(actions: string[], headline = 'UI diagnostic captured'): void {
  try {
    const blocked = actions.filter((a) => a.startsWith('neutralized'));
    const overflows = actions.filter((a) => a.startsWith('reset'));
    const parts: string[] = [headline];
    if (blocked.length > 0) {
      parts.push(`recovered ${blocked.length} blocker${blocked.length > 1 ? 's' : ''}`);
    }
    if (overflows.length > 0) {
      parts.push(`cleared ${overflows.length} overflow lock${overflows.length > 1 ? 's' : ''}`);
    }
    if (blocked.length === 0 && overflows.length === 0) {
      parts.push('no blocker found — try reload if still frozen');
    }

    const div = document.createElement('div');
    div.textContent = parts.join(' · ');
    Object.assign(div.style, {
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      background: 'var(--surface-raised)',
      color: 'var(--field-label-color)',
      border: '1px solid #d4a017',
      borderRadius: '2px',
      padding: '8px 16px',
      fontSize: '13px',
      fontFamily: 'Arial, sans-serif',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 8px rgba(0 0 0 / 0.8)',
    });
    document.body.appendChild(div);
    setTimeout(() => {
      try { document.body.removeChild(div); } catch { /* already removed */ }
    }, 4000);
  } catch {
    /* best effort — don't let the toast crash after we've just recovered */
  }
}

// ── Automatic trap watchdog ──────────────────────────────────
/**
 * A 404 (or any thrown API error) inside an async handler/effect becomes an
 * UNHANDLED PROMISE REJECTION — React ErrorBoundaries can't see it (they only
 * catch render/lifecycle throws), so if the failing operation had put up a
 * full-screen blocking overlay and its teardown sat AFTER the `await` (never
 * reached on throw), the overlay is stranded and the whole app appears frozen:
 * "buttons dead, no pathway, no error card". This watchdog promotes the existing
 * manual Ctrl+Alt+D recovery into an automatic safety net so field users aren't
 * stuck. On a rejection it waits `delayMs` (letting a correct teardown win the
 * race), then recovers ONLY if a genuine trap still persists. Throttled so a
 * rejection storm can't loop. Dependencies are injected so the scheduling and
 * throttle logic is unit-testable without a real DOM or wall clock.
 */
export interface TrapWatchdogDeps {
  /** Returns the recovery actions taken; empty when there was no trap to fix. */
  recoverIfTrapped: () => string[];
  /** Called with the non-empty action list after a successful auto-recovery. */
  onRecovered: (actions: string[]) => void;
  setTimer: (cb: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
  now: () => number;
  /** Grace period before checking for a persistent trap. Default 1500ms. */
  delayMs?: number;
  /** Minimum gap between two auto-recoveries. Default 5000ms. */
  throttleMs?: number;
}

export interface TrapWatchdog {
  /** Arm a delayed trap check (call on an unhandled rejection / uncaught error). */
  notifyPotentialTrap(): void;
  /** Cancel any pending check. */
  dispose(): void;
}

export function createTrapWatchdog(deps: TrapWatchdogDeps): TrapWatchdog {
  const delayMs = deps.delayMs ?? 1500;
  const throttleMs = deps.throttleMs ?? 5000;
  let pending: number | null = null;
  let lastRecoveryAt = -Infinity;

  const runCheck = (): void => {
    pending = null;
    // Don't fight a recovery we just performed (guards against a rejection loop).
    if (deps.now() - lastRecoveryAt < throttleMs) return;
    const actions = deps.recoverIfTrapped();
    if (actions.length > 0) {
      lastRecoveryAt = deps.now();
      deps.onRecovered(actions);
    }
  };

  return {
    notifyPotentialTrap(): void {
      if (pending !== null) return; // coalesce a burst of rejections into one check
      pending = deps.setTimer(runCheck, delayMs);
    },
    dispose(): void {
      if (pending !== null) { deps.clearTimer(pending); pending = null; }
    },
  };
}

// ── Install global keystroke + error capture ─────────────────
let installed = false;
export function installUiTrapHotkey(): void {
  if (installed) return;
  installed = true;

  const watchdog = createTrapWatchdog({
    recoverIfTrapped,
    onRecovered: (actions) => {
      // Persist evidence of what was stuck, then tell the user in plain language.
      void captureUiTrap('auto_recovered_after_unhandled_rejection');
      showRecoveryToast(actions, 'Screen unlocked after a failed request');
    },
    setTimer: (cb, ms) => window.setTimeout(cb, ms),
    clearTimer: (h) => window.clearTimeout(h),
    now: () => Date.now(),
  });

  // Capture global JS errors so we know if a render exception preceded the freeze
  window.addEventListener('error', (e) => {
    captureError(`error: ${e.message} at ${e.filename}:${e.lineno}`);
    // Arm the watchdog only for genuine script exceptions — resource-load errors
    // (img/script 404) fire here too but carry no message and can't strand an
    // overlay. The check itself is a no-op when nothing is actually trapped.
    if (e.error || e.message) watchdog.notifyPotentialTrap();
  });
  window.addEventListener('unhandledrejection', (e) => {
    captureError(`unhandledrejection: ${String(e.reason).slice(0, 300)}`);
    watchdog.notifyPotentialTrap();
  });

  // Ctrl+Alt+D — Diagnostic + recovery. Reachable even when click handlers are dead.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      e.stopPropagation();
      // Capture FIRST so evidence reflects the trapped state, then recover.
      void captureUiTrap('triggered_by_user_ctrl_alt_d');
      const actions = attemptTrapRecovery();
      showRecoveryToast(actions);
    }
  }, true /* capture phase — runs before React listeners */);

  // Drain any pending payloads from previous freezes
  void flushPendingPayloads();
}
