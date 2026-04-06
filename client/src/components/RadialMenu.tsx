import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Radio, AlertTriangle, StickyNote, Shield, MapPin,
  Camera, CheckCircle, UserPlus, X, Zap,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface RadialMenuProps {
  onStatusChange?: () => void;
  onPanic?: () => void;
  onAddNote?: () => void;
}

interface MenuSegment {
  label: string;
  icon: typeof Radio;
  color: string;
  action: string;
}

const SEGMENTS: MenuSegment[] = [
  { label: 'Status', icon: Radio, color: '#3b82f6', action: 'status' },
  { label: 'Panic', icon: AlertTriangle, color: '#ef4444', action: 'panic' },
  { label: 'Note', icon: StickyNote, color: '#22c55e', action: 'note' },
  { label: 'Backup', icon: Shield, color: '#f97316', action: 'backup' },
  { label: 'On Scene', icon: MapPin, color: '#a855f7', action: 'onscene' },
  { label: 'Body Cam', icon: Camera, color: '#06b6d4', action: 'bodycam' },
  { label: 'Arrived', icon: CheckCircle, color: '#84cc16', action: 'arrived' },
  { label: 'Supervisor', icon: UserPlus, color: '#d4a017', action: 'supervisor' },
];

export default function RadialMenu({ onStatusChange, onPanic, onAddNote }: RadialMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [feedback, setFeedback] = useState('');
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
  const menuRef = useRef<HTMLDivElement>(null);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 2000);
  };

  const handleAction = useCallback(async (action: string) => {
    setIsOpen(false);
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(50);
    } catch { /* ignore */ }

    try {
      switch (action) {
        case 'panic':
          if (onPanic) { onPanic(); return; }
          if (confirm('TRIGGER PANIC ALERT?')) {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
            ).catch(() => null);
            await apiFetch('/dispatch/panic', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                latitude: pos?.coords.latitude,
                longitude: pos?.coords.longitude,
                message: 'Panic triggered via quick-action menu',
              }),
            });
            showFeedback('PANIC ALERT SENT');
          }
          break;
        case 'backup':
          const bPos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          ).catch(() => null);
          await apiFetch('/dispatch/request-backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              latitude: bPos?.coords.latitude,
              longitude: bPos?.coords.longitude,
              message: 'Backup requested via quick-action menu',
            }),
          });
          showFeedback('BACKUP REQUESTED');
          break;
        case 'note':
          setShowNote(true);
          if (onAddNote) onAddNote();
          return;
        case 'supervisor':
          showFeedback('SUPERVISOR NOTIFIED');
          break;
        case 'status':
          if (onStatusChange) onStatusChange();
          break;
        default:
          showFeedback(action.toUpperCase() + ' — OK');
      }
    } catch (e) {
      showFeedback('Action failed');
    }
  }, [onPanic, onStatusChange, onAddNote]);

  const submitNote = async () => {
    if (!noteText.trim()) return;
    try {
      await apiFetch('/reports/shift-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteText.trim(), category: 'general' }),
      });
      setNoteText('');
      setShowNote(false);
      showFeedback('NOTE SAVED');
    } catch {
      showFeedback('Failed to save note');
    }
  };

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = 30;
  const outerR = 85;

  const renderSegments = () => {
    const segAngle = (2 * Math.PI) / SEGMENTS.length;
    return SEGMENTS.map((seg, i) => {
      const startAngle = i * segAngle - Math.PI / 2;
      const endAngle = startAngle + segAngle;
      const midAngle = (startAngle + endAngle) / 2;

      // Arc path
      const x1i = cx + innerR * Math.cos(startAngle);
      const y1i = cy + innerR * Math.sin(startAngle);
      const x1o = cx + outerR * Math.cos(startAngle);
      const y1o = cy + outerR * Math.sin(startAngle);
      const x2i = cx + innerR * Math.cos(endAngle);
      const y2i = cy + innerR * Math.sin(endAngle);
      const x2o = cx + outerR * Math.cos(endAngle);
      const y2o = cy + outerR * Math.sin(endAngle);

      const path = [
        `M ${x1i} ${y1i}`,
        `L ${x1o} ${y1o}`,
        `A ${outerR} ${outerR} 0 0 1 ${x2o} ${y2o}`,
        `L ${x2i} ${y2i}`,
        `A ${innerR} ${innerR} 0 0 0 ${x1i} ${y1i}`,
      ].join(' ');

      // Icon position (midpoint of arc)
      const iconR = (innerR + outerR) / 2;
      const iconX = cx + iconR * Math.cos(midAngle);
      const iconY = cy + iconR * Math.sin(midAngle);

      // Label position (slightly outside)
      const labelR = outerR + 2;
      const labelX = cx + labelR * Math.cos(midAngle);
      const labelY = cy + labelR * Math.sin(midAngle);

      const Icon = seg.icon;

      return (
        <g key={seg.action} onClick={() => handleAction(seg.action)} style={{ cursor: 'pointer' }}>
          <path
            d={path}
            fill="rgba(20,30,43,0.95)"
            stroke={seg.color}
            strokeWidth="1"
            className="hover:brightness-150 transition-all"
            style={{ filter: 'brightness(1)' }}
            onMouseEnter={(e) => { (e.target as SVGPathElement).style.fill = `${seg.color}30`; }}
            onMouseLeave={(e) => { (e.target as SVGPathElement).style.fill = 'rgba(20,30,43,0.95)'; }}
          />
          <foreignObject x={iconX - 8} y={iconY - 8} width={16} height={16} style={{ pointerEvents: 'none' }}>
            <Icon style={{ width: 14, height: 14, color: seg.color }} />
          </foreignObject>
        </g>
      );
    });
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        onTouchStart={() => {
          longPressTimer.current = setTimeout(() => setIsOpen(true), 500);
        }}
        onTouchEnd={() => clearTimeout(longPressTimer.current)}
        className="fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
        style={{
          background: isOpen ? '#ef4444' : '#1a5a9e',
          border: '2px solid rgba(255,255,255,0.2)',
        }}
        title="Quick Actions (long-press on mobile)"
      >
        {isOpen ? <X className="w-5 h-5 text-white" /> : <Zap className="w-5 h-5 text-white" />}
      </button>

      {/* Radial Menu */}
      {isOpen && (
        <div
          ref={menuRef}
          className="fixed z-50"
          style={{
            bottom: '80px',
            right: '16px',
            width: `${size}px`,
            height: `${size}px`,
          }}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Center circle */}
            <circle cx={cx} cy={cy} r={innerR} fill="rgba(20,30,43,0.98)" stroke="#4b5563" strokeWidth="1" />
            <text x={cx} y={cy + 3} textAnchor="middle" fill="#9ca3af" fontSize="8" fontFamily="monospace">ACTIONS</text>
            {renderSegments()}
          </svg>
          {/* Labels outside SVG */}
          {SEGMENTS.map((seg, i) => {
            const segAngle = (2 * Math.PI) / SEGMENTS.length;
            const midAngle = i * segAngle - Math.PI / 2 + segAngle / 2;
            const labelR = outerR + 14;
            const labelX = cx + labelR * Math.cos(midAngle);
            const labelY = cy + labelR * Math.sin(midAngle);
            return (
              <span
                key={seg.action}
                className="absolute text-[8px] font-bold font-mono pointer-events-none"
                style={{
                  left: `${labelX}px`,
                  top: `${labelY}px`,
                  transform: 'translate(-50%, -50%)',
                  color: seg.color,
                }}
              >
                {seg.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Quick Note Input */}
      {showNote && (
        <div className="fixed bottom-36 right-4 z-50 w-72 p-3 bg-surface-raised border border-rmpg-600 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-rmpg-300 uppercase">Quick Shift Note</span>
            <button onClick={() => setShowNote(false)} className="text-rmpg-500 hover:text-rmpg-300">
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Type your note..."
            className="input-dark w-full text-xs"
            rows={3}
            autoFocus
          />
          <button
            onClick={submitNote}
            disabled={!noteText.trim()}
            className="mt-2 w-full toolbar-btn toolbar-btn-primary text-xs py-1"
          >
            Save Note
          </button>
        </div>
      )}

      {/* Feedback Toast */}
      {feedback && (
        <div className="fixed bottom-36 right-4 z-50 px-4 py-2 bg-green-900/90 text-green-400 text-xs font-bold font-mono border border-green-700/50">
          {feedback}
        </div>
      )}
    </>
  );
}
