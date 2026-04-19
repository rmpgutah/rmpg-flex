import { useState, useEffect, useRef } from 'react';
import { Network, Loader2 } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';

interface SearchResult {
  id: number;
  type: string;
  label: string;
}

interface Seed {
  id: number;
  type: string;
  label: string;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

export default function ConnectionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchQuery.trim().length < MIN_QUERY_LEN) {
      setResults([]);
      setDropdownOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await apiFetch<SearchResult[]>(
          `/connections/search?q=${encodeURIComponent(searchQuery.trim())}`
        );
        setResults(data || []);
        setDropdownOpen(true);
      } catch (err) {
        console.error('Connections search error:', err);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  function pickSeed(r: SearchResult) {
    setSeed({ id: r.id, type: r.type, label: r.label });
    setDropdownOpen(false);
    setSearchQuery('');
    setResults([]);
  }

  return (
    <div className="p-4 space-y-4 h-full flex flex-col">
      <PanelTitleBar title="CONNECTIONS ANALYST" icon={Network} />

      <div className="relative">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search for a person, vehicle, case, incident..."
            className="flex-1 bg-surface-raised border border-[#222222] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-[#d4a017] focus:outline-none"
            style={{ borderRadius: 2 }}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => { if (results.length) setDropdownOpen(true); }}
            aria-label="Seed search"
          />
          {searching && <Loader2 className="w-4 h-4 animate-spin text-[#d4a017]" />}
        </div>

        {dropdownOpen && results.length > 0 && (
          <ul
            role="listbox"
            className="absolute z-10 mt-1 w-full bg-surface-raised border border-[#222222] max-h-80 overflow-y-auto"
            style={{ borderRadius: 2 }}
          >
            {results.map(r => (
              <li
                key={`${r.type}-${r.id}`}
                role="option"
                aria-selected={false}
                onClick={() => pickSeed(r)}
                className="px-3 py-2 text-sm text-gray-200 cursor-pointer hover:bg-surface-sunken border-b border-[#1a1a1a] last:border-b-0"
              >
                <span className="text-[#d4a017] text-xs uppercase mr-2">{r.type}</span>
                {r.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {seed && (
        <div
          data-testid="seed-display"
          className="px-3 py-2 bg-surface-raised border border-[#d4a017] text-sm text-gray-200 flex items-center gap-3"
          style={{ borderRadius: 2 }}
        >
          <span className="text-[#d4a017] text-xs uppercase font-semibold">{seed.type}</span>
          <span className="font-semibold">{seed.label}</span>
          <span className="text-gray-500 text-xs ml-auto">#{seed.id}</span>
          <button
            type="button"
            onClick={() => setSeed(null)}
            className="text-xs text-gray-400 hover:text-[#d4a017]"
            aria-label="Clear seed"
          >
            CLEAR
          </button>
        </div>
      )}

      <div
        data-testid="graph-canvas"
        className="flex-1 bg-surface-sunken border border-[#222222] flex items-center justify-center text-gray-500 text-sm"
        style={{ borderRadius: 2, minHeight: 400 }}
      >
        {seed
          ? `Graph for ${seed.type} #${seed.id} — rendering in Task 5.4.`
          : 'Seed a graph by searching above.'}
      </div>
    </div>
  );
}
