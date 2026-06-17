import { useState } from 'react';
import { Search, Star } from 'lucide-react';
import { useSavedSearches } from '../useSavedSearches';

const HINT = 'plate:  dob:  phone:  vin:  dl:  case:  name:"…"  addr:"…"  type:  flag:  since:  until:';

export default function SearchBar({ value, onChange, onSave }: {
  value: string;
  onChange: (v: string) => void;
  onSave?: (name: string) => void;
}) {
  const { saved, recent } = useSavedSearches();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border border-rmpg-700 bg-surface-sunken rounded-[2px] px-3 py-2 focus-within:border-[#d4a017]">
        <Search size={14} className="text-[#d4a017]" />
        <input
          autoFocus value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search — try plate:8XQ220, name:&quot;Hale&quot;, flag:warrant…"
          className="flex-1 bg-transparent text-[13px] text-rmpg-200 outline-none"
        />
        {onSave && value.trim() && (
          <button title="Save this search" onClick={() => { const n = prompt('Name this search:'); if (n) onSave(n); }}
            className="text-[#888] hover:text-[#d4a017]"><Star size={13} /></button>
        )}
      </div>
      <div className="text-[9px] text-rmpg-500 font-mono mt-1 px-1 truncate">{HINT}</div>

      {open && (saved.length > 0 || recent.length > 0) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-[#060606] border border-border-default rounded-[2px] max-h-[260px] overflow-y-auto">
          {saved.length > 0 && <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase px-3 pt-2">Saved</div>}
          {saved.map((s) => (
            <button key={s.id} onMouseDown={() => onChange(s.query_text)}
              className="w-full text-left px-3 py-[5px] text-[11px] text-rmpg-200 hover:bg-surface-sunken flex items-center gap-2">
              <Star size={10} className="text-[#d4a017]" /><span className="min-w-0 flex-1 truncate">{s.name}</span>
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
