// Shared selection state for the Intel Portal. The center surfaces call
// selectEntity(); the right context panel renders whatever is selected.
// This is the single seam between the three panes — surfaces never reach
// into the panel directly.
//
// v1047 — panel-collapsed flag is now scoped per-user. Intel data is the
// most sensitive surface in the app (active warrants, gang flags, watch-
// list); a shared-device login (kiosk, MDT) inheriting the prior user's
// portal layout state was a small but real privacy leak. Anonymous user
// falls back to the legacy global key so the migration is lossless.
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { AuthContext } from '../../context/AuthContext';

export interface SelectedEntity { type: string; id: number; label: string }
export type PanelMode = 'dossier' | 'graph';

interface IntelContextValue {
  selected: SelectedEntity | null;
  selectEntity: (type: string, id: number, label: string) => void;
  panelMode: PanelMode;
  setPanelMode: (m: PanelMode) => void;
  panelCollapsed: boolean;
  togglePanel: () => void;
}

const Ctx = createContext<IntelContextValue | null>(null);
const COLLAPSE_KEY_LEGACY = 'rmpg-intel-panel-collapsed';
const COLLAPSE_KEY_PREFIX = 'rmpg-intel-panel-collapsed-';

function collapseKeyFor(userId: string | number | null | undefined): string {
  return userId != null && String(userId).length > 0
    ? `${COLLAPSE_KEY_PREFIX}${userId}`
    : COLLAPSE_KEY_LEGACY;
}

export function IntelProvider({ children }: { children: ReactNode }) {
  // Optional auth read — IntelProvider is used in unit tests without an
  // AuthProvider, so we read the context directly (undefined → fall back
  // to the legacy global key).
  const auth = useContext(AuthContext);
  const userId = (auth?.user as { id?: string | number } | null | undefined)?.id;
  const collapseKey = collapseKeyFor(userId);

  const [selected, setSelected] = useState<SelectedEntity | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('dossier');
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(collapseKey) === '1'; } catch { return false; }
  });

  const selectEntity = useCallback((type: string, id: number, label: string) => {
    setSelected({ type, id, label });
    setPanelMode('dossier');     // a fresh selection always opens the dossier peek
    setPanelCollapsed(false);    // …and expands the panel so it's visible
  }, []);

  const togglePanel = useCallback(() => {
    setPanelCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(collapseKey, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }, [collapseKey]);

  return (
    <Ctx.Provider value={{ selected, selectEntity, panelMode, setPanelMode, panelCollapsed, togglePanel }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIntelContext(): IntelContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIntelContext must be used within IntelProvider');
  return v;
}
