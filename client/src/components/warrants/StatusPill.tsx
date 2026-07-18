// client/src/components/warrants/StatusPill.tsx
import { formatEnumValue } from '../../utils/formatters';

// Moderate-polish pill treatment for warrant status — see
// docs/superpowers/specs/2026-07-14-warrants-page-rebuild-design.md.
// This is a deliberate, scoped exception to the project-wide dense-table
// "no pill badges" rule (CLAUDE.md, Design tokens section) — do not
// generalize this component's styling to other tables.
const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  active:   { bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/40',    dot: 'bg-red-500' },
  served:   { bg: 'bg-green-500/15',  text: 'text-green-400',  border: 'border-green-500/40',  dot: 'bg-green-500' },
  recalled: { bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/40',  dot: 'bg-amber-500' },
  expired:  { bg: 'bg-rmpg-500/15',   text: 'text-rmpg-300',   border: 'border-rmpg-500/40',   dot: 'bg-rmpg-400' },
  quashed:  { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/40', dot: 'bg-purple-500' },
};
const FALLBACK_STYLE = { bg: 'bg-rmpg-700/40', text: 'text-rmpg-300', border: 'border-rmpg-600/50', dot: 'bg-rmpg-400' };

interface StatusPillProps {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusPill({ status, size = 'sm' }: StatusPillProps) {
  const style = STATUS_STYLES[status] ?? FALLBACK_STYLE;
  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-2 py-0.5'
    : 'text-xs px-2.5 py-1';

  return (
    <span
      data-testid="status-pill"
      className={`inline-flex items-center gap-1.5 font-bold rounded-full border ${style.bg} ${style.text} ${style.border} ${sizeClasses}`}
    >
      <span data-testid="status-pill-dot" className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {formatEnumValue(status.replace(/-/g, '_'))}
    </span>
  );
}
