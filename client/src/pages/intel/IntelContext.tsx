// Shared selection state for the Intel Portal. The center surfaces call
// selectEntity(); the right context panel renders whatever is selected.
// This is the single seam between the three panes — surfaces never reach
// into the panel directly.
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

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
const COLLAPSE_KEY = 'rmpg-intel-panel-collapsed';

export function IntelProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedEntity | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('dossier');
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });

  const selectEntity = useCallback((type: string, id: number, label: string) => {
    setSelected({ type, id, label });
    setPanelMode('dossier');     // a fresh selection always opens the dossier peek
    setPanelCollapsed(false);    // …and expands the panel so it's visible
  }, []);

  const togglePanel = useCallback(() => {
    setPanelCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }, []);

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
