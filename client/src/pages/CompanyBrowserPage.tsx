// ============================================================
// RMPG Flex — Company Browser (in-app)
// Embedded <webview>-based browser running inside the main
// app window. webviewTag must be enabled on the main BrowserWindow
// (desktop/main.js). Falls back gracefully in non-Electron envs.
// ============================================================

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, X, Plus, Star, Clock,
  ZoomIn, ZoomOut, Download, Printer, Lock, Unlock, Globe,
  Bookmark, Trash2, Copy, Home, Search, Shield, Wifi, WifiOff,
  ExternalLink, ChevronDown, Volume2, VolumeX, Maximize2,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import WebCompanyBrowserPage from './WebCompanyBrowserPage';

// ── Types ────────────────────────────────────────────────────────────────────

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  error: string | null;
  pinned?: boolean;
  muted?: boolean;
  favicon?: string;
  zoom?: number;
}

interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  folder?: string;
}

interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: string;
}

interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  startedAt: string;
  status: 'downloading' | 'done' | 'failed';
  progress?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NEW_TAB_URL = 'about:blank';
const MAX_HISTORY = 500;
const SAVE_DEBOUNCE_MS = 800;
const DEFAULT_ZOOM = 1;
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

const RMPG_QUICK_LINKS = [
  { label: 'RMPG Portal', url: 'https://rmpgutahps.us/portal/login' },
  { label: 'SL County', url: 'https://www.slco.org' },
  { label: 'Utah Courts', url: 'https://www.utcourts.gov' },
  { label: 'Fleet.io', url: 'https://app.fleetio.com' },
  { label: 'NCIC NLETS', url: 'https://www.nlets.org' },
];

