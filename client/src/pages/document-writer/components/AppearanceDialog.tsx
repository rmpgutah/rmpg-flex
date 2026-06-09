import { Sliders, X, RotateCcw } from 'lucide-react';
import { DEFAULT_APPEARANCE, type EditorAppearance } from '../appearance';
import { FONT_FAMILIES } from '../types';

/** Editor appearance settings — font, size, line height, writing measure
 *  (max content width), and paper tint. These affect ONLY the editing canvas
 *  (never the printed/PDF output) and are persisted across sessions. */
export default function AppearanceDialog({
  value, onChange, onClose,
}: {
  value: EditorAppearance;
  onChange: (next: EditorAppearance) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof EditorAppearance>(k: K, v: EditorAppearance[K]) => onChange({ ...value, [k]: v });
  const lbl = 'text-[10px] text-rmpg-400 uppercase tracking-wide mb-1 block';
  const sel = 'w-full bg-[#141414] border border-[#222] text-rmpg-100 text-[12px] rounded-[2px] px-2 py-1.5 focus:outline-none focus:border-[#d4a017]/50';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-sm bg-[#0a0a0a] border border-[#2e2e2e] rounded-[2px] shadow-2xl shadow-black/70" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a]">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-rmpg-100 uppercase tracking-wide">
            <Sliders className="w-3.5 h-3.5 text-[#d4a017]" /> Editor Appearance
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-rmpg-500 hover:text-rmpg-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-3 space-y-3">
          <div>
            <label className={lbl}>Editing font</label>
            <select className={sel} value={value.fontFamily} onChange={(e) => set('fontFamily', e.target.value)}>
              <option value="">Document default</option>
              {FONT_FAMILIES.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Font size: {value.fontSize}pt</label>
              <input type="range" min={9} max={24} step={1} value={value.fontSize}
                onChange={(e) => set('fontSize', Number(e.target.value))} className="w-full accent-[#d4a017]" />
            </div>
            <div>
              <label className={lbl}>Line height: {value.lineHeight}</label>
              <input type="range" min={1} max={2.5} step={0.1} value={value.lineHeight}
                onChange={(e) => set('lineHeight', Number(e.target.value))} className="w-full accent-[#d4a017]" />
            </div>
          </div>

          <div>
            <label className={lbl}>Writing measure (max content width): {value.maxWidth > 0 ? `${value.maxWidth}px` : 'full page'}</label>
            <input type="range" min={0} max={760} step={20} value={value.maxWidth}
              onChange={(e) => set('maxWidth', Number(e.target.value))} className="w-full accent-[#d4a017]" />
            <p className="text-[9px] text-rmpg-600 mt-0.5 leading-snug">A narrower measure (≈600–700px) is easier to read while drafting. Does not affect print.</p>
          </div>

          <div className="flex items-center justify-between">
            <label className={lbl + ' mb-0'}>Paper tint (screen only)</label>
            <div className="flex items-center gap-2">
              <input type="color" value={value.paperTint || '#ffffff'} onChange={(e) => set('paperTint', e.target.value)} />
              {value.paperTint && (
                <button type="button" onClick={() => set('paperTint', '')} className="text-[10px] text-rmpg-500 hover:text-rmpg-200">clear</button>
              )}
            </div>
          </div>
        </div>

        <div className="px-3 py-2 border-t border-[#1a1a1a] flex items-center justify-between">
          <button type="button" onClick={() => onChange({ ...DEFAULT_APPEARANCE })}
            className="text-[10px] text-rmpg-400 hover:text-rmpg-100 flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> Reset to defaults
          </button>
          <button type="button" onClick={onClose}
            className="px-3 py-1 text-[10px] font-medium bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
