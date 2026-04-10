import React, { useState, useRef, useEffect } from 'react';
import { Download, Camera, Printer, ChevronDown, Loader2 } from 'lucide-react';
import { isLightMapStyle, isSatelliteStyle } from '../utils/mapConstants';
import type { MapStyleId } from '../utils/mapConstants';

interface MapExportMenuProps {
  mapStyle: MapStyleId;
  isMobile: boolean;
  onScreenshot: () => Promise<boolean>;
  onPrint: () => void;
}

export default function MapExportMenu({ mapStyle, isMobile, onScreenshot, onPrint }: MapExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const light = isLightMapStyle(mapStyle);
  const sat = isSatelliteStyle(mapStyle);

  const bgBase = light ? 'rgba(255,255,255,0.92)' : sat ? 'rgba(6,12,20,0.92)' : 'rgba(6,12,20,0.95)';
  const borderBase = light ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(30,48,72,0.6)';
  const textColor = light ? 'text-gray-700' : 'text-rmpg-200';
  const hoverBg = light ? 'hover:bg-[#1b2128]' : 'hover:bg-[#1b2128]';

  const handleScreenshot = async () => {
    setBusy(true);
    setOpen(false);
    try {
      await onScreenshot();
    } catch {
      // Screenshot failed — silently handled; busy state resets below
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => {
    setOpen(false);
    onPrint();
  };

  return (
    <div ref={menuRef} className="relative">
      {/* Trigger button */}
      <button type="button"
        onClick={() => setOpen(!open)}
        disabled={busy}
        className={`backdrop-blur-md shadow-xl transition-colors ${
          light
            ? 'bg-white/90 border border-gray-300 hover:bg-[#1b2128]'
            : 'bg-surface-deep/95 border border-rmpg-600 hover:bg-rmpg-700/40'
        }`}
        style={isMobile
          ? { borderRadius: 2, width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }
          : { borderRadius: 2, padding: 10, display: 'flex', alignItems: 'center', gap: 4 }
        }
        title="Export map"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {busy ? (
          <Loader2 className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${light ? 'text-gray-600' : 'text-rmpg-300'} animate-spin`} />
        ) : (
          <>
            <Download className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${light ? 'text-gray-600' : 'text-rmpg-300'}`} />
            {/* #23: Dropdown chevron with smooth rotation */}
            {!isMobile && <ChevronDown className={`w-3 h-3 ${light ? 'text-gray-500' : 'text-rmpg-400'} transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />}
          </>
        )}
      </button>

      {/* Dropdown */}
      <div
        role="menu"
        className={`absolute bottom-full mb-2 right-0 z-[1100] backdrop-blur-md shadow-xl overflow-hidden transition-all duration-150 origin-bottom-right border ${
          light ? 'border-gray-300' : 'border-[#2b313a]'
        } ${
          open
            ? 'scale-100 opacity-100 pointer-events-auto'
            : 'scale-95 opacity-0 pointer-events-none'
        }`}
        style={{
          borderRadius: 2,
          background: bgBase,
          minWidth: 180,
        }}
      >
        {/* #21: Menu items with improved hover and icon styling */}
        <button type="button"
          role="menuitem"
          onClick={handleScreenshot}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-100 active:scale-[0.97] ${textColor} ${hoverBg}`}
          style={{ borderBottom: borderBase }}
        >
          <Camera className="w-3.5 h-3.5 shrink-0 opacity-80" />
          <div>
            <div className="text-xs font-medium">Screenshot Map</div>
            <div className={`text-[9px] ${light ? 'text-rmpg-400' : 'text-rmpg-500'}`}>Download as PNG</div>
          </div>
        </button>
        {/* #22: Removed duplicate divider between items */}
        <button type="button"
          role="menuitem"
          onClick={handlePrint}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-100 active:scale-[0.97] ${textColor} ${hoverBg}`}
        >
          <Printer className="w-3.5 h-3.5 shrink-0 opacity-80" />
          <div>
            <div className="text-xs font-medium">Print Map</div>
            <div className={`text-[9px] ${light ? 'text-rmpg-400' : 'text-rmpg-500'}`}>Open print dialog</div>
          </div>
        </button>
      </div>
    </div>
  );
}
