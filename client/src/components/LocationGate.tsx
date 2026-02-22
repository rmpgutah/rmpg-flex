// ============================================================
// RMPG Flex — Mandatory Location Gate
// Blocks app access if the user denies GPS location permission.
// All RMPG Flex users MUST share their location while using
// the app on any platform (Windows, macOS, Android, Web).
// ============================================================

import React from 'react';
import { MapPin, AlertTriangle, RefreshCw } from 'lucide-react';

interface LocationGateProps {
  permissionDenied: boolean;
  permissionPending: boolean;
  error: string | null;
  onRetry: () => void;
}

export default function LocationGate({ permissionDenied, permissionPending, error, onRetry }: LocationGateProps) {
  // Show pending screen briefly while requesting permission
  if (permissionPending) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99998,
          background: 'rgba(0, 0, 0, 0.95)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: '#fff',
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            border: '3px solid #bc1010',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
            animation: 'pulse 2s ease-in-out infinite',
          }}
        >
          <MapPin size={32} color="#bc1010" />
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>
          Location Access Required
        </h2>
        <p style={{ fontSize: 13, color: '#888', maxWidth: 360, textAlign: 'center', lineHeight: 1.6 }}>
          RMPG Flex requires your location to operate. Please allow location access when prompted.
        </p>

        <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 8, color: '#666', fontSize: 13 }}>
          <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Requesting location permission...
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        `}</style>
      </div>
    );
  }

  // Show blocking overlay if permission denied
  if (permissionDenied) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99998,
          background: 'rgba(10, 0, 0, 0.97)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: '#fff',
          padding: '20px',
        }}
      >
        <div
          style={{
            width: 100,
            height: 100,
            border: '3px solid #d93030',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <AlertTriangle size={40} color="#d93030" />
        </div>

        <h2 style={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: 'uppercase',
          marginBottom: 8,
          color: '#d93030',
          textAlign: 'center',
        }}>
          Location Required
        </h2>

        <p style={{
          fontSize: 14,
          color: '#aaa',
          maxWidth: 420,
          textAlign: 'center',
          marginBottom: 12,
          lineHeight: 1.7,
        }}>
          RMPG Flex <strong>requires</strong> location sharing for all users on all devices.
          You must enable location access to continue using this application.
        </p>

        <div style={{
          background: 'rgba(188, 16, 16, 0.15)',
          border: '1px solid #8a0c0c',
          padding: '16px 24px',
          maxWidth: 420,
          marginBottom: 24,
          textAlign: 'left',
        }}>
          <p style={{ fontSize: 12, color: '#c8c8c8', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            How to enable:
          </p>
          <ul style={{ fontSize: 12, color: '#a0a0a0', lineHeight: 1.8, paddingLeft: 16, margin: 0 }}>
            <li><strong>Android:</strong> Open Settings &rarr; Apps &rarr; RMPG Flex &rarr; Permissions &rarr; Location &rarr; Allow</li>
            <li><strong>Chrome:</strong> Click the lock icon in the address bar &rarr; Location &rarr; Allow</li>
            <li><strong>Windows/macOS:</strong> Check browser or OS location settings</li>
          </ul>
        </div>

        <button
          onClick={onRetry}
          style={{
            padding: '12px 32px',
            background: '#bc1010',
            color: '#fff',
            border: 'none',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 1,
            cursor: 'pointer',
            textTransform: 'uppercase',
            marginBottom: 16,
          }}
        >
          Retry Location Access
        </button>

        {/* Location tracking is understood per employment agreement */}
      </div>
    );
  }

  // No gate needed
  return null;
}
