import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, FileText, Copy, Trash2, Save, Link } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { useDesktopWindows } from '../DesktopWindowManager';

const W = 500;
const H = 400;
const STORAGE_KEY = 'rmpg_notepad_content';
const AUTOSAVE_MS = 2000;

interface DesktopNotepadProps {
  onClose: () => void;
}

export default function DesktopNotepad({ onClose }: DesktopNotepadProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [text, setText] = useState<string>(() => sessionStorage.getItem(STORAGE_KEY) ?? '');
  const [saved, setSaved] = useState(true);
  const [status, setStatus] = useState('');
  const timerRef = useRef<number | null>(null);
  const { windows } = useDesktopWindows();

  // Auto-save to sessionStorage
  useEffect(() => {
    setSaved(false);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      sessionStorage.setItem(STORAGE_KEY, text);
      setSaved(true);
    }, AUTOSAVE_MS);
    return () => { if (timerRef.current !== null) clearTimeout(timerRef.current); };
  }, [text]);

  const copyAll = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setStatus('Copied!');
      setTimeout(() => setStatus(''), 1500);
    }).catch(() => {});
  }, [text]);

  const clearAll = useCallback(() => {
    setText('');
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const saveAsFile = useCallback(() => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `note-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('Saved');
    setTimeout(() => setStatus(''), 1500);
  }, [text]);

  // Find any CFS floating window to link the note to
  const cfsWindow = windows.find(w => w.path?.includes('/dispatch') || w.title?.toLowerCase().includes('call'));
  const linkToCall = useCallback(() => {
    if (!cfsWindow) return;
    const prefix = `[Linked to ${cfsWindow.title}]\n`;
    setText(t => t.startsWith(prefix) ? t : prefix + t);
    setStatus('Linked');
    setTimeout(() => setStatus(''), 1500);
  }, [cfsWindow]);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  const btnStyle = (color?: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 10px',
    background: 'none', border: '1px solid var(--border-default)', borderRadius: 2,
    cursor: 'pointer', color: color ?? 'var(--text-primary)',
  });

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px var(--window-shadow)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}>
        <FileText size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>
          Notepad {!saved && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>·</span>}
        </span>
        <button aria-label="Close Notepad" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-default)', flexShrink: 0, flexWrap: 'wrap' }}>
        <button aria-label="New note" onClick={clearAll} style={btnStyle()}>
          <FileText size={10} /> New
        </button>
        <button aria-label="Save note to file" onClick={saveAsFile} style={btnStyle()}>
          <Save size={10} /> Save
        </button>
        <button aria-label="Copy all text" onClick={copyAll} style={btnStyle()}>
          <Copy size={10} /> Copy
        </button>
        <button aria-label="Clear note" onClick={clearAll} style={btnStyle('var(--sev-critical)')}>
          <Trash2 size={10} /> Clear
        </button>
        {cfsWindow && (
          <button aria-label="Link note to call" onClick={linkToCall} style={{ ...btnStyle(), marginLeft: 'auto' }}>
            <Link size={10} /> Link to call
          </button>
        )}
        {status && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: cfsWindow ? 0 : 'auto' }}>{status}</span>}
      </div>

      {/* Text area */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
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

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '3px 10px', background: 'var(--surface-sunken)', borderTop: '1px solid var(--border-default)', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{wordCount} words · {charCount} chars</span>
        {!saved && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>Saving…</span>}
        {saved && charCount > 0 && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>Auto-saved</span>}
      </div>
    </div>
  );
}
