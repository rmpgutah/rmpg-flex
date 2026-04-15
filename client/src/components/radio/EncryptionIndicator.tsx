import React, { useState, useEffect } from 'react';
import { Lock, Unlock, ShieldAlert } from 'lucide-react';

type EncryptionMode = 'secure' | 'clear' | 'scramble';

const LS_KEY = 'rmpg-radio-encryption';

const MODE_CONFIG: Record<EncryptionMode, {
  led: string;
  label: string;
  icon: React.ElementType;
  keyId: string;
}> = {
  secure: { led: '#22c55e', label: 'P25 SECURE', icon: Lock, keyId: '0x4A' },
  clear: { led: '#d4a017', label: 'P25 CLEAR', icon: Unlock, keyId: '0x00' },
  scramble: { led: '#dc2626', label: 'P25 SCRAMBLE', icon: ShieldAlert, keyId: '0x7F' },
};

export default function EncryptionIndicator() {
  const [mode, setMode] = useState<EncryptionMode>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY) as EncryptionMode | null;
      if (stored && stored in MODE_CONFIG) return stored;
    } catch { /* ignore */ }
    return 'secure';
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const config = MODE_CONFIG[mode];
  const IconComponent = config.icon;

  return (
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">
        ENCRYPTION
      </div>

      {/* Status row */}
      <div className="flex items-center gap-2 mb-2">
        {/* LED dot */}
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: config.led,
            boxShadow: `0 0 4px ${config.led}`,
            flexShrink: 0,
          }}
        />
        {/* Icon */}
        <IconComponent className="w-3.5 h-3.5" style={{ color: config.led }} />
        {/* Label */}
        <span
          className="font-mono text-[11px] font-bold tracking-wide"
          style={{ color: config.led }}
        >
          {config.label}
        </span>
      </div>

      {/* Key ID */}
      <div className="text-[9px] font-mono text-[#666666] mb-2">
        Key: {config.keyId}
      </div>

      {/* Toggle buttons */}
      <div className="flex gap-1">
        {(Object.keys(MODE_CONFIG) as EncryptionMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="flex-1 text-[8px] font-bold uppercase tracking-wide py-1 px-1.5 rounded-[2px] transition-all duration-150 border"
            style={{
              background: mode === m ? '#d4a017' : '#111111',
              color: mode === m ? '#000000' : '#666666',
              borderColor: mode === m ? '#d4a017' : '#333333',
            }}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}
