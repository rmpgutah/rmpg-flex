import { useMemo, useRef, useState } from 'react';
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

interface Props {
  onNavigate: (path: string) => void;
  /** Optional ref forwarded from parent so the N shortcut can focus the input */
  searchRef?: React.RefObject<HTMLInputElement | null>;
}

export default function GlobalCatalogSearch({ onNavigate, searchRef }: Props) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const inputRef = searchRef ?? internalRef;
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
    <div className="bg-surface-base border border-border-default">
      <div className="px-3 py-2 border-b border-border-default flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-brand-400" />
        <div className="text-[9px] text-brand-400 uppercase tracking-wider font-semibold">
          Search all {ALL_TOOLS.length} tools
        </div>
        <input id="ff-globalcatalogsearch-0"
          ref={inputRef}
          type="text"
          placeholder="nmap, sqlmap, exif, wifi, hash…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="ml-auto bg-surface-overlay border border-rmpg-700 text-rmpg-200 text-[11px] px-2 py-1 w-72 focus:border-brand-400 outline-none font-mono"
        />
      </div>
      {q.trim().length >= 2 && matches.length === 0 && (
        <div className="px-3 py-4 text-rmpg-500 text-[11px]">No tools match "{q}".</div>
      )}
      {matches.length > 0 && (
        <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border-subtle)]">
          {matches.map(({ category, entry }) => {
            const route = CATEGORY_ROUTES[category];
            return (
              <button
                key={`${category}:${entry.className}`}
                onClick={() => route && onNavigate(route)}
                disabled={!route}
                className="w-full text-left px-3 py-2 flex items-start gap-3 hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <div className="text-rmpg-200 text-xs font-semibold">{entry.title}</div>
                    <div className="text-brand-400 text-[9px] font-mono uppercase tracking-wider">{category}</div>
                  </div>
                  <div className="text-rmpg-400 text-[10px] leading-snug line-clamp-2 mt-0.5">{entry.description}</div>
                </div>
                {entry.projectUrl && (
                  <a
                    href={entry.projectUrl}
                    target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-rmpg-400 hover:text-brand-400"
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
    </div>
  );
}
