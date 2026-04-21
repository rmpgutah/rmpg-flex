import { useState } from 'react';
import { Bookmark, Save, Trash2, X } from 'lucide-react';
import type { LayerPreset } from '../hooks/useLayerPresets';

interface MapV2PresetsButtonProps {
  presets: LayerPreset[];
  onSave: (name: string) => void;
  onApply: (preset: LayerPreset) => void;
  onRemove: (name: string) => void;
}

/**
 * Layer-preset save/load button — top-right corner of the layers panel
 * area. Click opens a small dropdown with: text input + Save button at
 * top, list of named presets below. Each preset has Apply (click row)
 * and Trash (delete) actions.
 */
export default function MapV2PresetsButton({
  presets, onSave, onApply, onRemove,
}: MapV2PresetsButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  function handleSave() {
    if (!name.trim()) return;
    onSave(name.trim());
    setName('');
  }

  return (
    <div className="absolute top-2 right-2 z-30 select-none font-mono text-[10px] uppercase tracking-wider">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Layer presets"
        aria-label="Layer presets"
        className={
          'p-1.5 bg-[#141414] border border-[#222222] hover:bg-[#1a1a1a] ' +
          (open ? 'text-[#d4a017]' : 'text-[#9ca3af]')
        }
      >
        <Bookmark className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-1 w-[200px] bg-[#0a0a0a] border border-[#222222] divide-y divide-[#1a1a1a]">
          <div className="p-1.5 flex items-center gap-1 bg-[#0d0d0d]">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              placeholder="Preset name…"
              aria-label="New preset name"
              className="flex-1 bg-[#141414] border border-[#1a1a1a] outline-none px-1.5 py-1 text-[#e5e7eb] placeholder:text-[#666666] font-mono text-[10px]"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim()}
              title="Save current layer state"
              aria-label="Save preset"
              className="p-1 bg-[#141414] border border-[#1a1a1a] hover:bg-[#1a1a1a] text-[#d4a017] disabled:opacity-30"
            >
              <Save className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
          {presets.length === 0 && (
            <div className="px-2 py-2 text-[#666666] text-[9px]">No saved presets</div>
          )}
          {presets.map((p) => (
            <div key={p.name} className="flex items-center gap-1 px-2 py-1 hover:bg-[#1a1a1a]">
              <button
                type="button"
                onClick={() => { onApply(p); setOpen(false); }}
                className="flex-1 text-left text-[#e5e7eb]"
              >
                {p.name}
                <span className="ml-2 text-[#666666] text-[8px]">
                  {Object.values(p.visibility).filter(Boolean).length} on
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(p.name)}
                aria-label={`Delete preset ${p.name}`}
                className="p-0.5 text-[#666666] hover:text-[#ef4444]"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full p-1 text-[#666666] hover:bg-[#1a1a1a] flex items-center justify-center gap-1"
          >
            <X className="w-3 h-3" aria-hidden="true" /> close
          </button>
        </div>
      )}
    </div>
  );
}
