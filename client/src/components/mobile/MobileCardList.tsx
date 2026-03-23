// ============================================================
// RMPG Flex — Mobile Card List
// Reusable scrollable card list replacing data tables on mobile.
// Supports pull-to-refresh, search filtering, empty state, and
// infinite-scroll (load-more) with the retro CAD aesthetic.
// ============================================================

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Search, RefreshCw, ChevronDown, Inbox } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
interface MobileCardListProps<T> {
  /** Full data array (filtering happens externally or via searchQuery) */
  items: T[];
  /** Render a single card — receives item and its index */
  renderCard: (item: T, index: number) => React.ReactNode;
  /** Called when a card is tapped */
  onItemTap?: (item: T) => void;
  /** Unique key extractor for each item */
  keyExtractor: (item: T) => string;
  /** Show a search bar at the top */
  searchable?: boolean;
  /** External search value (controlled mode) */
  searchQuery?: string;
  /** Called when user types in the search bar */
  onSearchChange?: (query: string) => void;
  /** Search placeholder text */
  searchPlaceholder?: string;
  /** Pull-to-refresh callback — return a promise */
  onRefresh?: () => Promise<void>;
  /** "Load more" callback for infinite scroll */
  onLoadMore?: () => void;
  /** Whether more items are available to load */
  hasMore?: boolean;
  /** Whether data is currently loading */
  loading?: boolean;
  /** Message to show when list is empty */
  emptyMessage?: string;
  /** Optional icon for empty state */
  emptyIcon?: React.ElementType;
  /** Optional header content above the list */
  header?: React.ReactNode;
  /** Optional class name for outer wrapper */
  className?: string;
}

// ─── Pull-to-refresh thresholds ──────────────────────────────
const PULL_THRESHOLD = 64;  // px to pull before triggering refresh
const PULL_MAX = 100;       // max overscroll px

// ─── Component ───────────────────────────────────────────────
export default function MobileCardList<T>({
  items,
  renderCard,
  onItemTap,
  keyExtractor,
  searchable = false,
  searchQuery: externalSearch,
  onSearchChange,
  searchPlaceholder = 'Search…',
  onRefresh,
  onLoadMore,
  hasMore = false,
  loading = false,
  emptyMessage = 'No items found',
  emptyIcon: EmptyIcon = Inbox,
  header,
  className = '',
}: MobileCardListProps<T>) {
  // ── Pull-to-refresh state ──────────────────────────────────
  const listRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // ── Internal search state (uncontrolled mode) ──────────────
  const [internalSearch, setInternalSearch] = useState('');
  const searchValue = externalSearch ?? internalSearch;
  const handleSearch = useCallback(
    (val: string) => {
      if (onSearchChange) onSearchChange(val);
      else setInternalSearch(val);
    },
    [onSearchChange],
  );

  // ── Pull-to-refresh touch handlers ─────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onRefresh || refreshing) return;
    const el = listRef.current;
    if (el && el.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, [onRefresh, refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!onRefresh || refreshing || !touchStartY.current) return;
    const el = listRef.current;
    if (!el || el.scrollTop > 0) return;

    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      const clamped = Math.min(delta * 0.5, PULL_MAX);
      setPullDistance(clamped);
    }
  }, [onRefresh, refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!onRefresh || refreshing) return;
    if (pullDistance >= PULL_THRESHOLD) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    setPullDistance(0);
    touchStartY.current = 0;
  }, [onRefresh, refreshing, pullDistance]);

  // ── Infinite scroll observer ───────────────────────────────
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onLoadMore || !hasMore || loading) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore();
      },
      { root: listRef.current, rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, loading]);

  // ── Pull indicator rotation ────────────────────────────────
  const pullReady = pullDistance >= PULL_THRESHOLD;

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* ── Search Bar ─────────────────────────────────────── */}
      {searchable && (
        <div
          className="flex-shrink-0 px-3 py-2"
          style={{
            background: '#141e2b',
            borderBottom: '1px solid #1e3048',
          }}
        >
          <div
            className="flex items-center gap-2 px-3"
            style={{
              height: 40,
              background: '#0d1520',
              border: '1px solid #1e3048',
            }}
          >
            <Search style={{ width: 16, height: 16, color: '#5a6e80', flexShrink: 0 }} />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm text-rmpg-200 placeholder:text-rmpg-500 outline-none font-mono"
              style={{ minHeight: 40 }}
            />
            {searchValue && (
              <button type="button"
                onClick={() => handleSearch('')}
                className="text-rmpg-400 hover:text-rmpg-200"
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Optional header ────────────────────────────────── */}
      {header && (
        <div className="flex-shrink-0">{header}</div>
      )}

      {/* ── Scrollable list area ───────────────────────────── */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          WebkitOverflowScrolling: 'touch',
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: pullDistance === 0 ? 'transform 0.3s ease-out' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Pull-to-refresh indicator */}
        {onRefresh && (pullDistance > 0 || refreshing) && (
          <div
            className="flex items-center justify-center py-3"
            style={{
              position: 'absolute',
              top: -48,
              left: 0,
              right: 0,
              height: 48,
            }}
          >
            <RefreshCw
              style={{
                width: 20,
                height: 20,
                color: pullReady || refreshing ? '#1a5a9e' : '#5a6e80',
                transform: pullReady ? 'rotate(180deg)' : `rotate(${pullDistance * 3}deg)`,
                transition: 'transform 0.2s ease',
                animation: refreshing ? 'spin 1s linear infinite' : undefined,
              }}
            />
          </div>
        )}

        {/* Loading state */}
        {loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-rmpg-400">
            <RefreshCw
              style={{ width: 24, height: 24, animation: 'spin 1s linear infinite' }}
            />
            <span className="mt-3 text-xs font-mono uppercase tracking-wider">
              Loading…
            </span>
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-rmpg-400">
            <EmptyIcon style={{ width: 36, height: 36, opacity: 0.4 }} />
            <span className="mt-3 text-xs font-mono uppercase tracking-wider">
              {emptyMessage}
            </span>
          </div>
        )}

        {/* Card items */}
        {items.length > 0 && (
          <div className="px-2 py-2 space-y-1.5">
            {items.map((item, i) => (
              <div
                key={keyExtractor(item)}
                onClick={() => onItemTap?.(item)}
                className="cursor-pointer active:scale-[0.98] transition-transform duration-75"
              >
                {renderCard(item, i)}
              </div>
            ))}

            {/* Load-more sentinel */}
            {hasMore && <div ref={sentinelRef} className="h-4" />}

            {/* Loading more indicator */}
            {loading && items.length > 0 && (
              <div className="flex items-center justify-center py-4 text-rmpg-400">
                <RefreshCw
                  style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }}
                />
                <span className="ml-2 text-[10px] font-mono uppercase">
                  Loading more…
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
