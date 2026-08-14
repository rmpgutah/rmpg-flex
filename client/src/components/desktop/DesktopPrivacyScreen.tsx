import React from 'react';

interface DesktopPrivacyScreenProps {
  onClose: () => void;
}

export default function DesktopPrivacyScreen({ onClose }: DesktopPrivacyScreenProps) {
  return (
    <div
      aria-label="Privacy screen overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'rgba(0,0,0,0.85)',
        pointerEvents: 'none',
      }}
    >
      {/* Badge — pointer-events:auto so user can dismiss */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-default)',
          borderRadius: 2,
          padding: '4px 10px',
          fontSize: 10,
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          pointerEvents: 'auto',
        }}
      >
        <span>Privacy Screen Active</span>
        <button
          onClick={onClose}
          aria-label="Dismiss privacy screen"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-primary)',
            fontSize: 11,
            lineHeight: 1,
            padding: '0 2px',
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
