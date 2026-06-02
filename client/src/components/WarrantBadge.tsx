import React from "react";
interface WarrantBadgeProps {
  flags: string | any[];
  size?: 'sm' | 'md';
  onClick?: () => void;
}

function WarrantBadge({ flags, size = 'sm', onClick }: WarrantBadgeProps) {
  let parsed: any[] = [];
  try {
    parsed = typeof flags === 'string' ? JSON.parse(flags || '[]') : (flags || []);
  } catch {
    // Malformed flags JSON: fall back to substring detection so a real
    // ACTIVE_WARRANT flag stored as a raw/garbled string still badges instead
    // of silently rendering nothing (officer-safety signal must not vanish).
    parsed = typeof flags === 'string' && flags.includes('ACTIVE_WARRANT') ? ['ACTIVE_WARRANT'] : [];
  }

  const warrantFlag = parsed.find((f: any) => f?.type === 'ACTIVE_WARRANT' || f === 'ACTIVE_WARRANT');
  if (!warrantFlag) return null;

  const count = typeof warrantFlag === 'object' ? warrantFlag.count : 1;
  const severity = typeof warrantFlag === 'object' ? warrantFlag.severity : 'unknown';

  const severityColors: Record<string, string> = {
    felony: 'bg-red-600 text-white',
    misdemeanor: 'bg-amber-600 text-white',
    infraction: 'bg-yellow-500 text-yellow-950',
    unknown: 'bg-red-500 text-white',
  };

  const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1 font-bold rounded-sm ${severityColors[severity] || severityColors.unknown} ${sizeClasses} ${onClick ? 'cursor-pointer hover:brightness-110' : ''}`}
      onClick={onClick}
      title={`${count} active warrant${count > 1 ? 's' : ''} — ${severity}`}
    >
      WARRANT{count > 1 ? ` (${count})` : ''}
    </span>
  );
}

export default React.memo(WarrantBadge);
