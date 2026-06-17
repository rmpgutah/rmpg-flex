import { useEffect, useMemo, useRef, useState } from 'react';
import { Stamp, X, Upload, Sparkles, Check, Save, AlertTriangle, RotateCcw } from 'lucide-react';
import { addCustomStamp, type CustomStamp } from './CustomStampsGallery';

// ============================================================
// Stamp Studio — author transparent-PNG stamps two ways:
//
//  1. BACKGROUND REMOVAL — upload a PNG/JPG, knock out the white/light
//     background to transparency via a luminance threshold (with a soft
//     edge band so antialiased borders don't leave a halo). Before/after
//     preview over a transparency checkerboard.
//
//  2. TEMPLATES — generate a stamp from a parameterised design rendered to
//     a transparent canvas: round notary seal, approval/denied/pending,
//     classic text stamps (COPY/ORIGINAL/DRAFT/CONFIDENTIAL/VOID), officer
//     badge, date stamp, and the RMPG company seal.
//
// Output of both is a transparent PNG data URL that can be (a) saved to the
// personal stamp library (shared localStorage with CustomStampsGallery) or
// (b) dropped straight onto the current page via onUse().
// ============================================================

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB source cap (pre-processing)
const STAMP_OUTPUT_MAX_BYTES = 512 * 1024; // keep library entries localStorage-healthy

type StudioTab = 'templates' | 'background';
type TemplateKind = 'notary' | 'approval' | 'text' | 'badge' | 'date' | 'rmpg';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Drop the finished stamp onto the current page immediately. */
  onUse: (dataUrl: string, name: string) => void;
  /** Notify the parent that the library changed (so the gallery can refresh). */
  onSaved?: () => void;
  /** Default officer name / badge to pre-fill the officer-oriented templates. */
  officerName?: string;
  badgeNumber?: string;
}

// ─── Canvas helpers ─────────────────────────────────────────
function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Draw text along a circular arc, centered on `midAngle` (radians, 0 = +x).
 *  Positive `dir` lays characters clockwise; negative anticlockwise (used for
 *  bottom arcs so they read left-to-right). */
function arcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  midAngle: number,
  dir: 1 | -1,
  font: string,
  color: string,
) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  // angular span of the whole string at this radius
  const span = total / radius;
  let angle = midAngle - (dir * span) / 2;
  for (let i = 0; i < text.length; i++) {
    const chSpan = widths[i] / radius;
    const a = angle + (dir * chSpan) / 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    ctx.save();
    ctx.translate(x, y);
    // tangent orientation; bottom arc (dir -1) flips so glyphs aren't upside down
    ctx.rotate(a + (dir === 1 ? Math.PI / 2 : -Math.PI / 2));
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
    angle += dir * chSpan;
  }
  ctx.restore();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── Background removal ─────────────────────────────────────
/** Knock out light backgrounds to transparency. Pixels brighter than
 *  `threshold` become fully transparent; a `soft`-wide band just below it
 *  ramps alpha so antialiased edges don't leave a hard ring. */
