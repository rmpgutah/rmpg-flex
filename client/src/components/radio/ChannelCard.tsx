import React from 'react';
import type { RadioChannel } from '../../hooks/useRadioConsole';

interface ChannelCardProps {
  channel: RadioChannel;
  isActive: boolean;
  isScanning: boolean;
  isScanTarget: boolean;
  onClick: () => void;
}

export default function ChannelCard({ channel, isActive, isScanning, isScanTarget, onClick }: ChannelCardProps) {
  const activeColor = '#33ff33';
  const dimColor = '#1a5a1a';
  const textColor = isActive ? activeColor : dimColor;
  const borderColor = isActive ? '#2a5a2a' : '#1a1a1a';

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-[2px] p-2 transition-all duration-150 border"
      style={{
        background: '#050505',
        borderColor,
        outline: isScanTarget && isScanning ? `1px solid ${activeColor}` : 'none',
      }}
    >
      {/* Channel name + zone */}
      <div className="flex items-center justify-between mb-1">
        <span
          className="font-mono text-[11px] font-bold truncate"
          style={{
            color: textColor,
            textShadow: isActive ? `0 0 6px ${activeColor}` : 'none',
          }}
        >
          {channel.name}
        </span>
        <span className="font-mono text-[8px] text-[#555555] shrink-0 ml-1">
          {channel.zone}
        </span>
      </div>

      {/* Channel ID + unit count */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px]" style={{ color: dimColor }}>
          {channel.id.toUpperCase()}
        </span>
        <span className="font-mono text-[8px] text-[#555555]">
          {channel.unitsOnline} units
        </span>
      </div>

      {/* RX activity bar */}
      <div
        className="mt-1.5 rounded-[1px] overflow-hidden"
        style={{ height: 3, background: '#111111' }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: channel.isActive ? '100%' : isActive ? '40%' : '0%',
            background: channel.isActive
              ? activeColor
              : isActive
                ? dimColor
                : 'transparent',
            boxShadow: channel.isActive ? `0 0 4px ${activeColor}` : 'none',
          }}
        />
      </div>

      {/* Active transmitter */}
      {channel.activeTransmitter && (
        <div className="mt-1 font-mono text-[8px]" style={{ color: activeColor }}>
          TX: {channel.activeTransmitter}
        </div>
      )}
    </button>
  );
}
