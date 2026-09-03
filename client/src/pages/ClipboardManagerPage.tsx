import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Clipboard, Copy, Pin, Trash2, Download, Search, ExternalLink, Plus } from 'lucide-react';
import {
  addClipEntry, filterClipHistory, loadClipHistory, loadPins, removeClipEntry,
  saveClipHistory, sortClips, togglePin, clipsToCsv,
} from '../utils/clipboardStore';
import { cadPathForClip, classifyClipboard, clipKindLabel, isInAppCadPath, safeHttpUrl } from '../utils/clipboardClassify';
import { downloadTextFile } from '../utils/intelHitExport';

export default function ClipboardManagerPage() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<string[]>(() => loadClipHistory());
  const [pins, setPins] = useState<string[]>(() => loadPins());
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('all');

  const readClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setHistory((h) => addClipEntry(h, text));
    } catch { /* permission denied */ }
  }, []);

  useEffect(() => {
    readClipboard();
    const iv = setInterval(readClipboard, 3000);
    window.addEventListener('focus', readClipboard);
    return () => { clearInterval(iv); window.removeEventListener('focus', readClipboard); };
  }, [readClipboard]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '/') { e.preventDefault(); document.getElementById('clip-search')?.focus(); }
      if (e.key === 'Escape') { setQuery(''); setKindFilter('all'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function copyEntry(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* permission denied */ }
  }

  const visible = useMemo(() => {
    const filtered = filterClipHistory(sortClips(history, pins), query);
    if (kindFilter === 'all') return filtered;
    return filtered.filter((e) => classifyClipboard(e) === kindFilter);
  }, [history, pins, query, kindFilter]);

  const kinds = useMemo(() => {
    const set = new Set(history.map(classifyClipboard));
    return [...set];
  }, [history]);

  return (
    <div className="min-h-full bg-surface-base p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Clipboard className="w-4 h-4 text-brand-400" />
        <div className="text-[10px] font-semibold tracking-widest text-[color:var(--field-label-color)]">CLIPBOARD HISTORY</div>
        <span className="ml-auto text-[9px] text-fg-muted font-mono">{history.length} saved · {pins.length} pinned</span>
      </div>
      {history.length === 0 && (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No clipboard entries yet</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.map((entry: string, i: number) => (
          <div key={i} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1, wordBreak: 'break-all', fontFamily: 'Arial, sans-serif' }}>
              {entry.slice(0, 200)}{entry.length > 200 ? '…' : ''}
            </div>
            <button type="button" onClick={() => copyEntry(entry)} title="Copy" style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
              <Copy className="w-3 h-3" style={{ color: 'var(--brand-400)' }} />
            </button>
          </div>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) { setHistory((h) => addClipEntry(h, manual)); setManual(''); }
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Paste or type to save…"
          aria-label="Add clipboard entry"
          className="flex-1 px-2 py-1.5 bg-surface-sunken border border-border-subtle rounded-[2px] text-[11px] text-rmpg-100"
        />
        <button type="submit" className="toolbar-btn flex items-center gap-1 text-[9px]">
          <Plus className="w-3 h-3" /> ADD
        </button>
      </form>

      {visible.length === 0 && (
        <div className="text-[10px] text-fg-muted">
          {history.length === 0 ? 'No clipboard entries yet — copy text or add one above.' : 'No entries match this filter.'}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {visible.map((entry) => {
          const kind = classifyClipboard(entry);
          const pinned = pins.includes(entry);
          return (
            <div key={entry.slice(0, 80) + entry.length} className="bg-surface-raised border border-border-subtle rounded-[2px] p-2 flex gap-2 items-start">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[8px] font-semibold tracking-wide text-[color:var(--panel-header-color)]">{clipKindLabel(kind)}</span>
                  <span className="text-[8px] text-fg-muted font-mono">{entry.length} chars</span>
                  {pinned && <Pin className="w-2.5 h-2.5 text-brand-400" />}
                </div>
                <div className="text-[10px] text-rmpg-100 font-mono break-all">
                  {entry.slice(0, 400)}{entry.length > 400 ? '…' : ''}
                </div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button type="button" onClick={() => copyEntry(entry)} title="Copy" className="p-0.5">
                  <Copy className="w-3 h-3 text-brand-400" />
                </button>
                <button type="button" onClick={() => setPins(togglePin(pins, entry))} title="Pin" className="p-0.5">
                  <Pin className="w-3 h-3" style={{ color: pinned ? 'var(--brand-400)' : 'var(--text-secondary)' }} />
                </button>
                <button
                  type="button"
                  title="Open in CAD"
                  className="p-0.5"
                  onClick={() => {
                    const path = cadPathForClip(kind, entry);
                    if (isInAppCadPath(path)) {
                      navigate(path);
                      return;
                    }
                    const url = safeHttpUrl(path);
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                >
                  <ExternalLink className="w-3 h-3 text-fg-muted" />
                </button>
                <button type="button" onClick={() => setHistory((h) => removeClipEntry(h, entry))} title="Delete" className="p-0.5">
                  <Trash2 className="w-3 h-3 text-[color:var(--sev-critical)]" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