function removeBackground(src: HTMLCanvasElement, threshold: number, soft: number): HTMLCanvasElement {
  const out = newCanvas(src.width, src.height);
  const sctx = src.getContext('2d')!;
  const octx = out.getContext('2d')!;
  const img = sctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  const lo = Math.max(0, threshold - soft);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum >= threshold) {
      d[i + 3] = 0;
    } else if (lum > lo && soft > 0) {
      // linear ramp from opaque (at lo) to transparent (at threshold)
      const keep = 1 - (lum - lo) / (threshold - lo);
      d[i + 3] = Math.round(d[i + 3] * keep);
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Could not decode image'));
    im.src = dataUrl;
  });
  // Cap working resolution so processing stays fast and the output PNG stays small.
  const MAX_DIM = 900;
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const c = newCanvas(Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ─── Template renderers (all draw on a transparent canvas) ──
interface TemplateState {
  ink: string;
  notaryName: string; notaryState: string; notaryCommission: string; notaryExpires: string;
  decision: 'APPROVED' | 'DENIED' | 'PENDING'; approvalDate: string; approvalOfficer: string;
  textWord: string;
  badgeOfficer: string; badgeNumber: string;
  dateValue: string; dateLabel: string;
}

const DECISION_COLOR: Record<TemplateState['decision'], string> = {
  APPROVED: '#1f8b4c', DENIED: '#c0392b', PENDING: '#c77d0a',
};
const TEXT_WORDS = ['COPY', 'ORIGINAL', 'DRAFT', 'CONFIDENTIAL', 'VOID'];

function renderTemplate(kind: TemplateKind, s: TemplateState): HTMLCanvasElement {
  switch (kind) {
    case 'notary': return renderNotary(s);
    case 'rmpg': return renderRmpgSeal(s);
    case 'approval': return renderApproval(s);
    case 'text': return renderTextStamp(s);
    case 'badge': return renderBadge(s);
    case 'date': return renderDateStamp(s);
  }
}

function renderRoundSeal(opts: {
  ink: string; topArc: string; bottomArc: string;
  centerLines: string[]; innerNote?: string;
}): HTMLCanvasElement {
  const S = 360;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d')!;
  const cx = S / 2, cy = S / 2;
  ctx.strokeStyle = opts.ink;
  ctx.fillStyle = opts.ink;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, 168, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 150, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 96, 0, Math.PI * 2); ctx.stroke();
  arcText(ctx, opts.topArc.toUpperCase(), cx, cy, 130, -Math.PI / 2, 1, 'bold 19px Georgia, serif', opts.ink);
  if (opts.bottomArc) arcText(ctx, opts.bottomArc.toUpperCase(), cx, cy, 130, Math.PI / 2, -1, 'bold 16px Georgia, serif', opts.ink);
  // side stars
  ctx.font = '18px Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', cx - 138, cy);
  ctx.fillText('★', cx + 138, cy);
  // center stack
  ctx.font = 'bold 18px Georgia, serif';
  const lines = opts.centerLines.filter(Boolean);
  const lh = 22;
  let y = cy - ((lines.length - 1) * lh) / 2;
  for (const ln of lines) { ctx.fillText(ln, cx, y); y += lh; }
  if (opts.innerNote) {
    ctx.font = 'italic 11px Georgia, serif';
    ctx.fillText(opts.innerNote, cx, cy + 78);
  }
  return c;
}

function renderNotary(s: TemplateState): HTMLCanvasElement {
  return renderRoundSeal({
    ink: s.ink,
    topArc: s.notaryName || 'NOTARY PUBLIC',
    bottomArc: `STATE OF ${(s.notaryState || 'UTAH').toUpperCase()}`,
    centerLines: ['NOTARY', 'PUBLIC', s.notaryCommission ? `Comm# ${s.notaryCommission}` : ''],
    innerNote: s.notaryExpires ? `Expires ${s.notaryExpires}` : undefined,
  });
}

function renderRmpgSeal(s: TemplateState): HTMLCanvasElement {
  return renderRoundSeal({
    ink: s.ink,
    topArc: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    bottomArc: 'SALT LAKE CITY · UTAH',
    centerLines: ['RMPG', 'OFFICIAL'],
    innerNote: 'SEAL',
  });
}

function renderApproval(s: TemplateState): HTMLCanvasElement {
  const W = 420, H = 190;
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d')!;
  const color = DECISION_COLOR[s.decision];
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 5; roundRectPath(ctx, 10, 10, W - 20, H - 20, 8); ctx.stroke();
  ctx.lineWidth = 2; roundRectPath(ctx, 20, 20, W - 40, H - 40, 6); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 52px Arial, sans-serif';
  ctx.fillText(s.decision, W / 2, 66);
  ctx.font = '17px Arial, sans-serif';
  ctx.fillText(`Date: ${s.approvalDate || '____________'}`, W / 2, 120);
  ctx.fillText(`By: ${s.approvalOfficer || '____________'}`, W / 2, 150);
  return c;
}

