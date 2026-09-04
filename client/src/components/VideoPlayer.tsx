// ============================================================
// RMPG Flex — Body Camera Video Player Modal
// Police-style HUD overlay rendered as CSS over the video
// element. Original files are never modified (no FFmpeg burn).
// ============================================================
// Enhanced player with police-style HUD preview, playback
// controls, frame capture, download, and quick-classify.
// ============================================================

import { useRef, useState, useEffect } from 'react';
import { X, Video, Shield, Maximize2, Minimize2, Edit2, Printer, ScanSearch, AlertTriangle, Loader2 } from 'lucide-react';
import type { BodyCamVideo } from '../types';
import { VIDEO_CLASSIFICATION_COLORS } from '../pages/personnel/utils/personnelConstants';
// Note: VideoHudOverlay was imported but never referenced — the HUD is
// rendered inline below. Removed during the page-25 audit pass.
import { parseTimestamp } from '../utils/dateUtils';
import { getSignedParams, buildSignedQuerySync } from '../utils/signedUrls';
import { apiFetch, apiPostForm } from '../hooks/useApi';
import {
  openBodycamVideoCustodyPdf,
  type BodycamCustodyEntry,
} from '../utils/bodycamVideoCustodyPdf';
import { sampleFramesForAnalysis } from '../utils/videoAiAnalyze';
import type { AnalysisResult } from '../utils/videoAiAnalyze';
import { toDisplayLabel } from '../utils/formatters';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  video: BodyCamVideo | any | null;
  apiBase: string;
  getAuthHeaders: () => Record<string, string>;
  onEditVideo?: (video: any) => void;
  onClassify?: (videoId: any, classification: any) => void;
  streamEndpoint?: string;
  /** Optional — surfaced in the chain-of-custody PDF's "prepared by" line. */
  preparedBy?: string;
}

