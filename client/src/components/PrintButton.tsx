// ============================================================
// RMPG Flex — Print Button (Toolbar Style)
// Switches Google Maps to light style before printing, then
// restores dark style after the print dialog closes.
// Hidden during print via @media print styles.
// ============================================================

import { Printer } from 'lucide-react';
import { printWithLightMaps } from '../utils/googleMapsLoader';

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
