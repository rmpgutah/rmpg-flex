import { useMemo, useState } from 'react';
import {
  FileText, FileCheck, Shield, FilePlus, Package, Mail, File, Search,
  Car, Heart, Users, Lock, ClipboardList, Building2, Briefcase, Gavel, ScrollText, Scale,
  Star,
} from 'lucide-react';
import { TEMPLATES } from '../templates';
import type { DocumentTemplate, TemplateCategory } from '../types';
import PanelTitleBar from '../../../components/PanelTitleBar';

interface Props {
  onSelect: (template: DocumentTemplate, values: Record<string, string>) => void;
}

const CATEGORY_ICONS: Record<TemplateCategory, React.ReactNode> = {
  incident: <FileText className="w-5 h-5" />,
  arrest: <FileCheck className="w-5 h-5" />,
  'use-of-force': <Shield className="w-5 h-5" />,
  supplemental: <FilePlus className="w-5 h-5" />,
  evidence: <Package className="w-5 h-5" />,
  memo: <Mail className="w-5 h-5" />,
  letter: <Mail className="w-5 h-5" />,
  general: <File className="w-5 h-5" />,
  'le-traffic': <Car className="w-5 h-5" />,
  'le-dv': <Heart className="w-5 h-5" />,
  'le-juvenile': <Users className="w-5 h-5" />,
  'le-investigation': <Search className="w-5 h-5" />,
  'le-pursuit': <Shield className="w-5 h-5" />,
  'le-property': <Package className="w-5 h-5" />,
  'le-missing': <Users className="w-5 h-5" />,
  'sec-post': <ClipboardList className="w-5 h-5" />,
  'sec-dar': <ClipboardList className="w-5 h-5" />,
  'sec-client': <Building2 className="w-5 h-5" />,
  'sec-access': <Lock className="w-5 h-5" />,
  'sec-patrol': <Shield className="w-5 h-5" />,
  'hr-employee': <Briefcase className="w-5 h-5" />,
  'hr-discipline': <Briefcase className="w-5 h-5" />,
  'hr-training': <Briefcase className="w-5 h-5" />,
  'hr-leave': <Briefcase className="w-5 h-5" />,
  'legal-court': <Gavel className="w-5 h-5" />,
  'legal-warrant': <ScrollText className="w-5 h-5" />,
  'legal-affidavit': <ScrollText className="w-5 h-5" />,
  'legal-discovery': <Scale className="w-5 h-5" />,
};

type TopGroup = 'all' | 'starred' | 'le' | 'security' | 'hr' | 'legal' | 'misc';

const GROUPS: { id: TopGroup; label: string; match: (c: TemplateCategory) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'starred', label: 'Starred', match: () => false }, // handled separately
  { id: 'le', label: 'Law Enforcement', match: (c) => c.startsWith('le-') || c === 'incident' || c === 'arrest' || c === 'use-of-force' || c === 'supplemental' || c === 'evidence' },
  { id: 'security', label: 'Security', match: (c) => c.startsWith('sec-') },
  { id: 'hr', label: 'HR / Admin', match: (c) => c.startsWith('hr-') },
  { id: 'legal', label: 'Legal / Court', match: (c) => c.startsWith('legal-') },
  { id: 'misc', label: 'Misc', match: (c) => c === 'memo' || c === 'letter' || c === 'general' },
];

const STAR_KEY = 'rmpg_writer_starred';
function readStarred(): Set<string> {
  try { const raw = localStorage.getItem(STAR_KEY); return raw ? new Set(JSON.parse(raw)) : new Set(); }
  catch { return new Set(); }
}
function writeStarred(s: Set<string>) { localStorage.setItem(STAR_KEY, JSON.stringify([...s])); }

