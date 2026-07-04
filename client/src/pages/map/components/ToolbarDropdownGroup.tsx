import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import IconButton from '../../../components/IconButton';

interface ToolbarDropdownGroupProps {
  icon: LucideIcon;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** A collapsible group of related map-toolbar toggles, sharing one trigger
 *  button. Matches the existing "Advanced map tools" expand/collapse pattern
 *  in MapboxMapPage.tsx — extracted here so Overlays/Analysis/Drawing &
 *  Measure/View can each reuse it instead of duplicating the trigger markup. */
export default function ToolbarDropdownGroup({
  icon: Icon, label, open, onToggle, children,
}: ToolbarDropdownGroupProps) {
  const panelId = `toolbar-dropdown-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="flex flex-col gap-1">
      <IconButton
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={`bg-surface-raised/95 border border-border-default p-2 backdrop-blur-sm ${
          open ? 'text-brand-gold-500' : 'text-rmpg-300 hover:text-brand-gold-500'
        }`}
        style={{ borderRadius: 2 }}
        title={label}
      >
        <Icon className="w-4 h-4" />
      </IconButton>
      {open && (
        <div id={panelId} className="flex flex-col gap-1">
          {children}
        </div>
      )}
    </div>
  );
}
