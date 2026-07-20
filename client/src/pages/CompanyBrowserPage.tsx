// ============================================================
// RMPG Flex — Company Browser
// General-purpose external web browsing, rendered inside a
// dedicated Electron BrowserWindow (see desktop/main.js's
// 'window:open-company-browser' handler). Never rendered inside
// the main app window or a FloatingWindow iframe — <webview> is
// only enabled on this one window's webPreferences.
// ============================================================

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Plus, Star, Trash2, Clock } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  error: string | null;
}

interface Bookmark {
  id: string;
  url: string;
  title: string;
}

interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: string;
}

// React's own type definitions (@types/react) already declare a global
// `HTMLWebViewElement` and a `webview` JSX intrinsic element (see
// react/index.d.ts's WebViewHTMLAttributes) — Electron normally supplies the
// runtime behind that type. That built-in declaration only extends
// `HTMLElement` with no members, so it doesn't know about the imperative
// navigation methods Electron's <webview> actually exposes at runtime. This
// merges the missing members onto the same global interface rather than
// declaring an unrelated same-named type (which TS would then treat as two
// incompatible types).
declare global {
  interface HTMLWebViewElement {
    src: string;
    goBack(): void;
    goForward(): void;
    reload(): void;
    getURL(): string;
    getTitle(): string;
    canGoBack(): boolean;
    canGoForward(): boolean;
  }
}

const NEW_TAB_URL = 'about:blank';
const MAX_HISTORY_ENTRIES = 200;
const BOOKMARKS_SAVE_DEBOUNCE_MS = 800;

// Mirrors desktop/main.js's FATAL_NET_ERRORS (search that name there for the
// per-code rationale). Duplicated rather than imported: main.js is a
// CommonJS Electron-main module and this file is an ES module bundled by
// Vite for the renderer — there's no clean shared-import path across that
// boundary, so the pragmatic choice is one small client-local constant with
// this comment as the tether, instead of forcing a cross-process module.
// Keep the two lists in sync if either changes.
const FATAL_NET_ERRORS = new Set([
  -2, -100, -101, -102, -103, -105, -106, -109, -118, -130, -137,
  -201, -202, -203, -207, -208,
]);
function isFatalNavFailure(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame === true && FATAL_NET_ERRORS.has(errorCode);
}

function makeTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Bare domains ("example.com") get https:// prepended, like a real browser's address bar. Anything that already looks like a URL (has a scheme) passes through unchanged. */
function normalizeAddressInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return NEW_TAB_URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function CompanyBrowserPage() {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [{
    id: makeTabId(), url: NEW_TAB_URL, title: '', canGoBack: false, canGoForward: false, loading: false, error: null,
  }]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [addressInput, setAddressInput] = useState('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const webviewRefs = useRef<Record<string, HTMLWebViewElement | null>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstLoad = useRef(true);

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);

  useEffect(() => {
    setAddressInput(activeTab.url === NEW_TAB_URL ? '' : activeTab.url);
  }, [activeTab.id, activeTab.url]);

  useEffect(() => {
    apiFetch<{ browser_bookmarks_json: string | null; browser_history_json: string | null }>('/preferences')
      .then((prefs) => {
        setBookmarks(parseJsonArray<Bookmark>(prefs.browser_bookmarks_json));
        setHistory(parseJsonArray<HistoryEntry>(prefs.browser_history_json));
      })
      .catch(() => { /* start empty on failure — non-blocking, same tolerance as DesktopPage's preferences load */ });
  }, []);

  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      apiFetch('/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          browser_bookmarks_json: JSON.stringify(bookmarks),
          browser_history_json: JSON.stringify(history),
        }),
      }).catch(() => { /* non-blocking — retried on next change, same pattern as DesktopPage */ });
    }, BOOKMARKS_SAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [bookmarks, history]);

  const updateTab = useCallback((id: string, patch: Partial<BrowserTab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const recordHistory = useCallback((url: string, title: string) => {
    if (url === NEW_TAB_URL) return;
    setHistory(prev => [{ url, title, visitedAt: new Date().toISOString() }, ...prev].slice(0, MAX_HISTORY_ENTRIES));
  }, []);

  const navigateActiveTab = useCallback((rawUrl: string) => {
    const url = normalizeAddressInput(rawUrl);
    updateTab(activeTab.id, { url, loading: true, error: null });
  }, [activeTab.id, updateTab]);

  const handleAddressSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    navigateActiveTab(addressInput);
  }, [addressInput, navigateActiveTab]);

  const openNewTab = useCallback(() => {
    const tab: BrowserTab = { id: makeTabId(), url: NEW_TAB_URL, title: '', canGoBack: false, canGoForward: false, loading: false, error: null };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev; // always keep at least one tab open
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabId) setActiveTabId(next[next.length - 1].id);
      delete webviewRefs.current[id];
      return next;
    });
  }, [activeTabId]);

  const goBack = useCallback(() => webviewRefs.current[activeTab.id]?.goBack(), [activeTab.id]);
  const goForward = useCallback(() => webviewRefs.current[activeTab.id]?.goForward(), [activeTab.id]);
  const reload = useCallback(() => webviewRefs.current[activeTab.id]?.reload(), [activeTab.id]);

  const isBookmarked = bookmarks.some(b => b.url === activeTab.url);
  const toggleBookmark = useCallback(() => {
    if (isBookmarked) {
      setBookmarks(prev => prev.filter(b => b.url !== activeTab.url));
    } else {
      setBookmarks(prev => [...prev, { id: makeTabId(), url: activeTab.url, title: activeTab.title }]);
    }
  }, [isBookmarked, activeTab.url, activeTab.title]);

  // <webview> fires plain DOM events (not React synthetic events), so listeners
  // are attached imperatively via the ref rather than JSX props.
  useEffect(() => {
    const el = webviewRefs.current[activeTab.id];
    if (!el) return;

    const onDidNavigate = () => {
      const url = el.getURL();
      updateTab(activeTab.id, {
        url, loading: false, error: null, canGoBack: el.canGoBack(), canGoForward: el.canGoForward(),
      });
    };
    const onTitleUpdated = (e: Event) => {
      const title = (e as CustomEvent & { title?: string }).title ?? el.getTitle();
      updateTab(activeTab.id, { title });
      recordHistory(el.getURL(), title);
    };
    const onStartLoading = () => updateTab(activeTab.id, { loading: true });
    const onStopLoading = () => updateTab(activeTab.id, {
      loading: false, canGoBack: el.canGoBack(), canGoForward: el.canGoForward(),
    });
    // Per the design's Error Handling section: DNS/connection/cert failures
    // are shown inline in the tab, filtered through the same fatal/non-fatal
    // split main.js's own did-fail-load handler uses (FATAL_NET_ERRORS
    // above) so a transient ABORTED/NETWORK_CHANGED blip doesn't flash a
    // false error.
    const onDidFailLoad = (e: Event) => {
      const fe = e as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (!isFatalNavFailure(fe.errorCode ?? 0, fe.isMainFrame ?? true)) return;
      updateTab(activeTab.id, {
        loading: false,
        error: fe.errorDescription || 'This page could not be loaded.',
      });
    };

    el.addEventListener('did-navigate', onDidNavigate);
    el.addEventListener('did-navigate-in-page', onDidNavigate);
    el.addEventListener('page-title-updated', onTitleUpdated);
    el.addEventListener('did-start-loading', onStartLoading);
    el.addEventListener('did-stop-loading', onStopLoading);
    el.addEventListener('did-fail-load', onDidFailLoad);
    return () => {
      el.removeEventListener('did-navigate', onDidNavigate);
      el.removeEventListener('did-navigate-in-page', onDidNavigate);
      el.removeEventListener('page-title-updated', onTitleUpdated);
      el.removeEventListener('did-start-loading', onStartLoading);
      el.removeEventListener('did-stop-loading', onStopLoading);
      el.removeEventListener('did-fail-load', onDidFailLoad);
    };
  }, [activeTab.id, updateTab, recordHistory]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--surface-base)' }}>
      <div role="tablist" className="flex items-center" style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            onClick={() => setActiveTabId(tab.id)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] cursor-pointer"
            style={{
              maxWidth: 180, borderRight: '1px solid var(--border-subtle)',
              background: tab.id === activeTabId ? 'var(--surface-raised)' : 'transparent',
              color: 'var(--text-primary)',
            }}
          >
            <span className="truncate">{tab.title || 'New Tab'}</span>
            <button
              type="button"
              aria-label="Close tab"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
            >
              <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
        ))}
        <button type="button" aria-label="New tab" onClick={openNewTab} className="p-1.5">
          <Plus className="w-3.5 h-3.5" style={{ color: 'var(--rmpg-400)' }} />
        </button>
      </div>

      <div className="flex items-center gap-1 px-2 py-1" style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}>
        <button type="button" aria-label="Back" onClick={goBack} disabled={!activeTab.canGoBack} className="p-1">
          <ArrowLeft className="w-3.5 h-3.5" style={{ color: activeTab.canGoBack ? 'var(--rmpg-400)' : 'var(--text-muted)' }} />
        </button>
        <button type="button" aria-label="Forward" onClick={goForward} disabled={!activeTab.canGoForward} className="p-1">
          <ArrowRight className="w-3.5 h-3.5" style={{ color: activeTab.canGoForward ? 'var(--rmpg-400)' : 'var(--text-muted)' }} />
        </button>
        <button type="button" aria-label="Reload" onClick={reload} className="p-1">
          <RotateCw className="w-3.5 h-3.5" style={{ color: 'var(--rmpg-400)' }} />
        </button>
        <form onSubmit={handleAddressSubmit} className="flex-1">
          <input
            type="text"
            role="textbox"
            aria-label="Address"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="Enter a URL"
            className="w-full px-2 py-1 text-[11px]"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          />
        </form>
        <button type="button" aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'} onClick={toggleBookmark} className="p-1">
          <Star className="w-3.5 h-3.5" fill={isBookmarked ? 'currentColor' : 'none'} style={{ color: 'var(--brand-gold)' }} />
        </button>
        <button type="button" aria-label="History" onClick={() => setHistoryOpen(o => !o)} className="p-1">
          <Clock className="w-3.5 h-3.5" style={{ color: 'var(--rmpg-400)' }} />
        </button>
      </div>

      {bookmarks.length > 0 && (
        <div className="flex items-center gap-3 px-2 py-1" style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}>
          {bookmarks.map(b => (
            <a
              key={b.id}
              role="link"
              href="#"
              onClick={(e) => { e.preventDefault(); navigateActiveTab(b.url); }}
              className="text-[11px] truncate"
              style={{ color: 'var(--text-primary)', maxWidth: 160 }}
            >
              {b.title || b.url}
            </a>
          ))}
        </div>
      )}

      <div className="flex-1 relative">
        {tabs.map(tab => (
          <webview
            key={tab.id}
            ref={(el) => { webviewRefs.current[tab.id] = el; }}
            src={tab.url}
            style={{ position: 'absolute', inset: 0, display: tab.id === activeTabId ? 'block' : 'none' }}
            partition={`persist:company-browser-${tab.id}`}
          />
        ))}

        {activeTab.error && (
          <div
            role="alert"
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 12px',
              background: 'var(--sev-critical)', color: 'var(--text-primary)', fontSize: 11, zIndex: 1,
            }}
          >
            {activeTab.error}
          </div>
        )}

        {historyOpen && (
          <div
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: 280,
              background: 'var(--surface-raised)', borderLeft: '1px solid var(--border-strong)', overflowY: 'auto',
            }}
          >
            <div className="flex items-center justify-between px-2 py-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>History</span>
              <button type="button" aria-label="Clear history" onClick={() => setHistory([])}>
                <Trash2 className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
            {history.map((h, i) => (
              <div
                key={`${h.url}_${h.visitedAt}_${i}`}
                onClick={() => navigateActiveTab(h.url)}
                className="px-2 py-1 text-[11px] truncate cursor-pointer"
                style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)' }}
              >
                {h.title || h.url}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
