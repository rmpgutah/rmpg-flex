interface WarrantBadgeProps {
  flags: string | any[];
  size?: 'sm' | 'md';
  onClick?: () => void;
}

export default function WarrantBadge({ flags, size = 'sm', onClick }: WarrantBadgeProps) {
  let parsed: any[] = [];
  try {
    parsed = typeof flags === 'string' ? JSON.parse(flags || '[]') : (flags || []);
  } catch { return null; }

  const warrantFlag = parsed.find((f: any) => f?.type === 'ACTIVE_WARRANT' || f === 'ACTIVE_WARRANT');
  if (!warrantFlag) return null;

  const count = typeof warrantFlag === 'object' ? warrantFlag.count : 1;
  const severity = typeof warrantFlag === 'object' ? warrantFlag.severity : 'unknown';

  const severityColors: Record<string, string> = {
    felony: 'bg-red-600 text-white',
    misdemeanor: 'bg-amber-600 text-white',
    infraction: 'bg-yellow-500 text-black',
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
