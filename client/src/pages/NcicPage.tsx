// ============================================================
// RMPG Flex — Standalone NCIC / NLETS Terminal Page
// Full-page wrapper around NcicQueryPanel in embedded mode.
// ============================================================

import React from 'react';
import { Terminal } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import NcicQueryPanel from '../components/NcicQueryPanel';

export default function NcicPage() {
  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PanelTitleBar title="NCIC / NLETS TERMINAL" icon={Terminal} />
      <div className="flex-1 overflow-hidden">
        <NcicQueryPanel isOpen={true} onClose={() => {}} embedded={true} />
      </div>
    </div>
  );
}
