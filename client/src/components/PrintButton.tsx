// ============================================================
// RMPG Flex — Print Button (Toolbar Style)
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
