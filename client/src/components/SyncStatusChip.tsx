// client/src/components/SyncStatusChip.tsx
import { useApiBase } from '../hooks/useApiBase';

export default function SyncStatusChip() {
  const { mode, isProbing, localBase } = useApiBase();

  if (!localBase) return null;

  return (
    <div
      title={mode === 'local' ? 'Connected to local FZ-55 server' : 'Connected to Cloudflare'}
      className={[
        'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold select-none',
        mode === 'local'
          ? 'bg-green-900/40 text-green-300 border border-green-700/50'
          : 'bg-surface-raised text-rmpg-400 border border-rmpg-700/40',
        isProbing ? 'opacity-60' : '',
      ].join(' ')}
    >
      <span
        className={[
          'w-1.5 h-1.5 rounded-full',
          mode === 'local' ? 'bg-green-400' : 'bg-rmpg-500',
        ].join(' ')}
      />
      {mode === 'local' ? 'LOCAL' : 'CLOUD'}
    </div>
  );
}