export default function TemplateChooser({ onSelect }: Props) {
  const [selected, setSelected] = useState<DocumentTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [group, setGroup] = useState<TopGroup>('all');
  const [query, setQuery] = useState('');
  const [starred, setStarred] = useState<Set<string>>(readStarred);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inGroup = (t: DocumentTemplate) => {
      if (group === 'starred') return starred.has(t.id);
      return GROUPS.find(g => g.id === group)!.match(t.category);
    };
    return TEMPLATES.filter(t => {
      if (!inGroup(t)) return false;
      if (!q) return true;
      const hay = `${t.name} ${t.description} ${t.tags?.join(' ') || ''} ${t.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [group, query, starred]);

  const grouped = useMemo(() => {
    const m = new Map<TemplateCategory, DocumentTemplate[]>();
    for (const t of filtered) {
      const arr = m.get(t.category) || [];
      arr.push(t);
      m.set(t.category, arr);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const toggleStar = (id: string) => {
    setStarred(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeStarred(next);
      return next;
    });
  };

  const handleUse = () => {
    if (!selected) return;
    onSelect(selected, values);
  };

  if (selected) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <PanelTitleBar title={selected.name.toUpperCase()} icon={FileText} />
        <p className="text-xs text-rmpg-500 mt-2 mb-2">{selected.description}</p>
        {selected.statutes && selected.statutes.length > 0 && (
          <p className="text-[10px] text-[#d4a017] mb-4"><strong>Utah Code:</strong> {selected.statutes.join(' · ')}</p>
        )}

        {selected.fields.length > 0 && (
          <div className="space-y-3 mb-6">
            <p className="text-[11px] text-rmpg-400 font-medium uppercase tracking-wide">Fill in fields (or leave blank to fill later):</p>
            {selected.fields.map(f => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="text-[11px] text-rmpg-300 w-36 text-right flex-shrink-0">{f.label}:</label>
                <input
                  type="text"
                  value={values[f.key] || ''}
                  onChange={(e) => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.source === 'cad' ? `Auto-fill from CAD (${f.cadPath})` : 'Enter value...'}
                  className="flex-1 bg-[#0a0a0a] border border-[#222] rounded-[2px] px-2.5 py-1.5 text-xs text-rmpg-200 placeholder-rmpg-600 focus:border-[#d4a017]/50 focus:outline-none"
                />
                {f.source === 'cad' && <span className="text-[9px] text-[#d4a017]/60 font-mono">CAD</span>}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button type="button" onClick={handleUse}
            className="px-4 py-2 text-xs font-medium bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20">
            Create Document
          </button>
          <button type="button" onClick={() => { setSelected(null); setValues({}); }}
            className="px-4 py-2 text-xs text-rmpg-400 hover:text-rmpg-200">
            ← Back to templates
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PanelTitleBar title="NEW DOCUMENT" icon={FileText} />
      <p className="text-xs text-rmpg-500 mt-2 mb-4">{TEMPLATES.length} templates available. Filter by category, search, or star your favorites.</p>

      {/* Search + tabs */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates (name, tag, statute, category)..."
            className="w-full bg-[#0a0a0a] border border-[#222] rounded-[2px] pl-8 pr-3 py-2 text-xs text-rmpg-200 placeholder-rmpg-600 focus:border-[#d4a017]/50 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GROUPS.map(g => {
            const count = g.id === 'starred' ? starred.size : TEMPLATES.filter(t => g.match(t.category)).length;
            const active = group === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={`px-3 py-1 text-[11px] rounded-[2px] border transition-colors ${active ? 'bg-[#d4a017]/15 border-[#d4a017]/40 text-[#d4a017]' : 'bg-[#0d0d0d] border-[#222] text-rmpg-400 hover:text-rmpg-200 hover:border-[#333]'}`}
              >
                {g.label} <span className="text-rmpg-600 ml-1">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-xs text-rmpg-500">No templates match.</div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <h3 className="text-[10px] uppercase tracking-wider text-rmpg-500 mb-2 flex items-center gap-2 border-b border-[#1a1a1a] pb-1">
                <span className="text-[#d4a017]">{CATEGORY_ICONS[cat] || <File className="w-4 h-4" />}</span>
                {cat.replace(/-/g, ' ')}
                <span className="text-rmpg-600 normal-case">({items.length})</span>
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {items.map(t => {
                  const isStar = starred.has(t.id);
                  return (
                    <div key={t.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setSelected(t)}
                        className="w-full flex flex-col items-start gap-1 p-3 bg-[#0d0d0d] border border-[#222] rounded-[2px] hover:border-[#d4a017]/40 hover:bg-[#141414] transition-colors text-left"
                      >
                        <span className="text-[11px] font-medium text-rmpg-200 leading-tight">{t.name}</span>
                        <span className="text-[9px] text-rmpg-500 leading-tight line-clamp-2">{t.description}</span>
                        {t.tags && t.tags.length > 0 && (
                          <span className="text-[8px] text-rmpg-600 mt-0.5 truncate w-full">{t.tags.slice(0, 4).join(' · ')}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        title={isStar ? 'Unstar' : 'Star'}
                        onClick={(e) => { e.stopPropagation(); toggleStar(t.id); }}
                        className={`absolute top-1.5 right-1.5 p-0.5 rounded-[2px] ${isStar ? 'text-[#d4a017]' : 'text-rmpg-700 opacity-0 group-hover:opacity-100 hover:text-[#d4a017]'}`}
                      >
                        <Star className="w-3 h-3" fill={isStar ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
