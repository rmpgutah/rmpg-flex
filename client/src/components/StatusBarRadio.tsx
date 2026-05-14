import { useState, useEffect } from 'react';
import { Mic } from 'lucide-react';

type RadioState = 'idle' | 'tx' | 'rx';

const LS_PANEL_KEY = 'rmpg-radio-panel-open';

export default function StatusBarRadio() {
  const [radioState, setRadioState] = useState<RadioState>('idle');
  const [channelName] = useState('Dispatch Main');

  // Listen for radio state changes from PTTButton
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ state: RadioState }>).detail;
      if (detail?.state) setRadioState(detail.state);
    };
    window.addEventListener('rmpg-radio-state', handler);
    return () => window.removeEventListener('rmpg-radio-state', handler);
  }, []);

  const handleClick = () => {
    // Toggle the radio console panel open/close via localStorage + custom event
    try {
      const current = localStorage.getItem(LS_PANEL_KEY) === 'true';
      localStorage.setItem(LS_PANEL_KEY, String(!current));
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('rmpg-radio-toggle'));
  };

  const iconColor =
    radioState === 'tx' ? '#dc2626' : radioState === 'rx' ? '#22c55e' : '#888888';

  const truncatedChannel = channelName.length > 15 ? channelName.slice(0, 14) + '\u2026' : channelName;

  return (
    <div
      className="status-bar-section cursor-pointer"
      onClick={handleClick}
      title="Toggle Radio Console (R)"
      style={{ gap: 4 }}
    >
      <Mic className="w-3 h-3" style={{ color: iconColor, flexShrink: 0 }} />
      <span style={{ color: iconColor, fontWeight: radioState !== 'idle' ? 700 : 400 }}>
        {radioState === 'tx' ? 'TX' : radioState === 'rx' ? 'RX' : truncatedChannel}
      </span>
    </div>
  );
}
