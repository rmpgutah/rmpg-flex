// ============================================================
// RMPG Flex — NCIC / NLETS Terminal Page
// Full-featured split-pane NCIC terminal replicating Spillman
// Flex with query forms, history, saved queries, stats, and
// keyboard shortcuts.
// ============================================================

import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Terminal, FileText } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import NcicQueryPanel, { type NcicQueryPanelHandle } from '../components/NcicQueryPanel';
import { useIsMobile } from '../hooks/useIsMobile';
import { generateNcicReferencePdf } from '../utils/ncicReferencePdf';
import { useAuth } from '../context/AuthContext';

type NcicQueryType = 'person' | 'vehicle' | 'warrant' | 'xref' | 'phone' | 'address' | 'dl' | 'ofac';
const VALID_TYPES: NcicQueryType[] = ['person', 'vehicle', 'warrant', 'xref', 'phone', 'address', 'dl', 'ofac'];

export default function NcicPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const canManage = ['admin', 'manager'].includes(user?.role ?? '');
  const panelRef = useRef<NcicQueryPanelHandle>(null);

  useEffect(() => { document.title = 'NCIC / NLETS Terminal — RMPG Flex'; }, []);

  // Strip deep-link params after they have been consumed (replace so Back works)
  useEffect(() => {
    if (params.get('q') || params.get('type')) {
      setSearchParams({}, { replace: true });
    }
  }, []); // run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // Deep-link: /ncic?q=<term>&type=<xref|person|...> auto-runs a query on open
  // (e.g. launched from the Cmd+K command palette). Defaults to a full
  // cross-reference (QX) — the most useful one-shot lookup.
  const initialQuery = useMemo(() => {
    const q = params.get('q');
    if (!q) return null;
    const t = params.get('type') as NcicQueryType | null;
    return { type: t && VALID_TYPES.includes(t) ? t : 'xref', query: q };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global N shortcut — focus the query input
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'N' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      panelRef.current?.focusInput();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Esc cascade — navigate back when no modal is open
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      navigate(-1);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [navigate]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {!isMobile && (
        <PanelTitleBar title="NCIC / NLETS TERMINAL" icon={Terminal}>
          <span className="text-[8px] font-mono text-rmpg-500 tracking-wider">SECURE CHANNEL</span>
          <IconButton
            aria-label="Download NCIC Operator Reference Guide (PDF)"
            title="Reference Guide (PDF)"
            onClick={() => generateNcicReferencePdf()}
            className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold tracking-wide text-brand-400 hover:text-brand-300 border border-rmpg-700 hover:border-brand-500 bg-surface-raised"
          >
            <FileText size={11} />
            <span>REFERENCE GUIDE</span>
          </IconButton>
        </PanelTitleBar>
      )}
      <div className="flex-1 overflow-hidden print:overflow-visible">
        <NcicQueryPanel
          ref={panelRef}
          isOpen={true}
          onClose={() => navigate(-1)}
          embedded={true}
          initialQuery={initialQuery}
          canManage={canManage}
        />
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — QUERY TYPE GRID
  // ══════════════════════════════════════════════════════════

  const queryGrid = (
    <div className="grid grid-cols-3 gap-1 p-2">
      {QUERY_TYPES.map((qt, idx) => {
        const Icon = qt.icon;
        const isActive = selectedType?.code === qt.code;
        return (
          <button
            key={qt.code}
            onClick={() => handleSelectType(qt)}
            className={`flex flex-col items-center py-1.5 px-1 border transition-colors ${
              isActive
                ? 'border-[#d4a017] bg-[#d4a017]/10 text-[#d4a017]'
                : 'border-[#222222] bg-[#0a0a0a] text-[#888888] hover:border-[#444444] hover:text-[#cccccc]'
            }`}
            title={`${qt.desc} (${idx < 9 ? `Ctrl+${idx + 1}` : qt.code})`}
          >
            <Icon className="w-3 h-3 mb-0.5" />
            <span className="text-[8px] font-semibold tracking-wider">{qt.label}</span>
            <span className="text-[7px] opacity-60">{qt.code}</span>
          </button>
        );
      })}
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — STRUCTURED QUERY FORM
  // ══════════════════════════════════════════════════════════

  const queryForm = selectedType && (
    <div className="px-2 pb-2 space-y-1.5">
      <div className="flex items-center gap-1.5 py-1 border-b border-[#1a1a1a]">
        <ChevronRight className="w-2.5 h-2.5 text-[#d4a017]" />
        <span className="text-[9px] font-semibold text-[#d4a017] tracking-wider">
          {selectedType.desc.toUpperCase()}
        </span>
      </div>
      {selectedType.fields.map(field => (
        <div key={field.key}>
          <label className="block text-[7px] font-semibold text-[#888888] tracking-wider mb-0.5 uppercase">
            {field.label}
          </label>
          <input
            type="text"
            value={formData[field.key] || ''}
            onChange={e => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmitQuery(); }}
            placeholder={field.placeholder}
            className="w-full bg-[#050505] border border-[#222222] text-[10px] font-mono text-green-400 px-2 py-1 placeholder-[#333333] focus:border-[#d4a017] focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ))}
      <div className="flex gap-1 pt-1">
        <button
          onClick={handleSubmitQuery}
          className="flex-1 flex items-center justify-center gap-1 bg-[#d4a017]/15 border border-[#d4a017]/40 text-[#d4a017] text-[9px] font-semibold tracking-wider py-1.5 hover:bg-[#d4a017]/25 transition-colors"
        >
          <Play className="w-2.5 h-2.5" />
          SUBMIT QUERY
        </button>
        <IconButton
          aria-label="Save query to bookmarks"
          onClick={handleSaveQuery}
          className="px-2 bg-[#141414] border border-[#222222] text-[#888888] hover:text-[#d4a017] hover:border-[#d4a017]/40 transition-colors"
        >
          <BookmarkPlus className="w-3 h-3" />
        </IconButton>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — QUERY HISTORY
  // ══════════════════════════════════════════════════════════

  const historySection = (
    <div className="border-t border-[#1a1a1a]">
      <button
        onClick={() => setShowHistory(prev => !prev)}
        className="flex items-center justify-between w-full px-2 py-1 text-[8px] font-semibold text-[#888888] tracking-wider hover:text-[#cccccc] transition-colors"
      >
        <span className="flex items-center gap-1">
          <History className="w-2.5 h-2.5" />
          QUERY HISTORY ({history.length})
        </span>
        <ChevronRight className={`w-2.5 h-2.5 transition-transform ${showHistory ? 'rotate-90' : ''}`} />
      </button>
      {showHistory && (
        <div className="max-h-[180px] overflow-y-auto px-1 pb-1 space-y-0.5">
          {history.length === 0 ? (
            <div className="text-[8px] text-[#444444] text-center py-2 font-mono">NO QUERIES THIS SESSION</div>
          ) : (
            history.map(entry => (
              <button
                key={entry.id}
                onClick={() => handleRerunQuery(entry)}
                className="w-full flex items-center gap-1.5 px-1.5 py-0.5 bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#333333] transition-colors text-left group"
                title="Click to re-run"
              >
                <span className="text-[7px] font-mono text-[#555555] tabular-nums shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="text-[8px] font-mono text-[#d4a017] shrink-0">{entry.code}</span>
                <span className="text-[8px] font-mono text-[#888888] truncate group-hover:text-[#cccccc]">{entry.queryStr}</span>
                <Play className="w-2 h-2 text-[#333333] group-hover:text-[#d4a017] shrink-0 ml-auto" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — SAVED QUERIES
  // ══════════════════════════════════════════════════════════

  const savedSection = (
    <div className="border-t border-[#1a1a1a]">
      <button
        onClick={() => setShowSaved(prev => !prev)}
        className="flex items-center justify-between w-full px-2 py-1 text-[8px] font-semibold text-[#888888] tracking-wider hover:text-[#cccccc] transition-colors"
      >
        <span className="flex items-center gap-1">
          <Bookmark className="w-2.5 h-2.5" />
          SAVED QUERIES ({savedQueries.length})
        </span>
        <ChevronRight className={`w-2.5 h-2.5 transition-transform ${showSaved ? 'rotate-90' : ''}`} />
      </button>
      {showSaved && (
        <div className="max-h-[180px] overflow-y-auto px-1 pb-1 space-y-0.5">
          {savedQueries.length === 0 ? (
            <div className="text-[8px] text-[#444444] text-center py-2 font-mono">NO SAVED QUERIES</div>
          ) : (
            savedQueries.map(sq => (
              <div
                key={sq.id}
                className="flex items-center gap-1 px-1.5 py-0.5 bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#333333] transition-colors group"
              >
                <button
                  onClick={() => {
                    const qt = QUERY_TYPES.find(q => q.code === sq.code);
                    if (qt) {
                      handleRerunQuery({ id: sq.id, code: sq.code, queryStr: sq.queryStr, timestamp: Date.now(), hit: false });
                    }
                  }}
                  className="flex-1 flex items-center gap-1.5 text-left min-w-0"
                  title="Click to run"
                >
                  <span className="text-[8px] font-mono text-[#d4a017] shrink-0">{sq.code}</span>
                  <span className="text-[8px] font-mono text-[#888888] truncate group-hover:text-[#cccccc]">{sq.queryStr}</span>
                </button>
                <IconButton
                  aria-label={`Delete saved query ${sq.label}`}
                  onClick={() => handleDeleteSaved(sq.id)}
                  className="p-0.5 text-[#333333] hover:text-[#ef4444] transition-colors shrink-0"
                >
                  <X className="w-2.5 h-2.5" />
                </IconButton>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — STATS BAR
  // ══════════════════════════════════════════════════════════

  const statsBar = (
    <div className="px-2 py-1 border-t border-[#1a1a1a] bg-[#050505]">
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[7px] font-mono tracking-wider">
        <div className="flex justify-between">
          <span className="text-[#555555]">QUERIES</span>
          <span className="text-[#888888] tabular-nums">{stats.totalQueries}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#555555]">HITS</span>
          <span className="text-[#22c55e] tabular-nums">{stats.totalHits}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#555555]">LAST QUERY</span>
          <span className="text-[#888888] tabular-nums">
            {stats.lastQueryTime ? new Date(stats.lastQueryTime).toLocaleTimeString('en-US', { hour12: false }) : '--:--:--'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#555555]">AVG RESP</span>
          <span className="text-[#888888] tabular-nums">{avgResponseTime ? `${avgResponseTime}ms` : '---'}</span>
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — TERMINAL ACTION BAR
  // ══════════════════════════════════════════════════════════

  const terminalActionBar = (
    <div className="flex items-center justify-between px-2 py-1 border-b border-[#222222] bg-[#0a0a0a]">
      <div className="flex items-center gap-1.5">
        <Terminal className="w-3 h-3 text-[#d4a017]" />
        <span className="text-[8px] font-semibold text-[#d4a017] tracking-wider">TERMINAL OUTPUT</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[7px] font-mono text-[#555555] tracking-wider mr-1 tabular-nums">
          {stats.totalQueries} QUERIES | {stats.totalHits} HITS
        </span>
        <IconButton
          aria-label="Clear terminal (Ctrl+L)"
          onClick={handleClearTerminal}
          className="p-1 text-[#555555] hover:text-[#cccccc] transition-colors"
          title="Clear Terminal (Ctrl+L)"
        >
          <Trash2 className="w-3 h-3" />
        </IconButton>
        <IconButton
          aria-label="Export results as text file (Ctrl+E)"
          onClick={handleExport}
          className="p-1 text-[#555555] hover:text-[#cccccc] transition-colors"
          title="Export Results (Ctrl+E)"
        >
          <Download className="w-3 h-3" />
        </IconButton>
        <IconButton
          aria-label="Print terminal output (Ctrl+P)"
          onClick={handlePrint}
          className="p-1 text-[#555555] hover:text-[#cccccc] transition-colors"
          title="Print (Ctrl+P)"
        >
          <Printer className="w-3 h-3" />
        </IconButton>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — LEFT PANEL (query forms + tools)
  // ══════════════════════════════════════════════════════════

  const leftPanel = (
    <div className="flex flex-col h-full bg-[#0a0a0a] border-r border-[#222222] overflow-hidden"
         style={{ width: isMobile ? '100%' : 320, minWidth: isMobile ? undefined : 320 }}>
      {/* Panel header */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[#222222]"
           style={{ background: 'linear-gradient(180deg, #1a1a1a 0%, #242424 100%)' }}>
        <Search className="w-3 h-3 text-[#d4a017]" />
        <span className="text-[9px] font-semibold text-[#d4a017] tracking-wider">QUERY FORMS</span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {queryGrid}
        {queryForm}
        {historySection}
        {savedSection}
      </div>

      {/* Stats footer */}
      {statsBar}
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — RIGHT PANEL (terminal output)
  // ══════════════════════════════════════════════════════════

  const rightPanel = (
    <div className="flex flex-col flex-1 h-full overflow-hidden" ref={terminalRef}>
      {terminalActionBar}
      <div className="flex-1 overflow-hidden print:overflow-visible">
        <NcicQueryPanel
          isOpen={true}
          onClose={() => navigate(-1)}
          embedded={true}
          initialQuery={pendingQuery}
        />
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — MOBILE TAB BAR
  // ══════════════════════════════════════════════════════════

  const mobileTabBar = (
    <div className="flex border-b border-[#222222] bg-[#0a0a0a]">
      <button
        onClick={() => setMobileTab('query')}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[9px] font-semibold tracking-wider border-b-2 transition-colors ${
          mobileTab === 'query'
            ? 'border-[#d4a017] text-[#d4a017]'
            : 'border-transparent text-[#555555] hover:text-[#888888]'
        }`}
      >
        <Search className="w-3 h-3" />
        QUERY
      </button>
      <button
        onClick={() => setMobileTab('terminal')}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[9px] font-semibold tracking-wider border-b-2 transition-colors ${
          mobileTab === 'terminal'
            ? 'border-[#d4a017] text-[#d4a017]'
            : 'border-transparent text-[#555555] hover:text-[#888888]'
        }`}
      >
        <Terminal className="w-3 h-3" />
        TERMINAL
      </button>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // RENDER — MAIN LAYOUT
  // ══════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Session header */}
      {headerBar}

      {isMobile ? (
        <>
          {mobileTabBar}
          <div className="flex-1 overflow-hidden">
            {mobileTab === 'query' ? leftPanel : rightPanel}
          </div>
        </>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {leftPanel}
          {rightPanel}
        </div>
      )}
    </div>
  );
}
