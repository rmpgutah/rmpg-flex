import React, { useState, useEffect, useCallback } from 'react';
import { X, Clipboard, Copy, Trash2 } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';

const MAX_ITEMS = 20;
const MAX_PREVIEW_CHARS = 120;
const STORAGE_KEY = 'rmpg_clipboard_history';
const W = 300;
const H = 420;

interface ClipItem {
  id: string;
  text: string;
  ts: number;
}

function loadHistory(): ClipItem[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch { return []; }
}

function saveHistory(items: ClipItem[]) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

interface DesktopClipboardProps {
  onClose: () => void;
}

export default function DesktopClipboard({ onClose }: DesktopClipboardProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [items, setItems] = useState<ClipItem[]>(loadHistory);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Listen to copy events and store up to MAX_ITEMS
  useEffect(() => {
    const handler = () => {
      try {
        navigator.clipboard.readText().then(text => {
          if (!text || text.length === 0) return;
          setItems(prev => {
            const next = [{ id: `${Date.now()}_${Math.random()}`, text, ts: Date.now() }, ...prev.filter(p => p.text !== text)].slice(0, MAX_ITEMS);
            saveHistory(next);
            return next;
          });
        }).catch(() => {});
      } catch { /* permissions denied */ }
    };
    document.addEventListener('copy', handler);
    return () => document.removeEventListener('copy', handler);
  }, []);

  const copyToClipboard = useCallback((item: ClipItem) => {
    navigator.clipboard.writeText(item.text).then(() => {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1200);
    }).catch(() => {});
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    saveHistory([]);
  }, []);

  const preview = (text: string) =>
    text.length > MAX_PREVIEW_CHARS ? text.slice(0, MAX_PREVIEW_CHARS) + '…' : text;

  const formatTs = (ts: number) => {
    const d = new Date(ts); // new-date-ok: ts is Date.now() epoch ms, not a server string
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px var(--window-shadow)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div
        onPointerDown={onPointerDown}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}
      >
        <Clipboard size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>Clipboard History</span>
        <button aria-label="Close Clipboard" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{items.length} / {MAX_ITEMS} items</span>
        {items.length > 0 && (
          <button
            aria-label="Clear all clipboard history"
            onClick={clearAll}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sev-critical)', padding: '2px 4px' }}
          >
            <Trash2 size={10} /> Clear all
          </button>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {items.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>
            No clipboard history yet.<br />Copy text anywhere in RMPG Flex to record it here.
          </p>
        ) : (
          items.map(item => (
            <div
              key={item.id}
              onClick={() => copyToClipboard(item)}
              style={{
                padding: '8px 10px', marginBottom: 4, borderRadius: 2, cursor: 'pointer',
                background: copiedId === item.id ? 'var(--surface-sunken)' : 'var(--surface-base)',
                border: `1px solid ${copiedId === item.id ? 'var(--desktop-shell-accent, var(--accent-silver-400))' : 'var(--border-default)'}`,
                transition: 'background 0.12s, border-color 0.12s',
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.4, wordBreak: 'break-word', fontFamily: 'Arial, sans-serif', whiteSpace: 'pre-wrap' }}>
                {preview(item.text)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{formatTs(item.ts)}</span>
                <span style={{ fontSize: 9, color: copiedId === item.id ? 'var(--desktop-shell-accent)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Copy size={9} /> {copiedId === item.id ? 'Copied!' : 'Click to copy'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
