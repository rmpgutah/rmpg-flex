// ============================================================
// RMPG Flex — Standalone NCIC Terminal Page
// Full-page wrapper around the NcicQueryPanel in embedded mode.
// ============================================================

import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Terminal, FileText } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import NcicQueryPanel, { type NcicQueryPanelHandle } from '../components/NcicQueryPanel';
import { useIsMobile } from '../hooks/useIsMobile';
import { generateNcicReferencePdf } from '../utils/ncicReferencePdf';
import { useAuth } from '../context/AuthContext';

type NcicQueryType = 'person' | 'vehicle' | 'warrant' | 'xref' | 'phone' | 'address' | 'dl' | 'ofac';
const VALID_TYPES: NcicQueryType[] = ['person', 'vehicle', 'warrant', 'xref', 'phone', 'address', 'dl', 'ofac'];

export default function NcicPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const canManage = ['admin', 'manager'].includes(user?.role ?? '');
  const panelRef = useRef<NcicQueryPanelHandle>(null);

  useEffect(() => { document.title = 'NCIC / NLETS Terminal — RMPG Flex'; }, []);

  // Strip deep-link params after they have been consumed (replace so Back works)
  useEffect(() => {
    if (params.get('q') || params.get('type')) {
      setSearchParams({}, { replace: true });
    }
  }, []); // run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // Deep-link: /ncic?q=<term>&type=<xref|person|...> auto-runs a query on open
  // (e.g. launched from the Cmd+K command palette). Defaults to a full
  // cross-reference (QX) — the most useful one-shot lookup.
  const initialQuery = useMemo(() => {
    const q = params.get('q');
    if (!q) return null;
    const t = params.get('type') as NcicQueryType | null;
    return { type: t && VALID_TYPES.includes(t) ? t : 'xref', query: q };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global N shortcut — focus the query input
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'N' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      panelRef.current?.focusInput();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Esc cascade — navigate back when no modal is open
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      navigate(-1);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [navigate]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {!isMobile && (
        <PanelTitleBar title="NCIC / NLETS TERMINAL" icon={Terminal}>
          <span className="text-[8px] font-mono text-rmpg-500 tracking-wider">SECURE CHANNEL</span>
          <IconButton
            aria-label="Download NCIC Operator Reference Guide (PDF)"
            title="Reference Guide (PDF)"
            onClick={() => generateNcicReferencePdf()}
            className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold tracking-wide text-brand-400 hover:text-brand-300 border border-rmpg-700 hover:border-brand-500 bg-surface-raised"
          >
            <FileText size={11} />
            <span>REFERENCE GUIDE</span>
          </IconButton>
        </PanelTitleBar>
      )}
      <div className="flex-1 overflow-hidden print:overflow-visible">
        <NcicQueryPanel
          ref={panelRef}
          isOpen={true}
          onClose={() => navigate(-1)}
          embedded={true}
          initialQuery={initialQuery}
          canManage={canManage}
        />
      </div>
    </div>
  );
}
