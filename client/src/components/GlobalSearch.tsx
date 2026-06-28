// System-wide quick search (Ctrl/Cmd+K). Powered by the unified Knowledge
// Base endpoint — one request fans out across every record type and returns
// results keyed on the VISIBLE identifier (call/case/citation/warrant number,
// name, plate, badge, call sign, statute cite), never the backend row id.
// Selecting a result navigates to that record's section.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, User, Car, FileText, Phone, AlertTriangle, X, ArrowRight, Clock,
  Loader2, Command, Shield, Building2, Users, Radio, Package, Scale, Receipt,
  Fingerprint, BookOpen, type LucideIcon,
} from 'lucide-react';
import { knowledgeBaseSearch, kbTypeLabel, KB_TYPE_META, type KbResult } from '../utils/knowledgeBase';
import { useAuth } from '../context/AuthContext';

const TYPE_ICON: Record<string, LucideIcon> = {
  call: Phone, person: User, vehicle: Car, warrant: Shield, citation: Receipt,
  incident: FileText, personnel: Users, unit: Radio, evidence: Package,
  bolo: AlertTriangle, property: Building2, arrest: Fingerprint, statute: Scale,
};
const iconFor = (type: string): LucideIcon => TYPE_ICON[type] || BookOpen;

interface RecentSearch extends KbResult { timestamp: number; }

// Storage key is scoped per user.id so a shared MDT doesn't leak one
// operator's Cmd+K queries (names, plates, badges) to the next person who
// opens the dialog. When no user is known (mid-login first render) we skip
// reads and writes entirely rather than fall back to a shared key.
const LEGACY_RECENT_KEY = 'rmpg-recent-searches-v2';
const recentKeyFor = (userId: string | number | undefined): string | null =>
  userId ? `rmpg_globalsearch_recent_${userId}` : null;
const MAX_RECENT = 6;

