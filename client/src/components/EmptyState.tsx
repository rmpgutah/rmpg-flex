import React from 'react';
import { type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export default function EmptyState({ icon: Icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${className}`}>
      <div className="w-14 h-14 rounded-sm bg-rmpg-800/50 border border-rmpg-700/50 flex items-center justify-center mb-4">
        <Icon size={28} className="text-rmpg-500" />
      </div>
      <h3 className="text-sm font-semibold text-rmpg-300 mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-rmpg-500 max-w-xs">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 toolbar-btn toolbar-btn-primary text-xs"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
