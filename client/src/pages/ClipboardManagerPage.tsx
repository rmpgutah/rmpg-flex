import React, { useEffect, useCallback } from 'react';
import { Copy, Clipboard } from 'lucide-react';
import { useDesktopSystem } from '../context/DesktopSystemContext';

export default function ClipboardManagerPage() {
  const { clipboardHistory, addClipboardEntry } = useDesktopSystem();

  const readClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) addClipboardEntry(text);
    } catch { /* permission denied */ }
  }, [addClipboardEntry]);

  useEffect(() => {
    readClipboard();
    const iv = setInterval(readClipboard, 3000);
    window.addEventListener('focus', readClipboard);
    return () => { clearInterval(iv); window.removeEventListener('focus', readClipboard); };
  }, [readClipboard]);

  async function copyEntry(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* permission denied */ }
  }

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Clipboard className="w-4 h-4" style={{ color: 'var(--brand-400)' }} />
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>CLIPBOARD HISTORY</div>
      </div>
      {clipboardHistory.length === 0 && (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No clipboard entries yet</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {clipboardHistory.map((entry, i) => (
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
    </div>
  );
}
