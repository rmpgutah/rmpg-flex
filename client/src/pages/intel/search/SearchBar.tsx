import { useState, useEffect, useRef } from 'react';
import { Search, Star, X } from 'lucide-react';
import { useSavedSearches } from '../useSavedSearches';

const HINT = 'plate:  dob:  phone:  vin:  dl:  case:  name:"…"  addr:"…"  type:  flag:  since:  until:';

// Inline name-the-search popover. Replaces the prior `window.prompt('Name
// this search:')` — native prompts can't be themed, can't be Esc-cascaded,
// and tank the dashcam HUD on iPad/MDT (audit findings v1024–v1037).
function SaveSearchPopover({ onSave, onClose }: { onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);
  const submit = () => { const v = name.trim(); if (v) { onSave(v); onClose(); } };
  return (
    <div className="absolute z-30 right-0 top-full mt-1 w-[260px] bg-surface-overlay border border-border-default rounded-[2px] p-2 shadow-md">
      <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase mb-1">Save search</div>
      <div className="flex gap-1">
        <input
          ref={inputRef} value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Name (e.g. Active gang warrants)"
          className="flex-1 bg-surface-sunken border border-border-default rounded-[2px] px-2 py-[5px] text-[11px] text-rmpg-200 focus:border-brand-500 outline-none"
        />
        <button onClick={submit} disabled={!name.trim()}
          className="font-mono text-[9px] tracking-wide text-black bg-brand-600 rounded-[2px] px-2 py-[5px] uppercase disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
        <button aria-label="Cancel" onClick={onClose} className="text-rmpg-500 hover:text-rmpg-300 px-1"><X size={11} /></button>
      </div>
    </div>
  );
}

export default function SearchBar({ value, onChange, onSave }: {
  value: string;
  onChange: (v: string) => void;
  onSave?: (name: string) => void;
}) {
  const { saved, recent } = useSavedSearches();
  const [open, setOpen] = useState(false);
  const [savingOpen, setSavingOpen] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border border-rmpg-700 bg-surface-sunken rounded-[2px] px-3 py-2 focus-within:border-brand-500">
        <Search size={14} className="text-brand-400" />
        <input
          autoFocus value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder='Search — try plate:8XQ220, name:"Hale", flag:warrant…'
          className="flex-1 bg-transparent text-[13px] text-rmpg-200 outline-none"
        />
        {onSave && value.trim() && (
          <button title="Save this search" aria-label="Save this search"
            onClick={() => setSavingOpen((v) => !v)}
            className="text-rmpg-500 hover:text-brand-400"><Star size={13} /></button>
        )}
      </div>
      <div className="text-[9px] text-rmpg-500 font-mono mt-1 px-1 truncate">{HINT}</div>

      {savingOpen && onSave && (
        <SaveSearchPopover onSave={onSave} onClose={() => setSavingOpen(false)} />
      )}

      {open && (saved.length > 0 || recent.length > 0) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-surface-overlay border border-border-default rounded-[2px] max-h-[260px] overflow-y-auto">
          {saved.length > 0 && <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase px-3 pt-2">Saved</div>}
          {saved.map((s) => (
            <button key={s.id} onMouseDown={() => onChange(s.query_text)}
              className="w-full text-left px-3 py-[5px] text-[11px] text-rmpg-200 hover:bg-surface-sunken flex items-center gap-2">
              <Star size={10} className="text-brand-400" /><span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-[9px] text-rmpg-500 font-mono truncate max-w-[160px]">{s.query_text}</span>
            </button>
          ))}
          {recent.length > 0 && <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase px-3 pt-2">Recent</div>}
          {recent.map((r, i) => (
            <button key={i} onMouseDown={() => onChange(r.query_text)}
              className="w-full text-left px-3 py-[5px] text-[11px] text-rmpg-300 hover:bg-surface-sunken truncate">{r.query_text}</button>
          ))}
        </div>
      )}
    </div>
  );
}
