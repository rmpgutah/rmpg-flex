import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';

interface MileagePromptModalProps {
  mode: 'starting' | 'ending';
  callNumber: string;
  vehicleId: string;
  startingMileage?: number | null;
  onSubmit: (mileage: number, vehicleId: string) => void;
  onCancel: () => void;
}

export default function MileagePromptModal({
  mode, callNumber, vehicleId, startingMileage, onSubmit, onCancel,
}: MileagePromptModalProps) {
  const [mileage, setMileage] = useState('');
  const [editVehicleId, setEditVehicleId] = useState(vehicleId || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus the mileage input on mount
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = () => {
    const val = parseFloat(mileage);
    if (isNaN(val) || val < 0) return;
    onSubmit(val, editVehicleId);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70">
      <div
        className="w-[340px] border rounded-sm"
        style={{
          background: 'var(--color-rmpg-800, #141e2b)',
          borderColor: 'var(--color-rmpg-600, #2a3a4e)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b"
          style={{
            background: 'var(--color-rmpg-700, #1a2636)',
            borderColor: 'var(--color-rmpg-600, #2a3a4e)',
          }}
        >
          <span className="text-xs font-bold text-white">
            {mode === 'starting' ? 'Starting Mileage' : 'Ending Mileage'} — {callNumber}
          </span>
          <button onClick={onCancel} className="text-rmpg-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {mode === 'ending' && startingMileage != null && (
            <div className="text-[10px] text-rmpg-400">
              Starting mileage: <span className="text-brand-gold-400 font-mono font-bold">{startingMileage.toLocaleString()}</span>
            </div>
          )}

          <div>
            <label className="text-[10px] text-brand-gold-500 block mb-1">
              {mode === 'starting' ? 'Odometer Reading (Start)' : 'Odometer Reading (End)'}
            </label>
            <input
              ref={inputRef}
              type="number"
              min="0"
              step="0.1"
              className="input-dark text-sm w-full font-mono"
              placeholder="e.g. 45230"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
            />
          </div>

          <div>
            <label className="text-[10px] text-brand-gold-500 block mb-1">Vehicle ID</label>
            {vehicleId ? (
              <div className="text-xs text-rmpg-200 font-mono bg-rmpg-700/50 border border-rmpg-600 rounded-sm px-2 py-1">
                {vehicleId}
              </div>
            ) : (
              <input
                type="text"
                className="input-dark text-xs w-full"
                placeholder="Vehicle ID or unit number"
                value={editVehicleId}
                onChange={(e) => setEditVehicleId(e.target.value)}
              />
            )}
          </div>

          {mode === 'ending' && startingMileage != null && mileage && (
            <div className="text-[10px] text-rmpg-400">
              Total miles: <span className="text-green-400 font-mono font-bold">
                {Math.max(0, parseFloat(mileage) - startingMileage).toFixed(1)}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-4 py-2 border-t"
          style={{ borderColor: 'var(--color-rmpg-600, #2a3a4e)' }}
        >
          <button onClick={onCancel} className="toolbar-btn text-xs px-3 py-1">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!mileage || isNaN(parseFloat(mileage))}
            className="toolbar-btn toolbar-btn-primary text-xs px-3 py-1"
          >
            {mode === 'starting' ? 'Go En Route' : 'Go On Scene'}
          </button>
        </div>
      </div>
    </div>
  );
}
