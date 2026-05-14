import { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, ChevronLeft, ChevronRight } from 'lucide-react';
import EncryptionIndicator from './EncryptionIndicator';
import RadioChannelScanner from './RadioChannelScanner';
import SignalMeter from './SignalMeter';
import UnitSelector from './UnitSelector';
import PTTButton from './PTTButton';
import EmergencyOverride from './EmergencyOverride';
import TransmissionLog from './TransmissionLog';
import type { TransmissionLogHandle } from './TransmissionLog';
import QuickCommands from './QuickCommands';
import { useRadioConsole } from '../../hooks/useRadioConsole';
import { useSignalStrength } from '../../hooks/useSignalStrength';

const LS_KEY = 'rmpg-radio-panel-open';

export default function RadioConsole() {
  const [isOpen, setIsOpen] = useState(() => {
    try { return localStorage.getItem(LS_KEY) === 'true'; } catch { return false; }
  });

  const radioConsole = useRadioConsole();
  const signalStats = useSignalStrength();
  const txLogRef = useRef<TransmissionLogHandle>(null);

  // Persist open/close state
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, String(isOpen)); } catch { /* ignore */ }
  }, [isOpen]);

  // Listen for external toggle events (from StatusBarRadio)
  useEffect(() => {
    const handler = () => setIsOpen((prev) => !prev);
    window.addEventListener('rmpg-radio-toggle', handler);
    return () => window.removeEventListener('rmpg-radio-toggle', handler);
  }, []);

  // "R" key toggle (skip when focused on input/textarea/select)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'r' || e.key === 'R') {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      setIsOpen(prev => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // TX/RX LED color based on connection
  const ledColor = signalStats.signalBars >= 6 ? '#22c55e' : signalStats.signalBars >= 2 ? '#d4a017' : '#dc2626';

  // Broadcast PTT state change via custom event (for StatusBarRadio)
  const handlePTTStateChange = useCallback((state: 'idle' | 'tx' | 'rx') => {
    window.dispatchEvent(new CustomEvent('rmpg-radio-state', { detail: { state } }));
    if (state === 'tx') {
      txLogRef.current?.addLogEntry({
        source: 'LOCAL',
        text: 'PTT transmit started',
        type: 'unit',
      });
    }
  }, []);

  // Radio check result callback
  const handleRadioCheckResult = useCallback((callSign: string, status: string) => {
    txLogRef.current?.addLogEntry({
      source: 'SYSTEM',
      text: `Radio check ${callSign}: ${status}`,
      type: 'system',
    });
  }, []);

  // Quick command callback
  const handleQuickCommand = useCallback((code: string) => {
    txLogRef.current?.addLogEntry({
      source: 'LOCAL',
      text: `Quick command: ${code}`,
      type: 'dispatch',
    });
  }, []);

  // Emergency callbacks
  const handleEmergencyActivate = useCallback(() => {
    txLogRef.current?.addLogEntry({
      source: 'LOCAL',
      text: 'Emergency override ACTIVATED',
      type: 'emergency',
    });
  }, []);

  const handleEmergencyDeactivate = useCallback(() => {
    txLogRef.current?.addLogEntry({
      source: 'LOCAL',
      text: 'Emergency override DEACTIVATED',
      type: 'system',
    });
  }, []);

  // ── Collapsed strip ──
  if (!isOpen) {
    return (
      <div
        className="flex flex-col items-center justify-start gap-3 py-4 cursor-pointer select-none shrink-0 transition-all duration-200"
        style={{
          width: 48,
          background: 'linear-gradient(180deg, #111111 0%, #0a0a0a 100%)',
          borderRight: '1px solid #222222',
        }}
        onClick={() => setIsOpen(true)}
        title="Open Radio Console (R)"
      >
        {/* TX/RX LED */}
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: ledColor,
            boxShadow: `0 0 4px ${ledColor}`,
          }}
        />
        {/* Radio icon */}
        <Radio className="w-4 h-4 text-[#888888]" />
        {/* Vertical "RADIO" text */}
        <div
          className="text-[9px] font-bold tracking-[2px] text-[#888888] uppercase"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
        >
          RADIO
        </div>
        <ChevronRight className="w-3 h-3 text-[#555555] mt-2" />
      </div>
    );
  }

  // ── Expanded panel ──
  return (
    <div
      className="flex flex-col shrink-0 overflow-hidden transition-all duration-200"
      style={{
        width: 320,
        background: '#0a0a0a',
        borderRight: '1px solid #222222',
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{
          background: 'linear-gradient(180deg, #1a1a1a 0%, #242424 100%)',
          borderBottom: '1px solid #2e2e2e',
        }}
      >
        <div className="flex items-center gap-2">
          {/* TX/RX LED */}
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: ledColor,
              boxShadow: `0 0 4px ${ledColor}`,
            }}
          />
          <span className="text-[11px] font-bold tracking-[1px] text-[#d4a017] uppercase">
            RMPG RADIO CONSOLE
          </span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-0.5 hover:bg-[#333333] rounded-[2px] transition-colors"
          title="Collapse Radio Console (R)"
        >
          <ChevronLeft className="w-4 h-4 text-[#888888]" />
        </button>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2 scrollbar-dark">
        {/* 1. Encryption */}
        <EncryptionIndicator />

        {/* 2. Channels + Scanner */}
        <RadioChannelScanner
          channels={radioConsole.channels}
          activeChannelId={radioConsole.activeChannelId}
          setActiveChannelId={radioConsole.setActiveChannelId}
          isScanning={radioConsole.isScanning}
          toggleScan={radioConsole.toggleScan}
          scanIndex={radioConsole.scanIndex}
        />

        {/* 3. Signal Strength */}
        <SignalMeter
          latencyMs={signalStats.latencyMs}
          signalBars={signalStats.signalBars}
          throughputUp={signalStats.throughputUp}
          throughputDown={signalStats.throughputDown}
          packetLoss={signalStats.packetLoss}
          dbm={signalStats.dbm}
        />

        {/* 4. Unit Selector */}
        <UnitSelector onRadioCheckResult={handleRadioCheckResult} />

        {/* 5. PTT */}
        <PTTButton onStateChange={handlePTTStateChange} />

        {/* 6. Emergency Override */}
        <EmergencyOverride
          onActivate={handleEmergencyActivate}
          onDeactivate={handleEmergencyDeactivate}
        />

        {/* 7. Transmission Log */}
        <TransmissionLog ref={txLogRef} />

        {/* 8. Quick Commands */}
        <QuickCommands onCommand={handleQuickCommand} />
      </div>
    </div>
  );
}
