// ============================================================
// RMPG Flex — Web Company Browser (full-featured)
// 50-feature multi-tab browser powered by WebBrowserSessionDO.
// See docs/superpowers/specs/2026-07-22-web-company-browser-phase1-design.md.
// ============================================================

import React, {
  useCallback, useEffect, useReducer, useRef, useState,
} from 'react';
import { apiFetch } from '../hooks/useApi';

// ── Constants ────────────────────────────────────────────────────────────────

const TOKEN_KEY = 'rmpg_token';
const BOOKMARKS_KEY = 'rmpg_browser_bookmarks';
const HISTORY_KEY = 'rmpg_browser_history';
const RECENTLY_CLOSED_KEY = 'rmpg_browser_recently_closed';
const SAVED_TABS_KEY = 'rmpg_browser_saved_tabs';
const MAX_HISTORY = 200;
const MAX_RECENTLY_CLOSED = 10;

const DARK_MODE_CSS = `html{filter:invert(1) hue-rotate(180deg) !important}img,video,canvas{filter:invert(1) hue-rotate(180deg) !important}`;

const RMPG_LINKS = [
  { label: 'CAD', path: '/cad' },
  { label: 'RMS', path: '/rms' },
  { label: 'Dispatch', path: '/dispatch' },
  { label: 'Intel', path: '/intel' },
  { label: 'Fleet', path: '/fleet' },
  { label: 'Warrants', path: '/warrants' },
  { label: 'Map', path: '/map' },
  { label: 'Reports', path: '/reports' },
  { label: 'Admin', path: '/admin' },
  { label: 'Browser', path: '/web-browser' },
];

// ── Types ────────────────────────────────────────────────────────────────────

interface BrowserTab {
  id: string;
  sessionId: string | null;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  error: string | null;
  pinned: boolean;
  lastFrame: string | null;
}

interface Bookmark { id: string; url: string; title: string; addedAt: number; }
interface HistoryEntry { url: string; title: string; visitedAt: number; }
interface RecentlyClosedTab { url: string; title: string; closedAt: number; }

// ── Utilities ────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function resolveWsBase(): string {
  const h = window.location.hostname;
  return (h === 'localhost' || h === '127.0.0.1') ? `ws://${h}:8787` : 'wss://api.rmpgutah.us';
}

// Feature 10/11: normalize address bar input
function normalize(raw: string): string {
  const t = raw.trim();
  if (!t) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  if (/\s/.test(t) || !/^[^.\s]+\.[^.\s]/.test(t)) {
    const base = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ? 'http://localhost:8787'
      : 'https://api.rmpgutah.us';
    return `${base}/api/browser-search?q=${encodeURIComponent(t)}`;
  }
  return `https://${t}`;
}

// Feature 12: security padlock
function padlock(url: string): string {
  if (url.startsWith('https://')) return '🔒';
  if (url.startsWith('http://')) return '🔓';
  return '';
}

function loadJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

function saveJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full */ }
}

// ── Styles ───────────────────────────────────────────────────────────────────