function renderTextStamp(s: TemplateState): HTMLCanvasElement {
  const word = (s.textWord || 'COPY').toUpperCase();
  const c = newCanvas(440, 140);
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = s.ink; ctx.fillStyle = s.ink;
  ctx.lineWidth = 5; roundRectPath(ctx, 8, 8, c.width - 16, c.height - 16, 10); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // shrink font to fit long words like CONFIDENTIAL
  let size = 64;
  ctx.font = `bold ${size}px Arial, sans-serif`;
  while (ctx.measureText(word).width > c.width - 56 && size > 20) {
    size -= 2; ctx.font = `bold ${size}px Arial, sans-serif`;
  }
  ctx.fillText(word, c.width / 2, c.height / 2 + 2);
  return c;
}

function renderBadge(s: TemplateState): HTMLCanvasElement {
  const W = 440, H = 150;
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = s.ink; ctx.fillStyle = s.ink;
  ctx.lineWidth = 4; roundRectPath(ctx, 8, 8, W - 16, H - 16, 12); ctx.stroke();
  // star badge glyph on the left
  ctx.font = '52px Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', 64, H / 2);
  ctx.beginPath(); ctx.moveTo(112, 24); ctx.lineTo(112, H - 24); ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = 'left';
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText((s.badgeOfficer || 'OFFICER NAME').toUpperCase(), 132, H / 2 - 16);
  ctx.font = '20px Arial, sans-serif';
  ctx.fillText(`Badge #${s.badgeNumber || '0000'}`, 132, H / 2 + 18);
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('ROCKY MOUNTAIN PROTECTIVE GROUP', 132, H - 26);
  return c;
}

function renderDateStamp(s: TemplateState): HTMLCanvasElement {
  const W = 360, H = 120;
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = s.ink; ctx.fillStyle = s.ink;
  ctx.lineWidth = 4; roundRectPath(ctx, 8, 8, W - 16, H - 16, 8); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '15px Arial, sans-serif';
  ctx.fillText((s.dateLabel || 'RECEIVED').toUpperCase(), W / 2, 38);
  ctx.font = 'bold 36px "Courier New", monospace';
  ctx.fillText(s.dateValue || new Date().toISOString().slice(0, 10), W / 2, 76);
  return c;
}

// ─── Transparency-checkerboard preview wrapper ──────────────
const CHECKER =
  'repeating-conic-gradient(#cfcfcf 0% 25%, #ffffff 0% 50%) 50% / 16px 16px';

function trimDataUrl(canvas: HTMLCanvasElement): string {
  // PNG keeps alpha; if it's too big, fall back to a smaller re-render.
  let url = canvas.toDataURL('image/png');
  if (url.length * 0.75 > STAMP_OUTPUT_MAX_BYTES) {
    const scaled = newCanvas(Math.round(canvas.width * 0.7), Math.round(canvas.height * 0.7));
    scaled.getContext('2d')!.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    url = scaled.toDataURL('image/png');
  }
  return url;
}

