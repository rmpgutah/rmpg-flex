// ============================================================
// RMPG Flex — Body Cameras Page (Standalone)
// Extracted from PersonnelPage to its own route, accessible
// from the Personnel dropdown in the sidebar.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import DeleteRecordModal from '../components/DeleteRecordModal';
import { isEvidenceLocked, evidenceLockReason } from '../utils/evidenceLock';

type ModalMode = 'none' | 'new_body_camera' | 'edit_body_camera' | 'upload_video';

export default function BodyCamerasPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'admin';
  const isGodMode = user?.role === 'admin'; // Admin God Mode — unrestricted access

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

  // Destructive-modal state lifted from below so the deep-link +
  // Esc-cascade effects (declared next) can read it. The previous
  // ordering put these declarations AFTER the effects that referenced
  // them — TS catches it, but lifting also makes the page's state
  // shape easier to scan.
  const [cameraToDelete, setCameraToDelete] = useState<BodyCamera | null>(null);
  const [videoToDelete, setVideoToDelete] = useState<BodyCamVideo | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  // ── /body-cameras?video_id=<id> URL deep-link auto-open ──
  // 22nd consecutive page-pass on the cross-page contract. Court-package
  // links, evidence cross-refs, and the dashcam ↔ BWC sibling lookup all
  // need to open the player directly on a specific clip. Falls through
  // to a direct fetch when the row is paginated out of the current list
  // (officer filter, retention narrow). Param is stripped after applying
  // so a hard refresh doesn't loop. The aliases `clip_id` and
  // `recording_id` mirror the mission brief — older bookmarks generated
  // before the canonical param was named survive.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingVideoIdRef = useRef<string | null>(
    searchParams.get('video_id')
    || searchParams.get('clip_id')
    || searchParams.get('recording_id'),
  );
  useEffect(() => {
    const target = pendingVideoIdRef.current;
    if (!target || loading) return;
    pendingVideoIdRef.current = null;
    let cancelled = false;
    (async () => {
      try {
        const hit = videos.find((v) => String(v.id) === String(target));
        if (hit) {
          if (!cancelled) setPlayingVideo(hit);
        } else {
          const row = await apiFetch<any>(`/personnel/bodycam-videos/${target}`);
          if (cancelled) return;
          if (row && row.id != null) {
            setPlayingVideo(mapBodyCamVideo(row));
          } else {
            addToast(`Video ${target} not found`, 'warning');
          }
        }
      } catch {
        if (!cancelled) addToast(`Failed to load video ${target}`, 'error');
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('video_id');
          next.delete('clip_id');
          next.delete('recording_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, loading]);

  // ── Esc smart-cascade ──
  // Closes the smallest-open-first of the five modals BodyCamerasPage
  // owns (player → upload → camera form → camera-delete → video-delete).
  // The player on its own already self-closes on Esc via React-Router /
  // the role="dialog" handler, but pressing Esc while typing in the
  // upload modal previously did nothing — and ConfirmDialog's Esc
  // listener only fires when ConfirmDialog itself owns focus. Centralised
  // here so every owner-controlled modal in the page behaves the same.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Top-most-first cascade: any open destructive dialog wins,
      // then the player, then the upload modal, then the camera form.
      if (cameraToDelete) { setCameraToDelete(null); return; }
      if (videoToDelete) { setVideoToDelete(null); return; }
      if (playingVideo) { setPlayingVideo(null); return; }
      if (modal === 'upload_video') { setModal('none'); return; }
      if (modal === 'new_body_camera' || modal === 'edit_body_camera') {
        // Don't ambush an operator mid-typing in the form.
        if (isTypingInField(e.target)) return;
        setModal('none'); setEditData(undefined); return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cameraToDelete, videoToDelete, playingVideo, modal]);

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

  // Track the full row of the camera / video being deleted so the
  // destructive modal can surface officer name, capture date, linked
  // incident, and evidence-lock status. The previous `window.confirm`
  // showed "Delete this video? This cannot be undone." with no
  // identifying info — evidentiary footage was being destroyed with
  // zero identity check. Audit caught (2026-06-21). State declarations
  // were lifted above the deep-link / Esc-cascade effects (which read
  // them) — see top of component.

  // Audit caught (2026-06-21 follow-up): the previous "find by id, if
  // found set" was silently swallowing the click when a concurrent
  // useLiveSync removed the row between render + click. Now we toast +
  // refresh so the operator gets a model of what happened.
  const handleDelete = (camId: number) => {
    const cam = cameras.find(c => c.id === camId);
    if (cam) { setCameraToDelete(cam); return; }
    addToast('That camera is no longer available — refreshing list', 'info');
    refreshBodyCameras();
  };

  const handleVideoDelete = (videoId: number) => {
    const v = videos.find(x => x.id === videoId);
    if (v) { setVideoToDelete(v); return; }
    addToast('That video is no longer available — refreshing list', 'info');
    refreshBodyCameras();
  };

  // Reordered post-delete flow: the v1009 sequence reported a refresh
  // failure as a delete failure (false 'Failed to delete' toast on a
  // row that IS gone, modal kept the just-deleted video on screen).
  // Now the delete result is reported truthfully even when refresh
  // fails; refresh failure surfaces as a non-blocking info toast.
  const confirmCameraDelete = async (opts?: { force?: boolean }) => {
    if (!cameraToDelete) return;
    const camId = cameraToDelete.id;
    setDeleting(true);
    const path = opts?.force
      ? `/personnel/body-cameras/${camId}?force=true`
      : `/personnel/body-cameras/${camId}`;
    try {
      await apiFetch(path, { method: 'DELETE' });
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete body camera', 'error');
      setDeleting(false);
      return;
    }
    setCameraToDelete(null);
    setDeleting(false);
    addToast(opts?.force ? 'Body camera destroyed (admin override)' : 'Body camera deleted', 'success');
    try { await refreshBodyCameras(); }
    catch { addToast('Camera list could not refresh — pull-to-refresh to retry', 'info'); }
  };

  const confirmVideoDelete = async (opts?: { force?: boolean }) => {
    if (!videoToDelete) return;
    const vidId = videoToDelete.id;
    setDeleting(true);
    const path = opts?.force
      ? `/personnel/bodycam-videos/${vidId}?force=true`
      : `/personnel/bodycam-videos/${vidId}`;
    try {
      await apiFetch(path, { method: 'DELETE' });
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete video', 'error');
      setDeleting(false);
      return;
    }
    setVideoToDelete(null);
    setDeleting(false);
    addToast(opts?.force ? 'Video destroyed (admin override)' : 'Video deleted', 'success');
    try { await refreshBodyCameras(); }
    catch { addToast('Video list could not refresh — pull-to-refresh to retry', 'info'); }
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
      <div className="flex-shrink-0 border-b border-rmpg-700" style={{ background: 'var(--surface-overlay)' }}>
        <PanelTitleBar title="BODY CAMERAS" icon={Video}>
          <RmpgLogo height={16} iconOnly />
          <span className="toolbar-separator" />
          <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400 mr-3" role="group" aria-label="Body camera statistics">
            <Video className="w-3 h-3" aria-hidden="true" />
            <span>Cameras: <strong className="text-rmpg-100">{cameras.length}</strong></span>
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
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark">
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
        preparedBy={user
          ? ((`${user.first_name || ''} ${user.last_name || ''}`.trim()) || user.full_name || user.username)
          : undefined}
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

      <DeleteRecordModal
        isOpen={cameraToDelete !== null}
        onClose={() => setCameraToDelete(null)}
        onConfirm={confirmCameraDelete}
        recordType="body camera"
        recordLabel={cameraToDelete?.camera_id || cameraToDelete?.make}
        details={
          cameraToDelete && (
            <>
              {cameraToDelete.officer_name && <div>Assigned to: {cameraToDelete.officer_name}</div>}
              {cameraToDelete.camera_id && <div>ID: {cameraToDelete.camera_id}</div>}
              {(cameraToDelete.make || cameraToDelete.model) && (
                <div className="text-rmpg-500">{[cameraToDelete.make, cameraToDelete.model].filter(Boolean).join(' ')}</div>
              )}
              <div className="text-amber-400 mt-1">Removes the camera AND all associated videos.</div>
            </>
          )
        }
        // Cascade hold check — the server-side DELETE on a camera
        // CASCADEs into bodycam_videos. The follow-up audit caught
        // that a camera delete bypassed the per-video evidence-lock
        // entirely. We block here whenever ANY video under the camera
        // is on a hold; the server has the same check as backup.
        evidenceLocked={
          !!cameraToDelete
          && videos.some(v => v.camera_id === cameraToDelete.id && isEvidenceLocked(v.retention_status))
        }
        evidenceLockReason={
          cameraToDelete
            ? `One or more videos assigned to this camera are under hold. Release the hold from the evidence custody page before retiring the camera.`
            : undefined
        }
        isDeleting={deleting}
      />

      <DeleteRecordModal
        isOpen={videoToDelete !== null}
        onClose={() => setVideoToDelete(null)}
        onConfirm={confirmVideoDelete}
        recordType="body-cam video"
        recordLabel={
          videoToDelete?.title
          || (videoToDelete?.recorded_at && new Date(videoToDelete.recorded_at).toLocaleString())
          || (videoToDelete ? `Video #${videoToDelete.id}` : undefined)
        }
        details={
          videoToDelete && (
            <>
              {videoToDelete.officer_name && <div>Officer: {videoToDelete.officer_name}</div>}
              {videoToDelete.classification && <div>Classification: {videoToDelete.classification}</div>}
              {videoToDelete.case_number && <div>Case {videoToDelete.case_number}</div>}
              {videoToDelete.recorded_at && (
                <div className="text-rmpg-500">Recorded {new Date(videoToDelete.recorded_at).toLocaleString()}</div>
              )}
              {videoToDelete.duration_seconds != null && (
                <div className="text-rmpg-500">{Math.round(videoToDelete.duration_seconds)}s</div>
              )}
              {videoToDelete.retention_status && (
                <div className="text-rmpg-500">Retention: {videoToDelete.retention_status}</div>
              )}
            </>
          )
        }
        // Positive hold-list check — see utils/evidenceLock.ts. The
        // prior negative check blocked LAWFUL retention-purge of
        // 'expired' videos. Now only true legal/IA/court holds block.
        evidenceLocked={isEvidenceLocked(videoToDelete?.retention_status)}
        evidenceLockReason={evidenceLockReason(videoToDelete?.retention_status)}
        isDeleting={deleting}
      />
    </div>
  );
}
