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
    <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`} role="status" aria-label={title}>
      <div
        className="w-12 h-12 flex items-center justify-center mb-3"
        style={{
          background: 'rgba(212,160,23,0.08)',
          border: '1px solid rgba(212,160,23,0.15)',
        }}
        aria-hidden="true"
      >
        <Icon size={24} color="#d4a017" style={{ opacity: 0.5 }} />
      </div>
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#666666] mb-1.5">{title}</h3>
      {description && (
        <p className="text-[10px] text-[#555555] max-w-xs leading-relaxed">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="btn-gold mt-3"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