export default function StampStudio({ open, onClose, onUse, onSaved, officerName, badgeNumber }: Props) {
  const [tab, setTab] = useState<StudioTab>('templates');
  const [kind, setKind] = useState<TemplateKind>('notary');
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Background-removal state
  const [srcCanvas, setSrcCanvas] = useState<HTMLCanvasElement | null>(null);
  const [threshold, setThreshold] = useState(238);
  const [soft, setSoft] = useState(18);

  // Template state
  const [tpl, setTpl] = useState<TemplateState>({
    ink: '#c0392b',
    notaryName: 'NOTARY PUBLIC', notaryState: 'Utah', notaryCommission: '', notaryExpires: '',
    decision: 'APPROVED', approvalDate: new Date().toISOString().slice(0, 10), approvalOfficer: officerName || '',
    textWord: 'COPY',
    badgeOfficer: officerName || '', badgeNumber: badgeNumber || '',
    dateValue: new Date().toISOString().slice(0, 10), dateLabel: 'RECEIVED',
  });

  const previewRef = useRef<HTMLCanvasElement | null>(null);

  // The canvas the current tab would output (template render OR processed upload).
  const outputCanvas = useMemo<HTMLCanvasElement | null>(() => {
    if (tab === 'templates') return renderTemplate(kind, tpl);
    if (tab === 'background' && srcCanvas) return removeBackground(srcCanvas, threshold, soft);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, kind, tpl, srcCanvas, threshold, soft]);

  // Paint the output canvas into the visible preview element.
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !outputCanvas) return;
    el.width = outputCanvas.width; el.height = outputCanvas.height;
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(outputCanvas, 0, 0);
  }, [outputCanvas]);

  useEffect(() => { if (!open) { setError(null); setSavedMsg(null); } }, [open]);

  if (!open) return null;

  const stampName = (): string => {
    if (tab === 'background') return 'Cutout stamp';
    switch (kind) {
      case 'notary': return `Notary — ${tpl.notaryName || 'seal'}`;
      case 'rmpg': return 'RMPG seal';
      case 'approval': return `${tpl.decision} stamp`;
      case 'text': return `${tpl.textWord} stamp`;
      case 'badge': return `Badge — ${tpl.badgeOfficer || 'officer'}`;
      case 'date': return `Date — ${tpl.dateValue}`;
    }
  };

  const handleUpload = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) { setError('Upload a PNG or JPEG image.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError(`Image too large (${Math.round(file.size / 1024)} KB). Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`); return; }
    try { setSrcCanvas(await fileToCanvas(file)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load image'); }
  };

  const finish = (mode: 'use' | 'save') => {
    if (!outputCanvas) { setError('Nothing to export yet.'); return; }
    const dataUrl = trimDataUrl(outputCanvas);
    const name = stampName();
    if (mode === 'use') { onUse(dataUrl, name); onClose(); return; }
    const stamp: CustomStamp = {
      id: Math.random().toString(36).slice(2, 12),
      name,
      imageData: dataUrl,
      width: outputCanvas.width,
      height: outputCanvas.height,
      createdAt: Date.now(),
    };
    addCustomStamp(stamp);
    onSaved?.();
    setSavedMsg(`Saved “${name}” to your stamp library.`);
    window.setTimeout(() => setSavedMsg(null), 3000);
  };

  const field = 'w-full bg-[#0d0d0d] border border-[#222] rounded-[2px] px-2 py-1 text-[11px] text-rmpg-100 focus:outline-none focus:border-[#d4a017]';
  const lbl = 'block text-[9px] uppercase tracking-wider text-rmpg-500 mb-0.5';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141414] border border-[#222] rounded-[2px] w-full max-w-[860px] max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header + tabs */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#222]">
          <h3 className="text-sm font-semibold text-rmpg-100 inline-flex items-center gap-2">
            <Stamp className="w-4 h-4 text-[#d4a017]" /> Stamp Studio
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-rmpg-100" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex border-b border-[#222]">
          {(['templates', 'background'] as StudioTab[]).map((t) => (
            <button key={t} type="button" onClick={() => { setTab(t); setError(null); }}
              className="px-4 py-2 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: tab === t ? '#d4a017' : '#888', borderBottom: tab === t ? '2px solid #d4a017' : '2px solid transparent' }}>
              {t === 'templates' ? 'Templates' : 'Background removal'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ── Controls ── */}
          <div className="space-y-3">
            {error && (
              <div className="bg-red-900/20 border border-red-700/40 text-red-200 text-[11px] px-3 py-1.5 rounded-sm flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5" /> <div>{error}</div>
              </div>
            )}

            {tab === 'templates' ? (
              <>
                <div>
                  <span className={lbl}>Template</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      ['notary', 'Notary seal'], ['approval', 'Approval'], ['text', 'Text'],
                      ['badge', 'Badge'], ['date', 'Date'], ['rmpg', 'RMPG seal'],
                    ] as [TemplateKind, string][]).map(([k, label]) => (
                      <button key={k} type="button" onClick={() => setKind(k)}
                        className="py-1.5 rounded-[2px] text-[10px] border"
                        style={{
                          borderColor: kind === k ? '#d4a017' : '#222',
                          color: kind === k ? '#d4a017' : '#aaa',
                          background: kind === k ? 'rgba(212,160,23,0.08)' : '#0d0d0d',
                        }}>{label}</button>
                    ))}
                  </div>
                </div>

                {/* Ink color (templates that aren't decision-colored) */}
                {kind !== 'approval' && (
                  <div>
                    <span className={lbl}>Ink color</span>
                    <div className="flex items-center gap-2">
                      <input id="ff-stampstudio-ink" type="color" value={tpl.ink}
                        onChange={(e) => setTpl({ ...tpl, ink: e.target.value })}
                        className="w-8 h-7 bg-transparent border border-[#222] rounded-[2px] cursor-pointer" />
                      {['#c0392b', '#111111', '#1a3a5c', '#d4a017', '#1f8b4c'].map((c) => (
                        <button key={c} type="button" aria-label={`Ink ${c}`} onClick={() => setTpl({ ...tpl, ink: c })}
                          className="w-5 h-5 rounded-full border border-[#333]" style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                )}

                {kind === 'notary' && (
                  <>
                    <div><span className={lbl}>Notary name</span><input id="ff-ss-nn" className={field} value={tpl.notaryName} onChange={(e) => setTpl({ ...tpl, notaryName: e.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><span className={lbl}>State</span><input id="ff-ss-nst" className={field} value={tpl.notaryState} onChange={(e) => setTpl({ ...tpl, notaryState: e.target.value })} /></div>
                      <div><span className={lbl}>Commission #</span><input id="ff-ss-nc" className={field} value={tpl.notaryCommission} onChange={(e) => setTpl({ ...tpl, notaryCommission: e.target.value })} /></div>
                    </div>
                    <div><span className={lbl}>Expiration</span><input id="ff-ss-nex" className={field} placeholder="MM/DD/YYYY" value={tpl.notaryExpires} onChange={(e) => setTpl({ ...tpl, notaryExpires: e.target.value })} /></div>
                  </>
                )}

                {kind === 'approval' && (
                  <>
                    <div>
                      <span className={lbl}>Decision</span>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['APPROVED', 'DENIED', 'PENDING'] as const).map((d) => (
                          <button key={d} type="button" onClick={() => setTpl({ ...tpl, decision: d })}
                            className="py-1.5 rounded-[2px] text-[10px] font-bold border"
                            style={{ borderColor: tpl.decision === d ? DECISION_COLOR[d] : '#222', color: tpl.decision === d ? DECISION_COLOR[d] : '#888', background: '#0d0d0d' }}>{d}</button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><span className={lbl}>Date</span><input id="ff-ss-ad" className={field} value={tpl.approvalDate} onChange={(e) => setTpl({ ...tpl, approvalDate: e.target.value })} /></div>
                      <div><span className={lbl}>Officer / by</span><input id="ff-ss-ao" className={field} value={tpl.approvalOfficer} onChange={(e) => setTpl({ ...tpl, approvalOfficer: e.target.value })} /></div>
                    </div>
                  </>
                )}

                {kind === 'text' && (
                  <div>
                    <span className={lbl}>Word</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {TEXT_WORDS.map((w) => (
                        <button key={w} type="button" onClick={() => setTpl({ ...tpl, textWord: w })}
                          className="py-1.5 rounded-[2px] text-[10px] font-bold border"
                          style={{ borderColor: tpl.textWord === w ? '#d4a017' : '#222', color: tpl.textWord === w ? '#d4a017' : '#888', background: '#0d0d0d' }}>{w}</button>
                      ))}
                    </div>
                  </div>
                )}

                {kind === 'badge' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className={lbl}>Officer name</span><input id="ff-ss-bo" className={field} value={tpl.badgeOfficer} onChange={(e) => setTpl({ ...tpl, badgeOfficer: e.target.value })} /></div>
                    <div><span className={lbl}>Badge #</span><input id="ff-ss-bn" className={field} value={tpl.badgeNumber} onChange={(e) => setTpl({ ...tpl, badgeNumber: e.target.value })} /></div>
                  </div>
                )}

                {kind === 'date' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className={lbl}>Label</span><input id="ff-ss-dl" className={field} value={tpl.dateLabel} onChange={(e) => setTpl({ ...tpl, dateLabel: e.target.value })} /></div>
                    <div><span className={lbl}>Date</span><input id="ff-ss-dv" className={field} value={tpl.dateValue} onChange={(e) => setTpl({ ...tpl, dateValue: e.target.value })} /></div>
                  </div>
                )}
              </>
            ) : (
              <>
                <input id="ff-stampstudio-upload" ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary inline-flex items-center gap-1.5 text-[11px]">
                  <Upload className="w-3.5 h-3.5" /> {srcCanvas ? 'Replace image' : 'Upload PNG / JPEG'}
                </button>
                {!srcCanvas && (
                  <div className="bg-[#0d0d0d] border border-[#222] rounded-sm p-4 text-[10px] text-rmpg-500">
                    Upload a signature, logo, or stamp photographed on white paper. The studio knocks out the light background so it drops cleanly onto a page.
                  </div>
                )}
                {srcCanvas && (
                  <>
                    <div>
                      <span className={lbl}>White threshold — {threshold}</span>
                      <input id="ff-ss-th" type="range" min={120} max={255} value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))} className="w-full accent-[#d4a017]" />
                      <div className="text-[9px] text-rmpg-600">Higher keeps more of the image; lower removes more (also clears light grays).</div>
                    </div>
                    <div>
                      <span className={lbl}>Soft edge — {soft}</span>
                      <input id="ff-ss-soft" type="range" min={0} max={60} value={soft}
                        onChange={(e) => setSoft(Number(e.target.value))} className="w-full accent-[#d4a017]" />
                    </div>
                    <div>
                      <span className={lbl}>Before</span>
                      <div className="rounded-sm overflow-hidden inline-block border border-[#222]" style={{ background: '#fff' }}>
                        <PreviewImg canvas={srcCanvas} max={150} />
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* ── Live preview (transparency checkerboard) ── */}
          <div className="space-y-3">
            <span className={lbl}>Preview (transparent)</span>
            <div className="rounded-sm border border-[#222] flex items-center justify-center p-3 min-h-[200px]" style={{ background: CHECKER }}>
              {outputCanvas
                ? <canvas ref={previewRef} className="max-w-full" style={{ maxHeight: 260, width: 'auto', height: 'auto' }} />
                : <span className="text-[10px] text-rmpg-600">Upload an image to preview.</span>}
            </div>
            {savedMsg && (
              <div className="bg-emerald-900/20 border border-emerald-700/40 text-emerald-200 text-[11px] px-3 py-1.5 rounded-sm flex items-center gap-2">
                <Check className="w-3.5 h-3.5" /> {savedMsg}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[#222]">
          <button type="button" onClick={() => { setSrcCanvas(null); setError(null); }}
            className="text-[10px] text-rmpg-500 hover:text-rmpg-100 inline-flex items-center gap-1"
            style={{ visibility: tab === 'background' && srcCanvas ? 'visible' : 'hidden' }}>
            <RotateCcw className="w-3 h-3" /> Clear upload
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => finish('save')} disabled={!outputCanvas}
              className="btn-secondary inline-flex items-center gap-1.5 text-[11px] disabled:opacity-40">
              <Save className="w-3.5 h-3.5" /> Save to library
            </button>
            <button type="button" onClick={() => finish('use')} disabled={!outputCanvas}
              className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-40">
              <Sparkles className="w-3.5 h-3.5" /> Use on page
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Small helper to render a source canvas into an <img>-like preview without
// re-decoding (used for the "before" thumbnail).
function PreviewImg({ canvas, max }: { canvas: HTMLCanvasElement; max: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
    el.width = Math.round(canvas.width * scale);
    el.height = Math.round(canvas.height * scale);
    el.getContext('2d')!.drawImage(canvas, 0, 0, el.width, el.height);
  }, [canvas, max]);
  return <canvas ref={ref} className="block" />;
}
