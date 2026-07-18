import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV_CATEGORIES } from '../../../data/navCatalog';
import { loadFavorites, loadRecent } from '../../../utils/navFavorites';

export default function DesktopQuickAccessWidget() {
  const navigate = useNavigate();
  const allFunctions = useMemo(() => NAV_CATEGORIES.flatMap(cat => cat.functions), []);
  const favorites = useMemo(() => {
    const favSet = loadFavorites();
    return allFunctions.filter(fn => favSet.has(fn.path));
  }, [allFunctions]);
  const recent = useMemo(() => {
    const recentPaths = loadRecent();
    return recentPaths.map(p => allFunctions.find(fn => fn.path === p)).filter(Boolean).slice(0, 5) as typeof allFunctions;
  }, [allFunctions]);

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 220 }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--rmpg-400)' }}>Quick Access</div>
      {favorites.length === 0 && recent.length === 0 ? (
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No favorites yet — star a module in the Directory.</div>
      ) : (
        <>
          {favorites.map(fn => (
            <button key={fn.path} type="button" onClick={() => navigate(fn.path)} className="w-full text-left text-[11px] py-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
              {fn.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
