import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { NavFunction } from '../../../data/navCatalog';
import { loadFavorites, loadRecent } from '../../../utils/navFavorites';

export interface DesktopQuickAccessWidgetProps {
  // Role-filtered catalog, threaded down from DesktopPage's `allFunctions`
  // (mirrors ModuleDirectoryPage's visibleCategories filter). Must NOT fall
  // back to importing NAV_CATEGORIES directly — that would bypass the
  // adminOnly/CLIENT_VIEWER_BLOCKED/CONTRACT_MANAGER_BLOCKED filtering that
  // every other module-surfacing path in this feature (icon grid, taskbar
  // launcher) already goes through.
  catalog: NavFunction[];
}

export default function DesktopQuickAccessWidget({ catalog }: DesktopQuickAccessWidgetProps) {
  const navigate = useNavigate();
  const favorites = useMemo(() => {
    const favSet = loadFavorites();
    return catalog.filter(fn => favSet.has(fn.path));
  }, [catalog]);
  const recent = useMemo(() => {
    const recentPaths = loadRecent();
    return recentPaths.map(p => catalog.find(fn => fn.path === p)).filter(Boolean).slice(0, 5) as NavFunction[];
  }, [catalog]);

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 220 }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Quick Access</div>
      {favorites.length === 0 && recent.length === 0 ? (
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No favorites yet — star a module in the Directory.</div>
      ) : (
        <>
          {favorites.length > 0 && (
            <div>
              {recent.length > 0 && (
                <div className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Favorites</div>
              )}
              {favorites.map(fn => (
                <button key={fn.path} type="button" onClick={() => navigate(fn.path)} className="w-full text-left text-[11px] py-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
                  {fn.label}
                </button>
              ))}
            </div>
          )}
          {recent.length > 0 && (
            <div className={favorites.length > 0 ? 'mt-2' : undefined}>
              <div className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Recent</div>
              {recent.map(fn => (
                <button key={fn.path} type="button" onClick={() => navigate(fn.path)} className="w-full text-left text-[11px] py-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
                  {fn.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
