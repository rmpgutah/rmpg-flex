import { useState, useEffect, useRef, useCallback } from 'react';

export interface RadioChannel {
  id: string;
  name: string;
  zone: string;
  isActive: boolean;
  activeTransmitter?: string;
  unitsOnline: number;
}

const DEFAULT_CHANNELS: RadioChannel[] = [
  { id: 'ch01', name: 'Dispatch Main', zone: 'Zone 1', isActive: false, unitsOnline: 0 },
  { id: 'ch02', name: 'Tactical', zone: 'Zone 2', isActive: false, unitsOnline: 0 },
  { id: 'ch03', name: 'Supervisors', zone: 'Admin', isActive: false, unitsOnline: 0 },
];

const SCAN_INTERVAL_MS = 3000;

export function useRadioConsole() {
  const [channels, setChannels] = useState<RadioChannel[]>(DEFAULT_CHANNELS);
  const [activeChannelId, setActiveChannelId] = useState<string>('ch01');
  const [isScanning, setIsScanning] = useState(false);
  const [scanIndex, setScanIndex] = useState(0);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Scanner cycles every 3s, pauses on channel with active transmission
  useEffect(() => {
    if (!isScanning) {
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      return;
    }

    scanTimerRef.current = setInterval(() => {
      setScanIndex((prev) => {
        const nextIdx = (prev + 1) % channels.length;
        const nextChannel = channels[nextIdx];

        // Pause on active channel (has an active transmitter)
        if (nextChannel.isActive && nextChannel.activeTransmitter) {
          return prev; // stay on current
        }

        // Move to next channel and set it as active
        setActiveChannelId(nextChannel.id);
        return nextIdx;
      });
    }, SCAN_INTERVAL_MS);

    return () => {
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
    };
  }, [isScanning, channels]);

  const toggleScan = useCallback(() => {
    setIsScanning((prev) => !prev);
  }, []);

  return {
    channels,
    setChannels,
    activeChannelId,
    setActiveChannelId,
    isScanning,
    toggleScan,
    scanIndex,
  };
}
