// ============================================================
// RMPG Flex — Warrant Alert Banner
// Persistent floating notification for real-time warrant hits
// Used in DispatchPage and MdtPage via WebSocket events
// ============================================================

import { AlertTriangle, X, ExternalLink } from 'lucide-react';
import { formatEnumValue } from '../utils/formatters';

export interface WarrantAlert {
  id: string;
  callId?: number | string;
  callNumber?: string;
  personName: string;
  severity: 'felony' | 'misdemeanor' | 'bench' | 'civil' | null;
  charge?: string;
  source?: string;
  receivedAt: number;
}

const SEVERITY_STYLES: Record<string, string> = {
  felony: 'bg-red-950 border-red-700 text-red-200',
  misdemeanor: 'bg-amber-950 border-amber-700 text-amber-200',
  bench: 'bg-orange-950 border-orange-700 text-orange-200',
  civil: 'bg-gray-950 border-gray-700 text-gray-200',
};

interface Props {
  alerts: WarrantAlert[];
  onDismiss: (id: string) => void;
  onViewCall?: (callId: number | string) => void;
}

export default function WarrantAlertBanner({ alerts, onDismiss, onViewCall }: Props) {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-[120px] right-4 z-[200] flex flex-col gap-2 max-w-sm">
      {alerts.map(alert => (
        <div
          key={alert.id}
          className={`flex items-start gap-3 p-3 rounded-sm border text-sm shadow-xl animate-in slide-in-from-right ${(alert.severity && SEVERITY_STYLES[alert.severity]) || 'bg-red-950 border-red-700 text-red-200'}`}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="font-bold font-mono text-xs uppercase tracking-wider">
              ⚠ WARRANT HIT {alert.severity ? `— ${formatEnumValue(alert.severity)}` : ''}
            </div>
            <div className="font-semibold truncate">{alert.personName}</div>
            {alert.charge && <div className="text-xs opacity-75 truncate">{alert.charge}</div>}
            {alert.callNumber && <div className="text-xs opacity-60">Call: {alert.callNumber}</div>}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            {onViewCall && alert.callId != null && (
              <button type="button"
                onClick={() => onViewCall(alert.callId!)}
                className="text-xs underline opacity-75 hover:opacity-100 flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> View
              </button>
            )}
            <button type="button" onClick={() => onDismiss(alert.id)} className="text-xs opacity-60 hover:opacity-100" aria-label="Dismiss warrant alert">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
