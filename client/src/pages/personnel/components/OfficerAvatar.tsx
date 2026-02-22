import React from 'react';
import type { OfficerWithStatus } from '../utils/personnelMappers';

interface Props {
  officer: OfficerWithStatus;
  size?: 'sm' | 'md' | 'lg';
  showStatusDot?: boolean;
}

const SIZE_CLASSES = { sm: 'w-8 h-8 text-[10px]', md: 'w-10 h-10 text-xs', lg: 'w-14 h-14 text-lg' };

export default function OfficerAvatar({ officer, size = 'md', showStatusDot = true }: Props) {
  const borderClasses = size === 'lg' ? 'border-2' : 'border';
  return (
    <div className="relative flex-shrink-0">
      <div className={`${SIZE_CLASSES[size]} rounded-full flex items-center justify-center font-bold ${borderClasses} ${
        officer.status === 'on_duty'
          ? 'bg-green-900/40 text-green-400 border-green-700/50'
          : 'bg-rmpg-700 text-rmpg-400 border-rmpg-600'
      }`}>
        {officer.badge_number || `${officer.first_name[0] || ''}${officer.last_name[0] || ''}`}
      </div>
      {showStatusDot && (
        <span className={`absolute -bottom-0.5 -right-0.5 ${size === 'lg' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'} rounded-full border-2 border-surface-base ${
          officer.status === 'on_duty' ? 'bg-green-400 shadow-[0_0_4px_rgba(34,197,94,0.6)]' : 'bg-gray-500'
        }`} />
      )}
    </div>
  );
}
