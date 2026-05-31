import { useState, useMemo, useCallback } from 'react';
import { Hash, Search, X, Check, AlertTriangle, Shield, Truck, Flame, Star } from 'lucide-react';
import { useDispatchCodes, type DispatchCode } from '../../hooks/useDispatchCodes';

const FAVORITES_KEY = 'rmpg-signal-favorites';

function loadFavorites(): Set<number> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed: number[] = JSON.parse(raw);
    return new Set<number>(parsed);
  } catch { return new Set(); }
}

function saveFavorites(set: Set<number>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
}

interface DispatchCodeQuickPanelProps {
  onApplyCode: (code: string) => void;
  onDismiss: () => void;
}

const CATEGORY_ICONS: Record<string, any> = {
  Emergency: AlertTriangle,
  Priority: Shield,
  Traffic: Truck,
  Fire: Flame,
  Signal: Hash,
};

function CodeRow({ code, onApply, isFavorite, onToggleFav }: {
  code: DispatchCode;
  onApply: (code: string) => void;
  isFavorite: boolean;
  onToggleFav: (id: number) => void;
}) {
  const priDot = code.priority === 'P1' ? 'bg-red-500' : code.priority === 'P2' ? 'bg-amber-500' : code.priority === 'P4' ? 'bg-green-500' : 'bg-gray-500';
  return (
    <div
      className="w-full flex items-center gap-1.5 px-3 py-1 text-[9px] hover:bg-[#ffffff08] transition-colors border-b border-[#1a1a1a]/50"
      title={`${code.code} — ${code.description}\nCategory: ${code.category} · Priority: ${code.priority}${code.notes ? `\nNotes: ${code.notes}` : ''}`}
    >
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onToggleFav(code.id); }}
        className="p-0.5 rounded hover:bg-[#ffffff15] transition-colors shrink-0"
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star className={`w-2.5 h-2.5 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-rmpg-600 hover:text-rmpg-400'}`} />
      </button>
      <div className={`flex-shrink-0 w-1 h-1 rounded-full ${priDot}`} />
      <span className="font-bold text-white shrink-0">{code.code}</span>
      <span className="text-rmpg-400 truncate flex-1 min-w-0">{code.description}</span>
      <div className="flex items-center gap-0.5 shrink-0">
        {code.requires_backup ? <Shield className="w-2.5 h-2.5 text-amber-400" /> : null}
        {code.officer_safety ? <AlertTriangle className="w-2.5 h-2.5 text-red-400" /> : null}
        {code.ems_needed ? <Truck className="w-2.5 h-2.5 text-green-400" /> : null}
        {code.fire_needed ? <Flame className="w-2.5 h-2.5 text-orange-400" /> : null}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onApply(code.code); }}
          className="p-0.5 rounded hover:bg-brand-500/20 text-rmpg-500 hover:text-brand-400 transition-colors"
          title="Apply code to selected call"
        >
          <Check className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
}