export default function VideoPlayer({ isOpen, onClose, video, apiBase, getAuthHeaders, onEditVideo, preparedBy }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);

  // AI object-detection ("Analyze") — samples frames from the already-loaded
  // <video> element and posts them to the Worker for weapon/force/vehicle/
  // scene detection. `localAnalysis` (this session's freshly-run result)
  // takes priority over `video.ai_analysis_json` (a prior run persisted on
  // the row), so re-running Analyze always reflects the latest pass.
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [localAnalysis, setLocalAnalysis] = useState<AnalysisResult | null>(null);
  // Synchronous re-entrancy guard for handleAnalyze — `analyzing` state is
  // only visible after React commits, so two rapid clicks before that commit
  // can both pass an `if (analyzing) return` check. A ref is readable/settable
  // synchronously within the same event-handler invocation, closing that race.
  const analyzingRef = useRef(false);

  // Reset all per-video AI-analysis state whenever the displayed video
  // changes. VideoPlayer is a single reused instance (BodyCamerasPage renders
  // it with no `key`), so without this reset a prior video's findings
  // (weapon-detection banner, seek buttons, etc.) would stay visible against
  // a newly opened, unrelated video — a misattribution risk for evidence.
  useEffect(() => {
    setLocalAnalysis(null);
    setAnalyzeError(null);
    setAnalyzing(false);
    setAnalyzeProgress(null);
    analyzingRef.current = false;
  }, [video?.id]);

  // Fire a chain-of-custody "viewed" event on open so the audit_log
  // captures WHO opened the player and WHEN, even when no metadata
  // edit follows. BWC footage access is statutory court-record
  // material; previously a supervisor could open + re-watch any
  // officer's footage and leave no trace. Best-effort — silent on
  // failure so a transient 5xx never blocks playback.
  const viewLoggedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isOpen || !video?.id) return;
    if (viewLoggedRef.current === video.id) return;
    viewLoggedRef.current = video.id;
    apiFetch(`/personnel/bodycam-videos/${video.id}/view-event`, { method: 'POST' })
      .catch((err) => { console.warn('[VideoPlayer] view-event log failed:', err); });
  }, [isOpen, video?.id]);

  // Per-resource signed params (sig/exp/nonce) from /api/auth/sign-urls —
  // keeps the session JWT out of the URL (it lands in CF/proxy logs).
  // Falls back to the legacy ?token= only if signing fails (offline, or a
  // not-yet-deployed Worker).
  const [signedQuery, setSignedQuery] = useState<string>((video as any)?._signedQuery || '');
  useEffect(() => {
    if (!isOpen || !video?.id || (video as any)?._signedQuery) return;
    let cancelled = false;
    getSignedParams('bodycam', video.id).then((p) => {
      if (cancelled) return;
      if (p) {
        setSignedQuery(buildSignedQuerySync(p));
      } else {
        const token = getAuthHeaders()['Authorization']?.replace('Bearer ', '') || '';
        setSignedQuery(`token=${encodeURIComponent(token)}`);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, video?.id]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onTime = () => setCurrentTime(vid.currentTime);
    vid.addEventListener('timeupdate', onTime);
    return () => vid.removeEventListener('timeupdate', onTime);
    // signedQuery: the <video> only mounts once signing resolves, so re-run
    // to attach the listener to the freshly mounted element.
  }, [isOpen, video, signedQuery]);

  if (!isOpen || !video) return null;

  const formatHudTime = (seconds: number) => {
    const d = video.recorded_at ? parseTimestamp(video.recorded_at) : new Date();
    const playback = new Date(d.getTime() + seconds * 1000);
    return playback.toLocaleString('en-US', {
      timeZone: 'America/Denver',
      month: '2-digit', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).replace(',', '');
  };

  const formatDuration = (seconds?: number) => {
    if (seconds == null) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // KB = bytes/1024 (binary), then MB/GB step decimally (/1000) — matches
  // BodyCameraTab.tsx's formatFileSize (kept in sync 2026-07-14 audit).
  const formatSize = (bytes: number) => {
    const kb = bytes / 1024;
    if (kb < 1000) return `${kb.toFixed(0)} KB`;
    const mb = kb / 1000;
    if (mb < 1000) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1000;
    return `${gb.toFixed(2)} GB`;
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return parseTimestamp(d).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const classLabel = (cls: string) => toDisplayLabel(cls).toUpperCase();

  // Prefer this-session's freshly-run analysis over whatever was already
  // persisted on the row.
  const analysis: AnalysisResult | null = localAnalysis ?? (video.ai_analysis_json ? (() => {
    try { return JSON.parse(video.ai_analysis_json); } catch { return null; }
  })() : null);

  const seekToTime = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const formatMmSs = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Empty until signing resolves — the <video> element gets no src rather
  // than a JWT-bearing URL it would immediately fetch.
  const streamUrl = signedQuery ? `${apiBase}/personnel/bodycam-videos/${video.id}/stream?${signedQuery}` : '';

  // Open the court-ready chain-of-custody PDF. Fetches /custody fresh
  // each click so a long-open player picks up newly-recorded entries
  // (e.g. a reclassification that just landed via WebSocket sync).
  const handlePrintCustody = async () => {
    if (!video || printing) return;
    setPrinting(true);
    try {
      let custody: BodycamCustodyEntry[] = [];
      try {
        const res = await apiFetch<{ entries?: BodycamCustodyEntry[] }>(`/personnel/bodycam-videos/${video.id}/custody`);
        custody = Array.isArray(res?.entries) ? res.entries : [];
      } catch (err) {
        // Open the PDF anyway with an empty custody timeline — the
        // metadata + signature block is still court-useful when the
        // audit endpoint 5xxs or is offline.
        console.warn('[VideoPlayer] custody fetch failed; printing with empty timeline:', err);
      }
      openBodycamVideoCustodyPdf({ video, custody, preparedBy });
    } finally {
      setPrinting(false);
    }
  };

  // Sample frames off the live <video> element and post them for AI object
  // detection (weapons/force indicators/vehicles/scenes/officer-safety
  // flags). Advisory only — a review aid, not a determination.
  const handleAnalyze = async () => {
    const vid = videoRef.current;
    if (!vid || !video || analyzing || analyzingRef.current) return;
    analyzingRef.current = true;
    // Capture the video this request belongs to so a late-resolving result
    // can be discarded if the user has since switched to a different video.
    const requestedVideoId = video.id;
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeProgress(null);
    try {
      const frames = await sampleFramesForAnalysis(vid, (done, total) => {
        if (requestedVideoId !== video?.id) return;
        setAnalyzeProgress({ done, total });
      });
      if (requestedVideoId !== video?.id) return; // user navigated away — discard silently
      if (frames.length === 0) {
        setAnalyzeError('No frames could be captured for analysis.');
        return;
      }
      const formData = new FormData();
      frames.forEach((f) => {
        formData.append('frame', f.blob, `frame_${f.timestamp}.jpg`);
      });
      formData.append('timestamps', JSON.stringify(frames.map((f) => f.timestamp)));

      // Server analyzes frames sequentially against Workers AI's vision model
      // (up to ANALYSIS_MAX_FRAMES = 20, deliberately not parallelized — see
      // src/routes/personnel/bodyCameraUploads.ts). 20 sequential vision calls
      // can comfortably exceed the default 60s fetch timeout, so this request
      // gets a generous 3-minute allowance instead.
      const result = await apiPostForm<{ success: boolean; frames_analyzed: number; frames_requested: number; analysis: AnalysisResult }>(
        `/personnel/bodycam-videos/${requestedVideoId}/analyze`,
        formData,
        { timeoutMs: 180_000 },
      );
      if (requestedVideoId !== video?.id) return; // stale result — video switched mid-request
      setLocalAnalysis(result.analysis);
    } catch (err) {
      if (requestedVideoId !== video?.id) return; // stale error — don't surface against the new video
      console.warn('[VideoPlayer] AI analysis failed:', err);
      setAnalyzeError(err instanceof Error ? err.message : 'AI analysis failed.');
    } finally {
      if (requestedVideoId === video?.id) {
        setAnalyzing(false);
        setAnalyzeProgress(null);
        analyzingRef.current = false;
      }
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch((err) => { console.warn('[VideoPlayer] enter fullscreen failed:', err); });
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch((err) => { console.warn('[VideoPlayer] exit fullscreen failed:', err); });
    }
  };

  const classColor = VIDEO_CLASSIFICATION_COLORS[video.classification] || 'bg-rmpg-700 text-rmpg-300';

  const overlayInfo = video.overlay_status ? {
    label: toDisplayLabel(video.overlay_status).toUpperCase(),
    cls: video.overlay_status === 'complete' ? 'border-green-500 text-green-400' : video.overlay_status === 'error' ? 'border-red-500 text-red-400' : 'border-amber-500 text-amber-400'
  } : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        ref={containerRef}
        className={`bg-black border border-rmpg-800 rounded-sm shadow-md overflow-hidden ${
          isFullscreen ? 'w-full h-full' : 'w-[900px] max-w-[calc(100vw-2rem)] max-h-[88dvh]'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Compact header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface-deep border-b border-rmpg-800">
          <div className="flex items-center gap-2 min-w-0">
            <Video className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
            <span className="text-[10px] font-mono font-bold text-rmpg-200 uppercase tracking-wider truncate">
              BWC — {video.title}
            </span>
            <span className={`text-[8px] px-1 py-0.5 font-bold flex-shrink-0 ${classColor}`}>
              {classLabel(video.classification)}
            </span>
            {overlayInfo && (
              <span className={`text-[9px] px-1.5 py-0.5 font-semibold flex items-center gap-1 border rounded-sm flex-shrink-0 ${overlayInfo.cls}`}>
                <Shield className={`w-2.5 h-2.5 ${video.overlay_status === 'processing' || video.overlay_status === 'pending' ? 'animate-spin' : ''}`} />
                {overlayInfo.label}
              </span>
            )}
          </div>
          {/* Right-side toolbar. The previous build had TWO separate flex
              clusters here — both rendered a Close button, producing a
              double-X in the header. Audit caught (2026-06-22): the second
              X was a stray copy left over when the HUD/fullscreen controls
              were lifted out of a different ancestor. Consolidated into one
              cluster + added the Print button (court-ready chain-of-custody
              PDF, mirrors evidence/FI/criminal-history/cases). */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrintCustody}
              disabled={printing}
              className="toolbar-btn p-1 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Open a printable chain-of-custody PDF for this video"
              aria-label="Print chain-of-custody PDF"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
            {onEditVideo && (
              <button type="button" onClick={() => onEditVideo(video)} className="toolbar-btn p-1" title="Edit video metadata">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing}
              className="toolbar-btn p-1 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Run AI object detection on this footage (review aid, not a determination)"
              aria-label="Analyze footage with AI object detection"
            >
              {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
            </button>
            <button type="button" onClick={() => setHudVisible(!hudVisible)} className="text-[9px] font-mono text-fg-muted hover:text-rmpg-200 px-1.5 py-0.5 transition-colors" title="Toggle HUD overlay">
              HUD {hudVisible ? 'ON' : 'OFF'}
            </button>
            <button type="button" onClick={toggleFullscreen} className="toolbar-btn p-1" title="Toggle fullscreen">
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button type="button" onClick={onClose} className="toolbar-btn p-1" aria-label="Close" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video + HUD Overlay */}
        <div className="relative bg-black">
          {streamUrl ? (
            <video
              ref={videoRef}
              controls
              autoPlay
              className="w-full max-h-[70vh]"
              src={streamUrl}
            >
              Your browser does not support the video tag.
            </video>
          ) : (
            <div className="w-full h-[40vh] flex items-center justify-center text-[11px] text-fg-muted">
              AUTHORIZING STREAM…
            </div>
          )}

          {/* ── Police-Style HUD Overlay ── */}
          {hudVisible && (
            <>
              {/* Top-left: Agency & Officer */}
              <div className="absolute top-2 left-3 pointer-events-none select-none">
                <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1.5 border border-white/10 rounded-sm">
                  <p className="font-mono text-[11px] text-rmpg-100 font-bold tracking-wider leading-tight">
                    ROCKY MOUNTAIN PROTECTIVE GROUP
                  </p>
                  <p className="font-mono text-[10px] text-rmpg-400 leading-tight">
                    BWC | {video.officer_name || 'UNKNOWN'} | CAM: {video.camera_serial || 'N/A'}
                  </p>
                </div>
              </div>

              {/* Top-right: Classification badge */}
              <div className="absolute top-2 right-3 pointer-events-none select-none">
                <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1.5 border border-white/10 rounded-sm text-right">
                  <p className="font-mono text-[10px] text-amber-400 font-bold tracking-wider">
                    {classLabel(video.classification)}
                  </p>
                  {video.case_number && (
                    <p className="font-mono text-[10px] text-white/80 leading-tight">
                      CASE: {video.case_number}
                    </p>
                  )}
                </div>
              </div>

              {/* Bottom-left: Timestamp (updates in real-time) */}
              <div className="absolute bottom-12 left-3 pointer-events-none select-none">
                <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1 border border-white/10 rounded-sm">
                  <p className="font-mono text-[12px] text-rmpg-100 font-bold tabular-nums tracking-wide">
                    {formatHudTime(currentTime)}
                  </p>
                </div>
              </div>

              {/* Bottom-right: REC indicator */}
              <div className="absolute bottom-12 right-3 pointer-events-none select-none">
                <div className="bg-black/60 backdrop-blur-sm px-2.5 py-1 border border-white/10 rounded-sm flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="font-mono text-[10px] text-red-400 font-bold">REC</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Compact Metadata Bar */}
        <div className="px-3 py-2 bg-surface-deep border-t border-rmpg-800">
          <div className="flex items-center justify-between text-[10px] font-mono text-rmpg-400 gap-4">
            <span className="flex items-center gap-1">
              <Shield className="w-2.5 h-2.5 text-brand-400" />
              <span className="text-rmpg-200">{video.officer_name || '-'}</span>
            </span>
            <span>CAM: <span className="text-rmpg-200">{video.camera_serial || '-'}</span></span>
            <span>DUR: <span className="text-rmpg-200">{formatDuration(video.duration_seconds)}</span></span>
            <span>SIZE: <span className="text-rmpg-200">{formatSize(video.file_size)}</span></span>
            <span>REC: <span className="text-rmpg-200">{formatDate(video.recorded_at)}</span></span>
            <span>RETENTION: <span className="text-rmpg-200 capitalize">{toDisplayLabel(video.retention_status) || '-'}</span></span>
          </div>
          {video.notes && (
            <p className="text-[9px] text-fg-muted italic mt-1 truncate">{video.notes}</p>
          )}
        </div>

        {video.transcript && (
          <div className="px-3 py-2 bg-surface-deep border-t border-rmpg-800">
            <p className="text-[9px] font-mono text-fg-muted uppercase tracking-wide mb-1">Transcript</p>
            <p className="text-[10px] text-rmpg-300 leading-relaxed max-h-24 overflow-y-auto scrollbar-dark">{video.transcript}</p>
          </div>
        )}

        {/* AI Findings — advisory review aid, not a determination. */}
        {(analyzing || analyzeError || analysis) && (
          <div className="px-3 py-2 bg-surface-deep border-t border-rmpg-800">
            {analyzing ? (
              <p className="text-[9px] font-mono text-fg-muted uppercase tracking-wide flex items-center gap-1.5">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                {analyzeProgress ? `Analyzing — frame ${analyzeProgress.done} of ${analyzeProgress.total}` : 'Analyzing…'}
              </p>
            ) : (
              <>
                {analyzeError && (
                  <p className="text-[9px] font-mono text-amber-400 flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
                    {analyzeError}
                  </p>
                )}
                {analysis && (
                  <>
                    <p className="text-[9px] font-mono text-fg-muted uppercase tracking-wide mb-1">
                      AI Findings — {analysis.frame_count} frame(s) analyzed
                    </p>
                    {!analysis.weapon && !analysis.force_indicators && analysis.vehicles.length === 0 &&
                      analysis.scene_types.length === 0 && analysis.officer_safety_flags.length === 0 ? (
                      <p className="text-[10px] text-fg-muted italic">No findings.</p>
                    ) : (
                      <div className="space-y-1">
                        {analysis.weapon && (
                          <button
                            type="button"
                            onClick={() => seekToTime(analysis.weapon!.timestamps[0])}
                            className="w-full text-left flex items-center gap-1.5 text-[10px] text-red-400 hover:text-red-300 transition-colors"
                          >
                            <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
                            Weapon detected — {Math.round(analysis.weapon.max_confidence * 100)}% confidence — review required
                            <span className="text-fg-muted">(jump to {formatMmSs(analysis.weapon.timestamps[0])})</span>
                          </button>
                        )}
                        {analysis.force_indicators && (
                          <button
                            type="button"
                            onClick={() => seekToTime(analysis.force_indicators!.timestamps[0])}
                            className="w-full text-left flex items-center gap-1.5 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
                          >
                            <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
                            Force indicator detected — {Math.round(analysis.force_indicators.max_confidence * 100)}% confidence — review required
                            <span className="text-fg-muted">(jump to {formatMmSs(analysis.force_indicators.timestamps[0])})</span>
                          </button>
                        )}
                        {analysis.officer_safety_flags.map((flag, i) => (
                          <button
                            key={`safety-${i}`}
                            type="button"
                            onClick={() => seekToTime(flag.timestamp)}
                            className="w-full text-left flex items-center gap-1.5 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
                          >
                            <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
                            Officer safety flag: {flag.flag} — review required
                            <span className="text-fg-muted">(jump to {formatMmSs(flag.timestamp)})</span>
                          </button>
                        ))}
                        {analysis.vehicles.map((v, i) => (
                          <button
                            key={`vehicle-${i}`}
                            type="button"
                            onClick={() => seekToTime(v.timestamps[0])}
                            className="w-full text-left flex items-center gap-1.5 text-[10px] text-rmpg-300 hover:text-rmpg-100 transition-colors"
                          >
                            <ScanSearch className="w-2.5 h-2.5 flex-shrink-0 text-fg-muted" />
                            Vehicle: {v.description}
                            <span className="text-fg-muted">(jump to {formatMmSs(v.timestamps[0])})</span>
                          </button>
                        ))}
                        {analysis.scene_types.map((s, i) => (
                          <button
                            key={`scene-${i}`}
                            type="button"
                            onClick={() => seekToTime(s.timestamps[0])}
                            className="w-full text-left flex items-center gap-1.5 text-[10px] text-rmpg-300 hover:text-rmpg-100 transition-colors"
                          >
                            <ScanSearch className="w-2.5 h-2.5 flex-shrink-0 text-fg-muted" />
                            Scene: {s.type}
                            <span className="text-fg-muted">(jump to {formatMmSs(s.timestamps[0])})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
