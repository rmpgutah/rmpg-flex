// ============================================================
// RMPG Flex — Dash Cameras Page (Standalone)
// Vehicle-mounted dash camera management with video upload
// and playback. Accessible from the Personnel dropdown.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Loader2, AlertTriangle } from 'lucide-react';
import type { DashCamera, DashCamVideo, VideoClassification } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import VideoUploadModal from '../components/VideoUploadModal';
import VideoPlayer from '../components/VideoPlayer';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useLiveSync } from '../hooks/useLiveSync';
import DashCameraTab from './dashcam/DashCameraTab';
import DashCameraFormModal from './dashcam/DashCameraFormModal';
import type { DashCameraFormData } from './dashcam/DashCameraFormModal';

type ModalMode = 'none' | 'new_dash_camera' | 'edit_dash_camera' | 'upload_video';

function mapDashCamera(raw: any): DashCamera {
  return {
    id: raw.id, vehicle_id: raw.vehicle_id, camera_id: raw.camera_id || '',
    make: raw.make || '', model: raw.model || '', firmware_version: raw.firmware_version || '',
    storage_capacity_gb: raw.storage_capacity_gb || 32, channel_count: raw.channel_count || 2,
    status: raw.status || 'available', condition: raw.condition || 'good',
    installed_at: raw.installed_at || '', removed_at: raw.removed_at || '',
    notes: raw.notes || '', created_by: raw.created_by || '',
    created_at: raw.created_at || '', updated_at: raw.updated_at || '',
    vehicle_number: raw.vehicle_number, vehicle_make: raw.vehicle_make,
    vehicle_model: raw.vehicle_model, vehicle_year: raw.vehicle_year,
  };
}

function mapDashCamVideo(raw: any): DashCamVideo {
  return {
    id: raw.id, camera_id: raw.camera_id, vehicle_id: raw.vehicle_id,
    title: raw.title || '', file_path: raw.file_path || '',
    file_size: raw.file_size || 0, duration_seconds: raw.duration_seconds || 0,
    mime_type: raw.mime_type || 'video/mp4', recorded_at: raw.recorded_at || '',
    case_number: raw.case_number || '', classification: raw.classification || 'routine',
    retention_status: raw.retention_status || 'active',
    gps_lat: raw.gps_lat, gps_lon: raw.gps_lon,
    notes: raw.notes || '', uploaded_by: raw.uploaded_by || '',
    created_at: raw.created_at || '', updated_at: raw.updated_at || '',
    camera_serial: raw.camera_serial, vehicle_number: raw.vehicle_number,
  };
}

