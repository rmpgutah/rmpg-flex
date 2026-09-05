// ============================================================
// RMPG Flex — Body Cameras Page (Standalone)
// Extracted from PersonnelPage to its own route, accessible
// from the Personnel dropdown in the sidebar.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Video, Loader2, AlertTriangle } from 'lucide-react';
import type { BodyCamera, BodyCamVideo, VideoClassification, VideoRetention } from '../types';
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
import RedactionStudio from '../components/RedactionStudio';
import BodyCamVideoEditModal, { type BodyCamVideoEditData } from '../components/BodyCamVideoEditModal';
import type { BodyCameraFormData } from './personnel/modals/BodyCameraFormModal';
import { mapBodyCamera, mapBodyCamVideo } from './personnel/utils/personnelMappers';
import DeleteRecordModal from '../components/DeleteRecordModal';
import { isEvidenceLocked, evidenceLockReason } from '../utils/evidenceLock';
import { parseTimestamp } from '../utils/dateUtils';
import { bodyCamerasToCsv, downloadTextFile } from '../utils/rmsListExport';
import { useMountedRef } from '../hooks/useMountedRef';

type ModalMode = 'none' | 'new_body_camera' | 'edit_body_camera' | 'upload_video';

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
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
  // Backend WRITE_ROLES = { admin, manager }; supervisors are read-all but not write.
  const canManage = user?.role === 'admin' || user?.role === 'manager';

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
  const [redactingVideo, setRedactingVideo] = useState<BodyCamVideo | null>(null);
  const [editingVideo, setEditingVideo] = useState<BodyCamVideo | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Officer list for the form modal dropdown
  const [officers, setOfficers] = useState<{ id: string; name: string }[]>([]);

  // ═══ NEW: Retention, Review, and Redaction Stats ═══
  const [retentionStats, setRetentionStats] = useState<{ total_expired: number; total_storage_gb: number } | null>(null);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [pendingRedactions, setPendingRedactions] = useState(0);

  // searchParams declared once here — shared by all three deep-link effects below.
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link: ?camera_id= highlights a specific camera row; ?officer_id=
  // pre-seeds the officer filter so only that officer's cameras and videos
  // are shown. Params are stripped after seeding so a hard refresh doesn't
  // re-apply stale values. These are read once at mount via a ref so the
  // effect doesn't depend on searchParams (avoids double-fire on the strip).
  const [highlightCameraId, setHighlightCameraId] = useState<number | null>(null);
  const [officerFilter, setOfficerFilter] = useState<string>('');
  const pendingCameraIdRef = useRef<string | null>(searchParams.get('camera_id'));
  const pendingOfficerIdRef = useRef<string | null>(searchParams.get('officer_id'));

  useEffect(() => {
    const camTarget = pendingCameraIdRef.current;
    const offTarget = pendingOfficerIdRef.current;
    if ((!camTarget && !offTarget) || loading) return;
    pendingCameraIdRef.current = null;
    pendingOfficerIdRef.current = null;

    if (offTarget) setOfficerFilter(offTarget);

    if (camTarget) {
      // Find by camera.id (numeric PK) or camera.camera_id (hardware serial).
      const hit = cameras.find(
        c => String(c.id) === camTarget || c.camera_id === camTarget,
      );
      if (hit) {
        setHighlightCameraId(hit.id);
      } else {
        addToast(`Camera ${camTarget} not found`, 'warning');
      }
    }

    // Strip consumed params.
    const next = new URLSearchParams(searchParams);
    next.delete('camera_id');
    next.delete('officer_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, loading]);

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
  const mountedRef = useMountedRef();

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
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load body camera data');
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
  // Court-package links, evidence cross-refs, and the dashcam ↔ BWC
  // sibling lookup all need to open the player directly on a specific
  // clip. Falls through to a direct fetch when the row is paginated out
  // of the current list. Param is stripped after applying so a hard
  // refresh doesn't loop. The aliases `clip_id` and `recording_id` mirror
  // the mission brief — older bookmarks generated before the canonical
  // param was named survive.
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

  // ── Keyboard shortcuts: Esc cascade + N shortcut ──
  // Esc closes the smallest-open-first of the six modals BodyCamerasPage
  // owns (player/redaction studio → upload → camera form → camera-delete →
  // video-delete). N opens the "Assign Camera" form (canManage only) when no
  // modal is open and the operator is not typing in a field.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      // Esc cascade: top-most-first — destructive dialog → player/redaction studio → upload → form.
      if (e.key === 'Escape') {
        if (cameraToDelete) { setCameraToDelete(null); return; }
        if (videoToDelete) { setVideoToDelete(null); return; }
        if (playingVideo) { setPlayingVideo(null); return; }
        // Cancel/dismiss only — do not refetch here (unlike the studio's own
        // onClose, which refreshes after a redaction commit). Esc is a fast
        // dismiss, not a save-and-refresh action.
        if (redactingVideo) { setRedactingVideo(null); return; }
        if (editingVideo) { if (isTypingInField(e.target)) return; setEditingVideo(null); return; }
        if (modal === 'upload_video') { setModal('none'); return; }
        if (modal === 'new_body_camera' || modal === 'edit_body_camera') {
          if (isTypingInField(e.target)) return;
          setModal('none'); setEditData(undefined); return;
        }
        return;
      }
      // N shortcut: open "Assign Camera" when no modal is active.
      if (e.key === 'n' || e.key === 'N') {
        if (isTypingInField(e.target)) return;
        if (modal !== 'none' || cameraToDelete || videoToDelete || playingVideo || redactingVideo || editingVideo) return;
        if (!canManage) return;
        e.preventDefault();
        openAdd();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // openAdd is a stable arrow function defined below — exclude from deps to
  // avoid a cycle; the handler closes over canManage + modal from state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraToDelete, videoToDelete, playingVideo, redactingVideo, editingVideo, modal, canManage]);

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

  const handleVideoEditSave = async (videoId: number, data: BodyCamVideoEditData) => {
    await apiFetch(`/personnel/bodycam-videos/${videoId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    await refreshBodyCameras();
    // Keep the open player's video in sync with the edited fields
    setPlayingVideo(prev =>
      prev && prev.id === videoId
        ? { ...prev, ...data, retention_status: data.retention_status as VideoRetention }
        : prev
    );
    addToast('Video details saved', 'success');
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
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save body camera', 'error');
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
    let deleteOk = false;
    try {
      await apiFetch(path, { method: 'DELETE' });
      deleteOk = true;
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete body camera', 'error');
    } finally {
      setDeleting(false);
    }
    if (!deleteOk) return;
    setCameraToDelete(null);
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
    let deleteOk = false;
    try {
      await apiFetch(path, { method: 'DELETE' });
      deleteOk = true;
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete video', 'error');
    } finally {
      setDeleting(false);
    }
    if (!deleteOk) return;
    setVideoToDelete(null);
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
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Bulk delete failed', 'error');
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
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Bulk classify failed', 'error');
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
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Bulk delete failed', 'error');
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
          <button
            type="button"
            className="toolbar-btn"
            disabled={cameras.length === 0}
            onClick={() => downloadTextFile('body-cameras.csv', bodyCamerasToCsv(cameras))}
            title="CSV of camera id, make, model, status — no officer names"
          >CSV</button>
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
            onRedactVideo={canManage ? setRedactingVideo : undefined}
            onDeleteVideo={handleVideoDelete}
            onUploadVideo={() => setModal('upload_video')}
            canManage={canManage}
            onBulkDeleteVideos={handleBulkDeleteVideos}
            onBulkClassifyVideos={handleBulkClassifyVideos}
            onBulkDeleteCameras={handleBulkDeleteCameras}
            bulkLoading={bulkLoading}
            highlightCameraId={highlightCameraId}
            initialOfficerFilter={officerFilter}
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
        onEditVideo={canManage ? setEditingVideo : undefined}
      />

      <BodyCamVideoEditModal
        isOpen={editingVideo !== null}
        onClose={() => setEditingVideo(null)}
        video={editingVideo}
        onSave={handleVideoEditSave}
      />

      {redactingVideo && (
        <RedactionStudio
          eventId={redactingVideo.id}
          source="bodycam"
          streamUrl={`/api/personnel/bodycam-videos/${redactingVideo.id}/stream`}
          stampLines={[
            redactingVideo.title,
            redactingVideo.officer_name || '',
            redactingVideo.recorded_at ? parseTimestamp(redactingVideo.recorded_at).toLocaleString('en-US', { timeZone: 'America/Denver' }) : '',
          ].filter(Boolean)}
          initialRegions={(() => {
            const raw = redactingVideo.detection_regions_json;
            if (!raw) return undefined;
            try { return JSON.parse(raw); } catch { return undefined; }
          })()}
          onClose={() => { setRedactingVideo(null); refreshBodyCameras(); }}
        />
      )}

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
          || (videoToDelete?.recorded_at && parseTimestamp(videoToDelete.recorded_at).toLocaleString('en-US', { timeZone: 'America/Denver' }))
          || (videoToDelete ? `Video #${videoToDelete.id}` : undefined)
        }
        details={
          videoToDelete && (
            <>
              {videoToDelete.officer_name && <div>Officer: {videoToDelete.officer_name}</div>}
              {videoToDelete.classification && <div>Classification: {videoToDelete.classification}</div>}
              {videoToDelete.case_number && <div>Case {videoToDelete.case_number}</div>}
              {videoToDelete.recorded_at && (
                <div className="text-rmpg-500">Recorded {parseTimestamp(videoToDelete.recorded_at).toLocaleString('en-US', { timeZone: 'America/Denver' })}</div>
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
