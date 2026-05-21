// ============================================================
// RMPG Flex — Print Button (Toolbar Style)
// Switches Mapbox maps to light style before printing, then
// restores dark style after the print dialog closes.
// Hidden during print via @media print styles.
// ============================================================

import React from 'react';
import { Printer } from 'lucide-react';
import { printWithLightMaps } from '../utils/mapboxLoader';

interface PrintButtonProps {
  label?: string;
  className?: string;
}

export default function PrintButton({ label = 'Print', className = '' }: PrintButtonProps) {
  return (
    <button
      type="button"
      className={`toolbar-btn ${className}`}
      onClick={() => printWithLightMaps()}
      title="Print current view (Ctrl+P)"
    >
      <Printer style={{ width: 12, height: 12 }} />
      <span>{label}</span>
    </button>
  );
}
