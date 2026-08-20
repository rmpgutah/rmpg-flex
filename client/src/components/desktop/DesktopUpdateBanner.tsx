import React, { useRef } from 'react';
import { Download } from 'lucide-react';
import { useDesktopSystem } from '../../context/DesktopSystemContext';

interface Props { taskbarHeightPx: number; hasActiveCall: boolean; }

export default function DesktopUpdateBanner({ taskbarHeightPx, hasActiveCall }: Props) {
  const { updateAvailable, dismissUpdate } = useDesktopSystem();
  const dismissed = useRef<string | null>(null);
  if (!updateAvailable || dismissed.current === updateAvailable) return null;
  const bottom = taskbarHeightPx + (hasActiveCall ? 24 : 0);
  return (
    <div style={{
      position: 'fixed', bottom, left: 0, right: 0, height: 28,
      background: 'var(--surface-raised)', borderTop: '1px solid var(--border-subtle)',
      display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
      zIndex: 9999,
    }}>
      <Download className="w-3 h-3" style={{ color: 'var(--brand-400)' }} />
      <span style={{ fontSize: 10, color: 'var(--text-primary)' }}>FlexOS update {updateAvailable} is ready</span>
      <button
        type="button"
        onClick={() => {
          try {
            (window as any).electron?.installUpdate?.();
          } catch { /* non-Electron */ }
        }}
        style={{ fontSize: 9, padding: '2px 10px', background: 'var(--brand-400)', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}
      >
        Install &amp; Restart
      </button>
      <button
        type="button"
        onClick={() => { dismissed.current = updateAvailable; dismissUpdate(); }}
        style={{ fontSize: 9, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}
      >
        Later
      </button>
    </div>
  );
}
