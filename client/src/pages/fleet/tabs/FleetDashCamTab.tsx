// ============================================================
// RMPG Flex — Fleet Detail: Dash Cam Tab
// Shows dash cameras installed on the selected vehicle + videos
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Camera, Video, Loader2, Play, FileText } from 'lucide-react';
import type { DashCamera, DashCamVideo } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';
import VideoPlayer from '../../../components/VideoPlayer';

interface Props {
  vehicleId: string | number;
}

const STATUS_LED: Record<string, string> = {
  installed: 'led-dot led-green',
  available: 'led-dot led-blue',
  maintenance: 'led-dot led-amber',
  damaged: 'led-dot led-red',
  lost: 'led-dot led-off',
};

export default function FleetDashCamTab({ vehicleId }: Props) {
  const [cameras, setCameras] = useState<DashCamera[]>([]);
  const [videos, setVideos] = useState<DashCamVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingVideo, setPlayingVideo] = useState<DashCamVideo | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [cams, vids] = await Promise.all([
        apiFetch<any[]>('/fleet/dash-cameras'),
        apiFetch<any[]>('/fleet/dashcam-videos'),
      ]);
      const allCams: DashCamera[] = Array.isArray(cams) ? cams : [];
      const allVids: DashCamVideo[] = Array.isArray(vids) ? vids : [];
      setCameras(allCams.filter(c => String(c.vehicle_id) === String(vehicleId)));
      setVideos(allVids.filter(v => String(v.vehicle_id) === String(vehicleId)));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [vehicleId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
      </div>
    );
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  if (cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-rmpg-500">
        <Camera className="w-8 h-8 mb-2" />
        <p className="text-xs">No dash cameras installed on this vehicle</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Camera Cards */}
      <div>
        <h3 className="text-[10px] font-bold uppercase text-rmpg-400 tracking-wider mb-2">Installed Cameras</h3>
        <div className="grid grid-cols-1 gap-2">
          {cameras.map(cam => (
            <div key={cam.id} className="panel-inset p-3 flex items-center gap-3">
              <Camera className="w-4 h-4 text-brand-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-rmpg-100 font-mono">{cam.camera_id}</span>
                  <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase ${STATUS_LED[cam.status] ? '' : ''}`}>
                    <span className={STATUS_LED[cam.status] || 'led-dot led-off'} />
                    {cam.status}
                  </span>
                </div>
                <div className="text-[9px] text-rmpg-500 mt-0.5">
                  {[cam.make, cam.model].filter(Boolean).join(' ') || 'Unknown'} &bull; {cam.channel_count || 2}ch &bull; {cam.storage_capacity_gb || 32}GB
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Videos */}
      {videos.length > 0 && (
        <div>
          <h3 className="text-[10px] font-bold uppercase text-rmpg-400 tracking-wider mb-2">
            Videos ({videos.length})
          </h3>
          <div className="space-y-1.5">
            {videos.map(vid => (
              <button
                key={vid.id}
                className="w-full panel-inset p-2.5 flex items-center gap-3 hover:bg-rmpg-700/30 transition-colors text-left"
                onClick={() => setPlayingVideo(vid)}
              >
                <div className="w-8 h-8 bg-black/40 rounded flex items-center justify-center flex-shrink-0">
                  <Play className="w-3.5 h-3.5 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-rmpg-100 truncate">{vid.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[9px] text-rmpg-500">
                    <span className="font-mono">{formatDuration(vid.duration_seconds)}</span>
                    <span>&bull;</span>
                    <span>{formatSize(vid.file_size)}</span>
                    {vid.case_number && (
                      <>
                        <span>&bull;</span>
                        <span className="flex items-center gap-0.5"><FileText className="w-2.5 h-2.5" />{vid.case_number}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className={`text-[8px] px-1.5 py-0.5 font-bold uppercase flex-shrink-0 ${
                  vid.classification === 'evidence' ? 'bg-gray-900/40 text-gray-400' :
                  vid.classification === 'flagged' ? 'bg-amber-900/40 text-amber-400' :
                  vid.classification === 'restricted' ? 'bg-red-900/40 text-red-400' :
                  'bg-rmpg-700 text-rmpg-400'
                }`}>
                  {vid.classification}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {videos.length === 0 && (
        <div className="flex flex-col items-center py-6 text-rmpg-500">
          <Video className="w-5 h-5 mb-1" />
          <p className="text-[10px]">No videos for this vehicle</p>
        </div>
      )}

      {/* Video Player */}
      <VideoPlayer
        isOpen={!!playingVideo}
        onClose={() => setPlayingVideo(null)}
        video={playingVideo}
        apiBase={window.location.origin + '/api'}
        getAuthHeaders={() => {
          const token = localStorage.getItem('rmpg_token');
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          return headers;
        }}
        streamEndpoint="/fleet/dashcam-videos"
      />
    </div>
  );
}
