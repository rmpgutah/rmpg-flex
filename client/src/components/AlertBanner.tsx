// ============================================================
// RMPG Flex — Alert Banner (Crimson Record Alerts)
// Displays warrants, BOLO matches, and flags at top of record
// detail views with LED indicators and priority-based styling
// ============================================================

import React from 'react';
import { AlertTriangle, Shield, Flag, X } from 'lucide-react';
import type { RecordAlert } from '../types';

interface AlertBannerProps {
  alerts: RecordAlert[];
  onDismiss?: (index: number) => void;
}

const TYPE_ICONS: Record<RecordAlert['type'], React.ElementType> = {
  warrant: Shield,
  bolo: AlertTriangle,
  flag: Flag,
};

export default function AlertBanner({ alerts, onDismiss }: AlertBannerProps) {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="w-full flex flex-col gap-0">
      {alerts.map((alert, index) => {
        const isCritical = alert.priority === 'critical';
        const Icon = TYPE_ICONS[alert.type] || Flag;

        return (
          <div
            key={`${alert.type}-${alert.entity_id || index}`}
            className="w-full flex items-center gap-3 px-3 py-2"
            style={{
              background: isCritical
                ? 'rgba(220, 38, 38, 0.3)'
                : 'rgba(180, 120, 0, 0.2)',
              border: isCritical
                ? '1px solid #991b1b'
                : '1px solid #a07000',
              borderRadius: 0,
            }}
          >
            {/* LED indicator */}
            <span
              className={
                isCritical
                  ? 'led-dot led-red animate-led-blink'
                  : 'led-dot led-amber'
              }
            />

            {/* Type icon */}
            <Icon
              className="w-4 h-4 flex-shrink-0"
              style={{ color: isCritical ? '#ef4444' : '#f59e0b' }}
            />

            {/* Alert content */}
            <div className="flex-1 min-w-0">
              <div
                className="font-bold uppercase tracking-wider text-white"
                style={{ fontSize: '10px', lineHeight: '14px' }}
              >
                {alert.title}
                {alert.entity_id && (
                  <span
                    className="font-mono ml-2"
                    style={{ color: isCritical ? '#fca5a5' : '#fcd34d' }}
                  >
                    {alert.entity_id}
                  </span>
                )}
              </div>
              {alert.description && (
                <div
                  className="text-rmpg-300 truncate"
                  style={{ fontSize: '9px', lineHeight: '12px', marginTop: '1px' }}
                >
                  {alert.description}
                </div>
              )}
            </div>

            {/* Dismiss button */}
            {onDismiss && (
              <button type="button"
                type="button"
                onClick={() => onDismiss(index)}
                className="flex-shrink-0 p-1 hover:bg-white/10 transition-colors"
                style={{ border: 'none', background: 'transparent', borderRadius: 0 }}
                title="Dismiss alert"
              >
                <X
                  className="w-3.5 h-3.5"
                  style={{ color: isCritical ? '#fca5a5' : '#fcd34d' }}
                />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
