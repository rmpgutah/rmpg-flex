import { useState } from 'react';
import type { OfficerWithStatus } from '../utils/personnelMappers';

interface Props {
  officer: OfficerWithStatus;
  size?: 'sm' | 'md' | 'lg';
  showStatusDot?: boolean;
}

const SIZE_CLASSES = { sm: 'w-8 h-8 text-[10px]', md: 'w-10 h-10 text-xs', lg: 'w-14 h-14 text-lg' };
const IMG_SIZES = { sm: 32, md: 40, lg: 56 };
const DOT_SIZES = { sm: 'w-2.5 h-2.5', md: 'w-3 h-3', lg: 'w-3.5 h-3.5' };

export default function OfficerAvatar({ officer, size = 'md', showStatusDot = true }: Props) {
  const borderClasses = size === 'lg' ? 'border-2' : 'border';
  const [imgError, setImgError] = useState(false);
  const hasImage = !!(officer as any).profile_image && !imgError;

  return (
    <div className="relative flex-shrink-0 group" role="img" aria-label={`${officer.first_name} ${officer.last_name} — ${officer.status === 'on_duty' ? 'On Duty' : 'Off Duty'}`}>
      {hasImage ? (
        <img
          src={(officer as any).profile_image}
          alt={`${officer.first_name} ${officer.last_name}`}
          className={`${SIZE_CLASSES[size]} rounded-full object-cover ${borderClasses} transition-all duration-200 group-hover:brightness-110 ${
            officer.status === 'on_duty' ? 'border-green-700/50 shadow-[0_0_6px_rgba(34,197,94,0.15)]' : 'border-rmpg-600'
          }`}
          style={{ width: IMG_SIZES[size], height: IMG_SIZES[size] }}
          onError={() => setImgError(true)}
        />
      ) : (
        <div className={`${SIZE_CLASSES[size]} rounded-full flex items-center justify-center font-bold tracking-wide ${borderClasses} transition-all duration-200 group-hover:brightness-110 ${
          officer.status === 'on_duty'
            ? 'bg-green-900/40 text-green-400 border-green-700/50 shadow-[0_0_6px_rgba(34,197,94,0.15)]'
            : 'bg-rmpg-700 text-rmpg-400 border-rmpg-600'
        }`}>
          {officer.badge_number || `${(officer.first_name || '')[0] || ''}${(officer.last_name || '')[0] || ''}`}
        </div>
      )}
      {showStatusDot && (
        <span className={`absolute -bottom-0.5 -right-0.5 ${DOT_SIZES[size]} rounded-full border-2 border-surface-base transition-colors duration-200 ${
          officer.status === 'on_duty' ? 'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-rmpg-500'
        }`} aria-hidden="true" />
      )}
    </div>
  );
}
