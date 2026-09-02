import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, FileText, Copy, Trash2, Save, Link, Plus, Download, Search } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { useDesktopWindows } from '../DesktopWindowManager';
import {
  deletePadNote, emptyNote, filterPadNotes, loadPadNotes, notesToPlaintext, PadNote, savePadNotes, upsertPadNote,
} from '../../../utils/notepadStore';
import { downloadTextFile } from '../../../utils/rmsListExport';

const W = 640;
const H = 460;
const AUTOSAVE_MS = 2000;

interface DesktopNotepadProps {
  onClose: () => void;
}

export default function DesktopNotepad({ onClose }: DesktopNotepadProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [notes, setNotes] = useState<PadNote[]>(() => loadPadNotes());
  const [activeId, setActiveId] = useState(() => loadPadNotes()[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(true);
  const [status, setStatus] = useState('');
  const timerRef = useRef<number | null>(null);
  const { windows } = useDesktopWindows();

  const active = notes.find((n) => n.id === activeId) ?? notes[0];

  useEffect(() => {
    setSaved(false);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      savePadNotes(notes);
      setSaved(true);
    }, AUTOSAVE_MS);
    return () => { if (timerRef.current !== null) clearTimeout(timerRef.current); };
  }, [notes]);

  const patchActive = (partial: Partial<PadNote>) => {
    setNotes((prev) => prev.map((n) => (n.id === activeId ? { ...n, ...partial, updatedAt: Date.now() } : n)));
  };

  const visibleNotes = useMemo(() => filterPadNotes(notes, query), [notes, query]);

  const copyAll = useCallback(() => {
    if (!active) return;
    navigator.clipboard.writeText(active.body).then(() => {
      setStatus('Copied');
      setTimeout(() => setStatus(''), 1500);
    }).catch(() => {});
  }, [active]);

  const newNote = useCallback(() => {
    const n = emptyNote('Untitled');
    setNotes((prev) => upsertPadNote(prev, n));
    setActiveId(n.id);
  }, []);

  const removeNote = useCallback(() => {
    if (!active) return;
    const next = deletePadNote(notes, active.id);
    setNotes(next);
    setActiveId(next[0]?.id ?? '');
  }, [active, notes]);

  const saveAsFile = useCallback(() => {
    if (!active) return;
    downloadTextFile(`${active.title.replace(/\s+/g, '-').slice(0, 40) || 'note'}.txt`, active.body, 'text/plain;charset=utf-8');
    setStatus('Saved');
    setTimeout(() => setStatus(''), 1500);
  }, [active]);

  const exportAll = useCallback(() => {
    downloadTextFile('flexos-notes.txt', notesToPlaintext(notes), 'text/plain;charset=utf-8');
  }, [notes]);

  const cfsWindow = windows.find(w => w.path?.includes('/dispatch') || w.title?.toLowerCase().includes('call'));
  const linkToCall = useCallback(() => {
    if (!cfsWindow || !active) return;
    const prefix = `[Linked to ${cfsWindow.title}]\n`;
    patchActive({ body: active.body.startsWith(prefix) ? active.body : prefix + active.body });
    setStatus('Linked');
    setTimeout(() => setStatus(''), 1500);
  }, [cfsWindow, active]);

  const wordCount = active?.body.trim() ? active.body.trim().split(/\s+/).length : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveAsFile();
      }
      if (e.key === 'Escape') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveAsFile, onClose]);

  const btnStyle = (color?: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 10px',
    background: 'none', border: '1px solid var(--border-default)', borderRadius: 2,
    cursor: 'pointer', color: color ?? 'var(--text-primary)',
  });

  if (!active) return null;

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px var(--window-shadow)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}>
        <FileText size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>
          Notepad {!saved && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>·</span>}
        </span>
        <button aria-label="Close Notepad" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-default)', flexShrink: 0, flexWrap: 'wrap' }}>
        <button aria-label="New note" onClick={newNote} style={btnStyle()}><Plus size={10} /> New</button>
        <button aria-label="Save note to file" onClick={saveAsFile} style={btnStyle()}><Save size={10} /> Save</button>
        <button aria-label="Copy note" onClick={copyAll} style={btnStyle()}><Copy size={10} /> Copy</button>
        <button aria-label="Export all notes" onClick={exportAll} style={btnStyle()}><Download size={10} /> All</button>
        <button aria-label="Delete note" onClick={removeNote} style={btnStyle('var(--sev-critical)')}><Trash2 size={10} /> Delete</button>
        {cfsWindow && (
          <button aria-label="Link note to call" onClick={linkToCall} style={btnStyle()}>
            <Link size={10} /> Link to call
          </button>
        )}
        {status && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{status}</span>}
      </div>

      {/* Text area */}
      <textarea
        value={active.body}
        onChange={e => patchActive({ body: e.target.value })}
        placeholder="Start typing your note…"
        style={{
          flex: 1,
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'var(--surface-base)',
          color: 'var(--text-primary)',
          fontSize: 12,
          fontFamily: 'Arial, sans-serif',
          lineHeight: 1.6,
          padding: 12,
          caretColor: 'var(--text-primary)',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', padding: '3px 10px', background: 'var(--surface-sunken)', borderTop: '1px solid var(--border-default)', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{notes.length} notes · {wordCount} words · {active.body.length} chars</span>
        {!saved && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>Saving…</span>}
        {saved && active.body.length > 0 && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>Auto-saved</span>}
      </div>
    </div>
  );
}
