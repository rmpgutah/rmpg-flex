import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, FileText, Link } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { apiFetch } from '../../../hooks/useApi';
import { copyToClipboard } from '../../../utils/clipboard';

const W = 500;
const H = 400;

interface LinkedCall {
  id: number | string;
  call_number?: string;
  incident_type?: string;
  address?: string;
}

interface DesktopEvidenceScratchPadProps {
  onClose: () => void;
  initialCallId?: number | string;
}

const EVENT_NAME = 'flexos-cfs-focused';

export default function DesktopEvidenceScratchPad({ onClose, initialCallId }: DesktopEvidenceScratchPadProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2 + 60), y: 120 });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));

  const [linkedCall, setLinkedCall] = useState<LinkedCall | null>(null);
  const [content, setContent] = useState('');
  const [find, setFind] = useState('');
  const [wrap, setWrap] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for CFS window focus events from other FloatingWindow title bars
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ callId: number | string; callNumber?: string; incidentType?: string; address?: string }>).detail;
      if (detail?.callId) {
        setLinkedCall({ id: detail.callId, call_number: detail.callNumber, incident_type: detail.incidentType, address: detail.address });
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  // Load call from prop on mount
  useEffect(() => {
    if (!initialCallId) return;
    apiFetch<LinkedCall>(`/dispatch/calls/${initialCallId}`)
      .then(call => setLinkedCall(call))
      .catch(() => setLinkedCall({ id: initialCallId }));
  }, [initialCallId]);

  // Auto-save every 2s while content changes; also save on unmount
  const saveToApi = useCallback(async (text: string, callId: number | string) => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/dispatch/calls/${callId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note: text, source: 'scratch_pad' }),
      });
      setSavedAt(new Date().toLocaleTimeString()); // new-date-ok — clock stamp, not a D1 string
    } catch { /* degrade silently */ } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!linkedCall) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveToApi(content, linkedCall.id), 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [content, linkedCall, saveToApi]);

  function stampHeader() {
    if (!linkedCall) return;
    const header = [
      `─── Incident #${linkedCall.call_number ?? linkedCall.id} ───`,
      linkedCall.incident_type ? `Type: ${linkedCall.incident_type}` : '',
      linkedCall.address ? `Address: ${linkedCall.address}` : '',
      `Time: ${new Date().toLocaleString()}`, // new-date-ok — clock stamp, not a D1 string
      '',
    ].filter(Boolean).join('\n');
    setContent(prev => (prev ? `${header}\n${prev}` : header));
  }

  return (
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
        background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
        borderRadius: 2, boxShadow: '0 8px 32px var(--window-shadow)', zIndex: 14000,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      {/* Title bar */}
      <div
        onPointerDown={onPointerDown}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}
      >
        <FileText size={13} style={{ color: 'var(--field-label-color)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>
          Evidence Scratch Pad
        </span>
        {saving && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Saving…</span>}
        {!saving && savedAt && <span style={{ fontSize: 9, color: 'var(--sev-ok)' }}>Saved {savedAt}</span>}
        <button aria-label="Close Evidence Scratch Pad" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      {/* Linked call header */}
      <div style={{ padding: '6px 10px', background: 'var(--surface-base)', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Link size={11} style={{ color: linkedCall ? 'var(--sev-ok)' : 'var(--text-muted)', flexShrink: 0 }} />
        {linkedCall ? (
          <span style={{ fontSize: 11, color: 'var(--text-primary)' }}>
            Linked to call <strong>#{linkedCall.call_number ?? linkedCall.id}</strong>
            {linkedCall.incident_type ? ` — ${linkedCall.incident_type}` : ''}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            No call linked — focus a Dispatch call window to auto-link
          </span>
        )}
        {linkedCall && (
          <button
            type="button"
            onClick={stampHeader}
            style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
          >
            Stamp header
          </button>
        )}
        <button
          type="button"
          onClick={() => void copyToClipboard(content)}
          disabled={!content}
          style={{ fontSize: 10, padding: '2px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
        >Copy</button>
        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          Wrap
        </label>
      </div>
      <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border-default)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find…"
          aria-label="Find in notes"
          style={{ flex: 1, fontSize: 11, padding: '3px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
        />
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
          {find.trim()
            ? `${content.toLowerCase().split(find.trim().toLowerCase()).length - 1} match(es)`
            : ''}
        </span>
      </div>

      {/* Editor */}
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={linkedCall ? 'Type evidence notes… auto-saved every 2 s.' : 'Type notes… link a call to save to the record.'}
        spellCheck
        style={{
          flex: 1, resize: 'none', border: 'none', outline: 'none',
          background: 'var(--surface-base)', color: 'var(--text-primary)',
          fontFamily: 'Arial, sans-serif', fontSize: 11, lineHeight: 1.6,
          padding: '10px 12px',
        }}
      />

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px', background: 'var(--surface-sunken)', borderTop: '1px solid var(--border-default)', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
          {content.length} chars · {content.split(/\s+/).filter(Boolean).length} words
        </span>
        {!linkedCall && (
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            Notes saved locally only until a call is linked
          </span>
        )}
      </div>
    </div>
  );
}
