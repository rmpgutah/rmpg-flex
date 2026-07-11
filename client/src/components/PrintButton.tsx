// ============================================================
// RMPG Flex — Print Button (Toolbar Style)
// Plain window.print(); pages with a live Mapbox map that need the
// light-style swap wire that up themselves via mapboxLoader's
// printWithLightMaps() (see e.g. MapboxMapPage). This component must
// NOT statically import mapboxLoader — it's rendered on nearly every
// page (including map-free ones like Dashboard/Records/Reports), and
// mapboxLoader eagerly loads the full mapbox-gl + deck.gl SDK
// (~2.3MB) at module scope. A dead import here was forcing that
// entire bundle onto every page load app-wide (2026-07-02 perf fix).
// Hidden during print via @media print styles.
// ============================================================

import { Printer } from 'lucide-react';

interface PrintButtonProps {
  label?: string;
  className?: string;
}

export default function PrintButton({ label = 'Print', className = '' }: PrintButtonProps) {
  return (
    <button
      type="button"
      className={`toolbar-btn ${className}`}
      onClick={() => window.print()}
      title="Print current view (Ctrl+P)"
    >
      <Printer style={{ width: 12, height: 12 }} />
      <span>{label}</span>
    </button>
  );
}