export const GlobalSearch: React.FC = () => {
  const { user } = useAuth();
  const recentKey = recentKeyFor(user?.id);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KbResult[]>([]);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Re-loads when the signed-in user changes (login, fast user-switch on a
  // shared MDT). One-time read-through migration copies the legacy unscoped
  // key into this user's slot, then deletes it so the next operator never
  // sees a previous shift's queries.
  useEffect(() => {
    if (!recentKey) { setRecent([]); return; }
    try {
      const scoped = localStorage.getItem(recentKey);
      if (scoped) { setRecent(JSON.parse(scoped)); return; }
      const legacy = localStorage.getItem(LEGACY_RECENT_KEY);
      if (legacy) {
        localStorage.setItem(recentKey, legacy);
        localStorage.removeItem(LEGACY_RECENT_KEY);
        setRecent(JSON.parse(legacy));
        return;
      }
      setRecent([]);
    } catch { /* ignore */ }
  }, [recentKey]);

  // Ctrl/Cmd+K opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setIsOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (isOpen) inputRef.current?.focus(); }, [isOpen]);

  const handleClose = useCallback(() => {
    setIsOpen(false); setQuery(''); setResults([]); setSelectedIndex(0);
  }, []);

  // Debounced unified search.
  useEffect(() => {
    if (!query.trim()) { setResults([]); setIsLoading(false); return; }
    setIsLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await knowledgeBaseSearch(query, 40);
      if (cancelled) return;
      setResults(r);
      setSelectedIndex(0);
      setIsLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const saveRecent = useCallback((result: KbResult) => {
    setRecent((prev) => {
      const filtered = prev.filter((r) => !(r.recordId === result.recordId && r.type === result.type));
      const updated = [{ ...result, timestamp: Date.now() }, ...filtered].slice(0, MAX_RECENT);
      if (recentKey) {
        try { localStorage.setItem(recentKey, JSON.stringify(updated)); } catch { /* ignore */ }
      }
      return updated;
    });
  }, [recentKey]);

  const handleSelect = useCallback((result: KbResult) => {
    saveRecent(result);
    // Pass the record id as a deep-link hint; sections that support it focus
    // the record, others simply open the section.
    navigate(`${result.route}?kb=${result.type}:${result.recordId}`);
    handleClose();
  }, [navigate, handleClose, saveRecent]);

  const displayed: KbResult[] = query.trim() ? results : recent;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, displayed.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && displayed.length > 0) { e.preventDefault(); handleSelect(displayed[selectedIndex]); }
  }, [displayed, selectedIndex, handleClose, handleSelect]);

  // Group results by type, preserving rank order.
  const groups: Array<[string, KbResult[]]> = [];
  for (const r of results) {
    const g = groups.find(([t]) => t === r.type);
    if (g) g[1].push(r); else groups.push([r.type, [r]]);
  }
  // Flat index for keyboard highlight across groups.
  let flatIdx = -1;

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[18vh] bg-black/70 backdrop-blur-sm"
      onClick={handleClose}
      role="dialog" aria-modal="true" aria-label="Knowledge Base search"
      style={{ touchAction: 'manipulation' }}
    >
      <div
        className="bg-surface-base border border-rmpg-600 shadow-md w-full max-w-2xl max-h-[64vh] flex flex-col animate-scale-in"
        style={{ borderTop: '2px solid #d4a017' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-rmpg-600">
          {isLoading ? <Loader2 className="w-5 h-5 text-rmpg-300 animate-spin" /> : <Search className="w-5 h-5 text-rmpg-300" />}
          <input
            id="ff-globalsearch-0" ref={inputRef} type="text" value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Search by call #, name, plate, warrant #, badge, statute…"
            aria-label="Search all records" autoComplete="off"
            className="flex-1 bg-transparent text-sm text-rmpg-100 placeholder-rmpg-500 outline-none"
          />
          <div className="flex items-center gap-2 text-xs text-rmpg-400">
            <kbd className="px-2 py-1 bg-rmpg-700 border border-rmpg-600"><Command className="w-3 h-3 inline" />K</kbd>
            <button type="button" onClick={handleClose} className="p-2 sm:p-0 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center hover:text-rmpg-200" style={{ touchAction: 'manipulation' }} aria-label="Close" title="Close search">
              <X className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1">
          {!query.trim() && recent.length > 0 && (
            <div className="p-2">
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-rmpg-400 font-medium"><Clock className="w-3 h-3" /> RECENT</div>
              {recent.map((r, i) => <ResultItem key={`r-${r.type}-${r.recordId}`} result={r} isSelected={i === selectedIndex} onClick={() => handleSelect(r)} />)}
            </div>
          )}
          {!query.trim() && recent.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-rmpg-500 text-center px-6">
              <BookOpen className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">Search the entire system by what you see —</p>
              <p className="text-xs text-rmpg-600 mt-1">call numbers, names, plates, warrant &amp; citation numbers, badges, unit call signs, statute cites.</p>
            </div>
          )}
          {query.trim() && !isLoading && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-rmpg-400">
              <Search className="w-12 h-12 mb-3 opacity-50" /><p className="text-sm">No results found</p>
            </div>
          )}
          {query.trim() && results.length > 0 && (
            <div className="p-2">
              {groups.map(([type, list]) => {
                const Icon = iconFor(type);
                return (
                  <div key={type} className="mb-4 last:mb-0">
                    <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium" style={{ color: KB_TYPE_META[type]?.color || 'var(--rmpg-400)' }}>
                      <Icon className="w-3 h-3" /> {kbTypeLabel(type).toUpperCase()}
                    </div>
                    {list.map((r) => { flatIdx += 1; const idx = flatIdx; return (
                      <ResultItem key={`${r.type}-${r.recordId}`} result={r} isSelected={idx === selectedIndex} onClick={() => handleSelect(r)} />
                    ); })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-600 text-[10px] text-rmpg-600">
          <span>↑↓ navigate • Enter open • Esc close</span>
          <span className="flex items-center gap-3">
            {query.trim() && (
              <button
                type="button"
                onClick={() => { navigate(`/intel?q=${encodeURIComponent(query)}`); handleClose(); }}
                className="text-[#d4a017] hover:underline"
              >
                Open in Intel Search →
              </button>
            )}
            {query.trim() && <span>{results.length} result{results.length === 1 ? '' : 's'}</span>}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const ResultItem: React.FC<{ result: KbResult; isSelected: boolean; onClick: () => void }> = ({ result, isSelected, onClick }) => {
  const Icon = iconFor(result.type);
  const color = KB_TYPE_META[result.type]?.color || 'var(--rmpg-400)';
  const sub = [result.title, result.subtitle].filter(Boolean).join(' · ');
  return (
    <button type="button"
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${isSelected ? 'bg-brand-900/25 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800 border-l-2 border-l-transparent'}`}
      onClick={onClick}
    >
      <Icon className="w-4 h-4 flex-shrink-0" style={{ color }} />
      <div className="flex-1 min-w-0">
        {/* The VISIBLE identifier is the headline. */}
        <p className="text-sm text-rmpg-100 truncate font-medium">{result.label}</p>
        {sub && <p className="text-xs text-rmpg-300 truncate">{sub}</p>}
      </div>
      <span className="px-2 py-0.5 bg-rmpg-700 text-rmpg-200 text-xs border border-rmpg-600 flex-shrink-0">{kbTypeLabel(result.type)}</span>
      <ArrowRight className="w-4 h-4 text-rmpg-400 flex-shrink-0" />
    </button>
  );
};
