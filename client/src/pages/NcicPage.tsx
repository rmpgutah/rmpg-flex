// ============================================================
// RMPG Flex — Standalone NCIC Terminal Page
// Full-page wrapper around the NcicQueryPanel in embedded mode.
// ============================================================

import React, { useEffect } from 'react';
import { Terminal } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import NcicQueryPanel from '../components/NcicQueryPanel';
import { useIsMobile } from '../hooks/useIsMobile';

export default function NcicPage() {
  const isMobile = useIsMobile();

  useEffect(() => { document.title = 'NCIC / NLETS Terminal \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {!isMobile && (
        <PanelTitleBar title="NCIC / NLETS TERMINAL" icon={Terminal}>
          <span className="text-[8px] font-mono text-rmpg-500 tracking-wider">SECURE CHANNEL</span>
        </PanelTitleBar>
      )}
      <div className="flex-1 overflow-hidden print:overflow-visible">
        <NcicQueryPanel isOpen={true} onClose={() => {}} embedded={true} />
      </div>
    </div>
  );
}
