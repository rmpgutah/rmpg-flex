import { Settings, X, Save } from 'lucide-react';
import { EditorPreferences, DEFAULT_PREFERENCES } from '../types';

interface Props {
  open: boolean;
  prefs: EditorPreferences;
  onChange: (next: EditorPreferences) => void;
  onClose: () => void;
}

const labelCls = 'text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1';
const inputCls = 'w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';

export default function PreferencesDialog({ open, prefs, onChange, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141414] border border-[#222] rounded-[2px] p-4 max-w-[480px] w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white inline-flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#d4a017]" /> Editor preferences
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>View mode</label>
            <select value={prefs.viewMode} onChange={(e) => onChange({ ...prefs, viewMode: e.target.value as EditorPreferences['viewMode'] })} className={inputCls}>
              <option value="continuous">Continuous (all pages stacked)</option>
              <option value="single">Single page</option>
              <option value="two-up">Two-up (side by side)</option>
            </select>
          </div>

          <div>
            <label className="inline-flex items-center gap-2 text-[10px] text-rmpg-300">
              <input type="checkbox" checked={prefs.snapToGrid}
                onChange={(e) => onChange({ ...prefs, snapToGrid: e.target.checked })} />
              Snap drawing to grid
            </label>
          </div>

          {prefs.snapToGrid && (
            <div>
              <label className={labelCls}>Grid size (PDF points)</label>
              <input type="number" min={1} max={72} value={prefs.gridSize}
                onChange={(e) => onChange({ ...prefs, gridSize: Math.max(1, parseInt(e.target.value, 10) || 6) })}
                className={inputCls} />
            </div>
          )}

          <div>
            <label className="inline-flex items-center gap-2 text-[10px] text-rmpg-300">
              <input type="checkbox" checked={prefs.autoSaveDrafts}
                onChange={(e) => onChange({ ...prefs, autoSaveDrafts: e.target.checked })} />
              Auto-save drafts to local storage
            </label>
          </div>

          <div>
            <label className="inline-flex items-center gap-2 text-[10px] text-rmpg-300">
              <input type="checkbox" checked={prefs.showAnnotationsPanel}
                onChange={(e) => onChange({ ...prefs, showAnnotationsPanel: e.target.checked })} />
              Show Annotations panel by default
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-4">
          <button type="button" onClick={() => onChange(DEFAULT_PREFERENCES)} className="text-[10px] text-rmpg-400 hover:text-white">
            Restore defaults
          </button>
          <button type="button" onClick={onClose} className="btn-primary inline-flex items-center gap-1">
            <Save className="w-3.5 h-3.5" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
