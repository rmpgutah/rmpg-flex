// ──────────────────────────────────────────────────────────────────
// RadioPage — leaf presentational components.
// All theme-aware via CSS vars (--rt-*); no useState, no effects.
// ──────────────────────────────────────────────────────────────────
import { Fragment } from 'react';
import { Antenna, WifiOff } from 'lucide-react';

export function Sep() { return <span className="text-[10px] font-mono" style={{ color: 'var(--rt-muted)' }}>│</span>; }

export function Banner({ icon, color, bg, children }: { icon: React.ReactNode; color: string; bg: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2" style={{ background: bg, borderBottom: `1px solid ${color}66` }}>
      {icon}
      <div className="flex-1 text-[10px] font-mono flex items-center gap-2">{children}</div>
    </div>
  );
}

export function ToolbarBtn({ children, onClick, active, danger, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean; title?: string }) {
  const fg = danger ? '#ef4444' : active ? 'var(--rt-accent)' : 'var(--rt-muted)';
  const bg = active ? 'rgba(212,160,23,0.10)' : 'transparent';
  return (
    <button type="button" onClick={onClick} title={title}
      className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono font-bold tracking-wider"
      style={{ border: `1px solid ${active ? fg : 'var(--rt-border)'}`, color: fg, background: bg }}>
      {children}
    </button>
  );
}

export function MiniToggle({ children, onClick, active, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      className="flex items-center justify-center w-5 h-5"
      style={{
        border: `1px solid ${active ? 'var(--rt-accent)' : 'var(--rt-border)'}`,
        color: active ? 'var(--rt-accent)' : 'var(--rt-muted)',
        background: active ? 'rgba(212,160,23,0.1)' : 'transparent',
      }}>
      {children}
    </button>
  );
}

export function ModeToggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono font-bold tracking-wider"
      style={{
        border: `1px solid ${active ? 'var(--rt-accent)' : 'var(--rt-border)'}`,
        color: active ? 'var(--rt-accent)' : 'var(--rt-muted)',
        background: active ? 'rgba(212,160,23,0.08)' : 'transparent',
      }}>
      {icon} {label}
    </button>
  );
}

export function FilterChip({ children, onClick, active, icon }: { children: React.ReactNode; onClick: () => void; active?: boolean; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-wider"
      style={{
        border: `1px solid ${active ? 'var(--rt-accent)' : 'var(--rt-border)'}`,
        color: active ? 'var(--rt-accent)' : 'var(--rt-muted)',
        background: active ? 'rgba(212,160,23,0.08)' : 'transparent',
      }}>
      {icon}{children}
    </button>
  );
}

export function SectionHeader({ icon, label, trailing }: { icon: React.ReactNode; label: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0"
      style={{ background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)', borderBottom: '1px solid var(--rt-border)' }}>
      {icon}
      <span className="text-[9px] font-mono font-bold tracking-[0.2em] flex-1 truncate" style={{ color: 'var(--rt-text)' }}>{label}</span>
      {trailing}
    </div>
  );
}

export function Waveform({ color, reverse = false, reduceMotion = false }: { color: string; reverse?: boolean; reduceMotion?: boolean }) {
  const bars = reverse ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return (
    <div className="flex items-end gap-0.5 h-6">
      {bars.map(i => (
        <div key={i} className="w-1"
          style={{
            background: color,
            height: reduceMotion ? '12px' : undefined,
            animation: reduceMotion ? 'none' : `radioWave 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
          }} />
      ))}
    </div>
  );
}

export function EmptyConsole({ isConnected, channels }: { isConnected: boolean; channels: number }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-4 text-center">
      <div className="w-24 h-24 flex items-center justify-center"
        style={{ background: 'radial-gradient(circle at 30% 30%, #1a1a1a 0%, #0a0a0a 70%)', border: '3px solid var(--rt-border)', boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.6)', borderRadius: '50%' }}>
        <Antenna style={{ width: 36, height: 36, color: '#333' }} />
      </div>
      <div>
        <div className="text-sm font-mono font-bold tracking-[0.3em]" style={{ color: 'var(--rt-text)' }}>NO CHANNEL JOINED</div>
        <div className="text-[10px] font-mono mt-1 tracking-wider" style={{ color: 'var(--rt-muted)' }}>
          {channels} channel{channels === 1 ? '' : 's'} available — pick one from the left to begin
        </div>
      </div>
      {!isConnected && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono text-red-400" style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.15)' }}>
          <WifiOff style={{ width: 12, height: 12 }} />
          DISCONNECTED — Radio service unavailable
        </div>
      )}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card px-2 py-1.5" style={{ background: '#0a0a0a', border: '1px solid var(--rt-border)' }}>
      <div className="text-[8px] font-mono tracking-[0.2em]" style={{ color: 'var(--rt-muted)' }}>{label}</div>
      <div className="text-base font-mono font-bold tabular-nums leading-tight" style={{ color: 'var(--rt-text)' }}>{value}</div>
    </div>
  );
}

export function Sparkline({ values, highlight }: { values: number[]; highlight?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-px h-8 px-2 py-1" style={{ background: '#0a0a0a', border: '1px solid var(--rt-border)' }}>
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * 100);
        const isNow = i === highlight;
        return (
          <div key={i} className="spark-bar flex-1" title={`${i.toString().padStart(2, '0')}:00 — ${v} tx`}
            style={{ height: `${h}%`, background: isNow ? 'var(--rt-accent)' : v === 0 ? '#1a1a1a' : '#2a8a2a', boxShadow: isNow ? '0 0 4px var(--rt-accent)' : 'none' }} />
        );
      })}
    </div>
  );
}

export function Heatmap({ rows }: { rows: number[][] }) {
  const max = Math.max(1, ...rows.flat());
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <div className="grid grid-cols-[14px_repeat(24,1fr)] gap-px" style={{ background: '#0a0a0a', padding: 1, border: '1px solid var(--rt-border)' }}>
      {rows.map((row, dayIdx) => (
        <Fragment key={dayIdx}>
          <div className="text-[7px] font-mono flex items-center justify-center" style={{ color: 'var(--rt-muted)' }}>{labels[dayIdx]}</div>
          {row.map((v, hour) => {
            const intensity = v / max;
            const bg = v === 0 ? '#101010' : `rgba(212,160,23,${0.15 + intensity * 0.85})`;
            return <div key={hour} title={`${labels[dayIdx]} ${hour.toString().padStart(2, '0')}:00 — ${v} tx`}
              style={{ background: bg, height: 8 }} />;
          })}
        </Fragment>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 mx-0.5 text-[9px] font-mono font-bold" style={{ background: '#1a1a1a', border: '1px solid #333', color: 'var(--rt-text)' }}>
      {children}
    </kbd>
  );
}

export function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 justify-between">
      <span className="text-[10px] tracking-wider" style={{ color: 'var(--rt-muted)' }}>{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

export function SettingCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 justify-between cursor-pointer">
      <span className="text-[10px] tracking-wider" style={{ color: 'var(--rt-muted)' }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="cursor-pointer" style={{ accentColor: 'var(--rt-accent)' }} />
    </label>
  );
}
