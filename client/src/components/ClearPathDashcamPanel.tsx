// ============================================================
// RMPG Flex — ClearPath dashcam status panel (plate-log)
// Surfaces the passive dashcam ALPR pipeline in the plate log: is it
// configured/enabled, how many cameras are mapped, media-sync state + last
// sync + clips, and how many plate reads have come from dashcams. Links to the
// Admin → ClearPath GPS tab for configuration.
// ============================================================

import { useEffect, useState } from 'react';
import { Video, Settings, Camera } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';

interface CpgStatus {
  configured: boolean; enabled: boolean; active_mappings: number;
  media_sync_enabled?: boolean; last_media_sync?: string | null;
}
interface MediaStatus { total_synced_clips: number; total_dashcam_reads?: number; last_media_sync: string | null }

export default function ClearPathDashcamPanel({ dashcamCount }: { dashcamCount: number }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<CpgStatus | null>(null);
  const [media, setMedia] = useState<MediaStatus | null>(null);

  useEffect(() => {
    apiFetch<CpgStatus>('/clearpathgps/status').then(setStatus).catch(() => setStatus(null));
    apiFetch<MediaStatus>('/clearpathgps/media-status').then(setMedia).catch(() => setMedia(null));
  }, []);

  const configured = !!status?.configured;
  const active = configured && !!status?.enabled;
  const mediaOn = active && !!status?.media_sync_enabled;
  const lastSync = media?.last_media_sync || status?.last_media_sync;
  const dot = !configured ? 'bg-[#555]' : mediaOn ? 'bg-purple-400 animate-pulse' : active ? 'bg-[#d4a017]' : 'bg-[#888]';
  const label = !configured ? 'NOT CONFIGURED' : mediaOn ? 'DASHCAM ALPR ACTIVE' : active ? 'GPS ON · MEDIA OFF' : 'CONFIGURED · DISABLED';

  return (
    <div className="border border-purple-900/60 bg-[#0b0b0b]">
      <div className="px-2 py-[3px] border-b border-[#1a1a1a] flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[9px] font-semibold text-purple-300">
          <Video className="w-3 h-3" /> CLEARPATH DASHCAM
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
          <span className="text-[#888888] font-normal tracking-wide">{label}</span>
        </div>
        <button type="button" onClick={() => navigate('/admin')} className="text-[#888888] hover:text-white flex items-center gap-1 text-[9px]" title="Configure ClearPath GPS">
          <Settings className="w-3 h-3" /> Configure
        </button>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[#1a1a1a]">
        <Stat icon={<Camera className="w-3 h-3" />} value={configured ? status!.active_mappings : '—'} label="cameras" />
        <Stat value={media ? media.total_synced_clips : '—'} label="clips" />
        {/* Real dashcam ALPR reads come from alpr_captures (media-status), not the
            recent-sightings window (`dashcamCount`) which read 0 even with hundreds
            of captures. Fall back to the prop if the server field is absent. */}
        <Stat value={media?.total_dashcam_reads ?? dashcamCount} label="reads" />
      </div>
      {lastSync && <div className="px-2 py-1 text-[9px] text-[#666666] border-t border-[#1a1a1a]">Last sync: {String(lastSync).replace('T', ' ').slice(0, 16)}</div>}
      {!configured && (
        <div className="px-2 py-1.5 text-[10px] text-[#888888] border-t border-[#1a1a1a]">
          Connect your ClearPath cameras to read plates passively from dashcam footage. Tap <span className="text-purple-300">Configure</span>.
        </div>
      )}
    </div>
  );
}

function Stat({ icon, value, label }: { icon?: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="px-2 py-1.5 text-center">
      <div className="text-sm font-bold text-white font-mono flex items-center justify-center gap-1">{icon}{value}</div>
      <div className="text-[8px] uppercase tracking-wider text-[#888888]">{label}</div>
    </div>
  );
}