const S = {
  root: { display: 'flex', flexDirection: 'column' as const, height: '100vh', background: 'var(--surface-base)', color: 'var(--text-primary)', fontSize: 11, fontFamily: 'Arial, sans-serif' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 2, padding: '2px 4px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 },
  tabBar: { display: 'flex', alignItems: 'flex-end', gap: 1, padding: '2px 4px 0', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, overflowX: 'auto' as const },
  btn: { padding: '2px 6px', fontSize: 10, background: 'rgba(195,204,214,0.08)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 2, flexShrink: 0, lineHeight: '16px' },
  iconBtn: { padding: '1px 4px', fontSize: 12, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 2, flexShrink: 0 },
  input: { flex: 1, padding: '2px 6px', fontSize: 11, background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 2, minWidth: 0 },
  panel: { position: 'fixed' as const, top: 0, right: 0, bottom: 0, width: 280, background: 'var(--surface-raised)', borderLeft: '1px solid var(--border-subtle)', zIndex: 50, display: 'flex', flexDirection: 'column' as const, overflowY: 'auto' as const },
  panelHeader: { padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--field-label-color)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  panelRow: { padding: '4px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' as const, fontSize: 10 },
  modal: { position: 'fixed' as const, inset: 0, background: 'rgba(0 0 0 / 0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modalBox: { background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 16, minWidth: 340, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto' as const },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function WebCompanyBrowserPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadJson(BOOKMARKS_KEY, []));
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadJson(HISTORY_KEY, []));
  const [recentlyClosed, setRecentlyClosed] = useState<RecentlyClosedTab[]>(() => loadJson(RECENTLY_CLOSED_KEY, []));
  const [showBookmarksPanel, setShowBookmarksPanel] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showRecentlyClosed, setShowRecentlyClosed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0); // 0–100, 0 = hidden
  const [, forceRender] = useReducer(x => x + 1, 0);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const lastFrameRef = useRef<Map<string, string>>(new Map());
  const activeTabIdRef = useRef('');
  const cancelledRef = useRef<Set<string>>(new Set());
  const tabsRef = useRef<BrowserTab[]>([]);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs in sync
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const updateTab = useCallback((tabId: string, patch: Partial<BrowserTab>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...patch } : t));
  }, []);

  const sendToTab = useCallback((tabId: string, obj: unknown) => {
    const ws = socketsRef.current.get(tabId);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const sendToActive = useCallback((obj: unknown) => {
    sendToTab(activeTabIdRef.current, obj);
  }, [sendToTab]);

  // Feature 50: loading progress bar animation
  const startProgress = useCallback(() => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    setLoadProgress(10);
    let v = 10;
    progressTimerRef.current = setInterval(() => {
      v = Math.min(v + Math.random() * 8, 85);
      setLoadProgress(v);
    }, 200);
  }, []);

  const finishProgress = useCallback(() => {
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    setLoadProgress(100);
    setTimeout(() => setLoadProgress(0), 300);
  }, []);

  // ── Session connect ────────────────────────────────────────────────────────

  const connectTab = useCallback((tabId: string, initialUrl?: string) => {
    cancelledRef.current.delete(tabId);
    apiFetch<{ sessionId: string }>('/web-browser/session', { method: 'POST' })
      .then(res => {
        if (cancelledRef.current.has(tabId)) return;
        updateTab(tabId, { sessionId: res.sessionId, loading: true });

        const ws = new WebSocket(`${resolveWsBase()}/api/web-browser-ws?sessionId=${res.sessionId}`);
        socketsRef.current.set(tabId, ws);
        let receivedAny = false;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'authenticate', token: localStorage.getItem(TOKEN_KEY) || '' }));
          // navigate is sent after `ready` — not here — to avoid racing puppeteer.launch()
        };

        ws.onerror = () => updateTab(tabId, { error: 'Unable to start browser session, try again.', loading: false });

        ws.onmessage = ev => {
          receivedAny = true;
          let msg: any;
          try { msg = JSON.parse(ev.data); } catch { return; }

          if (msg.type === 'ready') {
            // Browser session is live — safe to navigate now
            updateTab(tabId, { loading: false });
            if (initialUrl && initialUrl !== 'about:blank' && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'navigate', url: initialUrl }));
            }
          } else if (msg.type === 'frame') {
            const data: string = msg.data;
            lastFrameRef.current.set(tabId, data);
            if (activeTabIdRef.current === tabId) {
              const img = new Image();
              img.onload = () => {
                const canvas = canvasRef.current;
                if (!canvas || activeTabIdRef.current !== tabId) return;
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext('2d')?.drawImage(img, 0, 0);
              };
              img.src = `data:image/jpeg;base64,${data}`;
            }
            // Save thumbnail for tab
            updateTab(tabId, { lastFrame: data });
          } else if (msg.type === 'loading') {
            updateTab(tabId, { loading: !!msg.loading });
            if (msg.loading && activeTabIdRef.current === tabId) startProgress();
            else if (!msg.loading && activeTabIdRef.current === tabId) finishProgress();
          } else if (msg.type === 'url_changed') {
            const url: string = msg.url || '';
            updateTab(tabId, { url, error: null });
            if (activeTabIdRef.current === tabId) setAddressInput(url);
            // Feature 19: history tracking
            if (url && url !== 'about:blank') {
              setHistory(prev => {
                const next = [{ url, title: '', visitedAt: Date.now() }, ...prev.filter(h => h.url !== url)].slice(0, MAX_HISTORY);
                saveJson(HISTORY_KEY, next);
                return next;
              });
            }
          } else if (msg.type === 'title_changed') {
            const title: string = msg.title || '';
            updateTab(tabId, { title });
            // Update history title
            if (title) {
              setHistory(prev => {
                const next = prev.map(h => h.title === '' ? { ...h, title } : h);
                saveJson(HISTORY_KEY, next);
                return next;
              });
            }
          } else if (msg.type === 'error') {
            updateTab(tabId, { error: msg.message, loading: false });
          } else if (msg.type === 'session_ended') {
            updateTab(tabId, { error: `Session ended: ${msg.reason}`, loading: false });
            ws.close();
          }
        };

        ws.onclose = () => {
          socketsRef.current.delete(tabId);
          if (!cancelledRef.current.has(tabId) && !receivedAny) {
            updateTab(tabId, { error: 'Unable to start browser session, try again.', loading: false });
          }
        };
      })
      .catch(() => updateTab(tabId, { error: 'Unable to start browser session, try again.', loading: false }));
  }, [updateTab, startProgress, finishProgress]);

  // ── Tab operations ─────────────────────────────────────────────────────────

  const newTab = useCallback((initialUrl?: string) => {
    const id = uid();
    const tab: BrowserTab = { id, sessionId: null, url: initialUrl || 'about:blank', title: 'New Tab', favicon: null, loading: false, error: null, pinned: false, lastFrame: null };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    activeTabIdRef.current = id;
    setAddressInput(initialUrl || '');
    connectTab(id, initialUrl);
    return id;
  }, [connectTab]);

  const closeTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (tab && (tab.url || tab.title)) {
      // Feature 27: recently closed
      setRecentlyClosed(prev => {
        const next = [{ url: tab.url, title: tab.title || tab.url, closedAt: Date.now() }, ...prev].slice(0, MAX_RECENTLY_CLOSED);
        saveJson(RECENTLY_CLOSED_KEY, next);
        return next;
      });
    }
    cancelledRef.current.add(tabId);
    socketsRef.current.get(tabId)?.close();
    socketsRef.current.delete(tabId);
    lastFrameRef.current.delete(tabId);
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId);
      if (activeTabIdRef.current === tabId && next.length > 0) {
        const newActive = next[next.length - 1].id;
        setActiveTabId(newActive);
        activeTabIdRef.current = newActive;
        setAddressInput(next[next.length - 1].url || '');
        // Redraw last frame for newly-active tab
        const frame = lastFrameRef.current.get(newActive);
        if (frame) {
          const img = new Image();
          img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.width = img.width; canvas.height = img.height;
            canvas.getContext('2d')?.drawImage(img, 0, 0);
          };
          img.src = `data:image/jpeg;base64,${frame}`;
        }
      }
      if (next.length === 0) {
        // Open a blank tab instead of leaving empty
        setTimeout(() => newTab(), 0);
      }
      return next;
    });
  }, [newTab]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    activeTabIdRef.current = tabId;
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (tab) setAddressInput(tab.url || '');
    // Redraw last frame
    const frame = lastFrameRef.current.get(tabId);
    if (frame) {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
      };
      img.src = `data:image/jpeg;base64,${frame}`;
    }
  }, []);

  // ── Mount: session restore + initial tab ───────────────────────────────────

  useEffect(() => {
    // Feature 39: session restore
    const savedUrls: string[] = loadJson(SAVED_TABS_KEY, []);
    if (savedUrls.length > 0) {
      savedUrls.forEach((url, i) => {
        const id = uid();
        const tab: BrowserTab = { id, sessionId: null, url, title: 'Restoring…', favicon: null, loading: true, error: null, pinned: false, lastFrame: null };
        setTabs(prev => [...prev, tab]);
        if (i === 0) { setActiveTabId(id); activeTabIdRef.current = id; setAddressInput(url); }
        connectTab(id, url);
      });
    } else {
      const id = uid();
      const tab: BrowserTab = { id, sessionId: null, url: 'about:blank', title: 'New Tab', favicon: null, loading: false, error: null, pinned: false, lastFrame: null };
      setTabs([tab]);
      setActiveTabId(id);
      activeTabIdRef.current = id;
      connectTab(id);
    }
    return () => {
      // Save open tab URLs for restore
      const urls = tabsRef.current.map(t => t.url).filter(u => u && u !== 'about:blank');
      saveJson(SAVED_TABS_KEY, urls);
      // Tear down all sockets
      socketsRef.current.forEach(ws => { try { ws.close(); } catch { /* ignore */ } });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Feature 1: blur fix via ResizeObserver ─────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        sendToTab(activeTabIdRef.current, { type: 'resize', width: Math.round(width), height: Math.round(height) });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [sendToTab]);

  // Sync resize when active tab changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) sendToTab(activeTabId, { type: 'resize', width: Math.round(width), height: Math.round(height) });
  }, [activeTabId, sendToTab]);

  // ── Features 40-47: keyboard shortcuts ────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input (except for our specific shortcuts)
      const inInput = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';

      if (e.ctrlKey && e.key === 'l') { // Feature 40
        e.preventDefault();
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
        return;
      }
      if (e.ctrlKey && e.key === 't') { // Feature 41
        e.preventDefault();
        newTab();
        return;
      }
      if (e.ctrlKey && e.key === 'w') { // Feature 42
        e.preventDefault();
        if (activeTabIdRef.current) closeTab(activeTabIdRef.current);
        return;
      }
      if (e.ctrlKey && e.key === 'r') { // Feature 43
        e.preventDefault();
        sendToActive({ type: 'key', key: 'F5' });
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') { // Feature 44
        e.preventDefault();
        sendToActive({ type: 'navigate_back' });
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') { // Feature 45
        e.preventDefault();
        sendToActive({ type: 'navigate_forward' });
        return;
      }
      if (e.ctrlKey && e.key === 'Tab') { // Feature 46
        e.preventDefault();
        const ts = tabsRef.current;
        if (ts.length < 2) return;
        const idx = ts.findIndex(t => t.id === activeTabIdRef.current);
        const next = ts[(idx + 1) % ts.length];
        switchTab(next.id);
        return;
      }
      if (!inInput && e.key === '?') { // Feature 47
        setShowShortcutsModal(m => !m);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [newTab, closeTab, sendToActive, switchTab]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const activeTab = tabs.find(t => t.id === activeTabId) ?? null;
  const isBookmarked = bookmarks.some(b => b.url === (activeTab?.url || ''));
  const showNewTabPage = !activeTab?.url || activeTab.url === 'about:blank';
  const historyUrls = history.map(h => h.url);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddressSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const url = normalize(addressInput);
    if (url === 'about:blank') return;
    sendToActive({ type: 'navigate', url });
    updateTab(activeTabIdRef.current, { url, error: null });
  }, [addressInput, sendToActive, updateTab]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    sendToActive({ type: 'click', x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY });
  }, [sendToActive]);

  const handleCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    let text = '';
    if (e.key.length === 1) { text = e.key; }
    else if (e.key === 'Enter') { text = '\n'; }
    else if (e.key === 'Backspace') { text = '\b'; }
    else { return; }
    e.preventDefault();
    sendToActive({ type: 'type', text });
  }, [sendToActive]);

  const handleCanvasWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    sendToActive({ type: 'scroll', dx: e.deltaX, dy: e.deltaY });
  }, [sendToActive]);

  // Feature 15: bookmark toggle
  const toggleBookmark = useCallback(() => {
    if (!activeTab) return;
    setBookmarks(prev => {
      let next: Bookmark[];
      if (prev.some(b => b.url === activeTab.url)) {
        next = prev.filter(b => b.url !== activeTab.url);
      } else {
        next = [...prev, { id: uid(), url: activeTab.url, title: activeTab.title || activeTab.url, addedAt: Date.now() }];
      }
      saveJson(BOOKMARKS_KEY, next);
      return next;
    });
  }, [activeTab]);

  // Feature 30: dark mode
  const toggleDarkMode = useCallback(() => {
    const next = !darkMode;
    setDarkMode(next);
    if (next) sendToActive({ type: 'inject_css', css: DARK_MODE_CSS });
  }, [darkMode, sendToActive]);

  // Feature 31: mobile viewport
  const toggleMobileViewport = useCallback(() => {
    const next = !mobileViewport;
    setMobileViewport(next);
    if (next) {
      sendToActive({ type: 'resize', width: 375, height: 667 });
    } else {
      const container = containerRef.current;
      if (container) {
        const { width, height } = container.getBoundingClientRect();
        sendToActive({ type: 'resize', width: Math.round(width), height: Math.round(height) });
      }
    }
  }, [mobileViewport, sendToActive]);

  // Feature 36: screenshot download
  const downloadScreenshot = useCallback(() => {
    const frame = lastFrameRef.current.get(activeTabId);
    if (!frame) return;
    const link = document.createElement('a');
    link.href = `data:image/jpeg;base64,${frame}`;
    link.download = `rmpg-browser-${Date.now()}.jpg`;
    link.click();
  }, [activeTabId]);

  // Feature 37: fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={S.root}>
      {/* Feature 2/3/4/24/25/26: Tab bar */}
      <div style={S.tabBar}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            onContextMenu={e => {
              e.preventDefault();
              // Feature 26: right-click to pin
              setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, pinned: !t.pinned } : t));
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: tab.pinned ? '2px 6px' : '2px 8px',
              background: tab.id === activeTabId ? 'var(--surface-raised)' : 'transparent',
              borderTop: tab.id === activeTabId ? '2px solid var(--accent-silver-400)' : '2px solid transparent',
              borderLeft: '1px solid var(--border-subtle)',
              borderRight: '1px solid var(--border-subtle)',
              cursor: 'pointer', fontSize: 10, minWidth: 0,
              maxWidth: tab.pinned ? 36 : 160,
              color: tab.id === activeTabId ? 'var(--text-primary)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap' as const, overflow: 'hidden',
            }}
            title={tab.title || tab.url}
          >
            {tab.pinned && <span>📌</span>}
            {/* Feature 24: loading indicator */}
            {tab.loading && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>}
            {!tab.pinned && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                {tab.title || tab.url || 'New Tab'}
              </span>
            )}
            {/* Feature 4: close tab */}
            {!tab.pinned && (
              <button
                onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                style={{ ...S.iconBtn, fontSize: 10, padding: '0 2px' }}
                aria-label="Close tab"
              >×</button>
            )}
          </div>
        ))}
        {/* Feature 3: new tab */}
        <button onClick={() => newTab()} style={{ ...S.iconBtn, padding: '2px 8px', fontSize: 14 }} aria-label="New tab">+</button>
        {/* Feature 27: recently closed dropdown */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowRecentlyClosed(v => !v)} style={S.iconBtn} aria-label="Recently closed">▾</button>
          {showRecentlyClosed && recentlyClosed.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', zIndex: 20, minWidth: 200 }}>
              {recentlyClosed.map((rc, i) => (
                <div key={i} onClick={() => { newTab(rc.url || 'about:blank'); setShowRecentlyClosed(false); }}
                  style={{ padding: '4px 8px', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  title={rc.url}
                >
                  {rc.title || rc.url}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Feature 50: loading progress bar */}
      {loadProgress > 0 && (
        <div style={{ height: 2, background: 'var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ height: '100%', width: `${loadProgress}%`, background: 'var(--accent-silver-400)', transition: 'width 0.2s ease' }} />
        </div>
      )}

      {/* Main toolbar */}
      <div style={S.toolbar}>
        {/* Feature 5: back */}
        <button onClick={() => sendToActive({ type: 'navigate_back' })} style={S.iconBtn} aria-label="Back">←</button>
        {/* Feature 6: forward */}
        <button onClick={() => sendToActive({ type: 'navigate_forward' })} style={S.iconBtn} aria-label="Forward">→</button>
        {/* Feature 7/8: reload or stop */}
        {activeTab?.loading
          ? <button onClick={() => sendToActive({ type: 'stop' })} style={S.iconBtn} aria-label="Stop">✕</button>
          : <button onClick={() => sendToActive({ type: 'key', key: 'F5' })} style={S.iconBtn} aria-label="Reload">↺</button>
        }
        {/* Feature 9: home */}
        <button onClick={() => sendToActive({ type: 'navigate', url: 'https://rmpgutah.us' })} style={S.iconBtn} aria-label="Home">⌂</button>

        {/* Feature 12: padlock */}
        <span style={{ fontSize: 11, flexShrink: 0 }}>{padlock(activeTab?.url || '')}</span>

        {/* Feature 10: address bar with Feature 22: autocomplete */}
        <form onSubmit={handleAddressSubmit} style={{ flex: 1, display: 'flex', gap: 2, minWidth: 0 }}>
          <input
            ref={addressInputRef}
            list="browser-history-datalist"
            type="text"
            role="textbox"
            aria-label="Address"
            value={addressInput}
            onChange={e => setAddressInput(e.target.value)}
            onFocus={e => e.target.select()}
            placeholder="Enter URL or search…"
            style={S.input}
          />
          <datalist id="browser-history-datalist">
            {historyUrls.slice(0, 20).map((u, i) => <option key={i} value={u} />)}
          </datalist>
          {/* Feature 14: clear URL */}
          {addressInput && (
            <button type="button" onClick={() => setAddressInput('')} style={S.iconBtn} aria-label="Clear URL">×</button>
          )}
          {/* Feature 11: go button */}
          <button type="submit" style={S.btn} aria-label="Navigate or search">Go</button>
        </form>

        {/* Feature 13: copy URL */}
        <button onClick={() => navigator.clipboard.writeText(activeTab?.url || '')} style={S.iconBtn} aria-label="Copy URL">⎘</button>
        {/* Feature 15: bookmark */}
        <button onClick={toggleBookmark} style={S.iconBtn} aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark'}>
          {isBookmarked ? '★' : '☆'}
        </button>
        {/* Feature 16: bookmarks panel */}
        <button onClick={() => setShowBookmarksPanel(v => !v)} style={S.btn} aria-label="Bookmarks">Bookmarks</button>
        {/* Feature 20: history panel */}
        <button onClick={() => setShowHistoryPanel(v => !v)} style={S.btn} aria-label="History">History</button>

        {/* Feature 30: dark mode */}
        <button onClick={toggleDarkMode} style={S.iconBtn} title="Dark mode" aria-label="Dark mode">🌙</button>
        {/* Feature 31: mobile viewport */}
        <button onClick={toggleMobileViewport} style={{ ...S.iconBtn, color: mobileViewport ? 'var(--accent-gold-300)' : 'var(--text-secondary)' }} title="Mobile viewport" aria-label="Mobile viewport">📱</button>
        {/* Feature 32/33/34: zoom */}
        <button onClick={() => sendToActive({ type: 'zoom_out' })} style={S.iconBtn} aria-label="Zoom out">−</button>
        <button onClick={() => sendToActive({ type: 'zoom_reset' })} style={S.btn} aria-label="Zoom reset">100%</button>
        <button onClick={() => sendToActive({ type: 'zoom_in' })} style={S.iconBtn} aria-label="Zoom in">+</button>
        {/* Feature 35: find on page */}
        <button onClick={() => sendToActive({ type: 'find' })} style={S.iconBtn} aria-label="Find on page">🔍</button>
        {/* Feature 36: screenshot download */}
        <button onClick={downloadScreenshot} style={S.iconBtn} aria-label="Download screenshot">📷</button>
        {/* Feature 37: fullscreen */}
        <button onClick={toggleFullscreen} style={S.iconBtn} aria-label="Fullscreen">⛶</button>
        {/* Feature 47/48: shortcuts modal */}
        <button onClick={() => setShowShortcutsModal(true)} style={S.iconBtn} aria-label="Shortcuts">?</button>
      </div>

      {/* Feature 18: bookmarks bar (first 8 bookmarks) */}
      {bookmarks.length > 0 && (
        <div style={{ display: 'flex', gap: 2, padding: '1px 4px', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, overflowX: 'auto' as const }}>
          {bookmarks.slice(0, 8).map(bm => (
            <button key={bm.id} onClick={() => sendToActive({ type: 'navigate', url: bm.url })} style={{ ...S.btn, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={bm.url}>
              {bm.title || bm.url}
            </button>
          ))}
        </div>
      )}

      {/* Feature 29: RMPG quick links bar */}
      <div style={{ display: 'flex', gap: 1, padding: '1px 4px', background: 'var(--surface-sunken, var(--surface-base))', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, overflowX: 'auto' as const }}>
        {RMPG_LINKS.map(l => (
          <button key={l.path} onClick={() => sendToActive({ type: 'navigate', url: `https://rmpgutah.us${l.path}` })} style={{ ...S.btn, fontSize: 9 }}>
            {l.label}
          </button>
        ))}
      </div>

      {/* Global error/session-ended banner (visible regardless of tab URL) */}
      {activeTab?.error && (
        <div role="alert" style={{ padding: '6px 12px', background: 'var(--sev-critical)', color: 'var(--text-primary)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span>{activeTab.error}</span>
          <button onClick={() => { updateTab(activeTabId, { error: null }); connectTab(activeTabId, activeTab.url || undefined); }} style={S.btn}>Retry</button>
        </div>
      )}

      {/* Canvas area */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Feature 28: custom new tab page */}
        {showNewTabPage ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24, padding: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--field-label-color)' }}>Rocky Mountain Protective Group</div>
            <form onSubmit={e => { e.preventDefault(); const url = normalize(addressInput); if (url !== 'about:blank') { sendToActive({ type: 'navigate', url }); updateTab(activeTabId, { url }); } }} style={{ display: 'flex', gap: 6, width: '100%', maxWidth: 400 }}>
              <input value={addressInput} onChange={e => setAddressInput(e.target.value)} placeholder="Search or enter URL…" style={{ ...S.input, fontSize: 13 }} autoFocus />
              <button type="submit" style={S.btn}>Go</button>
            </form>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, maxWidth: 500 }}>
              {RMPG_LINKS.map(l => (
                <button key={l.path} onClick={() => { const url = `https://rmpgutah.us${l.path}`; sendToActive({ type: 'navigate', url }); updateTab(activeTabId, { url }); }} style={{ padding: 10, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 2, fontSize: 10 }}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              tabIndex={0}
              onClick={handleCanvasClick}
              onKeyDown={handleCanvasKeyDown}
              onWheel={handleCanvasWheel}
              style={{ display: 'block' }}
            />
            {/* Feature 49: errors shown in the global banner above */}
          </>
        )}
      </div>

      {/* Feature 38: status bar */}
      <div style={{ height: 16, background: 'var(--surface-raised)', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 9, color: 'var(--text-secondary)', flexShrink: 0 }}>
        {activeTab?.url && activeTab.url !== 'about:blank' ? activeTab.url : 'RMPG Flex — Rocky Mountain Protective Group'}
        {activeTab?.loading && <span style={{ marginLeft: 8 }}>Loading…</span>}
      </div>

      {/* Feature 16/17: bookmarks panel */}
      {showBookmarksPanel && (
        <div style={S.panel}>
          <div style={S.panelHeader}>
            <span>Bookmarks</span>
            <button onClick={() => setShowBookmarksPanel(false)} style={S.iconBtn}>×</button>
          </div>
          {bookmarks.length === 0 && <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 10 }}>No bookmarks yet. Click ☆ to add.</div>}
          {bookmarks.map(bm => (
            <div key={bm.id} style={S.panelRow}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} onClick={() => { sendToActive({ type: 'navigate', url: bm.url }); setShowBookmarksPanel(false); }} title={bm.url}>
                {bm.title || bm.url}
              </span>
              {/* Feature 17: remove bookmark */}
              <button onClick={() => setBookmarks(prev => { const n = prev.filter(b => b.id !== bm.id); saveJson(BOOKMARKS_KEY, n); return n; })} style={S.iconBtn} aria-label="Remove bookmark">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Feature 20/21: history panel */}
      {showHistoryPanel && (
        <div style={S.panel}>
          <div style={S.panelHeader}>
            <span>History</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {/* Feature 21: clear history */}
              <button onClick={() => { setHistory([]); saveJson(HISTORY_KEY, []); }} style={S.btn}>Clear</button>
              <button onClick={() => setShowHistoryPanel(false)} style={S.iconBtn}>×</button>
            </div>
          </div>
          {history.length === 0 && <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 10 }}>No history yet.</div>}
          {history.slice(0, 50).map((h, i) => (
            <div key={i} style={S.panelRow} onClick={() => { sendToActive({ type: 'navigate', url: h.url }); setShowHistoryPanel(false); }} title={h.url}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                {h.title || h.url}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 9, flexShrink: 0 }}>
                {new Date(h.visitedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Feature 48: shortcuts modal */}
      {showShortcutsModal && (
        <div style={S.modal} onClick={() => setShowShortcutsModal(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ ...S.panelHeader, borderBottom: 'none', padding: '0 0 8px 0' }}>
              <span>Keyboard Shortcuts</span>
              <button onClick={() => setShowShortcutsModal(false)} style={S.iconBtn}>×</button>
            </div>
            {[
              ['Ctrl+L', 'Focus address bar'],
              ['Ctrl+T', 'New tab'],
              ['Ctrl+W', 'Close current tab'],
              ['Ctrl+R', 'Reload'],
              ['Ctrl+Tab', 'Next tab'],
              ['Alt+←', 'Back'],
              ['Alt+→', 'Forward'],
              ['?', 'Toggle this shortcuts modal'],
            ].map(([key, desc]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 11 }}>
                <code style={{ background: 'var(--surface-base)', padding: '1px 4px', borderRadius: 2 }}>{key}</code>
                <span style={{ color: 'var(--text-secondary)' }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spinner CSS */}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
