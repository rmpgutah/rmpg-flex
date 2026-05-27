// ReferencesTab — 10-codes + phonetic alphabets.
// Pure-data view; no network. Search filters TEN_CODES live.
import { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { TEN_CODES, PHONETIC_NATO, PHONETIC_LAPD } from '../constants';
import { SectionHeader, FilterChip } from '../components';
import { ls } from '../helpers';

type Phonetic = 'nato' | 'lapd';

export default function ReferencesTab() {
  const [q, setQ] = useState('');
  const [phonetic, setPhonetic] = useState<Phonetic>(() => (ls.get('radio_phonetic') === 'lapd' ? 'lapd' : 'nato'));

  const codes = useMemo(() => {
    if (!q) return TEN_CODES;
    const needle = q.toLowerCase();
    return TEN_CODES.filter((c) => c.code.toLowerCase().includes(needle) || c.meaning.toLowerCase().includes(needle));
  }, [q]);

  const alphabet = phonetic === 'nato' ? PHONETIC_NATO : PHONETIC_LAPD;

  const setPhoneticPersist = (p: Phonetic) => { setPhonetic(p); ls.set('radio_phonetic', p); };

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        icon={<BookOpen className="w-3 h-3" style={{ color: 'var(--rt-accent)' }} />}
        label="REFERENCES — 10-CODES + PHONETIC"
        trailing={
          <div className="flex items-center gap-1.5">
            <FilterChip onClick={() => setPhoneticPersist('nato')} active={phonetic === 'nato'}>NATO</FilterChip>
            <FilterChip onClick={() => setPhoneticPersist('lapd')} active={phonetic === 'lapd'}>LAPD</FilterChip>
          </div>
        }
      />

      <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--rt-border)' }}>
        <Search className="w-3 h-3" style={{ color: 'var(--rt-muted)' }} />
        <input
          type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="search 10-codes…"
          aria-label="Search ten codes"
          className="flex-1 bg-transparent outline-none text-[10px] font-mono"
          style={{ color: 'var(--rt-text)' }}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-px"
        style={{ background: 'var(--rt-border)' }}>
        {/* Ten-codes column */}
        <div style={{ background: 'var(--rt-bg)' }}>
          <div className="px-3 py-1.5 text-[9px] font-mono tracking-[0.3em]"
            style={{ color: 'var(--rt-muted)', borderBottom: '1px solid var(--rt-border)' }}>
            TEN CODES ({codes.length})
          </div>
          <ul>
            {codes.map((c) => (
              <li key={c.code} className="flex items-center gap-3 px-3 py-1 text-[10px] font-mono hover:bg-black/30">
                <span className="font-bold tabular-nums" style={{ color: 'var(--rt-accent)', minWidth: 50 }}>{c.code}</span>
                <span style={{ color: 'var(--rt-text)' }}>{c.meaning}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Phonetic column */}
        <div style={{ background: 'var(--rt-bg)' }}>
          <div className="px-3 py-1.5 text-[9px] font-mono tracking-[0.3em]"
            style={{ color: 'var(--rt-muted)', borderBottom: '1px solid var(--rt-border)' }}>
            PHONETIC — {phonetic.toUpperCase()}
          </div>
          <ul className="grid grid-cols-2 gap-px" style={{ background: 'var(--rt-border)' }}>
            {Object.entries(alphabet).map(([letter, word]) => (
              <li key={letter} className="flex items-center gap-3 px-3 py-1 text-[10px] font-mono hover:bg-black/30"
                style={{ background: 'var(--rt-bg)' }}>
                <span className="font-bold" style={{ color: 'var(--rt-accent)', minWidth: 18 }}>{letter}</span>
                <span style={{ color: 'var(--rt-text)' }}>{word}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
