// ============================================================
// RMPG Flex — Standalone NCIC Terminal Page
// Full-page wrapper around the NcicQueryPanel in embedded mode.
// ============================================================

import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Terminal } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import NcicQueryPanel from '../components/NcicQueryPanel';
import { useIsMobile } from '../hooks/useIsMobile';

type NcicQueryType = 'person' | 'vehicle' | 'warrant' | 'xref' | 'phone' | 'address' | 'dl' | 'ofac';
const VALID_TYPES: NcicQueryType[] = ['person', 'vehicle', 'warrant', 'xref', 'phone', 'address', 'dl', 'ofac'];

export default function NcicPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => { document.title = 'NCIC / NLETS Terminal \u2014 RMPG Flex'; }, []);

  // Deep-link: /ncic?q=<term>&type=<xref|person|...> auto-runs a query on open
  // (e.g. launched from the Cmd+K command palette). Defaults to a full
  // cross-reference (QX) \u2014 the most useful one-shot lookup.
  const initialQuery = useMemo(() => {
    const q = params.get('q');
    if (!q) return null;
    const t = params.get('type') as NcicQueryType | null;
    return { type: t && VALID_TYPES.includes(t) ? t : 'xref', query: q };
  }, [params]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {!isMobile && (
        <PanelTitleBar title="NCIC / NLETS TERMINAL" icon={Terminal}>
          <span className="text-[8px] font-mono text-rmpg-500 tracking-wider">SECURE CHANNEL</span>
        </PanelTitleBar>
      )}
      <div className="flex-1 overflow-hidden print:overflow-visible">
        <NcicQueryPanel isOpen={true} onClose={() => navigate(-1)} embedded={true} initialQuery={initialQuery} />
      </div>
    </div>
  );
}
