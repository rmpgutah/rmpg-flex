import { Printer, Smartphone } from 'lucide-react';
import type { PrintTarget } from '../utils/pdfTokens';

// Dual print button group. Office = laser/letter (default).
// Mobile = Brother PJ-700/800 thermal in-vehicle printers,
// which have a hardware ~6mm leading-edge dead zone — the
// generator pushes top content down 6mm when the doc is tagged
// 'mobile' so nothing gets clipped by the printer's roller bar.
//
// Usage:
//   <PrintButtonGroup
//     onPrint={(target) => downloadRecordPdf('citation', data, id, { printTarget: target })}
//   />
//
// Place anywhere the existing single Print/Download-PDF button
// lives. The component is uniform across record types — even
// office-heavy pages keep the Mobile button so officers have one
// muscle-memory pattern across the whole app.

interface PrintButtonGroupProps {
  onPrint: (target: PrintTarget) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  /** Optional label override — defaults to "Office" / "Mobile". */
  officeLabel?: string;
  mobileLabel?: string;
}

export default function PrintButtonGroup({
  onPrint,
  disabled = false,
  className = '',
  size = 'md',
  officeLabel = 'Office Print',
  mobileLabel = 'Mobile Print',
}: PrintButtonGroupProps) {
  const padding = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  const baseBtn =
    `inline-flex items-center gap-1.5 ${padding} font-semibold uppercase tracking-wide ` +
    `border transition-colors disabled:opacity-50 disabled:cursor-not-allowed`;

  return (
    <div className={`inline-flex items-stretch ${className}`} role="group" aria-label="Print options">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPrint('office')}
        title="Print on office laser / letter paper"
        className={`${baseBtn} bg-[#141414] border-[#222] text-white hover:bg-[#1c1c1c] hover:border-[#d4a017] rounded-l-[2px] -mr-px`}
      >
        <Printer className={iconSize} aria-hidden="true" />
        <span>{officeLabel}</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPrint('mobile')}
        title="Print on in-vehicle Brother PJ thermal printer (+6mm top offset)"
        className={`${baseBtn} bg-[#141414] border-[#222] text-[#d4a017] hover:bg-[#1c1c1c] hover:border-[#d4a017] rounded-r-[2px]`}
      >
        <Smartphone className={iconSize} aria-hidden="true" />
        <span>{mobileLabel}</span>
      </button>
    </div>
  );
}
