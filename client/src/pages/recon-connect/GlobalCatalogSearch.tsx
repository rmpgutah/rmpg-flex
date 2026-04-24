import { useMemo, useState } from 'react';
import { Search, ExternalLink } from 'lucide-react';
import catalogData from './originalCatalog.json';

type CatalogEntry = {
  className: string;
  title: string;
  description: string;
  install: string[];
  run: string[];
  projectUrl?: string;
};

const CATALOG = catalogData as Record<string, CatalogEntry[]>;

// category slug → the route that opens its native workspace
const CATEGORY_ROUTES: Record<string, string> = {
  'osint': '/recon-connect/c/osint',
  'web-recon': '/recon-connect/c/web-recon',
  'network-scanning': '/recon-connect/c/network-scanning',
  'password-tools': '/recon-connect/c/password-tools',
  'wireless-attacks': '/recon-connect/wireless',
  'exploitation': '/recon-connect/exploits',
  'active-directory': '/recon-connect/c/active-directory',
  'cloud-security': '/recon-connect/c/cloud-security',
  'mobile-security': '/recon-connect/c/mobile-security',
  'forensics': '/recon-connect/c/forensics',
  'anonymity': '/recon-connect/c/anonymity',
  'reverse-engineering': '/recon-connect/c/reverse-engineering',
  'sql-injection': '/recon-connect/c/sql-injection',
  'social-engineering': '/recon-connect/c/social-engineering',
  'ddos': '/recon-connect/c/ddos',
  'post-exploitation': '/recon-connect/c/post-exploitation',
  'other': '',
};

// Flatten the catalog once
const ALL_TOOLS: Array<{ category: string; entry: CatalogEntry }> = Object.entries(CATALOG).flatMap(
  ([cat, tools]) => tools.map((entry) => ({ category: cat, entry }))
);

export default function GlobalCatalogSearch({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    return ALL_TOOLS.filter(({ entry }) =>
      entry.title.toLowerCase().includes(query) ||
      entry.description.toLowerCase().includes(query)
    ).slice(0, 30);
  }, [q]);

  return (
    <div className="bg-[#141414] border border-[#222]">
      <div className="px-3 py-2 border-b border-[#222] flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-[#d4a017]" />
        <div className="text-[9px] text-[#d4a017] uppercase tracking-wider font-semibold">
          Search all {ALL_TOOLS.length} tools
        </div>
        <input
          type="text"
          placeholder="nmap, sqlmap, exif, wifi, hash…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="ml-auto bg-[#050505] border border-[#2e2e2e] text-[#d4d4d4] text-[11px] px-2 py-1 w-72 focus:border-[#d4a017] outline-none font-mono"
        />
      </div>
      {matches.length > 0 && (
        <div className="max-h-64 overflow-y-auto divide-y divide-[#1a1a1a]">
          {matches.map(({ category, entry }) => {
            const route = CATEGORY_ROUTES[category];
            return (
              <button
                key={`${category}:${entry.className}`}
                onClick={() => route && onNavigate(route)}
                disabled={!route}
                className="w-full text-left px-3 py-2 flex items-start gap-3 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <div className="text-[#d4d4d4] text-xs font-semibold">{entry.title}</div>
                    <div className="text-[#d4a017] text-[9px] font-mono uppercase tracking-wider">{category}</div>
                  </div>
                  <div className="text-[#888] text-[10px] leading-snug line-clamp-2 mt-0.5">{entry.description}</div>
                </div>
                {entry.projectUrl && (
                  <a
                    href={entry.projectUrl}
                    target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[#888] hover:text-[#d4a017]"
                    title="Project URL"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </button>
            );
          })}
        </div>
      )}
      {q.trim().length >= 2 && matches.length === 0 && (
        <div className="px-3 py-4 text-[#555] text-[11px]">No tools match "{q}".</div>
      )}
    </div>
  );
}
