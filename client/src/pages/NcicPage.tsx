// ============================================================
// RMPG Flex — Standalone NCIC Terminal Page
// Full-page wrapper around the NcicQueryPanel in embedded mode.
// ============================================================

import React from 'react';
import { Terminal } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import NcicQueryPanel from '../components/NcicQueryPanel';
import { useIsMobile } from '../hooks/useIsMobile';

export default function NcicPage() {
  const isMobile = useIsMobile();
  return (
    <div className="flex flex-col h-full animate-fade-in">
      {!isMobile && <PanelTitleBar title="NCIC / NLETS TERMINAL" icon={Terminal} />}
      <div className="flex-1 overflow-hidden">
        <NcicQueryPanel isOpen={true} onClose={() => {}} embedded={true} />
      </div>
    </div>
  );
}
