// ============================================================
// RMPG Flex — Location Warning Banner
// Shows a dismissible warning banner when GPS location
// permission is denied. Does NOT block app access.
// ============================================================

import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface LocationGateProps {
  permissionDenied: boolean;
  permissionPending: boolean;
  error: string | null;
  onRetry: () => void;
}

export default function LocationGate({ permissionDenied, onRetry }: LocationGateProps) {
  const [dismissed, setDismissed] = useState(false);

  // Nothing to show — permissionPending is intentionally silent (no bar)
  if (dismissed || !permissionDenied) return null;

  // Dismissible warning banner when permission denied
  if (permissionDenied) {
    return (
      <div style={{
        background: 'rgba(188, 16, 16, 0.12)',
        borderBottom: '1px solid #5a1010',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 11,
      }}>
        <AlertTriangle size={14} color="#d93030" style={{ flexShrink: 0 }} />
        <span style={{ color: '#ccc', flex: 1 }}>
          <strong style={{ color: '#d93030' }}>Location disabled</strong>
          {' — '}GPS tracking is not active. Enable location access in your browser or device settings for full functionality.
        </span>
        <button
          onClick={onRetry}
          style={{
            padding: '3px 10px',
            background: '#bc1010',
            color: '#fff',
            border: 'none',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            cursor: 'pointer',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          Retry
        </button>
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            flexShrink: 0,
          }}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return null;
}
