import React, { useState } from 'react';
import type { OfficerWithStatus } from '../utils/personnelMappers';

interface Props {
  officer: OfficerWithStatus;
  size?: 'sm' | 'md' | 'lg';
  showStatusDot?: boolean;
}

const SIZE_CLASSES = { sm: 'w-8 h-8 text-[10px]', md: 'w-10 h-10 text-xs', lg: 'w-14 h-14 text-lg' };
const IMG_SIZES = { sm: 32, md: 40, lg: 56 };

export default function OfficerAvatar({ officer, size = 'md', showStatusDot = true }: Props) {
  const borderClasses = size === 'lg' ? 'border-2' : 'border';
  const [imgError, setImgError] = useState(false);
  const hasImage = !!(officer as any).profile_image && !imgError;
  const isOnDuty = officer.status === 'on_duty';

  return (
    <div className="relative flex-shrink-0 record-avatar" style={{ transition: 'border-color 0.2s ease, box-shadow 0.2s ease' }}>
      {hasImage ? (
        <img
          src={(officer as any).profile_image}
          alt={`${officer.first_name} ${officer.last_name}`}
          className={`${SIZE_CLASSES[size]} rounded-full object-cover ${borderClasses} ${
            isOnDuty ? 'border-green-700/50' : 'border-rmpg-600'
          }`}
          style={{ width: IMG_SIZES[size], height: IMG_SIZES[size], transition: 'border-color 0.2s ease' }}
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={`${SIZE_CLASSES[size]} rounded-full flex items-center justify-center font-bold ${borderClasses} ${
            isOnDuty
              ? 'bg-green-900/40 text-green-400 border-green-700/50'
              : 'bg-rmpg-700 text-rmpg-400 border-rmpg-600'
          }`}
          style={{ transition: 'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease' }}
        >
          {officer.badge_number || `${(officer.first_name || '')[0] || ''}${(officer.last_name || '')[0] || ''}`}
        </div>
      )}
      {showStatusDot && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 ${size === 'lg' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} rounded-full border-2 border-surface-base ${
            isOnDuty ? 'bg-green-400' : 'bg-gray-500'
          }`}
          style={isOnDuty ? { boxShadow: '0 0 6px rgba(34,197,94,0.6)', animation: 'clock-ring-pulse 2.5s ease-in-out infinite' } : undefined}
        />
      )}
    </div>
  );
}
