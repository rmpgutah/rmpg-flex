import { useEffect, useRef, useState } from 'react';
import { X, Check, QrCode, Barcode as BarcodeIcon, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
// jsbarcode has no types shipped; declare as any locally so we don't add a
// brittle module declaration just for one call.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import JsBarcode from 'jsbarcode';

// In-app generator for QR codes and 1D barcodes that get placed onto the PDF
// as image annotations (PNG data URLs). Common law-enforcement uses:
//  - Evidence tag QR linking to incident URL
//  - Case number Code-128 on chain-of-custody forms
//  - Officer ID Code-39 (legacy badge readers)
//  - URL QR on subpoena / citation copies for digital response

export type BarcodeFormat =
  | 'qrcode'
  | 'CODE128'
  | 'CODE39'
  | 'EAN13'
  | 'UPC'
  | 'ITF14';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Receives the generated image data URL plus a default size in CSS px. */
  onConfirm: (dataUrl: string, defaultWidth: number, defaultHeight: number) => void;
}

const FORMATS: { value: BarcodeFormat; label: string; hint: string }[] = [
  { value: 'qrcode', label: 'QR Code', hint: '2D — URLs, evidence links, mobile scans' },
  { value: 'CODE128', label: 'Code 128', hint: 'High-density 1D — case numbers, asset tags' },
  { value: 'CODE39', label: 'Code 39', hint: 'Legacy 1D — badge readers, older systems' },
  { value: 'EAN13', label: 'EAN-13', hint: '13-digit — retail evidence' },
  { value: 'UPC', label: 'UPC', hint: '12-digit — retail evidence' },
  { value: 'ITF14', label: 'ITF-14', hint: '14-digit — shipping cartons' },
];

export default function BarcodeDialog({ open, onClose, onConfirm }: Props) {
  const [format, setFormat] = useState<BarcodeFormat>('qrcode');
  const [value, setValue] = useState('');
  const [errorCorrection, setErrorCorrection] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [showLabel, setShowLabel] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) { setPreview(null); setError(null); setValue(''); }
  }, [open]);

  // Live re-generate the preview whenever inputs change.
  useEffect(() => {
    if (!open || !value.trim()) { setPreview(null); return; }
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        if (format === 'qrcode') {
          const url = await QRCode.toDataURL(value, {
            errorCorrectionLevel: errorCorrection,
            margin: 2,
            scale: 6,
            color: { dark: '#000000', light: '#ffffff' },
          });
          if (!cancelled) setPreview(url);
        } else {
          // 1D barcodes via jsbarcode — render to a hidden canvas, then export.
          const canvas = canvasRef.current ?? document.createElement('canvas');
          JsBarcode(canvas, value, {
            format,
            displayValue: showLabel,
            fontSize: 14,
            margin: 8,
            width: 2,
            height: 60,
            background: '#ffffff',
            lineColor: '#000000',
          });
          if (!cancelled) setPreview(canvas.toDataURL('image/png'));
        }
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setError(err instanceof Error ? err.message : 'Generation failed');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, format, value, errorCorrection, showLabel]);

  if (!open) return null;

  const confirm = () => {
    if (!preview) return;
    // Default placement size depends on the format.
    const dims = format === 'qrcode' ? { w: 120, h: 120 } : { w: 240, h: 80 };
    onConfirm(preview, dims.w, dims.h);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-4 max-w-[640px] w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white inline-flex items-center gap-2">
            {format === 'qrcode' ? <QrCode className="w-4 h-4 text-[#d4a017]" /> : <BarcodeIcon className="w-4 h-4 text-[#d4a017]" />}
            Generate barcode / QR
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div>
              <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1">Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as BarcodeFormat)}
                className="w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017]">
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label} — {f.hint}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1">
                {format === 'qrcode' ? 'Text or URL' : 'Value'}
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={
                  format === 'qrcode' ? 'https://rmpgutah.us/incidents/2026-01234' :
                  format === 'EAN13' ? '5901234123457' :
                  format === 'UPC' ? '036000291452' :
                  format === 'ITF14' ? '00012345678905' :
                  'EVIDENCE-2026-00123'
                }
                className="w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017]"
              />
            </div>
            {format === 'qrcode' && (
              <div>
                <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1">Error correction</label>
                <select value={errorCorrection} onChange={(e) => setErrorCorrection(e.target.value as typeof errorCorrection)}
                  className="w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017]">
                  <option value="L">Low (~7%) — densest</option>
                  <option value="M">Medium (~15%) — recommended</option>
                  <option value="Q">Quartile (~25%)</option>
                  <option value="H">High (~30%) — most resilient to damage</option>
                </select>
              </div>
            )}
            {format !== 'qrcode' && (
              <label className="inline-flex items-center gap-2 text-[10px] text-rmpg-300">
                <input type="checkbox" checked={showLabel} onChange={(e) => setShowLabel(e.target.checked)} />
                Show readable text below
              </label>
            )}
            <div className="text-[10px] text-rmpg-500 pt-2 border-t border-[#222]">
              The generated code is placed as a high-resolution PNG image annotation. It can be moved, resized, and saved with the rest of your edits.
            </div>
          </div>

          <div className="bg-white rounded-sm flex items-center justify-center p-4 min-h-[200px]">
            {error ? (
              <div className="text-red-600 text-[11px] text-center">{error}</div>
            ) : preview ? (
              <img src={preview} alt="Preview" className="max-h-[200px] max-w-full" />
            ) : (
              <div className="text-gray-400 text-[10px] inline-flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Enter a value to generate
              </div>
            )}
          </div>
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className="flex items-center justify-end gap-2 mt-3">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={confirm} disabled={!preview}
            className="btn-primary inline-flex items-center gap-1 disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> Place on page
          </button>
        </div>
      </div>
    </div>
  );
}
