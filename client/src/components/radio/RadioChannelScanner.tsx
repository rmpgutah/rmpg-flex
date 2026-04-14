import React from 'react';
import { ScanLine, Plus } from 'lucide-react';
import ChannelCard from './ChannelCard';
import type { RadioChannel } from '../../hooks/useRadioConsole';

interface RadioChannelScannerProps {
  channels: RadioChannel[];
  activeChannelId: string;
  setActiveChannelId: (id: string) => void;
  isScanning: boolean;
  toggleScan: () => void;
  scanIndex: number;
}

export default function RadioChannelScanner({
  channels,
  activeChannelId,
  setActiveChannelId,
  isScanning,
  toggleScan,
  scanIndex,
}: RadioChannelScannerProps) {
  return (
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      {/* Section header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px]">
          CHANNELS
        </div>
        {/* Scan indicator animation */}
        {isScanning && (
          <div className="flex items-center gap-1">
            <ScanLine
              className="w-3 h-3 text-[#d4a017]"
              style={{
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            <span className="text-[8px] font-mono text-[#d4a017]">SCANNING</span>
          </div>
        )}
      </div>

      {/* Channel cards */}
      <div className="space-y-1.5 mb-2">
        {channels.map((ch, idx) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            isActive={ch.id === activeChannelId}
            isScanning={isScanning}
            isScanTarget={isScanning && idx === scanIndex}
            onClick={() => {
              setActiveChannelId(ch.id);
            }}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-1">
        <button
          onClick={toggleScan}
          className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-[2px] text-[9px] font-bold uppercase tracking-wide transition-all duration-150 border"
          style={{
            background: isScanning ? '#d4a017' : '#111111',
            color: isScanning ? '#000000' : '#888888',
            borderColor: isScanning ? '#d4a017' : '#333333',
          }}
        >
          <ScanLine className="w-3 h-3" />
          SCAN
        </button>
        <button
          className="flex items-center justify-center gap-1 py-1 px-2 rounded-[2px] text-[9px] font-bold uppercase tracking-wide transition-all duration-150 border border-[#333333] bg-[#111111] text-[#888888] hover:bg-[#1a1a1a]"
        >
          <Plus className="w-3 h-3" />
          ADD CH
        </button>
      </div>
    </div>
  );
}
