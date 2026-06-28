// ═══════════════════════════════════════════════════════════════
// Feature 18: Form Auto-Save Indicator
// Shows "Saving..." / "Saved" / "Error" indicator
// ═══════════════════════════════════════════════════════════════
import { Check, Loader2, AlertCircle, Cloud } from 'lucide-react';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface FormAutoSaveIndicatorProps {
  status: SaveStatus;
  lastSaved?: Date | null;
  className?: string;
}

export default function FormAutoSaveIndicator({ status, lastSaved, className = '' }: FormAutoSaveIndicatorProps) {
  const statusConfig = {
    idle: { icon: Cloud, text: 'Auto-save enabled', color: 'text-rmpg-500' },
    saving: { icon: Loader2, text: 'Saving...', color: 'text-brand-400' },
    saved: { icon: Check, text: 'Saved', color: 'text-green-400' },
    error: { icon: AlertCircle, text: 'Save failed', color: 'text-red-400' },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Icon className={`w-3 h-3 ${config.color} ${status === 'saving' ? 'animate-spin' : ''}`} />
      <span className={`text-[9px] font-bold uppercase tracking-wider ${config.color}`}>
        {config.text}
      </span>
      {status === 'saved' && lastSaved && (
        <span className="text-[9px] text-rmpg-600 font-mono ml-1">
          {lastSaved.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}
