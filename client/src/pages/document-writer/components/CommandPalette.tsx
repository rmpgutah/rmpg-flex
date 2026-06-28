// Command palette for the document writer. Ctrl+/ (or Cmd+/) opens it.
// Tabs across the top group commands by category ("All", "Case", "Insert", …);
// the query filters within the active tab. Arrow keys navigate, Enter runs.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ACTION_REGISTRY, ACTION_GROUPS, type DocAction } from '../docActions2';

interface Props {
  editor: Editor;
  onClose: () => void;
}

const ALL = 'All';
const RECENT = 'Recent';
const MRU_KEY = 'rmpg_writer_palette_mru';
const MRU_MAX = 12;

function readMru(): string[] {
  try { const v = JSON.parse(localStorage.getItem(MRU_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function pushMru(key: string): void {
  const prev = readMru().filter((k) => k !== key);
  prev.unshift(key);
  try { localStorage.setItem(MRU_KEY, JSON.stringify(prev.slice(0, MRU_MAX))); } catch { /* noop */ }
}

export default function CommandPalette({ editor, onClose }: Props) {
  const [q, setQ] = useState('');
  const [mru, setMru] = useState<string[]>(() => readMru());
  // Open on Recent if we have any history; otherwise All.
  const [tab, setTab] = useState<string>(mru.length ? RECENT : ALL);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo<DocAction[]>(() => {
    const needle = q.trim().toLowerCase();
    let inTab: DocAction[];
    if (tab === RECENT) {
      // Map keys in MRU order back to actions; drop any that no longer exist.
      const byKey = new Map(ACTION_REGISTRY.map((a) => [`${a.group}:${a.name}`, a]));
      inTab = mru.map((k) => byKey.get(k)).filter((a): a is DocAction => Boolean(a));
    } else if (tab === ALL) {
      inTab = ACTION_REGISTRY;
    } else {
      inTab = ACTION_REGISTRY.filter((a) => a.group === tab);
    }
    if (!needle) return inTab;
    return inTab.filter((a) => a.name.toLowerCase().includes(needle));
  }, [q, tab, mru]);

  // Count per tab — shown as a small badge on the tab strip.
  const counts = useMemo(() => {
    const m: Record<string, number> = { [ALL]: ACTION_REGISTRY.length, [RECENT]: mru.length };
    for (const g of ACTION_GROUPS) m[g] = ACTION_REGISTRY.filter((a) => a.group === g).length;
    return m;
  }, [mru]);

  // Keep the active row in view when arrow-navigating.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-row="${idx}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  // Reset selection whenever filter or tab changes.
  useEffect(() => { setIdx(0); }, [q, tab]);

  const run = (a: DocAction) => {
    const key = `${a.group}:${a.name}`;
    pushMru(key);
    setMru(readMru());
    try { a.fn(editor); } catch (err) { console.error('[command-palette]', a.name, err); }
    onClose();
  };

  // Recent appears only when there's history; tabs are otherwise stable.
  const tabs = [...(mru.length ? [RECENT] : []), ALL, ...ACTION_GROUPS];

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh]"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-[640px] max-w-[94vw] bg-surface-sunken border border-[#d4a017]/60 shadow-2xl flex flex-col"
        style={{ borderRadius: 2 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Tab strip */}
        <div
          className="flex overflow-x-auto border-b border-rmpg-700 bg-surface-overlay"
          style={{ scrollbarWidth: 'thin' }}
        >
          {tabs.map((t) => {
            const active = t === tab;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-[11px] uppercase tracking-wider whitespace-nowrap border-r border-border-default flex items-center gap-1.5 ${
                  active
                    ? 'bg-surface-sunken text-[#d4a017] border-b-2 border-b-[#d4a017]'
                    : 'text-rmpg-500 hover:text-rmpg-200 hover:bg-surface-sunken'
                }`}
                style={{ borderRadius: 0 }}
              >
                <span>{t}</span>
                <span className={`text-[9px] ${active ? 'text-rmpg-400' : 'text-rmpg-700'}`}>
                  {counts[t]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Tab') {
              // Tab / Shift+Tab cycles tabs without losing keyboard focus.
              e.preventDefault();
              const i = tabs.indexOf(tab);
              const next = e.shiftKey ? (i - 1 + tabs.length) % tabs.length : (i + 1) % tabs.length;
              setTab(tabs[next]);
            }
            else if (e.key === 'Enter') {
              e.preventDefault();
              const a = filtered[idx];
              if (a) run(a);
            }
          }}
          placeholder={`Search ${tab === ALL ? 'all commands' : tab.toLowerCase()}…`}
          className="w-full bg-transparent text-[13px] text-rmpg-100 px-3 py-2 outline-none border-b border-rmpg-700 placeholder:text-rmpg-600"
        />

        {/* Result list */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-rmpg-600 text-[11px]">
              No matching commands in <b>{tab}</b>.
            </div>
          )}
          {filtered.map((a, i) => (
            <button
              key={`${a.group}:${a.name}`}
              type="button"
              data-row={i}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(a)}
              className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between gap-3 ${
                i === idx ? 'bg-[#d4a017]/15 text-rmpg-100' : 'text-rmpg-300 hover:bg-surface-base'
              }`}
              style={{ borderRadius: 0 }}
            >
              <span>{a.name}</span>
              {/* Only show the group chip in the All tab — redundant inside a group tab. */}
              {tab === ALL && (
                <span className="text-[9px] uppercase tracking-wider text-rmpg-600">{a.group}</span>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 text-[9px] text-rmpg-600">
          <span>↑↓ navigate • Tab switch group • Enter run • Esc close</span>
          <span>{filtered.length} shown</span>
        </div>
      </div>
    </div>
  );
}
