/**
 * Virtual desktop (workspace) switcher for the RMPG Flex private OS shell.
 *
 * Renders a compact workspace pill row inside the taskbar. Each workspace
 * maintains its own window list (via DesktopWindowManager). Switching
 * workspaces shows/hides the corresponding floating windows.
 *
 * Default workspaces (4):
 *   1 — CAD/Dispatch       2 — Records/Warrants
 *   3 — Intel/Map          4 — Admin/Fleet
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export const WORKSPACE_COUNT = 4;
export const WORKSPACE_LABELS = ['CAD', 'RMS', 'Intel', 'Admin'];

const STORAGE_KEY = 'rmpg_desktop_active_workspace';
const WS_LABELS_KEY = 'rmpg_desktop_workspace_labels';

function readWorkspaceLabels(): string[] {
  try {
    const raw = localStorage.getItem(WS_LABELS_KEY);
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a.length === WORKSPACE_COUNT) return a; }
  } catch { /* ignore */ }
  return [...WORKSPACE_LABELS];
}

interface VirtualDesktopContextValue {
  active: number;
  setActive: (idx: number) => void;
}

const VirtualDesktopContext = createContext<VirtualDesktopContextValue>({ active: 0, setActive: () => {} });

export function VirtualDesktopProvider({ children }: { children: React.ReactNode }) {
  const [active, setActiveRaw] = useState(() => {
    try { return Math.max(0, Math.min(WORKSPACE_COUNT - 1, parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10))); }
    catch { return 0; }
  });

  const setActive = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(WORKSPACE_COUNT - 1, idx));
    setActiveRaw(clamped);
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
  }, []);

  // Keyboard: Ctrl+1–4 switch workspaces
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= WORKSPACE_COUNT) { e.preventDefault(); setActive(n - 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setActive]);

  return (
    <VirtualDesktopContext.Provider value={{ active, setActive }}>
      {children}
    </VirtualDesktopContext.Provider>
  );
}

export function useVirtualDesktop() {
  return useContext(VirtualDesktopContext);
}

/**
 * The compact workspace pill row rendered inside the taskbar.
 */
export function WorkspacePills() {
  const { active, setActive } = useVirtualDesktop();
  const [labels] = useState(readWorkspaceLabels);

  return (
    <div
      style={{ display: 'flex', gap: 2, alignItems: 'center' }}
      role="tablist"
      aria-label="Workspaces"
    >
      {labels.map((label, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={active === i}
          aria-label={`Workspace ${i + 1}: ${label}`}
          title={`${label} (Ctrl+${i + 1})`}
          onClick={() => setActive(i)}
          style={{
            padding: '2px 8px',
            fontSize: 9,
            fontWeight: active === i ? 700 : 400,
            letterSpacing: '0.08em',
            background: active === i ? 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.35)' : 'transparent',
            color: active === i ? 'var(--text-primary)' : 'var(--text-muted)',
            border: active === i ? '1px solid rgba(var(--rmpg-400-rgb, 80 140 200), 0.5)' : '1px solid transparent',
            cursor: 'pointer',
            userSelect: 'none',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
