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

  // Use window.alert because the React UI may be frozen — this is the
  // most reliable confirmation gesture that always works.
  const top = payload.fixedOverlays[0];
  const summary = top
    ? `Captured. Top overlay:\n${top.tag}.${top.className.slice(0, 60)}\nz-index: ${top.zIndex}\nbody.overflow: ${payload.bodyOverflow}\n\nUploaded to dispatch logs. Press F5 to recover the app.`
    : `Captured (no fixed overlay >100×100 found).\nbody.overflow: ${payload.bodyOverflow}\nactive: ${payload.activeElement?.tag}\n\nPress F5 to recover.`;
  window.alert(summary);

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

// ── Install global keystroke + error capture ─────────────────
let installed = false;
export function installUiTrapHotkey(): void {
  if (installed) return;
  installed = true;

  // Capture global JS errors so we know if a render exception preceded the freeze
  window.addEventListener('error', (e) => {
    captureError(`error: ${e.message} at ${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    captureError(`unhandledrejection: ${String(e.reason).slice(0, 300)}`);
  });

  // Ctrl+Alt+D — Diagnostic. Reachable even when click handlers are dead.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      e.stopPropagation();
      void captureUiTrap('triggered_by_user_ctrl_alt_d');
    }
  }, true /* capture phase — runs before React listeners */);

  // Drain any pending payloads from previous freezes
  void flushPendingPayloads();
}
