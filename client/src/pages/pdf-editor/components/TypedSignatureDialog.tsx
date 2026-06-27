import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, Type as TypeIcon } from 'lucide-react';

// Typed-signature / initials / quick-sign generator.
//
// Distinct from SignaturePad (which is freehand-drawn). Here the operator
// TYPES a name; we render it to an offscreen canvas in a cursive script face
// and hand back a transparent PNG that drops onto the page through the exact
// same `pendingImage` → signature-tool flow the drawn pad already uses.
//
// Three modes:
//   - 'signature'  → full name in cursive (one placeable signature image)
//   - 'initials'   → initials only (compact placeable signature image)
//   - 'quicksign'  → full-name signature image PLUS a flag asking the caller to
//                    also drop today's date + the typed initials beside it, so
//                    a sign/date/initials block lands in one placement gesture.

export type TypedSignatureResult = {
  /** Transparent PNG data URL of the rendered cursive text. */
  dataUrl: string;
  /** Aspect ratio (w/h) of the rendered glyphs — lets the caller size the
   *  placed image so the script isn't stretched. */
  aspect: number;
  /** Set in quick-sign mode: caller should also place a date stamp + these
   *  initials next to the signature. */
  quickSign?: { dateText: string; initials: string };
};

interface Props {
  open: boolean;
  mode: 'signature' | 'initials' | 'quicksign';
  /** Pre-fill from the signed-in operator's name. */
  defaultName?: string;
  onClose: () => void;
  onConfirm: (r: TypedSignatureResult) => void;
}

// Self-contained cursive faces. We deliberately use web-safe script/serif
// stacks already present on Win/Mac (Toughbook fleet + dispatch desktops) so
// there's no new font asset / network dependency.
const FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'segoe', label: 'Script', stack: '"Segoe Script", "Bradley Hand", "Snell Roundhand", cursive' },
  { id: 'brush', label: 'Brush', stack: '"Brush Script MT", "Comic Sans MS", cursive' },
  { id: 'serif', label: 'Formal', stack: 'Georgia, "Times New Roman", serif' },
];

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(p => p[0]?.toUpperCase() ?? '').join('').slice(0, 4) || '—';
}

/** Render `text` in `fontStack` to a transparent PNG, trimmed to the ink. */
function renderToPng(text: string, fontStack: string, color: string): { dataUrl: string; aspect: number } {
  const fontPx = 96;
  const probe = document.createElement('canvas');
  const pctx = probe.getContext('2d')!;
  pctx.font = `${fontPx}px ${fontStack}`;
  const metrics = pctx.measureText(text);
  const w = Math.max(40, Math.ceil(metrics.width) + 40);
  const h = Math.ceil(fontPx * 1.7);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `${fontPx}px ${fontStack}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);
  return { dataUrl: c.toDataURL('image/png'), aspect: w / h };
}

export default function TypedSignatureDialog({ open, mode, defaultName, onClose, onConfirm }: Props) {
  const [name, setName] = useState('');
  const [fontId, setFontId] = useState('segoe');
  const [color, setColor] = useState('#0a0a0a');
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) setName(defaultName ?? ''); }, [open, defaultName]);

  const font = FONTS.find(f => f.id === fontId) ?? FONTS[0];
  const renderText = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return '';
    return mode === 'initials' ? initialsOf(trimmed) : trimmed;
  }, [name, mode]);

  if (!open) return null;

  const title = mode === 'initials' ? 'Type initials' : mode === 'quicksign' ? 'Quick-sign (signature + date + initials)' : 'Type signature';

  const confirm = () => {
    if (!renderText) return;
    const { dataUrl, aspect } = renderToPng(renderText, font.stack, color);
    if (mode === 'quicksign') {
      const dateText = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
      onConfirm({ dataUrl, aspect, quickSign: { dateText, initials: initialsOf(name.trim()) } });
    } else {
      onConfirm({ dataUrl, aspect });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-base border border-border-default rounded-[2px] p-4 max-w-[560px] w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-rmpg-100 inline-flex items-center gap-1.5"><TypeIcon className="w-4 h-4 text-[#d4a017]" /> {title}</h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-rmpg-100" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <p className="text-[10px] text-rmpg-500 mb-2">
          {mode === 'quicksign'
            ? 'Type your full name. We render a cursive signature; placing it drops your signature, today’s date, and your initials together as a sign-off block.'
            : mode === 'initials'
              ? 'Type your name — we render your initials in a script face as a placeable mark.'
              : 'Type your name — we render it in a cursive script face as a placeable signature (embedded as a transparent PNG).'}
        </p>

        <input id="ff-typedsig-name"
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirm(); }}
          placeholder="Full name"
          className="w-full bg-surface-sunken border border-border-default text-sm text-rmpg-100 px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017] mb-3"
        />

        <div className="flex items-center gap-2 mb-3">
          <label className="inline-flex items-center gap-1 text-[10px] text-rmpg-400">
            Style
            <select id="ff-typedsig-font" value={fontId} onChange={e => setFontId(e.target.value)}
              className="bg-surface-sunken border border-border-default text-[10px] text-rmpg-200 px-1.5 py-1 rounded-sm">
              {FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-1 text-[10px] text-rmpg-400">
            Ink
            <input id="ff-typedsig-color" type="color" aria-label="Signature ink color" value={color} onChange={e => setColor(e.target.value)}
              className="w-7 h-7 bg-transparent border border-border-default rounded-sm cursor-pointer" />
          </label>
        </div>

        <div ref={previewRef} className="bg-white border border-border-subtle rounded-sm h-[120px] flex items-center justify-center overflow-hidden mb-3">
          {renderText
            ? <span style={{ fontFamily: font.stack, fontSize: 54, color, lineHeight: 1, whiteSpace: 'nowrap' }}>{renderText}</span>
            : <span className="text-[11px] text-rmpg-400">Preview appears here</span>}
        </div>

        {mode === 'quicksign' && renderText && (
          <div className="text-[10px] text-rmpg-500 mb-3">
            Will place: <span className="text-rmpg-300">signature</span> + date{' '}
            <span className="text-rmpg-300">{new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })}</span>
            {' '}+ initials <span className="text-rmpg-300">{initialsOf(name.trim())}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={confirm} disabled={!renderText} className="btn-primary inline-flex items-center gap-1 disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> {mode === 'quicksign' ? 'Place sign-off' : 'Use'}
          </button>
        </div>
      </div>
    </div>
  );
}
