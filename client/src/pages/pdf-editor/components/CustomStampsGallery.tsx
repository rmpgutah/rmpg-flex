import { useEffect, useRef, useState } from 'react';
import { Stamp, X, Upload, Trash2, Check, AlertTriangle } from 'lucide-react';

// Custom user-uploaded stamps gallery — personal authoring templates
// (badge stamps, signed stamps with logo, "RMPG / Det. Smith" combo stamps).
// Stored in localStorage as base64 data URLs so they're instantly available
// across editor sessions without going through /api/uploads.
//
// Two stamp tiers shown side by side:
//   - Built-in text stamps (CONFIDENTIAL, EVIDENCE, etc.) — always present
//   - Custom uploads — image-based; PNG transparency preserved on render
//
// Selecting a stamp closes the dialog and seeds the editor's pending image
// (for custom) or pending stamp label (for built-in), then activates the
// stamp tool so the next page click drops it.

const STORAGE_KEY = 'rmpg-pdf-editor-custom-stamps';
const MAX_BYTES = 512 * 1024; // 512 KB hard cap per stamp to keep localStorage healthy

const PRESETS = ['CONFIDENTIAL', 'EVIDENCE', 'COPY', 'ORIGINAL', 'DRAFT', 'APPROVED', 'VOID', 'FILED', 'RECEIVED'];

export interface CustomStamp {
  id: string;
  name: string;
  imageData: string;       // data: URL
  width: number;
  height: number;
  createdAt: number;
}

export type StampPick =
  | { kind: 'preset'; label: string }
  | { kind: 'custom'; stamp: CustomStamp };

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (pick: StampPick) => void;
}

export function loadCustomStamps(): CustomStamp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveCustomStamps(stamps: CustomStamp[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stamps)); } catch { /* quota — surface in UI */ }
}

export default function CustomStampsGallery({ open, onClose, onPick }: Props) {
  const [stamps, setStamps] = useState<CustomStamp[]>(() => loadCustomStamps());
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setStamps(loadCustomStamps());
  }, [open]);

  if (!open) return null;

  const handleUpload = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Stamp must be an image (PNG / JPEG)');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Stamp too large (${Math.round(file.size / 1024)} KB). Max ${Math.round(MAX_BYTES / 1024)} KB — try compressing first.`);
      return;
    }
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error('Could not read file'));
        r.readAsDataURL(file);
      });
      const dim = await new Promise<{ w: number; h: number }>((res, rej) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => rej(new Error('Could not decode image'));
        img.src = dataUrl;
      });
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Stamp';
      const stamp: CustomStamp = {
        id: Math.random().toString(36).slice(2, 12),
        name: baseName,
        imageData: dataUrl,
        width: dim.w,
        height: dim.h,
        createdAt: Date.now(),
      };
      const next = [stamp, ...stamps].slice(0, 50);
      setStamps(next);
      saveCustomStamps(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const handleDelete = (id: string) => {
    const next = stamps.filter(s => s.id !== id);
    setStamps(next);
    saveCustomStamps(next);
  };

  const handleRename = (id: string, name: string) => {
    const next = stamps.map(s => s.id === id ? { ...s, name } : s);
    setStamps(next);
    saveCustomStamps(next);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141414] border border-[#222] rounded-[2px] p-4 max-w-[760px] w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white inline-flex items-center gap-2">
            <Stamp className="w-4 h-4 text-[#d4a017]" /> Stamps gallery
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="text-[10px] text-rmpg-500 mb-3">
          Choose a stamp to drop onto the page. Custom stamps live in your browser only.
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-700/40 text-red-200 text-[11px] px-3 py-1.5 rounded-sm mb-3 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5" /> <div>{error}</div>
          </div>
        )}

        <div className="text-[9px] uppercase tracking-wider text-[#d4a017] mb-2 font-semibold">Built-in</div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {PRESETS.map(label => (
            <button key={label} type="button"
              onClick={() => { onPick({ kind: 'preset', label }); onClose(); }}
              className="bg-[#0d0d0d] hover:bg-[#1a1a1a] border-2 border-[#c62828]/70 hover:border-[#c62828] rounded-sm py-2 px-3 text-[#c62828] font-bold text-sm tracking-wider">
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] uppercase tracking-wider text-[#d4a017] font-semibold">Custom uploads ({stamps.length})</div>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="btn-secondary inline-flex items-center gap-1 text-[10px]">
            <Upload className="w-3 h-3" /> Upload PNG / JPEG
          </button>
        </div>

        {stamps.length === 0 ? (
          <div className="bg-[#0d0d0d] border border-[#222] rounded-sm p-6 text-center text-[10px] text-rmpg-500">
            No custom stamps yet. Upload a PNG (transparent backgrounds work) or JPEG up to {Math.round(MAX_BYTES / 1024)} KB.
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
            {stamps.map(s => (
              <div key={s.id} className="bg-[#0d0d0d] border border-[#222] hover:border-[#d4a017]/50 rounded-sm p-2 group">
                <button type="button"
                  onClick={() => { onPick({ kind: 'custom', stamp: s }); onClose(); }}
                  className="block w-full bg-white rounded-sm overflow-hidden mb-1.5 aspect-[4/3] flex items-center justify-center">
                  <img src={s.imageData} alt={s.name} className="max-w-full max-h-full object-contain" />
                </button>
                <div className="flex items-center gap-1">
                  <input type="text" value={s.name}
                    onChange={(e) => handleRename(s.id, e.target.value.slice(0, 40))}
                    className="flex-1 bg-transparent text-[10px] text-rmpg-200 border-b border-transparent hover:border-[#222] focus:outline-none focus:border-[#d4a017]" />
                  <button type="button" onClick={() => { onPick({ kind: 'custom', stamp: s }); onClose(); }}
                    className="p-0.5 text-rmpg-400 hover:text-[#d4a017]" title="Use this stamp">
                    <Check className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => handleDelete(s.id)}
                    className="p-0.5 text-rmpg-400 hover:text-red-400" title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
