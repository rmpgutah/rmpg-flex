// SettingsTab — theme, font scale, notifications, quiet hours.
// Backed entirely by localStorage (the `ls` helper) — settings are
// per-device by design (a radio operator's preferred theme on the
// dispatch console shouldn't override their phone's preference).
import { useEffect, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { ls, playBeep } from '../helpers';
import { THEMES, type Theme, NOTIF_SOUNDS } from '../constants';
import { SectionHeader, SettingRow, SettingCheckbox, ToolbarBtn } from '../components';

interface Props {
  theme: Theme;
  onTheme: (t: Theme) => void;
  fontScale: 'sm' | 'md' | 'lg';
  onFontScale: (f: 'sm' | 'md' | 'lg') => void;
}

// ─────────────────────────────────────────────────────────────
// Quiet hours — TODO(user-contribution): see the prompt below.
//
// `isInQuietHours(startHHMM, endHHMM, now)` should return true when
// `now` falls within the quiet-hours window. The tricky bit: the
// window can wrap midnight (e.g. start="22:00", end="06:00") in
// which case the naive `now >= start && now <= end` returns false
// at 23:00 — the bug we want to avoid.
//
// Inputs: startHHMM/endHHMM are "HH:MM" strings; now is a Date.
// Return true if quiet, false if not. Empty/invalid window → false.
// ─────────────────────────────────────────────────────────────
export function isInQuietHours(startHHMM: string, endHHMM: string, now: Date = new Date()): boolean {
  // TODO: implement. Replace this placeholder with your version.
  // Hint: convert all three to minutes-since-midnight, then handle
  // the wrap case (start > end) as a single OR check.
  void startHHMM; void endHHMM; void now;
  return false;
}

export default function SettingsTab({ theme, onTheme, fontScale, onFontScale }: Props) {
  const [notifEnabled, setNotifEnabled] = useState(() => ls.get('radio_notif_enabled') !== 'false');
  const [soundEnabled, setSoundEnabled] = useState(() => ls.get('radio_sound_enabled') !== 'false');
  const [notifSound, setNotifSound] = useState(() => ls.get('radio_notif_sound') || 'chime');
  const [quietStart, setQuietStart] = useState(() => ls.get('radio_quiet_start') || '');
  const [quietEnd, setQuietEnd] = useState(() => ls.get('radio_quiet_end') || '');
  const [reduceMotion, setReduceMotion] = useState(() => ls.get('radio_reduce_motion') === 'true');
  const [time24h, setTime24h] = useState(() => ls.get('radio_time_24h') !== 'false');
  const [compact, setCompact] = useState(() => ls.get('radio_compact') === 'true');

  useEffect(() => { ls.set('radio_notif_enabled', String(notifEnabled)); }, [notifEnabled]);
  useEffect(() => { ls.set('radio_sound_enabled', String(soundEnabled)); }, [soundEnabled]);
  useEffect(() => { ls.set('radio_notif_sound', notifSound); }, [notifSound]);
  useEffect(() => { ls.set('radio_quiet_start', quietStart); }, [quietStart]);
  useEffect(() => { ls.set('radio_quiet_end', quietEnd); }, [quietEnd]);
  useEffect(() => { ls.set('radio_reduce_motion', String(reduceMotion)); }, [reduceMotion]);
  useEffect(() => { ls.set('radio_time_24h', String(time24h)); }, [time24h]);
  useEffect(() => { ls.set('radio_compact', String(compact)); }, [compact]);

  const quietActive = quietStart && quietEnd ? isInQuietHours(quietStart, quietEnd) : false;

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        icon={<SettingsIcon className="w-3 h-3" style={{ color: 'var(--rt-accent)' }} />}
        label="SETTINGS"
      />

      <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-4 max-w-2xl">

        {/* Appearance */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[9px] font-mono tracking-[0.3em]" style={{ color: 'var(--rt-muted)' }}>APPEARANCE</h3>
          <SettingRow label="Theme">
            <div className="flex gap-1 flex-wrap">
              {THEMES.map((t) => (
                <button key={t} type="button" onClick={() => onTheme(t)}
                  className="px-2 py-1 text-[9px] font-mono font-bold tracking-wider uppercase"
                  style={{
                    border: `1px solid ${theme === t ? 'var(--rt-accent)' : 'var(--rt-border)'}`,
                    color: theme === t ? 'var(--rt-accent)' : 'var(--rt-muted)',
                    background: theme === t ? 'rgba(212,160,23,0.10)' : 'transparent',
                  }}>{t}</button>
              ))}
            </div>
          </SettingRow>
          <SettingRow label="Font scale">
            <div className="flex gap-1">
              {(['sm', 'md', 'lg'] as const).map((s) => (
                <button key={s} type="button" onClick={() => onFontScale(s)}
                  className="px-2 py-1 text-[9px] font-mono font-bold tracking-wider uppercase"
                  style={{
                    border: `1px solid ${fontScale === s ? 'var(--rt-accent)' : 'var(--rt-border)'}`,
                    color: fontScale === s ? 'var(--rt-accent)' : 'var(--rt-muted)',
                  }}>{s}</button>
              ))}
            </div>
          </SettingRow>
          <SettingCheckbox label="Reduce motion (no waveform animation)" checked={reduceMotion} onChange={setReduceMotion} />
          <SettingCheckbox label="Compact rows" checked={compact} onChange={setCompact} />
          <SettingCheckbox label="24-hour time" checked={time24h} onChange={setTime24h} />
        </section>

        {/* Notifications */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[9px] font-mono tracking-[0.3em]" style={{ color: 'var(--rt-muted)' }}>NOTIFICATIONS</h3>
          <SettingCheckbox label="Desktop notifications" checked={notifEnabled} onChange={setNotifEnabled} />
          <SettingCheckbox label="Sound on new transmission" checked={soundEnabled} onChange={setSoundEnabled} />
          <SettingRow label="Notification sound">
            <div className="flex items-center gap-2">
              <select value={notifSound} onChange={(e) => setNotifSound(e.target.value)}
                aria-label="Notification sound"
                className="bg-transparent text-[10px] font-mono outline-none cursor-pointer"
                style={{ color: 'var(--rt-text)', border: '1px solid var(--rt-border)', padding: '2px 6px' }}>
                {Object.keys(NOTIF_SOUNDS).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <ToolbarBtn onClick={() => playBeep(notifSound)} title="Preview sound">TEST</ToolbarBtn>
            </div>
          </SettingRow>
        </section>

        {/* Quiet hours */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[9px] font-mono tracking-[0.3em]" style={{ color: 'var(--rt-muted)' }}>QUIET HOURS</h3>
          <p className="text-[10px]" style={{ color: 'var(--rt-muted)' }}>
            During quiet hours, sounds are suppressed but transmissions still appear in the log.
          </p>
          <SettingRow label="Start">
            <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)}
              aria-label="Quiet hours start"
              className="bg-transparent text-[10px] font-mono outline-none"
              style={{ color: 'var(--rt-text)', border: '1px solid var(--rt-border)', padding: '2px 6px' }} />
          </SettingRow>
          <SettingRow label="End">
            <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)}
              aria-label="Quiet hours end"
              className="bg-transparent text-[10px] font-mono outline-none"
              style={{ color: 'var(--rt-text)', border: '1px solid var(--rt-border)', padding: '2px 6px' }} />
          </SettingRow>
          {quietStart && quietEnd && (
            <div className="text-[10px] font-mono" style={{ color: quietActive ? 'var(--rt-tx)' : 'var(--rt-muted)' }}>
              {quietActive ? 'STATUS: QUIET HOURS ACTIVE' : 'STATUS: NOT IN QUIET HOURS'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
