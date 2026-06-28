interface Props {
  channels: string[];
  current: string;
  onChange: (channel: string) => void;
}

export function ChannelSwitcher({ channels, current, onChange }: Props) {
  if (channels.length <= 1) return null;
  return (
    <div className="flex gap-1">
      {channels.map((ch) => (
        <button
          key={ch}
          onClick={() => onChange(ch)}
          className={`px-2 py-1 text-xs rounded-[2px] ${ch === current ? 'bg-brand-500 text-rmpg-100' : 'bg-surface-raised text-rmpg-300'}`}
        >
          {ch.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
