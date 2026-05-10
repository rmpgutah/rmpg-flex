// ============================================================
// RMPG Flex — NCIC / NLETS Terminal Page
// Full-featured split-pane NCIC terminal replicating Spillman
// Flex with query forms, history, saved queries, stats, and
// keyboard shortcuts.
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Terminal, Search, User, Car, FileWarning, CreditCard,
  MapPin, Shield, Bookmark, BookmarkPlus, Clock, Printer,
  Download, Trash2, History, Radio, Wifi, Database,
  Phone, Scale, Hash, X, Play, ChevronRight,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import NcicQueryPanel from '../components/NcicQueryPanel';
import IconButton from '../components/IconButton';
import { useIsMobile } from '../hooks/useIsMobile';
import { useWebSocket } from '../context/WebSocketContext';
import { useToast } from '../components/ToastProvider';
import { playTone } from '../utils/dispatchTones';

// ── Query type definitions ───────────────────────────────────

interface QueryType {
  code: string;
  label: string;
  desc: string;
  icon: typeof Terminal;
  ncicType: 'person' | 'vehicle' | 'warrant';
  fields: { key: string; label: string; placeholder: string }[];
}

const QUERY_TYPES: QueryType[] = [
  {
    code: 'QX', label: 'XREF', desc: 'Cross-Reference (ALL)', icon: Search,
    ncicType: 'person',
    fields: [
      { key: 'lastName', label: 'LAST NAME', placeholder: 'SMITH' },
      { key: 'firstName', label: 'FIRST NAME', placeholder: 'JOHN' },
    ],
  },
  {
    code: 'QH', label: 'PERSON', desc: 'Person / History', icon: User,
    ncicType: 'person',
    fields: [
      { key: 'lastName', label: 'LAST NAME', placeholder: 'SMITH' },
      { key: 'firstName', label: 'FIRST NAME', placeholder: 'JOHN' },
      { key: 'dob', label: 'DOB', placeholder: 'MM/DD/YYYY' },
    ],
  },
  {
    code: 'QV', label: 'VEHICLE', desc: 'Vehicle / Plate', icon: Car,
    ncicType: 'vehicle',
    fields: [
      { key: 'plate', label: 'PLATE #', placeholder: 'ABC1234' },
      { key: 'state', label: 'STATE', placeholder: 'UT' },
      { key: 'vin', label: 'VIN', placeholder: 'Optional' },
    ],
  },
  {
    code: 'QW', label: 'WARRANT', desc: 'Warrant Check', icon: FileWarning,
    ncicType: 'warrant',
    fields: [
      { key: 'lastName', label: 'LAST NAME', placeholder: 'SMITH' },
      { key: 'firstName', label: 'FIRST NAME', placeholder: 'JOHN' },
    ],
  },
  {
    code: 'QD', label: 'DL', desc: "Driver's License", icon: CreditCard,
    ncicType: 'person',
    fields: [
      { key: 'nameOrDl', label: 'NAME / DL#', placeholder: 'SMITH or D12345678' },
      { key: 'state', label: 'STATE', placeholder: 'UT' },
    ],
  },
  {
    code: 'QA', label: 'ADDRESS', desc: 'Premise Lookup', icon: MapPin,
    ncicType: 'person',
    fields: [
      { key: 'address', label: 'STREET ADDRESS', placeholder: '123 Main St' },
    ],
  },
  {
    code: 'QR', label: 'ARREST', desc: 'Arrest Records', icon: Shield,
    ncicType: 'person',
    fields: [
      { key: 'term', label: 'SEARCH TERM', placeholder: 'Name or booking #' },
    ],
  },
  {
    code: 'QS', label: 'SKIP', desc: 'Skip Tracer', icon: Search,
    ncicType: 'person',
    fields: [
      { key: 'term', label: 'SEARCH TERM', placeholder: 'Full name' },
    ],
  },
  {
    code: 'QB', label: 'BKGND', desc: 'Background Check', icon: Database,
    ncicType: 'person',
    fields: [
      { key: 'lastName', label: 'LAST NAME', placeholder: 'SMITH' },
      { key: 'firstName', label: 'FIRST NAME', placeholder: 'JOHN' },
    ],
  },
  {
    code: 'QO', label: 'OFAC', desc: 'Watchlist / SDN', icon: Shield,
    ncicType: 'person',
    fields: [
      { key: 'term', label: 'SEARCH TERM', placeholder: 'Name or alias' },
    ],
  },
  {
    code: 'QT', label: 'PHONE', desc: 'Phone Number', icon: Phone,
    ncicType: 'person',
    fields: [
      { key: 'term', label: 'PHONE NUMBER', placeholder: '801-555-1234' },
    ],
  },
  {
    code: 'QC', label: 'COURTS', desc: 'Utah Courts Xchange', icon: Scale,
    ncicType: 'person',
    fields: [
      { key: 'lastName', label: 'LAST NAME', placeholder: 'SMITH' },
      { key: 'firstName', label: 'FIRST NAME', placeholder: 'JOHN' },
    ],
  },
];