export default function DispatchCodeQuickPanel({ onApplyCode, onDismiss }: DispatchCodeQuickPanelProps) {
  const { codes, loading } = useDispatchCodes();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Emergency', 'Priority']));
  const [favorites, setFavorites] = useState<Set<number>>(loadFavorites);

  const toggleFav = useCallback((id: number) => {
    setFavorites((prev: Set<number>) => {
      const next = new Set<number>(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(next);
      return next;
    });
  }, []);

  const favoriteCodes = useMemo(
    () => codes.filter(c => favorites.has(c.id)),
    [codes, favorites]
  );

  const grouped = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filtered = query
      ? codes.filter(c => c.code.toLowerCase().includes(query) || c.description.toLowerCase().includes(query))
      : codes;
    const groups = new Map<string, DispatchCode[]>();
    for (const c of filtered) {
      const cat = c.category || 'Other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(c);
    }
    const order = ['Emergency', 'Priority', 'Traffic', 'Action', 'Status', 'Repair', 'Function', 'Info', 'Signal', 'Other'];
    return [...groups.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }, [codes, searchQuery]);

  const totalCount = codes.length;
  const resultCount = grouped.reduce((s: number, [, items]: [string, DispatchCode[]]) => s + items.length, 0);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="w-[260px] flex-shrink-0 border-l flex flex-col overflow-hidden" style={{ background: '#111', borderColor: '#1a1a1a' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#1a1a1a', background: '#0e0e0e' }}>
        <div className="flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-300">Dispatch Codes</span>
        </div>
        <button onClick={onDismiss} className="p-0.5 rounded hover:bg-[#ffffff10] transition-colors" title="Close codes panel">
          <X className="w-3.5 h-3.5 text-[#6b7280]" />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b" style={{ borderColor: '#1a1a1a' }}>
        <div className="relative">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#545454] pointer-events-none" />
          <input
            type="text"
            placeholder="Search codes or descriptions…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-[#2b2b2b] rounded-sm text-[10px] text-white pl-6 pr-2 py-1 placeholder-[#545454] focus:outline-none focus:border-brand-700/50"
          />
        </div>
        <div className="flex items-center gap-1 mt-1">
          <span className="text-[7px] text-rmpg-500">
            {searchQuery ? `${resultCount} of ${totalCount} codes` : `${totalCount} codes`}
          </span>
          {favoriteCodes.length > 0 && !searchQuery && (
            <span className="text-[7px] text-yellow-500 ml-auto">{favoriteCodes.length} ★</span>
          )}
        </div>
      </div>

      {/* Code list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-[10px] text-rmpg-500">Loading codes…</div>
        ) : grouped.length === 0 && (!searchQuery || favoriteCodes.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-8 text-[#545454]">
            <Hash className="w-6 h-6 mb-2 opacity-30" />
            <p className="text-[10px]">No codes match</p>
          </div>
        ) : (
          <>
            {/* Favorites section — only when not searching */}
            {!searchQuery && favoriteCodes.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-yellow-500 border-b border-[#1a1a1a]" style={{ background: '#0a0a0a' }}>
                  <Star className="w-2.5 h-2.5 fill-yellow-500/60 text-yellow-500" />
                  Favorites <span className="text-rmpg-600 font-normal">({favoriteCodes.length})</span>
                </div>
                {favoriteCodes.map((code: DispatchCode) => (
                  <CodeRow
                    key={`fav-${code.id}`}
                    code={code}
                    onApply={onApplyCode}
                    isFavorite={true}
                    onToggleFav={toggleFav}
                  />
                ))}
                {/* Separator */}
                <div className="h-[1px] bg-[#2b2b2b] mx-2 my-1" />
              </div>
            )}

            {/* Category groups */}
            {grouped.map(([category, items]: [string, DispatchCode[]]) => {
              const isExpanded = expandedCategories.has(category);
              const CatIcon = CATEGORY_ICONS[category] || Hash;
              return (
                <div key={category}>
                  <button
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-rmpg-400 hover:text-white border-b border-[#1a1a1a] hover:bg-[#ffffff08] transition-colors"
                    style={{ background: '#0a0a0a' }}
                  >
                    <CatIcon className="w-2.5 h-2.5" />
                    {category} <span className="text-rmpg-600 font-normal">({items.length})</span>
                    <span className="ml-auto text-[6px]">{isExpanded ? '▼' : '▶'}</span>
                  </button>
                  {isExpanded && items.map((code: DispatchCode) => (
                    <CodeRow
                      key={code.id}
                      code={code}
                      onApply={onApplyCode}
                      isFavorite={favorites.has(code.id)}
                      onToggleFav={toggleFav}
                    />
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Footer with quick stats */}
      <div className="px-2 py-1 border-t text-[7px] text-rmpg-500 flex items-center justify-between" style={{ borderColor: '#1a1a1a', background: '#0a0a0a' }}>
        <span>Click ★ to favorite</span>
        <span>{codes.filter(c => c.priority === 'P1').length} P1 · {codes.filter(c => c.priority === 'P2').length} P2</span>
      </div>
    </div>
  );
}
