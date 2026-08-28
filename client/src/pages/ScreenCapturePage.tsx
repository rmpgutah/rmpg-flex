import React, { useState, useCallback, useRef } from 'react';
import { Camera, Clipboard, Save, Tag, Square, Trash2, Paperclip, AlertCircle } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { apiHttpBase } from '../utils/apiOrigin';
import { parseTimestamp } from '../utils/dateUtils';

// ─── Types ────────────────────────────────────────────────────

interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  editing: boolean;
}

interface BoxAnnotation {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RecentCapture {
  timestamp: string;
  thumbnail?: string;
  filename: string;
}

// ─── Constants ────────────────────────────────────────────────

const CAPTURES_KEY = 'rmpg_captures';
const MAX_RECENT = 5;
const ACTIVE_CALL_KEY = 'rmpg_active_call_id';

// ─── Helpers ─────────────────────────────────────────────────

function loadRecentCaptures(): RecentCapture[] {
  try {
    return JSON.parse(localStorage.getItem(CAPTURES_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveRecentCaptures(captures: RecentCapture[]): void {
  localStorage.setItem(CAPTURES_KEY, JSON.stringify(captures.slice(0, MAX_RECENT)));
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).electron !== 'undefined';
}

function buildFilename(): string {
  const now = new Date();
  return `rmpg-capture-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.png`;
}

function formatTimestamp(ts: string): string {
  try {
    return parseTimestamp(ts).toLocaleString('en-US', {
      timeZone: 'America/Denver',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return ts;
  }
}

// ─── Watermark overlay renderer ───────────────────────────────

function buildWatermarkText(): string {
  const officer = (() => {
    try {
      const raw = localStorage.getItem('rmpg_user');
      if (!raw) return 'OFFICER';
      const u = JSON.parse(raw);
      return (u?.name || u?.username || 'OFFICER').toUpperCase();
    } catch {
      return 'OFFICER';
    }
  })();
  const ts = new Date().toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  return `RMPG FLEX  |  ${officer}  |  ${ts}`;
}

// ─── Component ────────────────────────────────────────────────

export default function ScreenCapturePage() {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);
  const [boxAnnotations, setBoxAnnotations] = useState<BoxAnnotation[]>([]);
  const [activeTool, setActiveTool] = useState<'none' | 'text' | 'box'>('none');
  const [recentCaptures, setRecentCaptures] = useState<RecentCapture[]>(() => loadRecentCaptures());
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [statusType, setStatusType] = useState<'ok' | 'err' | 'info'>('info');
  const [capturing, setCapturing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [watermarkText] = useState(() => buildWatermarkText());

  // Box drawing state
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const [activeBox, setActiveBox] = useState<BoxAnnotation | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const activeCallId = localStorage.getItem(ACTIVE_CALL_KEY);

  // ── Flash status message ────────────────────────────────────

  function flash(msg: string, type: 'ok' | 'err' | 'info' = 'info') {
    setStatusMsg(msg);
    setStatusType(type);
    setTimeout(() => setStatusMsg(''), 4000);
  }

  // ── Capture ─────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (!isElectron()) return;
    setCapturing(true);
    try {
      const result = await (window as any).electron?.captureScreen?.();
      if (!result) {
        flash('Capture returned no data.', 'err');
        return;
      }
      const dataUrl = result.startsWith('data:') ? result : `data:image/png;base64,${result}`;
      setCapturedImage(dataUrl);
      setTextAnnotations([]);
      setBoxAnnotations([]);
      setActiveBox(null);
      setActiveTool('none');
      flash('Screenshot captured.', 'ok');
    } catch (err: any) {
      flash(`Capture failed: ${err?.message ?? 'unknown error'}`, 'err');
    } finally {
      setCapturing(false);
    }
  }, []);

  // ── Preview click / drag for annotations ────────────────────

  function getRelativePos(e: React.MouseEvent): { x: number; y: number } {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * 100 * 100) / 100,
      y: Math.round(((e.clientY - rect.top) / rect.height) * 100 * 100) / 100,
    };
  }

  function handlePreviewMouseDown(e: React.MouseEvent) {
    if (!capturedImage) return;
    if (activeTool === 'text') {
      const pos = getRelativePos(e);
      const id = `txt-${Date.now()}`;
      setTextAnnotations(prev => [...prev, { id, x: pos.x, y: pos.y, text: '', editing: true }]);
    } else if (activeTool === 'box') {
      const pos = getRelativePos(e);
      boxStartRef.current = pos;
      setActiveBox({ id: `box-${Date.now()}`, x: pos.x, y: pos.y, width: 0, height: 0 });
    }
  }

  function handlePreviewMouseMove(e: React.MouseEvent) {
    if (activeTool !== 'box' || !boxStartRef.current || !activeBox) return;
    const pos = getRelativePos(e);
    const x = Math.min(boxStartRef.current.x, pos.x);
    const y = Math.min(boxStartRef.current.y, pos.y);
    const width = Math.abs(pos.x - boxStartRef.current.x);
    const height = Math.abs(pos.y - boxStartRef.current.y);
    setActiveBox(prev => prev ? { ...prev, x, y, width, height } : null);
  }

  function handlePreviewMouseUp() {
    if (activeTool === 'box' && activeBox && activeBox.width > 1 && activeBox.height > 1) {
      setBoxAnnotations(prev => [...prev, activeBox]);
    }
    boxStartRef.current = null;
    setActiveBox(null);
  }

  function commitTextAnnotation(id: string, text: string) {
    if (!text.trim()) {
      setTextAnnotations(prev => prev.filter(a => a.id !== id));
      return;
    }
    setTextAnnotations(prev => prev.map(a => a.id === id ? { ...a, text, editing: false } : a));
  }

  function removeText(id: string) {
    setTextAnnotations(prev => prev.filter(a => a.id !== id));
  }

  function removeBox(id: string) {
    setBoxAnnotations(prev => prev.filter(a => a.id !== id));
  }

  // ── Save ────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!capturedImage) return;
    const el = (window as any).electron;
    // Guard: saveScreenshot must exist in the preload bridge. Without this check
    // the optional-chain returns undefined instead of throwing, so the code falls
    // through and reports "Saved" even though no file was written — a silent false
    // success with real evidence-chain implications.
    if (!el?.saveScreenshot) {
      flash('Save is not available in this version of the desktop app.', 'err');
      return;
    }
    const filename = buildFilename();
    try {
      await el.saveScreenshot(capturedImage, filename);
      const fresh: RecentCapture = { timestamp: new Date().toISOString(), filename };
      const updated = [fresh, ...recentCaptures].slice(0, MAX_RECENT);
      setRecentCaptures(updated);
      saveRecentCaptures(updated);
      flash(`Saved: ${filename}`, 'ok');
    } catch (err: any) {
      flash(`Save failed: ${err?.message ?? 'unknown'}`, 'err');
    }
  }, [capturedImage, recentCaptures]);

