// ============================================================
// RMPG Flex — Body Cameras Page (Standalone)
// Extracted from PersonnelPage to its own route, accessible
// from the Personnel dropdown in the sidebar.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Video, Loader2, AlertTriangle } from 'lucide-react';
import type { BodyCamera, BodyCamVideo, VideoClassification } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import VideoUploadModal from '../components/VideoUploadModal';
import VideoPlayer from '../components/VideoPlayer';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useLiveSync } from '../hooks/useLiveSync';
import BodyCameraTab from './personnel/tabs/BodyCameraTab';
import BodyCameraFormModal from './personnel/modals/BodyCameraFormModal';
import type { BodyCameraFormData } from './personnel/modals/BodyCameraFormModal';
import { mapBodyCamera, mapBodyCamVideo } from './personnel/utils/personnelMappers';

type ModalMode = 'none' | 'new_body_camera' | 'edit_body_camera' | 'upload_video';

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function BodyCamerasPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'admin';

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  const [cameras, setCameras] = useState<BodyCamera[]>([]);
  const [videos, setVideos] = useState<BodyCamVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalMode>('none');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editData, setEditData] = useState<(Partial<BodyCameraFormData> & { id?: number }) | undefined>(undefined);
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create');
  const [playingVideo, setPlayingVideo] = useState<BodyCamVideo | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Officer list for the form modal dropdown
  const [officers, setOfficers] = useState<{ id: string; name: string }[]>([]);

  // ═══ NEW: Retention, Review, and Redaction Stats ═══
  const [retentionStats, setRetentionStats] = useState<{ total_expired: number; total_storage_gb: number } | null>(null);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [pendingRedactions, setPendingRedactions] = useState(0);

  // ----------------------------------------------------------
  // Data Fetching
  // ----------------------------------------------------------
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchData = useCallback(async () => {
    try {
      const [cams, vids, personnelList] = await Promise.all([
        apiFetch<any[]>('/personnel/body-cameras'),
        apiFetch<any[]>('/personnel/bodycam-videos'),
        apiFetch<any[]>('/personnel'),
      ]);
      if (!mountedRef.current) return;
      setCameras((Array.isArray(cams) ? cams : []).map(mapBodyCamera));
      setVideos((Array.isArray(vids) ? vids : []).map(mapBodyCamVideo));
      setOfficers(
        (Array.isArray(personnelList) ? personnelList : []).map((o: any) => ({
          id: String(o.id),
          name: `${o.first_name} ${o.last_name}${o.badge_number ? ` (${o.badge_number})` : ''}`,
        }))
      );
      setError(null);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || 'Failed to load body camera data');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    fetchData();
    // Fetch new upgrade data
    const fetchUpgradeData = async () => {
      try {
        const [ret, rev, red] = await Promise.all([
          apiFetch<any>('/personnel/bodycam-videos/retention/report').catch((err) => { console.warn('[BodyCameras] retention report fetch failed:', err); return null; }),
          apiFetch<any>('/personnel/bodycam-videos/reviews/pending').catch((err) => { console.warn('[BodyCameras] pending reviews fetch failed:', err); return null; }),
          apiFetch<any>('/personnel/bodycam-videos/redaction-requests').catch((err) => { console.warn('[BodyCameras] redaction requests fetch failed:', err); return null; }),
        ]);
        if (ret) setRetentionStats({ total_expired: ret.total_expired, total_storage_gb: ret.total_storage_gb });
        if (rev) setPendingReviews(rev.count || 0);
        if (red) setPendingRedactions((red.data || []).filter((r: any) => r.status === 'pending').length);
      } catch (err) { console.warn('[BodyCameras] upgrade data fetch failed:', err); }
    };
    fetchUpgradeData();
  }, [fetchData]);

  // Live-sync for real-time updates from other users
  useLiveSync('body_cameras', fetchData);
  useLiveSync('bodycam_videos', fetchData);

  // ----------------------------------------------------------
  // Refresh (cameras + videos only, skip officers)
  // ----------------------------------------------------------
  const refreshBodyCameras = async () => {
    const [cams, vids] = await Promise.all([
      apiFetch<any[]>('/personnel/body-cameras'),
      apiFetch<any[]>('/personnel/bodycam-videos'),
    ]);
    setCameras((Array.isArray(cams) ? cams : []).map(mapBodyCamera));
    setVideos((Array.isArray(vids) ? vids : []).map(mapBodyCamVideo));
  };

  // ----------------------------------------------------------
  // CRUD Handlers
  // ----------------------------------------------------------
  const handleSubmit = async (data: BodyCameraFormData) => {
    setIsSubmitting(true);
    try {
      const payload = { ...data, storage_capacity_gb: parseInt(data.storage_capacity_gb, 10) || 32 };
      if (editMode === 'edit' && editData?.id) {
        await apiFetch(`/personnel/body-cameras/${editData.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/personnel/body-cameras', { method: 'POST', body: JSON.stringify(payload) });
      }
      setModal('none');
      setEditData(undefined);
      await refreshBodyCameras();
      addToast('Body camera saved', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to save body camera', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (camId: number) => {
    if (!window.confirm('Delete this body camera and all associated videos? This cannot be undone.')) return;
    try {
      await apiFetch(`/personnel/body-cameras/${camId}`, { method: 'DELETE' });
      await refreshBodyCameras();
      addToast('Body camera deleted', 'success');
    } catch {
      addToast('Failed to delete body camera', 'error');
    }
  };

  const handleVideoDelete = async (videoId: number) => {
    if (!window.confirm('Delete this video? This cannot be undone.')) return;
    try {
      await apiFetch(`/personnel/bodycam-videos/${videoId}`, { method: 'DELETE' });
      await refreshBodyCameras();
      addToast('Video deleted', 'success');
    } catch {
      addToast('Failed to delete video', 'error');
    }
  };

  const openAdd = () => {
    setEditData(undefined);
    setEditMode('create');
    setModal('new_body_camera');
  };

  const openEdit = (cam: BodyCamera) => {
    setEditData({
      id: cam.id, officer_id: String(cam.officer_id), camera_id: cam.camera_id,
      make: cam.make || '', model: cam.model || '', firmware_version: cam.firmware_version || '',
      storage_capacity_gb: String(cam.storage_capacity_gb || 32),
      status: cam.status, condition: cam.condition || 'good',
      assigned_at: cam.assigned_at || '', returned_at: cam.returned_at || '', notes: cam.notes || '',
    });
    setEditMode('edit');
    setModal('edit_body_camera');
  };

  // ----------------------------------------------------------
  // Bulk Operations
  // ----------------------------------------------------------
  const handleBulkDeleteVideos = async (ids: number[]) => {
    setBulkLoading(true);
    try {
      await apiFetch('/personnel/bodycam-videos/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ videoIds: ids }),
      });
      await refreshBodyCameras();
      addToast(`${ids.length} video(s) deleted`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Bulk delete failed', 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkClassifyVideos = async (ids: number[], classification: VideoClassification) => {
    setBulkLoading(true);
    try {
      await apiFetch('/personnel/bodycam-videos/bulk', {
        method: 'PUT',
        body: JSON.stringify({ videoIds: ids, classification }),
      });
      await refreshBodyCameras();
      addToast(`${ids.length} video(s) reclassified to ${classification}`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Bulk classify failed', 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDeleteCameras = async (ids: number[]) => {
    setBulkLoading(true);
    try {
      await apiFetch('/personnel/body-cameras/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ cameraIds: ids }),
      });
      await refreshBodyCameras();
      addToast(`${ids.length} camera(s) deleted`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Bulk delete failed', 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  // Set document title
  useEffect(() => { document.title = 'Body Cameras \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex flex-col h-full animate-fade-in">

      {/* Header */}
      <div className="flex-shrink-0 border-b border-rmpg-700" style={{ background: '#0d1520' }}>
        <PanelTitleBar title="BODY CAMERAS" icon={Video}>
          <RmpgLogo height={16} iconOnly />
          <span className="toolbar-separator" />
          <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400 mr-3" role="group" aria-label="Body camera statistics">
            <Video className="w-3 h-3" aria-hidden="true" />
            <span>Cameras: <strong className="text-white">{cameras.length}</strong></span>
            <span className="text-rmpg-600" aria-hidden="true">|</span>
            <span>Videos: <strong className="text-brand-400">{videos.length}</strong></span>
            {pendingReviews > 0 && (<>
              <span className="text-rmpg-600">|</span>
              <span>Reviews: <strong className="text-amber-400">{pendingReviews}</strong></span>
            </>)}
            {pendingRedactions > 0 && (<>
              <span className="text-rmpg-600">|</span>
              <span>Redactions: <strong className="text-red-400">{pendingRedactions}</strong></span>
            </>)}
            {retentionStats && retentionStats.total_expired > 0 && (<>
              <span className="text-rmpg-600">|</span>
              <span>Expired: <strong className="text-red-400">{retentionStats.total_expired}</strong></span>
            </>)}
          </div>
          <PrintButton />
        </PanelTitleBar>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-dark">
        {loading && (
          <div className="flex items-center justify-center flex-1 py-20">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center justify-center flex-1 py-20">
            <div className="text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-rmpg-300">{error}</p>
              <button type="button" onClick={fetchData} className="toolbar-btn mt-3">Retry</button>
            </div>
          </div>
        )}

        {!loading && !error && (
          <BodyCameraTab
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
      <BodyCameraFormModal
        isOpen={modal === 'new_body_camera' || modal === 'edit_body_camera'}
        onClose={() => { setModal('none'); setEditData(undefined); }}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        officers={officers}
        initialData={editData}
        mode={editMode}
      />

      <VideoUploadModal
        isOpen={modal === 'upload_video'}
        onClose={() => setModal('none')}
        onUploaded={refreshBodyCameras}
        cameras={cameras}
        officerId={0}
        apiBase={window.location.origin + '/api'}
        getAuthHeaders={() => {
          const token = localStorage.getItem('rmpg_token');
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          return headers;
        }}
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
        onClassify={canManage ? async (videoId, classification) => {
          try {
            await apiFetch(`/personnel/bodycam-videos/${videoId}`, {
              method: 'PUT',
              body: JSON.stringify({ classification }),
            });
            await refreshBodyCameras();
            // Update the playing video's classification in-place
            setPlayingVideo(prev => prev ? { ...prev, classification } : null);
            addToast(`Video reclassified to ${classification}`, 'success');
          } catch {
            addToast('Failed to reclassify video', 'error');
          }
        } : undefined}
      />
    </div>
  );
}
