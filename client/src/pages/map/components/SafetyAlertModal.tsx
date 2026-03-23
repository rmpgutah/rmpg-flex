// ============================================================
// RMPG Flex — SafetyAlertModal Component
// Modal for broadcasting a safety alert. Provides type
// selection grid, location fields, details, and radius options.
// ============================================================

import React, { useState, useCallback, useEffect } from 'react';
import {
  AlertTriangle,
  X,
  Crosshair,
  Siren,
  Shield,
  Skull,
  Bomb,
  Car,
  Biohazard,
  Users,
  UserX,
  Target,
  Loader2,
} from 'lucide-react';
import type { SafetyAlertType } from '../hooks/useMapAlerts';

// ─── Props ──────────────────────────────────────────────────

interface SafetyAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBroadcast: (
    type: string,
    lat: number,
    lng: number,
    details: string,
    radius?: number,
  ) => Promise<void>;
  defaultLat?: number;
  defaultLng?: number;
}

// ─── Alert Type Definitions ─────────────────────────────────

interface AlertTypeDef {
  type: SafetyAlertType;
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const ALERT_TYPES: AlertTypeDef[] = [
  {
    type: 'officer_down',
    label: 'Officer Down',
    icon: <Shield size={16} />,
    color: '#ef4444',
    bgColor: 'rgba(239,68,68,0.15)',
  },
  {
    type: 'active_shooter',
    label: 'Active Shooter',
    icon: <Crosshair size={16} />,
    color: '#ef4444',
    bgColor: 'rgba(239,68,68,0.15)',
  },
  {
    type: 'shots_fired',
    label: 'Shots Fired',
    icon: <Target size={16} />,
    color: '#f59e0b',
    bgColor: 'rgba(245,158,11,0.15)',
  },
  {
    type: 'armed_subject',
    label: 'Armed Subject',
    icon: <Skull size={16} />,
    color: '#f59e0b',
    bgColor: 'rgba(245,158,11,0.15)',
  },
  {
    type: 'pursuit',
    label: 'Pursuit',
    icon: <Car size={16} />,
    color: '#3b82f6',
    bgColor: 'rgba(59,130,246,0.15)',
  },
  {
    type: 'hostage',
    label: 'Hostage',
    icon: <Users size={16} />,
    color: '#ef4444',
    bgColor: 'rgba(239,68,68,0.15)',
  },
  {
    type: 'barricaded',
    label: 'Barricaded',
    icon: <Siren size={16} />,
    color: '#f59e0b',
    bgColor: 'rgba(245,158,11,0.15)',
  },
  {
    type: 'bomb_threat',
    label: 'Bomb Threat',
    icon: <Bomb size={16} />,
    color: '#f59e0b',
    bgColor: 'rgba(245,158,11,0.15)',
  },
  {
    type: 'hazmat',
    label: 'HAZMAT',
    icon: <Biohazard size={16} />,
    color: '#3b82f6',
    bgColor: 'rgba(59,130,246,0.15)',
  },
  {
    type: 'missing_officer',
    label: 'Missing Officer',
    icon: <UserX size={16} />,
    color: '#a855f7',
    bgColor: 'rgba(168,85,247,0.15)',
  },
];

const RADIUS_OPTIONS = [200, 500, 1000, 2000];

// ─── Component ──────────────────────────────────────────────

export default function SafetyAlertModal({
  isOpen,
  onClose,
  onBroadcast,
  defaultLat,
  defaultLng,
}: SafetyAlertModalProps) {
  const [selectedType, setSelectedType] = useState<SafetyAlertType | null>(null);
  const [lat, setLat] = useState(defaultLat?.toFixed(6) ?? '');
  const [lng, setLng] = useState(defaultLng?.toFixed(6) ?? '');
  const [details, setDetails] = useState('');
  const [radius, setRadius] = useState(500);
  const [broadcasting, setBroadcasting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when defaults change
  React.useEffect(() => {
    if (defaultLat != null) setLat(defaultLat.toFixed(6));
    if (defaultLng != null) setLng(defaultLng.toFixed(6));
  }, [defaultLat, defaultLng]);

  const handleBroadcast = useCallback(async () => {
    if (!selectedType) {
      setError('Select an alert type');
      return;
    }
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      setError('Invalid coordinates');
      return;
    }

    setBroadcasting(true);
    setError(null);

    try {
      await onBroadcast(selectedType, latNum, lngNum, details, radius);
      // Reset and close
      setSelectedType(null);
      setDetails('');
      setRadius(500);
      setError(null);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to broadcast alert');
    } finally {
      setBroadcasting(false);
    }
  }, [selectedType, lat, lng, details, radius, onBroadcast, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="panel-beveled bg-surface-base flex flex-col"
        style={{
          width: 420,
          maxWidth: '95vw',
          maxHeight: '90vh',
          border: '1px solid #1e2a3a',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ background: '#0d1520', borderBottom: '1px solid #1e2a3a' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            <span className="text-sm font-bold uppercase tracking-wider text-red-400">
              Safety Broadcast
            </span>
          </div>
          <button type="button" onClick={onClose} className="toolbar-btn p-1" title="Cancel">
            <X size={14} className="text-rmpg-400" />
          </button>
        </div>

        {/* Body */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-4"
          style={{ scrollbarWidth: 'thin' }}
        >
          {/* Alert type grid */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-rmpg-400 mb-1.5 block">
              Alert Type
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {ALERT_TYPES.map((at) => {
                const isSelected = selectedType === at.type;
                return (
                  <button type="button"
                    key={at.type}
                    onClick={() => setSelectedType(at.type)}
                    className="rounded-sm flex items-center gap-2 px-2.5 py-2 text-left transition-colors"
                    style={{
                      background: isSelected ? at.bgColor : '#0d1520',
                      border: `1px solid ${isSelected ? at.color : '#1e2a3a'}`,
                    }}
                  >
                    <span style={{ color: at.color }}>{at.icon}</span>
                    <span
                      className="text-xs font-semibold"
                      style={{ color: isSelected ? at.color : '#94a3b8' }}
                    >
                      {at.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-rmpg-400 mb-1.5 block">
              Location
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="safety-alert-lat" className="text-[10px] text-rmpg-500 mb-0.5 block">
                  Latitude
                </label>
                <input
                  id="safety-alert-lat"
                  type="text"
                  inputMode="decimal"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className="w-full rounded-sm px-2 py-1.5 text-xs text-rmpg-200 font-mono tabular-nums border-rmpg-700"
                  style={{
                    background: '#0d1520',
                    border: '1px solid #1e2a3a',
                  }}
                  placeholder="40.7608"
                />
              </div>
              <div>
                <label htmlFor="safety-alert-lng" className="text-[10px] text-rmpg-500 mb-0.5 block">
                  Longitude
                </label>
                <input
                  id="safety-alert-lng"
                  type="text"
                  inputMode="decimal"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  className="w-full rounded-sm px-2 py-1.5 text-xs text-rmpg-200 font-mono tabular-nums border-rmpg-700"
                  style={{
                    background: '#0d1520',
                    border: '1px solid #1e2a3a',
                  }}
                  placeholder="-111.891"
                />
              </div>
            </div>
          </div>

          {/* Details */}
          <div>
            <label htmlFor="safety-alert-details" className="text-[10px] font-bold uppercase tracking-wider text-rmpg-400 mb-1.5 block">
              Details
            </label>
            <textarea
              id="safety-alert-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              className="w-full rounded-sm px-2 py-1.5 text-xs text-rmpg-200 resize-none"
              style={{
                background: '#0d1520',
                border: '1px solid #1e2a3a',
              }}
              placeholder="Describe the situation..."
            />
          </div>

          {/* Radius */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-rmpg-400 mb-1.5 block">
              Alert Radius
            </label>
            <div className="flex gap-1.5">
              {RADIUS_OPTIONS.map((r) => (
                <button type="button"
                  key={r}
                  onClick={() => setRadius(r)}
                  className="flex-1 rounded-sm py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    background: radius === r ? 'rgba(59,130,246,0.2)' : '#0d1520',
                    border: `1px solid ${radius === r ? '#3b82f6' : '#1e2a3a'}`,
                    color: radius === r ? '#60a5fa' : '#64748b',
                  }}
                >
                  {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle size={12} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3 shrink-0"
          style={{ borderTop: '1px solid #1e2a3a', background: '#0d1520' }}
        >
          <button type="button"
            onClick={onClose}
            disabled={broadcasting}
            className="toolbar-btn rounded-sm px-4 py-2 text-xs text-rmpg-400"
          >
            Cancel
          </button>
          <button type="button"
            onClick={handleBroadcast}
            disabled={broadcasting || !selectedType}
            className="rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
            style={{
              background:
                broadcasting || !selectedType
                  ? 'rgba(127,29,29,0.3)'
                  : 'rgba(239,68,68,0.25)',
              border: `1px solid ${broadcasting || !selectedType ? '#7f1d1d' : '#ef4444'}`,
              color: broadcasting || !selectedType ? '#7f1d1d' : '#fca5a5',
            }}
          >
            {broadcasting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Broadcasting...
              </span>
            ) : (
              'BROADCAST ALERT'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