const FATAL_NET_ERRORS = new Set([
  -2, -100, -101, -102, -103, -105, -106, -109, -118, -130, -137,
  -201, -202, -203, -207, -208,
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

declare global {
  interface HTMLWebViewElement {
    src: string;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
    getURL(): string;
    getTitle(): string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    setZoomFactor(factor: number): void;
    getZoomFactor(): number;
    print(): void;
    findInPage(text: string, options?: { forward?: boolean; matchCase?: boolean }): void;
    stopFindInPage(action: 'clearSelection' | 'keepSelection'): void;
    setAudioMuted(muted: boolean): void;
    isAudioMuted(): boolean;
    getWebContentsId(): number;
    executeJavaScript(code: string): Promise<unknown>;
    insertCSS(css: string): Promise<string>;
    removeInsertedCSS(key: string): Promise<void>;
    capturePage(): Promise<{ toPNG(): Buffer }>;
  }
}

function makeId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalize(raw: string): string {
  const t = raw.trim();
  if (!t) return NEW_TAB_URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  if (/\s/.test(t) || !t.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
  return `https://${t}`;
}

function isAllowed(url: string): boolean {
  if (url === NEW_TAB_URL || url === 'about:blank') return true;
  try {
    const p = new URL(url);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch { return false; }
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  try { const p = raw ? JSON.parse(raw) : []; return Array.isArray(p) ? p : []; } catch { return []; }
}

function ownershipKey(uid?: string | number): string {
  return uid != null ? `rmpg_cbrowser_ack_${uid}` : 'rmpg_cbrowser_ack';
}

function isFatalNavFailure(code: number, isMain: boolean): boolean {
  return isMain && FATAL_NET_ERRORS.has(code);
}

function securityLabel(url: string): { secure: boolean; label: string } {
  try {
    const p = new URL(url);
    if (p.protocol === 'https:') return { secure: true, label: p.hostname };
    return { secure: false, label: p.hostname };
  } catch { return { secure: false, label: '' }; }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CompanyBrowserPage() {
  const { user } = useAuth();

  const [tabs, setTabs] = useState<BrowserTab[]>(() => [
    { id: makeId(), url: NEW_TAB_URL, title: 'New Tab', canGoBack: false, canGoForward: false, loading: false, error: null, zoom: DEFAULT_ZOOM },
  ]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [addressInput, setAddressInput] = useState('');
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);

  // Panel visibility
  const [panel, setPanel] = useState<'history' | 'bookmarks' | 'downloads' | 'find' | 'quicklinks' | null>(null);

  // Find-in-page
  const [findQuery, setFindQuery] = useState('');
  const [findMatchCase, setFindMatchCase] = useState(false);

  // Ownership notice (shown once per user)
  const [showOwnershipNotice, setShowOwnershipNotice] = useState(
    () => localStorage.getItem(ownershipKey(user?.id)) !== '1'
  );

  // Dark reader CSS key
  const [darkReader, setDarkReader] = useState(false);
  const darkReaderKeyRef = useRef<string | null>(null);

  const webviewRefs = useRef<Record<string, HTMLWebViewElement | null>>({});
  const webviewContainerRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstLoad = useRef(true);
  const addressRef = useRef<HTMLInputElement>(null);

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);

  // Sync address bar with active tab
  useEffect(() => {
    setAddressInput(activeTab.url === NEW_TAB_URL ? '' : activeTab.url);
  }, [activeTab.id, activeTab.url]);

  // Load persisted bookmarks + history
  useEffect(() => {
    apiFetch<{ browser_bookmarks_json?: string | null; browser_history_json?: string | null }>('/user/preferences')
      .then(prefs => {
        setBookmarks(parseJsonArray<BookmarkItem>(prefs.browser_bookmarks_json));
        setHistory(parseJsonArray<HistoryEntry>(prefs.browser_history_json));
      })
      .catch(() => {});
  }, []);

  // Persist bookmarks + history (debounced)
  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      apiFetch('/user/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          browser_bookmarks_json: JSON.stringify(bookmarks),
          browser_history_json: JSON.stringify(history.slice(0, MAX_HISTORY)),
        }),
      }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [bookmarks, history]);

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') { e.preventDefault(); openNewTab(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') { e.preventDefault(); closeTab(activeTabId); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); reload(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') { e.preventDefault(); addressRef.current?.focus(); addressRef.current?.select(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setPanel(p => p === 'find' ? null : 'find'); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); toggleBookmark(); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') { e.preventDefault(); setPanel(p => p === 'history' ? null : 'history'); }
      if ((e.ctrlKey || e.metaKey) && e.key === '=') { e.preventDefault(); zoomIn(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); resetZoom(); }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeTab]);

  // ── Tab management ──────────────────────────────────────────────────────────

  const updateTab = useCallback((id: string, patch: Partial<BrowserTab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const recordHistory = useCallback((url: string, title: string) => {
    if (!url || url === NEW_TAB_URL) return;
    setHistory(prev => [{ url, title, visitedAt: new Date().toISOString() }, ...prev.filter(h => h.url !== url)].slice(0, MAX_HISTORY));
  }, []);

  const navigateTo = useCallback((rawUrl: string, tabId?: string) => {
    const id = tabId ?? activeTab.id;
    const url = normalize(rawUrl);
    if (!isAllowed(url)) { updateTab(id, { error: 'Only http/https URLs are permitted.' }); return; }
    updateTab(id, { url, loading: true, error: null });
  }, [activeTab.id, updateTab]);

  const openNewTab = useCallback((url?: string) => {
    const tab: BrowserTab = { id: makeId(), url: url ?? NEW_TAB_URL, title: url ? url : 'New Tab', canGoBack: false, canGoForward: false, loading: !!url, error: null, zoom: DEFAULT_ZOOM };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabId) setActiveTabId(next[Math.max(0, prev.findIndex(t => t.id === id) - 1)].id);
      delete webviewRefs.current[id];
      return next;
    });
  }, [activeTabId]);

  const duplicateTab = useCallback(() => {
    openNewTab(activeTab.url);
  }, [activeTab.url, openNewTab]);

  const pinTab = useCallback((id: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, pinned: !t.pinned } : t));
  }, []);

  const muteTab = useCallback((id: string) => {
    const el = webviewRefs.current[id];
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    const next = !tab.muted;
    el?.setAudioMuted?.(next);
    setTabs(prev => prev.map(t => t.id === id ? { ...t, muted: next } : t));
  }, [tabs]);

  // ── Navigation ──────────────────────────────────────────────────────────────

  const goBack = useCallback(() => webviewRefs.current[activeTab.id]?.goBack(), [activeTab.id]);
  const goForward = useCallback(() => webviewRefs.current[activeTab.id]?.goForward(), [activeTab.id]);
  const reload = useCallback(() => {
    if (activeTab.loading) {
      webviewRefs.current[activeTab.id]?.stop();
      updateTab(activeTab.id, { loading: false });
    } else {
      webviewRefs.current[activeTab.id]?.reload();
    }
  }, [activeTab.id, activeTab.loading, updateTab]);

  const goHome = useCallback(() => navigateTo('https://rmpgutahps.us/portal/login'), [navigateTo]);

  // ── Zoom ───────────────────────────────────────────────────────────────────

  const applyZoom = useCallback((factor: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(factor * 10) / 10));
    webviewRefs.current[activeTab.id]?.setZoomFactor?.(clamped);
    updateTab(activeTab.id, { zoom: clamped });
  }, [activeTab.id, updateTab]);

  const zoomIn = useCallback(() => applyZoom((activeTab.zoom ?? DEFAULT_ZOOM) + ZOOM_STEP), [activeTab.zoom, applyZoom]);
  const zoomOut = useCallback(() => applyZoom((activeTab.zoom ?? DEFAULT_ZOOM) - ZOOM_STEP), [activeTab.zoom, applyZoom]);
  const resetZoom = useCallback(() => applyZoom(DEFAULT_ZOOM), [applyZoom]);

  // ── Bookmarks ──────────────────────────────────────────────────────────────

  const isBookmarked = bookmarks.some(b => b.url === activeTab.url);
  const toggleBookmark = useCallback(() => {
    if (activeTab.url === NEW_TAB_URL) return;
    setBookmarks(prev =>
      isBookmarked
        ? prev.filter(b => b.url !== activeTab.url)
        : [...prev, { id: makeId(), url: activeTab.url, title: activeTab.title || activeTab.url }]
    );
  }, [isBookmarked, activeTab.url, activeTab.title]);

  const removeBookmark = useCallback((id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id));
  }, []);

  // ── Find in page ───────────────────────────────────────────────────────────

  const doFind = useCallback((forward = true) => {
    if (!findQuery) return;
    webviewRefs.current[activeTab.id]?.findInPage?.(findQuery, { forward, matchCase: findMatchCase });
  }, [activeTab.id, findQuery, findMatchCase]);

  const stopFind = useCallback(() => {
    webviewRefs.current[activeTab.id]?.stopFindInPage?.('clearSelection');
    setPanel(null);
  }, [activeTab.id]);

  // ── Print ──────────────────────────────────────────────────────────────────

  const printPage = useCallback(() => {
    webviewRefs.current[activeTab.id]?.print?.();
  }, [activeTab.id]);

  // ── Copy URL ───────────────────────────────────────────────────────────────

  const copyUrl = useCallback(() => {
    navigator.clipboard.writeText(activeTab.url).catch((err: unknown) => {
      console.error('Failed to copy URL to clipboard:', err);
    });
  }, [activeTab.url]);

  // ── Dark reader ────────────────────────────────────────────────────────────

  const toggleDarkReader = useCallback(async () => {
    const el = webviewRefs.current[activeTab.id];
    if (!el) return;
    if (!darkReader) {
      const key = await el.insertCSS?.(`
        html { filter: invert(90%) hue-rotate(180deg) !important; }
        img, video, canvas, [style*="background-image"] { filter: invert(100%) hue-rotate(180deg) !important; }
      `);
      if (key == null) return; // insertCSS not available or returned no key
      darkReaderKeyRef.current = key;
      setDarkReader(true);
    } else {
      const key = darkReaderKeyRef.current;
      if (key) {
        await el.removeInsertedCSS?.(key).catch((err: unknown) => {
          console.error('Failed to remove dark reader CSS:', err);
        });
      }
      darkReaderKeyRef.current = null;
      setDarkReader(false);
    }
  }, [activeTab.id, darkReader]);

  // ── Ownership notice ───────────────────────────────────────────────────────

  const dismissNotice = useCallback(() => {
    localStorage.setItem(ownershipKey(user?.id), '1');
    setShowOwnershipNotice(false);
  }, [user?.id]);

  // ── Webview event wiring ───────────────────────────────────────────────────

  useEffect(() => {
    const el = webviewRefs.current[activeTab.id];
    if (!el) return;

    const onNavigate = () => {
      const url = el.getURL();
      updateTab(activeTab.id, { url, loading: false, error: null, canGoBack: el.canGoBack(), canGoForward: el.canGoForward() });
    };
    const onTitleUpdated = (e: Event) => {
      const title = (e as CustomEvent & { title?: string }).title ?? el.getTitle();
      updateTab(activeTab.id, { title });
      recordHistory(el.getURL(), title);
    };
    const onStartLoading = () => updateTab(activeTab.id, { loading: true });
    const onStopLoading = () => updateTab(activeTab.id, { loading: false, canGoBack: el.canGoBack(), canGoForward: el.canGoForward() });
    const onFailLoad = (e: Event) => {
      const fe = e as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (!isFatalNavFailure(fe.errorCode ?? 0, fe.isMainFrame ?? false)) return;
      updateTab(activeTab.id, { loading: false, error: fe.errorDescription || 'Page could not be loaded.' });
    };
    const onNewWindow = (e: Event) => {
      const ne = e as Event & { url?: string };
      if (ne.url && isAllowed(ne.url)) openNewTab(ne.url);
    };

    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', onNavigate);
    el.addEventListener('page-title-updated', onTitleUpdated);
    el.addEventListener('did-start-loading', onStartLoading);
    el.addEventListener('did-stop-loading', onStopLoading);
    el.addEventListener('did-fail-load', onFailLoad);
    el.addEventListener('new-window', onNewWindow);
    return () => {
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', onNavigate);
      el.removeEventListener('page-title-updated', onTitleUpdated);
      el.removeEventListener('did-start-loading', onStartLoading);
      el.removeEventListener('did-stop-loading', onStopLoading);
      el.removeEventListener('did-fail-load', onFailLoad);
      el.removeEventListener('new-window', onNewWindow);
    };
  }, [activeTab.id, updateTab, recordHistory, openNewTab]);

  // ── Rendering helpers ──────────────────────────────────────────────────────

  const security = securityLabel(activeTab.url);
  const isElectron = !!(window as any).electron?.isElectron;

  if (!isElectron) return <WebCompanyBrowserPage />;

  const pinnedTabs = tabs.filter(t => t.pinned);
  const regularTabs = tabs.filter(t => !t.pinned);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Electron's <webview> has been observed to NOT reliably pick up a
  // CSS-only size (percentage width/height, `inset: 0`, `display: flex`)
  // for its internal guest frame — confirmed live: a real page loaded but
  // rendered only in a thin strip matching its own intrinsic content
  // height, with the rest of the box blank, regardless of the CSS applied
  // to the element or its container. The reliable fix used by real-world
  // Electron apps is to explicitly set the element's pixel width/height in
  // JS, driven by a ResizeObserver on the container, rather than trusting
  // CSS sizing alone. Applied to every mounted webview (not just the active
  // one) so a background tab is already correctly sized before it's
  // switched to.
  useEffect(() => {
    const container = webviewContainerRef.current;
    if (!container) return;

    const applySize = () => {
      const { width, height } = container.getBoundingClientRect();
      for (const el of Object.values(webviewRefs.current)) {
        if (!el) continue;
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
      }
    };

    applySize();
    // ResizeObserver doesn't exist in the jsdom test environment (only in a
    // real browser/Electron renderer) — a single applySize() call on mount
    // still covers that environment's needs.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(applySize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [tabs.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-base)', userSelect: 'none' }}>

      {/* ── Tab strip ──────────────────────────────────────────────────────── */}
      <div role="tablist" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)', minHeight: 32, overflow: 'hidden' }}>
        {/* Pinned tabs (compact) */}
        {pinnedTabs.map(tab => (
          <TabChip key={tab.id} tab={tab} active={tab.id === activeTabId} pinned onSelect={() => setActiveTabId(tab.id)} onClose={() => closeTab(tab.id)} onPin={() => pinTab(tab.id)} onMute={() => muteTab(tab.id)} onDuplicate={duplicateTab} />
        ))}
        {pinnedTabs.length > 0 && <div style={{ width: 1, background: 'var(--border-subtle)', alignSelf: 'stretch', margin: '4px 0' }} />}
        {/* Regular tabs */}
        <div style={{ display: 'flex', flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
          {regularTabs.map(tab => (
            <TabChip key={tab.id} tab={tab} active={tab.id === activeTabId} onSelect={() => setActiveTabId(tab.id)} onClose={() => closeTab(tab.id)} onPin={() => pinTab(tab.id)} onMute={() => muteTab(tab.id)} onDuplicate={duplicateTab} />
          ))}
        </div>
        <button type="button" aria-label="New tab (Ctrl+T)" title="New tab (Ctrl+T)" onClick={() => openNewTab()} style={{ padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
          <Plus style={{ width: 13, height: 13, color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* ── Navigation bar ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 6px', background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}>
        {/* Back / Forward / Reload */}
        <button type="button" aria-label="Back (Alt+←)" title="Back" onClick={goBack} disabled={!activeTab.canGoBack} style={navBtn(!activeTab.canGoBack)}>
          <ArrowLeft style={{ width: 13, height: 13 }} />
        </button>
        <button type="button" aria-label="Forward (Alt+→)" title="Forward" onClick={goForward} disabled={!activeTab.canGoForward} style={navBtn(!activeTab.canGoForward)}>
          <ArrowRight style={{ width: 13, height: 13 }} />
        </button>
        <button type="button" aria-label={activeTab.loading ? 'Stop loading (Ctrl+R)' : 'Reload (Ctrl+R)'} title={activeTab.loading ? 'Stop' : 'Reload'} onClick={reload} style={navBtn(false)}>
          {activeTab.loading
            ? <X style={{ width: 13, height: 13, color: 'var(--sev-critical)' }} />
            : <RotateCw style={{ width: 13, height: 13 }} />}
        </button>
        <button type="button" aria-label="Home" title="Go to RMPG Portal" onClick={goHome} style={navBtn(false)}>
          <Home style={{ width: 13, height: 13 }} />
        </button>

        {/* Security indicator + address bar */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-sunken, var(--surface-base))', border: '1px solid var(--border-subtle)', padding: '2px 8px' }}>
          {activeTab.url !== NEW_TAB_URL && (
            <span title={security.secure ? 'Secure connection (HTTPS)' : 'Not secure'}>
              {security.secure
                ? <Lock style={{ width: 11, height: 11, color: 'var(--accent-silver-400)' }} />
                : <Unlock style={{ width: 11, height: 11, color: 'var(--sev-warn)' }} />}
            </span>
          )}
          <form onSubmit={e => { e.preventDefault(); navigateTo(addressInput); }} style={{ flex: 1 }}>
            <input
              ref={addressRef}
              role="textbox"
              aria-label="Address bar (Ctrl+L)"
              type="text"
              value={addressInput}
              onChange={e => setAddressInput(e.target.value)}
              onFocus={e => e.target.select()}
              placeholder="Enter URL or search…"
              style={{ width: '100%', background: 'none', border: 'none', outline: 'none', fontSize: 11, color: 'var(--text-primary)', fontFamily: 'Arial, sans-serif' }}
            />
          </form>
          {addressInput && (
            <button type="button" onClick={() => { setAddressInput(''); addressRef.current?.focus(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <X style={{ width: 10, height: 10, color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        {/* Action buttons */}
        <button type="button" aria-label={isBookmarked ? 'Remove bookmark (Ctrl+D)' : 'Add bookmark (Ctrl+D)'} title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'} onClick={toggleBookmark} style={navBtn(false)}>
          <Star style={{ width: 13, height: 13, fill: isBookmarked ? 'currentColor' : 'none', color: isBookmarked ? 'var(--accent-gold-300)' : 'var(--text-secondary)' }} />
        </button>
        <button type="button" aria-label="Copy URL" title="Copy URL" onClick={copyUrl} style={navBtn(false)}>
          <Copy style={{ width: 12, height: 12 }} />
        </button>
        <button type="button" aria-label="Zoom in (Ctrl+=)" title={`Zoom: ${Math.round((activeTab.zoom ?? DEFAULT_ZOOM) * 100)}%`} onClick={zoomIn} style={navBtn(false)}>
          <ZoomIn style={{ width: 12, height: 12 }} />
        </button>
        <button type="button" aria-label="Zoom out (Ctrl+-)" title="Zoom out" onClick={zoomOut} style={navBtn(false)}>
          <ZoomOut style={{ width: 12, height: 12 }} />
        </button>
        {(activeTab.zoom ?? DEFAULT_ZOOM) !== DEFAULT_ZOOM && (
          <button type="button" aria-label="Reset zoom (Ctrl+0)" title="Reset zoom" onClick={resetZoom} style={{ ...navBtn(false), fontSize: 9, padding: '2px 4px', color: 'var(--accent-silver-400)' }}>
            {Math.round((activeTab.zoom ?? 1) * 100)}%
          </button>
        )}
        <button type="button" aria-label="Find in page (Ctrl+F)" title="Find in page" onClick={() => setPanel(p => p === 'find' ? null : 'find')} style={navBtn(panel === 'find')}>
          <Search style={{ width: 12, height: 12 }} />
        </button>
        <button type="button" aria-label="Print (Ctrl+P)" title="Print page" onClick={printPage} style={navBtn(false)}>
          <Printer style={{ width: 12, height: 12 }} />
        </button>
        <button type="button" aria-label="Dark mode" title={darkReader ? 'Disable dark reader' : 'Enable dark reader'} onClick={toggleDarkReader} style={navBtn(darkReader)}>
          <Shield style={{ width: 12, height: 12 }} />
        </button>
        <button type="button" aria-label="History (Ctrl+Shift+H)" title="History" onClick={() => setPanel(p => p === 'history' ? null : 'history')} style={navBtn(panel === 'history')}>
          <Clock style={{ width: 12, height: 12 }} />
        </button>
        <button type="button" aria-label="Bookmarks" title="Bookmarks" onClick={() => setPanel(p => p === 'bookmarks' ? null : 'bookmarks')} style={navBtn(panel === 'bookmarks')}>
          <Bookmark style={{ width: 12, height: 12 }} />
        </button>
        <button type="button" aria-label="Downloads" title="Downloads" onClick={() => setPanel(p => p === 'downloads' ? null : 'downloads')} style={navBtn(panel === 'downloads')}>
          <Download style={{ width: 12, height: 12 }} />
        </button>
        <button type="button" aria-label="Quick links" title="RMPG Quick Links" onClick={() => setPanel(p => p === 'quicklinks' ? null : 'quicklinks')} style={navBtn(panel === 'quicklinks')}>
          <Globe style={{ width: 12, height: 12 }} />
        </button>
      </div>

      {/* ── Bookmarks bar ──────────────────────────────────────────────────── */}
      {bookmarks.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '2px 6px', background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
          {bookmarks.map(b => (
            <button
              key={b.id}
              type="button"
              onClick={() => navigateTo(b.url)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-primary)', whiteSpace: 'nowrap', maxWidth: 140 }}
            >
              <Star style={{ width: 9, height: 9, fill: 'currentColor', color: 'var(--accent-gold-300)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title || b.url}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Find bar ───────────────────────────────────────────────────────── */}
      {panel === 'find' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-subtle)' }}>
          <input
            autoFocus
            type="text"
            placeholder="Find in page…"
            value={findQuery}
            onChange={e => setFindQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doFind(!e.shiftKey); if (e.key === 'Escape') stopFind(); }}
            style={{ flex: 1, padding: '2px 6px', fontSize: 11, background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={findMatchCase} onChange={e => setFindMatchCase(e.target.checked)} />
            Aa
          </label>
          <button type="button" onClick={() => doFind(false)} style={smallBtn}>↑</button>
          <button type="button" onClick={() => doFind(true)} style={smallBtn}>↓</button>
          <button type="button" aria-label="Close find bar" onClick={stopFind} style={{ ...smallBtn, color: 'var(--text-muted)' }}>
            <X style={{ width: 10, height: 10 }} />
          </button>
        </div>
      )}

      {/* ── Quick links bar ────────────────────────────────────────────────── */}
      {panel === 'quicklinks' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>RMPG Quick Links</span>
          {RMPG_QUICK_LINKS.map(link => (
            <button key={link.url} type="button" onClick={() => navigateTo(link.url)} style={{ padding: '2px 8px', fontSize: 10, background: 'rgba(195,204,214,0.06)', border: '1px solid rgba(195,204,214,0.1)', cursor: 'pointer', color: 'var(--text-primary)' }}>
              {link.label}
            </button>
          ))}
          <button type="button" onClick={() => setPanel(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
            <X style={{ width: 10, height: 10, color: 'var(--text-muted)' }} />
          </button>
        </div>
      )}

      {/* ── Progress bar ───────────────────────────────────────────────────── */}
      {activeTab.loading && (
        <div style={{ height: 2, background: 'rgba(195,204,214,0.1)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: '-50%', width: '50%', height: '100%', background: 'var(--accent-silver-400)', animation: 'cbrowserSlide 1.2s linear infinite' }} />
          <style>{`@keyframes cbrowserSlide { from { left: -50% } to { left: 150% } }`}</style>
        </div>
      )}

      {/* ── Main content area ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {/* Webview area */}
        <div ref={webviewContainerRef} style={{ flex: 1, position: 'relative' }}>
          {isElectron ? (
            tabs.map(tab => (
              <webview
                key={tab.id}
                ref={el => { webviewRefs.current[tab.id] = el; }}
                src={tab.url}
                style={{ position: 'absolute', inset: 0, display: tab.id === activeTabId ? 'flex' : 'none' }}
                partition={`persist:cbrowser-${tab.id}`}
              />
            ))
          ) : (
            /* Non-Electron fallback */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
              <WifiOff style={{ width: 32, height: 32, color: 'var(--text-muted)' }} />
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Company Browser requires the FlexOS desktop app</p>
              {activeTab.url !== NEW_TAB_URL && (
                <a href={activeTab.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--brand-400)' }}>
                  Open in system browser <ExternalLink style={{ width: 10, height: 10, display: 'inline' }} />
                </a>
              )}
            </div>
          )}

          {/* New tab page */}
          {activeTab.url === NEW_TAB_URL && isElectron && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, background: 'var(--surface-base)', zIndex: 1 }}>
              <Shield style={{ width: 40, height: 40, color: 'var(--accent-silver-400)' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Company Browser</span>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 300 }}>
                Rocky Mountain Protective Group — Authorized Personnel Only
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 400 }}>
                {RMPG_QUICK_LINKS.map(link => (
                  <button key={link.url} type="button" onClick={() => navigateTo(link.url)} style={{ padding: '6px 14px', fontSize: 11, background: 'rgba(195,204,214,0.06)', border: '1px solid rgba(195,204,214,0.1)', cursor: 'pointer', color: 'var(--text-primary)' }}>
                    {link.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Error overlay */}
          {activeTab.error && (
            <div role="alert" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 12px', background: 'rgba(239,68,68,0.12)', borderBottom: '1px solid rgba(239,68,68,0.2)', fontSize: 11, color: 'var(--sev-critical)', zIndex: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
              <WifiOff style={{ width: 13, height: 13, flexShrink: 0 }} />
              {activeTab.error}
              <button type="button" onClick={reload} style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button>
            </div>
          )}
        </div>

        {/* ── Side panel ───────────────────────────────────────────────────── */}
        {panel && panel !== 'find' && panel !== 'quicklinks' && (
          <div style={{ width: 280, background: 'var(--surface-raised)', borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {panel === 'history' ? 'History' : panel === 'bookmarks' ? 'Bookmarks' : 'Downloads'}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {panel === 'history' && (
                  <button type="button" aria-label="Clear history" title="Clear history" onClick={() => setHistory([])} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                    <Trash2 style={{ width: 11, height: 11, color: 'var(--text-muted)' }} />
                  </button>
                )}
                <button type="button" aria-label="Close panel" onClick={() => setPanel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                  <X style={{ width: 11, height: 11, color: 'var(--text-muted)' }} />
                </button>
              </div>
            </div>

            {panel === 'history' && (history.length === 0
              ? <EmptyState icon={Clock} message="No history yet" />
              : history.map((h, i) => (
                <PanelRow
                  key={`${h.url}_${i}`}
                  title={h.title || h.url}
                  subtitle={new Date(h.visitedAt).toLocaleString()} /* new-date-ok: visitedAt is set client-side via new Date().toISOString() (line 263), never from D1 */
                  onClick={() => navigateTo(h.url)}
                  onRemove={() => setHistory(prev => prev.filter((_, j) => j !== i))}
                />
              ))
            )}

            {panel === 'bookmarks' && (bookmarks.length === 0
              ? <EmptyState icon={Star} message="No bookmarks yet — press Ctrl+D to add one" />
              : bookmarks.map(b => (
                <PanelRow
                  key={b.id}
                  title={b.title || b.url}
                  subtitle={b.url}
                  onClick={() => navigateTo(b.url)}
                  onRemove={() => removeBookmark(b.id)}
                />
              ))
            )}

            {panel === 'downloads' && (downloads.length === 0
              ? <EmptyState icon={Download} message="No downloads this session" />
              : downloads.map(d => (
                <div key={d.id} style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</div>
                  <div style={{ fontSize: 9, color: d.status === 'failed' ? 'var(--sev-critical)' : 'var(--text-muted)', marginTop: 2 }}>{d.status}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 8px', background: 'var(--surface-overlay)', borderTop: '1px solid var(--border-subtle)', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          {activeTab.url !== NEW_TAB_URL && (
            <>
              {security.secure
                ? <Wifi style={{ width: 9, height: 9, color: 'var(--accent-silver-400)' }} />
                : <WifiOff style={{ width: 9, height: 9, color: 'var(--sev-warn)' }} />}
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Arial, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                {activeTab.loading ? 'Loading…' : activeTab.url}
              </span>
            </>
          )}
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.04em', flexShrink: 0 }}>
          © 2026 Rocky Mountain Protective Group — Authorized Personnel Only
        </span>
      </div>

      {/* ── Ownership notice ────────────────────────────────────────────────── */}
      {showOwnershipNotice && (
        <div role="dialog" aria-modal aria-label="Company Browser notice" style={{ position: 'absolute', inset: 0, background: 'rgba(0 0 0 / 0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
          <div style={{ background: 'var(--surface-raised)', border: '1px solid rgba(195,204,214,0.15)', padding: 28, maxWidth: 440, textAlign: 'center', boxShadow: '0 24px 64px rgba(0 0 0 / 0.7)' }}>
            <Shield style={{ width: 28, height: 28, color: 'var(--accent-silver-400)', margin: '0 auto 12px' }} />
            <p style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.7, margin: '0 0 16px' }}>
              Company Browser is proprietary software owned by <strong>Rocky Mountain Protective Group, LLC</strong>.
              It is provided for internal use only, restricted to authorized RMPG personnel.
              Unauthorized access, copying, or distribution is prohibited.
            </p>
            <button type="button" onClick={dismissNotice} style={{ padding: '7px 20px', fontSize: 11, fontWeight: 600, background: 'rgba(195,204,214,0.1)', border: '1px solid rgba(195,204,214,0.2)', color: 'var(--text-primary)', cursor: 'pointer', letterSpacing: '0.04em' }}>
              I Understand
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TabChip({ tab, active, pinned, onSelect, onClose, onPin, onMute, onDuplicate }: {
  tab: BrowserTab; active: boolean; pinned?: boolean;
  onSelect: () => void; onClose: () => void; onPin: () => void; onMute: () => void; onDuplicate: () => void;
}) {
  const [ctx, setCtx] = useState(false);
  const chipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctx) return;
    const handler = (e: MouseEvent) => {
      if (chipRef.current && !chipRef.current.contains(e.target as Node)) {
        setCtx(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctx]);

  return (
    <div
      ref={chipRef}
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      onContextMenu={e => { e.preventDefault(); setCtx(v => !v); }}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, padding: pinned ? '4px 8px' : '4px 6px', minWidth: pinned ? 0 : 100, maxWidth: pinned ? 36 : 180, borderRight: '1px solid var(--border-subtle)', cursor: 'pointer', background: active ? 'var(--surface-raised)' : 'transparent', flexShrink: pinned ? 0 : undefined }}
    >
      {tab.loading && <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--accent-silver-400)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />}
      {!tab.loading && <Globe style={{ width: 9, height: 9, color: 'var(--text-muted)', flexShrink: 0 }} />}
      {!pinned && <span style={{ fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{tab.title || 'New Tab'}</span>}
      {tab.muted && <VolumeX style={{ width: 9, height: 9, color: 'var(--text-muted)', flexShrink: 0 }} />}
      {!pinned && (
        <button type="button" aria-label="Close tab" onClick={e => { e.stopPropagation(); onClose(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
          <X style={{ width: 9, height: 9, color: 'var(--text-muted)' }} />
        </button>
      )}
      {ctx && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', boxShadow: '0 8px 24px rgba(0 0 0 / 0.4)', minWidth: 160 }}>
          {[
            { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', action: onPin },
            { label: tab.muted ? 'Unmute Tab' : 'Mute Tab', action: onMute },
            { label: 'Duplicate Tab', action: onDuplicate },
            { label: 'Close Tab', action: onClose },
          ].map(item => (
            <button key={item.label} type="button" onClick={() => { item.action(); setCtx(false); }} style={{ display: 'block', width: '100%', padding: '6px 12px', textAlign: 'left', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelRow({ title, subtitle, onClick, onRemove }: { title: string; subtitle?: string; onClick: () => void; onRemove?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', padding: '5px 10px', gap: 6 }}>
      <div onClick={onClick} style={{ flex: 1, cursor: 'pointer', overflow: 'hidden' }}>
        <div style={{ fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{subtitle}</div>}
      </div>
      {onRemove && (
        <button type="button" aria-label="Remove" onClick={e => { e.stopPropagation(); onRemove(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
          <X style={{ width: 9, height: 9, color: 'var(--text-muted)' }} />
        </button>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, flex: 1 }}>
      <Icon style={{ width: 20, height: 20, color: 'var(--text-muted)' }} />
      <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>{message}</span>
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function navBtn(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 4, background: active ? 'rgba(195,204,214,0.1)' : 'none',
    border: 'none', cursor: 'pointer',
    color: active ? 'var(--accent-silver-400)' : 'var(--text-secondary)',
  };
}

const smallBtn: React.CSSProperties = {
  padding: '2px 6px', fontSize: 10, background: 'rgba(195,204,214,0.06)',
  border: '1px solid rgba(195,204,214,0.1)', cursor: 'pointer', color: 'var(--text-primary)',
};
