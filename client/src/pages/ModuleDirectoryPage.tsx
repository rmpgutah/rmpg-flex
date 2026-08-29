import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Search, Star, Clock, ExternalLink, RefreshCw, Grid3X3 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isWindowablePath, openPageWindow } from '../utils/windowManager';
import PanelTitleBar from '../components/PanelTitleBar';
import { NAV_CATEGORIES, CLIENT_VIEWER_BLOCKED, CONTRACT_MANAGER_BLOCKED, type NavFunction } from '../data/navCatalog';
import { loadFavorites, saveFavorites, loadRecent, pushRecent } from '../utils/navFavorites';
import { useNavBadges, type NavBadges } from '../hooks/useNavBadges';
import { isAppPinned, pinApp, unpinApp } from '../utils/taskbarPreferences';
import ContextMenu from '../components/ContextMenu';
import { isFeatureEnabled, useFeatureFlags } from '../utils/featureFlags';
import { modulesToCsv, downloadTextFile } from '../utils/rmsListExport';
import { copyToClipboard } from '../utils/contextMenuActions';


export default function ModuleDirectoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isClientViewer = user?.role === 'client_viewer';
  const isContractManager = user?.role === 'contract_manager';
  const flagsTick = useFeatureFlags();

  const searchRef = useRef<HTMLInputElement>(null);

  const [activeCategory, setActiveCategory] = useState(NAV_CATEGORIES[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const toggleBulkSelected = useCallback((path: string) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const commitBulkPin = useCallback(() => {
    setFavorites(prev => {
      const next = new Set(prev);
      bulkSelected.forEach(path => next.add(path));
      saveFavorites(next);
      return next;
    });
    setBulkSelected(new Set());
    setBulkMode(false);
  }, [bulkSelected]);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [, forceRerender] = useState(0);
  const { badges, isLoading: badgesLoading } = useNavBadges();

  const showFavorites = favorites.size > 0 && !searchQuery.trim();

  // Deep-link: ?module=<categoryId> — select the category on mount and strip param
  useEffect(() => {
    const moduleParam = searchParams.get('module');
    if (!moduleParam) return;
    const matched = NAV_CATEGORIES.find(c => c.id === moduleParam);
    if (matched) setActiveCategory(matched.id);
    setSearchParams({}, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleCategories = useMemo(() => {
    return NAV_CATEGORIES.map(cat => ({
      ...cat,
      functions: cat.functions.filter(fn => {
        if (fn.adminOnly && !isAdmin) return false;
        if (isClientViewer && CLIENT_VIEWER_BLOCKED.has(fn.path)) return false;
        if (isContractManager && CONTRACT_MANAGER_BLOCKED.has(fn.path)) return false;
        if (!isFeatureEnabled(fn.path)) return false;
        if (pinnedOnly && !isAppPinned(fn.path) && !favorites.has(fn.path)) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return fn.label.toLowerCase().includes(q) ||
            fn.description.toLowerCase().includes(q) ||
            fn.path.toLowerCase().includes(q);
        }
        return true;
      }),
    })).filter(cat => cat.functions.length > 0);
  }, [isAdmin, isClientViewer, isContractManager, searchQuery, flagsTick, pinnedOnly, favorites]);

  const allFunctions = useMemo(
    () => visibleCategories.flatMap(cat => cat.functions),
    [visibleCategories],
  );

  const favoriteFunctions = useMemo(() => {
    if (favorites.size === 0) return [];
    return allFunctions.filter(fn => favorites.has(fn.path));
  }, [favorites, allFunctions]);

  const recentFunctions = useMemo(() => {
    if (recent.length === 0) return [];
    const seen = new Set<string>();
    const result: NavFunction[] = [];
    for (const path of recent) {
      const fn = allFunctions.find(f => f.path === path);
      if (fn && !seen.has(path)) {
        seen.add(path);
        result.push(fn);
      }
      if (result.length >= 5) break;
    }
    return result;
  }, [recent, allFunctions]);

  const toggleFavorite = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveFavorites(next);
      return next;
    });
  }, []);

  const handleNavigate = useCallback((path: string, newWindow = false) => {
    pushRecent(path);
    if (newWindow) {
      window.open(path, '_blank', 'noopener,noreferrer');
    } else {
      navigate(path);
    }
  }, [navigate]);

  const handlePopOut = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    pushRecent(path);
    openPageWindow(path);
  }, []);

  // Global keydown: N focuses search; Esc clears search; F-keys navigate shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    ) return;

    if (e.key === 'Escape') {
      e.stopPropagation();
      if (searchQuery) {
        setSearchQuery('');
        setActiveCategory(NAV_CATEGORIES[0].id);
      }
      return;
    }

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }

    const match = e.key.match(/^F(\d+)$/);
    if (!match) return;

    const fNum = parseInt(match[1], 10);
    const shortcutItems = allFunctions.filter(fn => fn.shortcut);
    const idx = fNum - 1;
    if (idx >= shortcutItems.length) return;

    e.preventDefault();
    handleNavigate(shortcutItems[idx].path);
  }, [allFunctions, handleNavigate, searchQuery]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Track navigation via history patches
  useEffect(() => {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const track = (path: string) => {
      try {
        const url = new URL(path, window.location.origin);
        if (url.pathname !== '/navigation') pushRecent(url.pathname);
      } catch { /* silent */ }
    };
    const handler = () => track(window.location.pathname);
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      handler();
    };
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      handler();
    };
    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);


  const hasSearchResults = !searchQuery.trim() || allFunctions.length > 0;

  // Keep recent state in sync after navigation tracking patches history
  useEffect(() => {
    setRecent(loadRecent());
  }, [activeCategory]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Navigation */}
      <nav
        className="flex-shrink-0 overflow-y-auto py-3"
        style={{
          width: 200,
          background: 'var(--surface-overlay)',
          borderRight: '1px solid var(--border-subtle)',
          scrollbarWidth: 'none',
        }}
      >
        <div className="px-3 pb-3 mb-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Modules</span>
          </div>
          <div className="text-[9px] text-rmpg-500 mt-1 font-mono">{allFunctions.length} Functions</div>
        </div>

        {showFavorites && (
          <button
            type="button"
            onClick={() => setActiveCategory('_favorites')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${activeCategory !== '_favorites' ? 'hover:bg-surface-raised' : ''}`}
            style={{
              background: activeCategory === '_favorites' ? 'rgba(var(--brand-400-rgb),0.12)' : 'transparent',
              color: activeCategory === '_favorites' ? 'rgb(var(--brand-400-rgb))' : 'rgb(var(--rmpg-500-rgb))',
              borderLeft: activeCategory === '_favorites' ? '3px solid rgb(var(--brand-400-rgb))' : '3px solid transparent',
            }}
          >
            <Star style={{ width: 14, height: 14, flexShrink: 0, color: activeCategory === '_favorites' ? 'rgb(var(--brand-400-rgb))' : 'var(--text-muted)' }} />
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-medium block truncate">Favorites</span>
              <span className="text-[8px] text-rmpg-600 font-mono">{favorites.size} saved</span>
            </div>
          </button>
        )}

        {recentFunctions.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveCategory('_recent')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${activeCategory !== '_recent' ? 'hover:bg-surface-raised' : ''}`}
            style={{
              background: activeCategory === '_recent' ? 'rgba(var(--rmpg-500-rgb),0.12)' : 'transparent',
              color: activeCategory === '_recent' ? 'var(--text-primary)' : 'rgb(var(--rmpg-500-rgb))',
              borderLeft: activeCategory === '_recent' ? '3px solid var(--border-default)' : '3px solid transparent',
            }}
          >
            <Clock style={{ width: 14, height: 14, flexShrink: 0, color: activeCategory === '_recent' ? 'var(--text-secondary)' : 'var(--text-muted)' }} />
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-medium block truncate">Recent</span>
              <span className="text-[8px] text-rmpg-600 font-mono">{recentFunctions.length} modules</span>
            </div>
          </button>
        )}

        {showFavorites && <div className="mx-3 my-1 h-px" style={{ background: 'var(--surface-raised)' }} />}

        {visibleCategories.map((cat) => {
          const Icon = cat.icon;
          const active = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${!active ? 'hover:bg-surface-raised' : ''}`}
              style={{
                background: active ? 'rgba(var(--rmpg-500-rgb),0.12)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'rgb(var(--rmpg-500-rgb))',
                borderLeft: active ? '3px solid var(--border-default)' : '3px solid transparent',
              }}
            >
              <Icon style={{ width: 14, height: 14, flexShrink: 0, color: active ? 'var(--text-secondary)' : 'var(--text-muted)' }} />
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-medium block truncate">{cat.label}</span>
                <span className="text-[8px] text-rmpg-600 font-mono">{cat.functions.length} functions</span>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: 'var(--surface-sunken)' }}>
        <div className="p-4 max-w-5xl mx-auto space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1" style={{ maxWidth: 400 }}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  if (e.target.value && visibleCategories.length > 0) {
                    setActiveCategory(visibleCategories[0].id);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    if (searchQuery) {
                      setSearchQuery('');
                      setActiveCategory(NAV_CATEGORIES[0].id);
                    } else {
                      searchRef.current?.blur();
                    }
                  }
                }}
                placeholder="Search modules by name, path, or description… (N to focus, Esc to clear)"
                className="w-full pl-9 pr-3 py-2 text-[11px] bg-surface-sunken border border-rmpg-700 text-rmpg-100 placeholder-rmpg-500 focus:outline-none focus:border-rmpg-500 transition-colors"
                autoFocus
              />
            </div>
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setActiveCategory(NAV_CATEGORIES[0].id); }}
              className="flex items-center gap-1 px-2 py-2 text-[10px] text-rmpg-500 hover:text-rmpg-300 transition-colors"
              title="Reset"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={pinnedOnly} onChange={(e) => setPinnedOnly(e.target.checked)} aria-label="Pinned and favorites only" />
              Pinned / favorites
            </label>
            <button
              type="button"
              className="px-2 py-2 text-[10px] border border-rmpg-700"
              disabled={allFunctions.length === 0}
              onClick={() => downloadTextFile('modules.csv', modulesToCsv(allFunctions))}
            >
              CSV
            </button>
          </div>

          <div className="flex items-center gap-2 px-2">
            <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                aria-label="Select multiple"
                checked={bulkMode}
                onChange={(e) => { setBulkMode(e.target.checked); setBulkSelected(new Set()); }}
              />
              Select multiple
            </label>
            {bulkMode && bulkSelected.size > 0 && (
              <button type="button" onClick={commitBulkPin} className="text-[10px] px-2 py-0.5" style={{ color: 'var(--accent-silver-400)', border: '1px solid var(--border-default)' }}>
                Pin {bulkSelected.size} selected
              </button>
            )}
          </div>

          {/* Badge loading indicator */}
          {badgesLoading && (
            <p className="text-[8px] text-rmpg-600 font-mono text-right pr-1 select-none">Loading live counts&#8230;</p>
          )}

          {/* No-results empty state */}
          {searchQuery.trim() && !hasSearchResults && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="w-8 h-8 text-rmpg-600 mb-3" />
              <p className="text-[11px] font-semibold text-rmpg-400">No modules matching &#8220;{searchQuery}&#8221;</p>
              <p className="text-[9px] text-rmpg-600 mt-1">Try a different keyword or browse by category.</p>
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setActiveCategory(NAV_CATEGORIES[0].id); }}
                className="mt-3 px-3 py-1.5 text-[10px] text-rmpg-400 border border-rmpg-700 hover:bg-surface-raised transition-colors"
              >
                Clear search
              </button>
            </div>
          )}

          {showFavorites && (activeCategory === '_favorites' || searchQuery.trim()) && (
            <div>
              <PanelTitleBar title={`Favorites (${favoriteFunctions.length})`} icon={Star} />
              {favoriteFunctions.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-[10px] text-rmpg-600">
                  No favorited modules &#8212; click the star on any module card.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {favoriteFunctions.map((fn) => renderFunctionCard(fn))}
                </div>
              )}
            </div>
          )}

          {recentFunctions.length > 0 && (activeCategory === '_recent' || searchQuery.trim()) && !showFavorites && (
            <div>
              <PanelTitleBar title={`Recent (${recentFunctions.length})`} icon={Clock} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {recentFunctions.map((fn) => renderFunctionCard(fn))}
              </div>
            </div>
          )}

          {hasSearchResults && visibleCategories.map((cat) => (
            <div key={cat.id}>
              <PanelTitleBar
                title={`${cat.label} (${cat.functions.length})`}
                icon={cat.icon}
              />
              {cat.id === activeCategory || searchQuery.trim() ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {cat.functions.map((fn) => renderFunctionCard(fn))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {cat.functions.slice(0, 3).map((fn) => {
                    const Icon = fn.icon;
                    return (
                      <button
                        key={fn.path}
                        type="button"
                        onClick={() => setActiveCategory(cat.id)}
                        className="flex items-center gap-3 p-3 text-left transition-colors hover:bg-surface-raised"
                        style={{
                          background: 'var(--surface-sunken)',
                          border: '1px solid var(--border-default)',
                        }}
                      >
                        <Icon className="w-3.5 h-3.5 text-rmpg-500 flex-shrink-0" />
                        <span className="text-[10px] text-rmpg-400 truncate">{fn.label}</span>
                      </button>
                    );
                  })}
                  {cat.functions.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setActiveCategory(cat.id)}
                      className="flex items-center justify-center p-3 text-[9px] text-rmpg-500 hover:text-rmpg-300 transition-colors font-mono"
                      style={{ border: '1px dashed var(--border-default)' }}
                    >
                      +{cat.functions.length - 3} more
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  function renderFunctionCard(fn: NavFunction) {
    const Icon = fn.icon;
    const isFavorite = favorites.has(fn.path);
    const canPopOut = isWindowablePath(fn.path);
    const badgeValue = fn.badgeKey ? badges[fn.badgeKey as keyof NavBadges] : undefined;

    return (
      <ContextMenu
        key={fn.path}
        items={[{
          label: isAppPinned(fn.path) ? 'Unpin from Taskbar' : 'Pin to Taskbar',
          onClick: () => { if (isAppPinned(fn.path)) unpinApp(fn.path); else pinApp(fn.path); forceRerender(n => n + 1); },
        }, {
          label: 'Copy path',
          onClick: () => { void copyToClipboard(fn.path); },
        }]}
      >
      <div
        className="group relative transition-all duration-150 hover:bg-surface-raised active:scale-[0.98]"
        style={{
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border-default)',
        }}
      >
        <button
          type="button"
          onClick={() => handleNavigate(fn.path)}
          onAuxClick={(e) => { if (e.button === 1) handleNavigate(fn.path, true); }}
          className="w-full flex items-start gap-3 p-3 text-left"
        >
          <div
            className="flex-shrink-0 flex items-center justify-center transition-colors group-hover:bg-brand-900/20"
            style={{
              width: 32,
              height: 32,
              background: 'rgba(var(--rmpg-500-rgb),0.08)',
              border: '1px solid var(--border-subtle)',
              position: 'relative',
            }}
          >
            <Icon className="w-4 h-4 text-rmpg-300 group-hover:text-brand-400 transition-colors" />
            {badgeValue !== undefined && badgeValue > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 flex items-center justify-center font-bold bg-red-600 text-white"
                style={{
                  minWidth: 14, height: 14, padding: '0 3px',
                  fontSize: 8, lineHeight: 1,
                  borderRadius: 7, border: '1px solid var(--surface-overlay)',
                  boxShadow: '0 0 6px rgba(220,38,38,0.5)',
                }}
              >
                {badgeValue > 99 ? '99+' : badgeValue}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-rmpg-100 group-hover:text-brand-400 transition-colors truncate">
                {fn.label}
              </span>
              {fn.shortcut && (
                <span
                  className="text-[8px] font-mono px-1 py-0.5 flex-shrink-0"
                  style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  {fn.shortcut}
                </span>
              )}
            </div>
            <span
              className="text-[8px] font-mono text-rmpg-600 block mt-0.5 truncate"
              title={fn.path}
            >
              {fn.path}
            </span>
            <p className="text-[9px] text-rmpg-400 leading-relaxed mt-1 line-clamp-2">
              {fn.description}
            </p>
          </div>
        </button>

        <div
          className={`absolute right-1 top-1 flex items-center gap-0.5 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${bulkMode ? 'opacity-100' : 'opacity-0'}`}
        >
          {canPopOut && (
            <button
              type="button"
              onClick={(e) => handlePopOut(fn.path, e)}
              className="p-1 text-rmpg-500 hover:text-rmpg-300 transition-colors"
              title={`Open ${fn.label} in new window`}
              aria-label={`Pop out ${fn.label}`}
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
          {bulkMode && (
            <input
              type="checkbox"
              aria-label={`Select ${fn.label}`}
              checked={bulkSelected.has(fn.path)}
              onChange={() => toggleBulkSelected(fn.path)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <button
            type="button"
            onClick={(e) => toggleFavorite(fn.path, e)}
            className="p-1 transition-colors"
            style={{ color: isFavorite ? 'rgb(var(--brand-400-rgb))' : 'var(--text-muted)' }}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={isFavorite ? `Remove ${fn.label} from favorites` : `Add ${fn.label} to favorites`}
          >
            <Star className="w-3 h-3" fill={isFavorite ? 'rgb(var(--brand-400-rgb))' : 'none'} />
          </button>
        </div>
      </div>
      </ContextMenu>
    );
  }
}