export default function DashCamerasPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'admin';

  const [cameras, setCameras] = useState<DashCamera[]>([]);
  const [videos, setVideos] = useState<DashCamVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalMode>('none');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editData, setEditData] = useState<(Partial<DashCameraFormData> & { id?: number }) | undefined>(undefined);
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create');
  const [playingVideo, setPlayingVideo] = useState<DashCamVideo | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [vehicles, setVehicles] = useState<{ id: string; label: string }[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [cams, vids, fleetList] = await Promise.all([
        apiFetch<any[]>('/fleet/dash-cameras'),
        apiFetch<any[]>('/fleet/dashcam-videos'),
        apiFetch<any>('/fleet'),
      ]);
      setCameras((Array.isArray(cams) ? cams : []).map(mapDashCamera));
      setVideos((Array.isArray(vids) ? vids : []).map(mapDashCamVideo));
      const vehicleList = Array.isArray(fleetList) ? fleetList : (fleetList?.vehicles || []);
      setVehicles(
        vehicleList.map((v: any) => ({
          id: String(v.id),
          label: `${v.vehicle_number}${v.make ? ` — ${v.year || ''} ${v.make} ${v.model || ''}`.trim() : ''}`,
        }))
      );
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load dash camera data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useLiveSync('dash_cameras', fetchData);
  useLiveSync('dashcam_videos', fetchData);

  const refreshDashCameras = async () => {
    const [cams, vids] = await Promise.all([
      apiFetch<any[]>('/fleet/dash-cameras'),
      apiFetch<any[]>('/fleet/dashcam-videos'),
    ]);
    setCameras((Array.isArray(cams) ? cams : []).map(mapDashCamera));
    setVideos((Array.isArray(vids) ? vids : []).map(mapDashCamVideo));
  };

  const handleSubmit = async (data: DashCameraFormData) => {
    setIsSubmitting(true);
    try {
      const payload = {
        ...data,
        storage_capacity_gb: parseInt(data.storage_capacity_gb) || 32,
        channel_count: parseInt(data.channel_count) || 2,
      };
      if (editMode === 'edit' && editData?.id) {
        await apiFetch(`/fleet/dash-cameras/${editData.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/fleet/dash-cameras', { method: 'POST', body: JSON.stringify(payload) });
      }
      setModal('none');
      setEditData(undefined);
      await refreshDashCameras();
      addToast('Dash camera saved', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to save dash camera', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (camId: number) => {
    try {
      await apiFetch(`/fleet/dash-cameras/${camId}`, { method: 'DELETE' });
      await refreshDashCameras();
      addToast('Dash camera deleted', 'success');
    } catch { addToast('Failed to delete dash camera', 'error'); }
  };

  const handleVideoDelete = async (videoId: number) => {
    try {
      await apiFetch(`/fleet/dashcam-videos/${videoId}`, { method: 'DELETE' });
      await refreshDashCameras();
      addToast('Video deleted', 'success');
    } catch { addToast('Failed to delete video', 'error'); }
  };

  const openAdd = () => { setEditData(undefined); setEditMode('create'); setModal('new_dash_camera'); };
  const openEdit = (cam: DashCamera) => {
    setEditData({
      id: cam.id, vehicle_id: String(cam.vehicle_id), camera_id: cam.camera_id,
      make: cam.make || '', model: cam.model || '', firmware_version: cam.firmware_version || '',
      storage_capacity_gb: String(cam.storage_capacity_gb || 32),
      channel_count: String(cam.channel_count || 2),
      status: cam.status, condition: cam.condition || 'good',
      installed_at: cam.installed_at || '', removed_at: cam.removed_at || '', notes: cam.notes || '',
    });
    setEditMode('edit');
    setModal('edit_dash_camera');
  };

  const handleBulkDeleteVideos = async (ids: number[]) => {
    setBulkLoading(true);
    try {
      await apiFetch('/fleet/dashcam-videos/bulk', { method: 'DELETE', body: JSON.stringify({ videoIds: ids }) });
      await refreshDashCameras();
      addToast(`${ids.length} video(s) deleted`, 'success');
    } catch (err: any) { addToast(err?.message || 'Bulk delete failed', 'error'); }
    finally { setBulkLoading(false); }
  };

  const handleBulkClassifyVideos = async (ids: number[], classification: VideoClassification) => {
    setBulkLoading(true);
    try {
      await apiFetch('/fleet/dashcam-videos/bulk', { method: 'PUT', body: JSON.stringify({ videoIds: ids, classification }) });
      await refreshDashCameras();
      addToast(`${ids.length} video(s) reclassified to ${classification}`, 'success');
    } catch (err: any) { addToast(err?.message || 'Bulk classify failed', 'error'); }
    finally { setBulkLoading(false); }
  };

  const handleBulkDeleteCameras = async (ids: number[]) => {
    setBulkLoading(true);
    try {
      await apiFetch('/fleet/dash-cameras/bulk', { method: 'DELETE', body: JSON.stringify({ cameraIds: ids }) });
      await refreshDashCameras();
      addToast(`${ids.length} camera(s) deleted`, 'success');
    } catch (err: any) { addToast(err?.message || 'Bulk delete failed', 'error'); }
    finally { setBulkLoading(false); }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-rmpg-700" style={{ background: '#161616' }}>
        <PanelTitleBar title="DASH CAMERAS" icon={Camera}>
          <RmpgLogo height={16} iconOnly />
          <span className="toolbar-separator" />
          <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400 mr-3">
            <Camera className="w-3 h-3" />
            <span>Cameras: <strong className="text-white">{cameras.length}</strong></span>
            <span className="text-rmpg-600">|</span>
            <span>Videos: <strong className="text-brand-400">{videos.length}</strong></span>
          </div>
          <PrintButton />
        </PanelTitleBar>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center flex-1 py-20">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-center flex-1 py-20">
            <div className="text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-rmpg-300">{error}</p>
              <button onClick={fetchData} className="toolbar-btn mt-3">Retry</button>
            </div>
          </div>
        )}

        {!loading && !error && (
          <DashCameraTab
            cameras={cameras}
            videos={videos}
            onAddCamera={openAdd}
            onEditCamera={openEdit}
            onDeleteCamera={handleDelete}
            onPlayVideo={setPlayingVideo}
            onDeleteVideo={handleVideoDelete}
            onUploadVideo={() => setModal('upload_video')}
            canManage={canManage}
            onBulkDeleteVideos={handleBulkDeleteVideos}
            onBulkClassifyVideos={handleBulkClassifyVideos}
            onBulkDeleteCameras={handleBulkDeleteCameras}
            bulkLoading={bulkLoading}
          />
        )}
      </div>

      {/* Modals */}
      <DashCameraFormModal
        isOpen={modal === 'new_dash_camera' || modal === 'edit_dash_camera'}
        onClose={() => { setModal('none'); setEditData(undefined); }}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        vehicles={vehicles}
        initialData={editData}
        mode={editMode}
      />

      <VideoUploadModal
        isOpen={modal === 'upload_video'}
        onClose={() => setModal('none')}
        onUploaded={refreshDashCameras}
        cameras={cameras.map(c => ({
          id: c.id,
          camera_id: c.camera_id,
          officer_id: c.vehicle_id,
          make: c.make,
          model: c.model,
          status: c.status as any,
          officer_name: c.vehicle_number || `Vehicle #${c.vehicle_id}`,
        }))}
        officerId={0}
        apiBase={window.location.origin + '/api'}
        getAuthHeaders={() => {
          const token = localStorage.getItem('rmpg_token');
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          return headers;
        }}
        uploadEndpoint="/fleet/dashcam-videos"
      />

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