  // ── Copy to clipboard ───────────────────────────────────────

  const handleCopy = useCallback(async () => {
    if (!capturedImage) return;
    const el = (window as any).electron;
    // Same guard as handleSave: copyToClipboard is not in the current preload;
    // without the check the optional-chain silently returns undefined and the
    // flash reports "Copied to clipboard." when nothing was actually written.
    if (!el?.copyToClipboard) {
      flash('Clipboard copy is not available in this version of the desktop app.', 'err');
      return;
    }
    try {
      await el.copyToClipboard(capturedImage);
      flash('Copied to clipboard.', 'ok');
    } catch (err: any) {
      flash(`Copy failed: ${err?.message ?? 'unknown'}`, 'err');
    }
  }, [capturedImage]);

  // ── Attach to call ──────────────────────────────────────────

  const handleAttach = useCallback(async () => {
    if (!capturedImage || !activeCallId) return;
    setAttaching(true);
    try {
      const blob = await fetch(capturedImage).then(r => r.blob());
      const filename = buildFilename();
      const fd = new FormData();
      fd.append('photo', blob, filename);
      fd.append('source', 'screen_capture');
      fd.append('call_id', String(activeCallId));

      await fetch(`${apiHttpBase()}/api/field-photos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('rmpg_token') ?? ''}`,
        },
        body: fd,
      }).then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      });

      flash(`Attached to Call #${activeCallId}.`, 'ok');
    } catch (err: any) {
      flash(`Attach failed: ${err?.message ?? 'unknown'}`, 'err');
    } finally {
      setAttaching(false);
    }
  }, [capturedImage, activeCallId]);

  // ── Not in Electron ─────────────────────────────────────────

  if (!isElectron()) {
    return (
      <div className="p-4 space-y-4">
        <PanelTitleBar title="SCREEN CAPTURE" icon={Camera} />
        <div
          className="flex flex-col items-center justify-center gap-3 rounded"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
            padding: '3rem 2rem',
            color: 'var(--text-secondary)',
            borderRadius: 2,
          }}
        >
          <AlertCircle size={32} style={{ color: 'var(--sev-warn)' }} />
          <p style={{ fontSize: 13 }}>
            Screen capture is available in the <strong>FlexOS desktop app</strong>.
          </p>
        </div>
      </div>
    );
  }

  // ── Main layout ─────────────────────────────────────────────

  const toolBtn = (tool: 'text' | 'box', label: string, Icon: React.ElementType) => (
    <button
      onClick={() => setActiveTool(prev => prev === tool ? 'none' : tool)}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 11,
        borderRadius: 2,
        border: '1px solid',
        cursor: 'pointer',
        borderColor: activeTool === tool ? 'var(--accent-silver-400)' : 'var(--border-subtle)',
        background: activeTool === tool ? 'var(--surface-sunken)' : 'var(--surface-base)',
        color: activeTool === tool ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      <Icon size={13} />
      {label}
    </button>
  );

  const actionBtn = (label: string, Icon: React.ElementType, onClick: () => void, disabled?: boolean) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        fontSize: 11,
        borderRadius: 2,
        border: '1px solid var(--border-subtle)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? 'var(--surface-sunken)' : 'var(--surface-raised)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={13} />
      {label}
    </button>
  );

  return (
    <div className="p-4 space-y-3" style={{ userSelect: activeTool !== 'none' ? 'none' : undefined }}>
      <PanelTitleBar title="SCREEN CAPTURE" icon={Camera} />

      {/* Toolbar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'center',
        padding: '6px 8px',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 2,
      }}>
        {/* Capture */}
        <button
          onClick={handleCapture}
          disabled={capturing}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 12px', fontSize: 11, borderRadius: 2,
            border: '1px solid var(--accent-silver-500)',
            background: 'var(--surface-sunken)',
            color: 'var(--text-primary)',
            cursor: capturing ? 'wait' : 'pointer',
            fontWeight: 600,
          }}
        >
          <Camera size={13} />
          {capturing ? 'Capturing…' : 'Capture Screen'}
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--border-subtle)', margin: '0 2px' }} />

        {/* Annotation tools */}
        {toolBtn('text', 'Add Label', Tag)}
        {toolBtn('box', 'Draw Box', Square)}

        {capturedImage && (textAnnotations.length > 0 || boxAnnotations.length > 0) && (
          <button
            onClick={() => { setTextAnnotations([]); setBoxAnnotations([]); }}
            title="Clear all annotations"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 8px', fontSize: 11, borderRadius: 2,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--sev-critical)',
              cursor: 'pointer',
            }}
          >
            <Trash2 size={12} /> Clear
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Actions */}
        {actionBtn('Copy', Clipboard, handleCopy, !capturedImage)}
        {actionBtn('Save', Save, handleSave, !capturedImage)}
        {activeCallId && actionBtn(
          attaching ? 'Attaching…' : `Attach to Call #${activeCallId}`,
          Paperclip,
          handleAttach,
          !capturedImage || attaching,
        )}
      </div>

      {/* Status */}
      {statusMsg && (
        <div style={{
          fontSize: 11, padding: '4px 10px', borderRadius: 2,
          background: statusType === 'ok' ? 'var(--sev-ok-bg, rgba(34,197,94,0.12))' :
            statusType === 'err' ? 'rgba(239,68,68,0.12)' : 'var(--surface-raised)',
          color: statusType === 'ok' ? 'var(--sev-ok, var(--sev-ok))' :
            statusType === 'err' ? 'var(--sev-critical)' : 'var(--text-secondary)',
          border: '1px solid',
          borderColor: statusType === 'ok' ? 'rgba(34,197,94,0.3)' :
            statusType === 'err' ? 'rgba(239,68,68,0.3)' : 'var(--border-subtle)',
        }}>
          {statusMsg}
        </div>
      )}

      {/* Tool hint */}
      {activeTool !== 'none' && (
        <div style={{
          fontSize: 11, padding: '3px 8px', borderRadius: 2,
          background: 'var(--surface-sunken)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)',
        }}>
          {activeTool === 'text' ? 'Click on the image to place a text label.' : 'Click and drag on the image to draw a red box.'}
          {' '}Press <kbd style={{ fontSize: 10, padding: '1px 4px', background: 'var(--surface-raised)', borderRadius: 2, border: '1px solid var(--border-subtle)' }}>Esc</kbd> to cancel.
        </div>
      )}

      {/* Preview area */}
      <div
        style={{
          position: 'relative',
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 2,
          minHeight: 320,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: activeTool === 'text' ? 'crosshair' : activeTool === 'box' ? 'crosshair' : 'default',
        }}
        ref={previewRef}
        onMouseDown={handlePreviewMouseDown}
        onMouseMove={handlePreviewMouseMove}
        onMouseUp={handlePreviewMouseUp}
        onKeyDown={e => { if (e.key === 'Escape') { setActiveTool('none'); setActiveBox(null); boxStartRef.current = null; } }}
        tabIndex={0}
      >
        {capturedImage ? (
          <>
            {/* Screenshot */}
            <img
              src={capturedImage}
              alt="Screen capture"
              draggable={false}
              style={{ display: 'block', maxWidth: '100%', maxHeight: 520, objectFit: 'contain', pointerEvents: 'none' }}
            />

            {/* Text annotations */}
            {textAnnotations.map(ann => (
              <div
                key={ann.id}
                style={{
                  position: 'absolute',
                  left: `${ann.x}%`,
                  top: `${ann.y}%`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 10,
                }}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
              >
                {ann.editing ? (
                  <input
                    autoFocus
                    defaultValue={ann.text}
                    placeholder="Label text…"
                    onBlur={e => commitTextAnnotation(ann.id, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitTextAnnotation(ann.id, (e.target as HTMLInputElement).value);
                      if (e.key === 'Escape') removeText(ann.id);
                    }}
                    style={{
                      fontSize: 11, padding: '2px 6px', borderRadius: 2,
                      border: '1px solid var(--accent-silver-400)',
                      background: 'rgba(0 0 0 / 0.75)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      minWidth: 100,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      background: 'rgba(0 0 0 / 0.72)',
                      color: 'var(--text-primary)',
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 2,
                      border: '1px solid rgba(255,255,255,0.25)',
                      whiteSpace: 'nowrap',
                      cursor: 'default',
                    }}
                    onDoubleClick={() => setTextAnnotations(prev => prev.map(a => a.id === ann.id ? { ...a, editing: true } : a))}
                  >
                    {ann.text}
                    <button
                      onClick={e => { e.stopPropagation(); removeText(ann.id); }}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 12 }}
                      title="Remove label"
                    >×</button>
                  </div>
                )}
              </div>
            ))}

            {/* Box annotations */}
            {boxAnnotations.map(box => (
              <div
                key={box.id}
                style={{
                  position: 'absolute',
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                  border: '2px solid var(--sev-critical)',
                  borderRadius: 1,
                  pointerEvents: 'none',
                  zIndex: 9,
                }}
              >
                <button
                  onClick={e => { e.stopPropagation(); removeBox(box.id); }}
                  style={{
                    position: 'absolute', top: -10, right: -10,
                    width: 16, height: 16,
                    borderRadius: '50%',
                    background: 'var(--sev-critical)',
                    color: '#fff',
                    border: 'none',
                    fontSize: 10,
                    lineHeight: '16px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    pointerEvents: 'all',
                    padding: 0,
                  }}
                  title="Remove box"
                >×</button>
              </div>
            ))}

            {/* Active box being drawn */}
            {activeBox && activeBox.width > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: `${activeBox.x}%`,
                  top: `${activeBox.y}%`,
                  width: `${activeBox.width}%`,
                  height: `${activeBox.height}%`,
                  border: '2px dashed var(--sev-critical)',
                  borderRadius: 1,
                  pointerEvents: 'none',
                  zIndex: 11,
                }}
              />
            )}

            {/* Watermark */}
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                fontSize: 10,
                padding: '2px 6px',
                background: 'rgba(0 0 0 / 0.6)',
                color: 'rgba(255,255,255,0.85)',
                borderRadius: 1,
                pointerEvents: 'none',
                letterSpacing: '0.04em',
                fontFamily: 'monospace',
              }}
            >
              {watermarkText}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            <Camera size={32} style={{ opacity: 0.3, marginBottom: 8, display: 'block', margin: '0 auto 8px' }} />
            Click <strong>Capture Screen</strong> to take a screenshot.
          </div>
        )}
      </div>

      {/* Recent captures */}
      {recentCaptures.length > 0 && (
        <div style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 2,
          padding: '8px 10px',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
            Recent Captures
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {recentCaptures.map((cap, i) => (
              <div
                key={i}
                title={cap.filename}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  cursor: 'default',
                }}
              >
                {cap.thumbnail ? (
                  <img
                    src={cap.thumbnail}
                    alt={cap.filename}
                    style={{
                      width: 72, height: 48,
                      objectFit: 'cover',
                      borderRadius: 2,
                      border: '1px solid var(--border-subtle)',
                    }}
                  />
                ) : (
                  <div style={{
                    width: 72, height: 48,
                    background: 'var(--surface-sunken)',
                    borderRadius: 2,
                    border: '1px solid var(--border-subtle)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Camera size={16} style={{ color: 'var(--text-muted)' }} />
                  </div>
                )}
                <span style={{ fontSize: 9, color: 'var(--text-secondary)', maxWidth: 72, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {formatTimestamp(cap.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