// Shortcut map: Ctrl+1 → QX, Ctrl+2 → QH, etc.
const SHORTCUT_INDICES = QUERY_TYPES.slice(0, 9);

// ── Saved query type ─────────────────────────────────────────

interface SavedQuery {
  id: string;
  code: string;
  queryStr: string;
  label: string;
  savedAt: number;
}

interface HistoryEntry {
  id: string;
  code: string;
  queryStr: string;
  timestamp: number;
  hit: boolean;
}

interface SessionStats {
  totalQueries: number;
  totalHits: number;
  lastQueryTime: number | null;
  responseTimes: number[];
}

const LS_SAVED_KEY = 'rmpg-ncic-saved-queries';

function loadSavedQueries(): SavedQuery[] {
  try {
    return JSON.parse(localStorage.getItem(LS_SAVED_KEY) || '[]');
  } catch { return []; }
}

function saveSavedQueries(queries: SavedQuery[]) {
  localStorage.setItem(LS_SAVED_KEY, JSON.stringify(queries));
}

// ── Helpers ──────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function buildCommandString(qt: QueryType, formData: Record<string, string>): string {
  const parts: string[] = [];
  for (const field of qt.fields) {
    const val = (formData[field.key] || '').trim();
    if (val) parts.push(val);
  }
  if (parts.length === 0) return '';

  // For multi-name fields, join with comma for name-based queries
  if (qt.fields.some(f => f.key === 'lastName') && qt.fields.some(f => f.key === 'firstName')) {
    const lastName = (formData.lastName || '').trim();
    const firstName = (formData.firstName || '').trim();
    const extra = qt.fields
      .filter(f => f.key !== 'lastName' && f.key !== 'firstName')
      .map(f => (formData[f.key] || '').trim())
      .filter(Boolean);
    const namePart = firstName ? `${lastName}, ${firstName}` : lastName;
    return `${qt.code} ${[namePart, ...extra].join(' ')}`;
  }

  return `${qt.code} ${parts.join(' ')}`;
}

// ── LED indicator component ──────────────────────────────────

function LedDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={`inline-block w-[6px] h-[6px] rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={{
        backgroundColor: color,
        boxShadow: `0 0 4px ${color}, 0 0 8px ${color}40`,
      }}
    />
  );
}

// ══════════════════════════════════════════════════════════════
// NCIC PAGE COMPONENT
// ══════════════════════════════════════════════════════════════

export default function NcicPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { isConnected } = useWebSocket();
  const { addToast } = useToast();

  // ── Session state ──────────────────────────────────────────
  const [sessionStart] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [selectedType, setSelectedType] = useState<QueryType | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [pendingQuery, setPendingQuery] = useState<{ type: 'person' | 'vehicle' | 'warrant'; query: string } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(loadSavedQueries);
  const [stats, setStats] = useState<SessionStats>({ totalQueries: 0, totalHits: 0, lastQueryTime: null, responseTimes: [] });
  const [mobileTab, setMobileTab] = useState<'query' | 'terminal'>('query');
  const [showHistory, setShowHistory] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const queryStartRef = useRef<number>(0);
  const entryCountRef = useRef(0);

  // Track terminal entries for export — listen to DOM mutations
  const lastQueryCountRef = useRef(0);

  // User ID for terminal ID
  const userId = useMemo(() => {
    try { return localStorage.getItem('rmpg_user_id') || '000'; }
    catch { return '000'; }
  }, []);

  // ── Session timer ──────────────────────────────────────────
  useEffect(() => {
    document.title = 'NCIC / NLETS Terminal \u2014 RMPG Flex';
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStart) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStart]);

  // ── Keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+L — clear terminal
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        handleClearTerminal();
        return;
      }
      // Ctrl+P — print
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        handlePrint();
        return;
      }
      // Ctrl+E — export
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        handleExport();
        return;
      }
      // Ctrl+1 through Ctrl+9 — quick select query type
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < SHORTCUT_INDICES.length) {
          handleSelectType(SHORTCUT_INDICES[idx]);
        }
        return;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Actions ────────────────────────────────────────────────

  const handleSelectType = useCallback((qt: QueryType) => {
    setSelectedType(qt);
    setFormData({});
    if (isMobile) setMobileTab('query');
  }, [isMobile]);

  const handleSubmitQuery = useCallback(() => {
    if (!selectedType) return;
    const cmdStr = buildCommandString(selectedType, formData);
    if (!cmdStr || cmdStr === `${selectedType.code} `) {
      addToast('Enter at least one search field', 'warning');
      return;
    }

    const queryStr = cmdStr.replace(`${selectedType.code} `, '');
    queryStartRef.current = Date.now();
    entryCountRef.current = stats.totalQueries;

    // Map code to NcicQueryPanel type
    const typeMap: Record<string, 'person' | 'vehicle' | 'warrant'> = {
      QH: 'person', QV: 'vehicle', QW: 'warrant',
    };
    // For query types not directly supported by initialQuery, use the
    // raw command approach by setting the query with the full command
    const mappedType = typeMap[selectedType.code];

    // Build the initialQuery — NcicQueryPanel will execute via its internal runQuery
    // For types not in the typeMap, we pass as person with the full command embedded
    setPendingQuery({
      type: mappedType || 'person',
      query: mappedType ? queryStr : cmdStr,
    });

    // Add to history
    const entry: HistoryEntry = {
      id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      code: selectedType.code,
      queryStr,
      timestamp: Date.now(),
      hit: false,
    };
    setHistory(prev => [entry, ...prev].slice(0, 20));

    // Update stats
    setStats(prev => ({
      ...prev,
      totalQueries: prev.totalQueries + 1,
      lastQueryTime: Date.now(),
    }));

    // Switch to terminal on mobile
    if (isMobile) setMobileTab('terminal');

    // Clear pending after a tick so NcicQueryPanel picks it up
    setTimeout(() => setPendingQuery(null), 100);
  }, [selectedType, formData, stats.totalQueries, isMobile, addToast]);

  const handleRerunQuery = useCallback((entry: HistoryEntry) => {
    const qt = QUERY_TYPES.find(q => q.code === entry.code);
    if (qt) {
      queryStartRef.current = Date.now();
      setPendingQuery({
        type: qt.ncicType,
        query: entry.queryStr,
      });
      setStats(prev => ({
        ...prev,
        totalQueries: prev.totalQueries + 1,
        lastQueryTime: Date.now(),
      }));
      if (isMobile) setMobileTab('terminal');
      setTimeout(() => setPendingQuery(null), 100);
    }
  }, [isMobile]);

  const handleSaveQuery = useCallback(() => {
    if (!selectedType) return;
    const cmdStr = buildCommandString(selectedType, formData);
    const queryStr = cmdStr.replace(`${selectedType.code} `, '');
    if (!queryStr.trim()) {
      addToast('Enter a query before saving', 'warning');
      return;
    }

    const newSaved: SavedQuery = {
      id: `sq-${Date.now()}`,
      code: selectedType.code,
      queryStr,
      label: `${selectedType.code} ${queryStr}`.substring(0, 40),
      savedAt: Date.now(),
    };
    const updated = [newSaved, ...savedQueries].slice(0, 50);
    setSavedQueries(updated);
    saveSavedQueries(updated);
    addToast('Query saved to bookmarks', 'success');
    playTone('info');
  }, [selectedType, formData, savedQueries, addToast]);

  const handleDeleteSaved = useCallback((id: string) => {
    const updated = savedQueries.filter(q => q.id !== id);
    setSavedQueries(updated);
    saveSavedQueries(updated);
  }, [savedQueries]);

  const handleClearTerminal = useCallback(() => {
    // NcicQueryPanel manages its own entries — we reset by remounting
    setPendingQuery(null);
    setStats({ totalQueries: 0, totalHits: 0, lastQueryTime: null, responseTimes: [] });
    setHistory([]);
    addToast('Terminal cleared', 'info');
  }, [addToast]);

  const handleExport = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const text = terminal.innerText || terminal.textContent || '';
    if (!text.trim()) {
      addToast('No terminal output to export', 'warning');
      return;
    }
    const header = [
      '═══════════════════════════════════════════════════════════',
      '  RMPG FLEX — NCIC / NLETS TERMINAL SESSION EXPORT',
      `  EXPORTED: ${new Date().toISOString()}`,
      `  TERMINAL: TRM-${userId}   ORI: RMPGFLEX01`,
      `  SESSION DURATION: ${formatElapsed(elapsed)}`,
      `  QUERIES: ${stats.totalQueries}   HITS: ${stats.totalHits}`,
      '═══════════════════════════════════════════════════════════',
      '',
    ].join('\n');
    const blob = new Blob([header + text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncic-export-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('Terminal output exported', 'success');
  }, [userId, elapsed, stats, addToast]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // ── Average response time ─────────────────────────────────
  const avgResponseTime = useMemo(() => {
    if (stats.responseTimes.length === 0) return 0;
    return Math.round(stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length);
  }, [stats.responseTimes]);

  // ══════════════════════════════════════════════════════════
  // RENDER — SESSION HEADER BAR
  // ══════════════════════════════════════════════════════════

  const headerBar = (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#222222]"
         style={{ background: 'linear-gradient(180deg, #1a1a1a 0%, #242424 100%)' }}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-[#d4a017]" />
          <span className="text-[10px] font-semibold text-[#d4a017] tracking-wider">NCIC / NLETS TERMINAL</span>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-[8px] font-mono text-[#888888] tracking-wider">
          <span>ORI: RMPGFLEX01</span>
          <span className="text-[#333333]">│</span>
          <span>TRM-{userId}</span>
          <span className="text-[#333333]">│</span>
          <span className="flex items-center gap-1">
            CHANNEL: SECURE <LedDot color="#22c55e" />
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[8px] font-mono tracking-wider">
        <span className="text-[#888888] tabular-nums">
          <Clock className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />
          {formatElapsed(elapsed)}
        </span>
        <span className="flex items-center gap-1">
          {isConnected ? (
            <>
              <LedDot color="#22c55e" />
              <span className="text-[#22c55e]">ONLINE</span>
            </>
          ) : (
            <>
              <LedDot color="#ef4444" pulse />
              <span className="text-[#ef4444]">OFFLINE</span>
            </>
          )}
        </span>
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
