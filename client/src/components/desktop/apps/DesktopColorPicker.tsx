import React, { useState, useEffect, useCallback } from 'react';
import { X, Pipette, Copy, Clock } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { colorHistoryToCsv, downloadTextFile } from '../../../utils/rmsListExport';

const W = 320;
const H = 440;
const HISTORY_KEY = 'rmpg_color_picker_history';
const MAX_HISTORY = 12;

interface DesktopColorPickerProps {
  onClose: () => void;
}

interface ColorValues {
  hex: string;
  rgb: string;
  hsl: string;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function buildColorValues(hex: string): ColorValues | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const [h, s, l] = rgbToHsl(r, g, b);
  const clean = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  return {
    hex: clean,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${h}, ${s}%, ${l}%)`,
  };
}

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); } catch { return []; }
}
function saveHistory(h: string[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY)));
}

function copyText(text: string) {
  const api = (window as unknown as Record<string, unknown>).electron as { setClipboardText?: (t: string) => void } | undefined;
  if (api?.setClipboardText) { api.setClipboardText(text); }
  else { navigator.clipboard.writeText(text).catch(() => {}); }
}

export default function DesktopColorPicker({ onClose }: DesktopColorPickerProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [color, setColor] = useState<ColorValues | null>(null);
  const [manualHex, setManualHex] = useState('#3b82f6');
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const hasEyeDropper = typeof (window as unknown as Record<string, unknown>).EyeDropper === 'function';

  const applyColor = useCallback((hex: string) => {
    const cv = buildColorValues(hex);
    if (!cv) return;
    setColor(cv);
    setManualHex(cv.hex);
    setHistory(prev => {
      const next = [cv.hex, ...prev.filter(h => h !== cv.hex)].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const initial = buildColorValues(manualHex);
    if (initial) setColor(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFromScreen = useCallback(async () => {
    if (!hasEyeDropper) return;
    try {
      const picker = new ((window as unknown as Record<string, unknown>).EyeDropper as new () => { open: () => Promise<{ sRGBHex: string }> })();
      const result = await picker.open();
      if (result?.sRGBHex) applyColor(result.sRGBHex);
    } catch {
      // User cancelled or error — no action needed
    }
  }, [hasEyeDropper, applyColor]);

  const handleManualChange = useCallback((hex: string) => {
    setManualHex(hex);
    const cv = buildColorValues(hex);
    if (cv) setColor(cv);
  }, []);

  const handleCopy = useCallback((key: string, value: string) => {
    copyText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  }, []);

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
  const labelStyle: React.CSSProperties = { fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase', width: 32, flexShrink: 0 };
  const valueStyle: React.CSSProperties = { flex: 1, fontSize: 12, fontFamily: 'monospace', color: 'var(--text-primary)', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: '3px 8px' };

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px rgba(0 0 0 / 0.45)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}>
        <Pipette size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>Color Picker</span>
        <button aria-label="Close Color Picker" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Swatch */}
        <div style={{ height: 80, borderRadius: 2, border: '1px solid var(--border-subtle)', background: color?.hex ?? '#3b82f6', transition: 'background 150ms' }} />

        {/* Pick button or color input */}
        {hasEyeDropper ? (
          <button
            onClick={pickFromScreen}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 14px', background: 'var(--brand-600, #1e4d7a)', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer', justifyContent: 'center' }}
          >
            <Pipette size={14} /> Pick from screen
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={color?.hex?.toLowerCase() ?? '#3b82f6'}
              onChange={e => applyColor(e.target.value)}
              style={{ width: 44, height: 36, border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', padding: 2, background: 'var(--surface-sunken)' }}
              title="Color picker"
            />
            <input
              type="text"
              value={manualHex}
              onChange={e => handleManualChange(e.target.value)}
              placeholder="#3b82f6"
              style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', padding: '5px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none' }}
            />
          </div>
        )}

        {/* Manual input when eyedropper available */}
        {hasEyeDropper && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="color"
              value={color?.hex?.toLowerCase() ?? '#3b82f6'}
              onChange={e => applyColor(e.target.value)}
              style={{ width: 36, height: 30, border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', padding: 2, background: 'var(--surface-sunken)', flexShrink: 0 }}
              title="Manual color input"
            />
            <input
              type="text"
              value={manualHex}
              onChange={e => handleManualChange(e.target.value)}
              placeholder="#3b82f6"
              style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', padding: '4px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none' }}
            />
          </div>
        )}

        {/* Color values */}
        {color && (
          <div>
            {([['HEX', color.hex], ['RGB', color.rgb], ['HSL', color.hsl]] as [string, string][]).map(([key, val]) => (
              <div key={key} style={rowStyle}>
                <span style={labelStyle}>{key}</span>
                <span style={valueStyle}>{val}</span>
                <button
                  aria-label={`Copy ${key} value`}
                  onClick={() => handleCopy(key, val)}
                  style={{ padding: 5, background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: copiedKey === key ? 'var(--brand-400)' : 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                >
                  <Copy size={11} />
                </button>
              </div>
            ))}
            {color && (
              <button
                type="button"
                onClick={() => handleCopy('ALL', `${color.hex} ${color.rgb} ${color.hsl}`)}
                style={{ marginTop: 6, fontSize: 10, padding: '4px 8px', border: '1px solid var(--border-subtle)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
              >Copy all</button>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              <Clock size={10} style={{ color: 'var(--field-label-color)' }} />
              <span style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>History</span>
              <button
                type="button"
                onClick={() => downloadTextFile('color-history.csv', colorHistoryToCsv(history))}
                style={{ marginLeft: 'auto', fontSize: 9, border: '1px solid var(--border-subtle)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >CSV</button>
              <button
                type="button"
                onClick={() => { setHistory([]); saveHistory([]); }}
                style={{ fontSize: 9, border: '1px solid var(--border-subtle)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >Clear</button>
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {history.map(hex => (
                <button
                  key={hex}
                  aria-label={`Use color ${hex}`}
                  onClick={() => applyColor(hex)}
                  title={hex}
                  style={{
                    width: 22, height: 22, background: hex, borderRadius: 2,
                    border: color?.hex === hex ? '2px solid var(--text-primary)' : '1px solid var(--border-subtle)',
                    cursor: 'pointer', flexShrink: 0, padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
