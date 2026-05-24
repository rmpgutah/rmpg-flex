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
    <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${className}`} role="status" aria-label={title}>
      <div className="w-14 h-14 bg-rmpg-800/30 border border-rmpg-700/30 flex items-center justify-center mb-4 panel-inset" aria-hidden="true">
        <Icon size={28} className="text-rmpg-500" style={{ opacity: 0.7 }} />
      </div>
      <h3 className="text-sm font-semibold text-rmpg-300 mb-1.5">{title}</h3>
      {description && (
        <p className="text-xs text-rmpg-500 max-w-xs">{description}</p>
      )}
      {action && (
        <button type="button"
          onClick={action.onClick}
          className="mt-4 toolbar-btn toolbar-btn-primary text-xs"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
