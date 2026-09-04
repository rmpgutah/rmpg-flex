// client/src/components/RedactionStudio.tsx
// Modal editor: scan a clip for plates/faces/people, let the operator toggle
// categories / draw-resize-delete boxes / pick style+strength, then render a
// redacted MP4 (canvas + ffmpeg.wasm), upload it to /api/redactions with a
// custody record, and download it.
import { useMemo, useRef, useState } from 'react';
import { X, Loader2, ScanSearch, ShieldOff, Download, Square, Trash2, AlertTriangle, Sparkles } from 'lucide-react';
import { apiPostForm, authedImageUrl } from '../hooks/useApi';
import { scanClip } from '../utils/redaction/scanClip';
import { loadFaceDetector } from '../utils/redaction/detectFaces';
import { renderRedacted } from '../utils/redaction/renderRedacted';
import { activeRegionsAt, interpBox, mergeSamples, type RedactionRegion, type RedactionKind, type RedactionStyle, type DetectorSample as RegionDetectorSample } from '../utils/redaction/regions';
import { sampleFramesForDeepScan, type DetectorSample as DeepScanDetectorSample } from '../utils/videoDeepScan';

const KIND_COLOR: Record<RedactionKind, string> = { plate: '#22d3ee', face: '#f472b6', person: '#a3e635', manual: '#d4a017' };

export default function RedactionStudio({ eventId, streamUrl, stampLines, onClose, source = 'dashcam', initialRegions }: {
  eventId: number; streamUrl: string; stampLines: string[]; onClose: () => void;
  /** Which custody-linkage field to populate: dashcam events (default) vs body-cam videos. */
  source?: 'dashcam' | 'bodycam';
  /** Pre-scanned regions (e.g. from an automatic upload-time scan) to seed
   *  the editor with, skipping the initial manual "Scan" click. The operator
   *  can still click "Scan" to run a fresh pass, which replaces these. */
  initialRegions?: RedactionRegion[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [t, setT] = useState(0);
  const [regions, setRegions] = useState<RedactionRegion[]>(initialRegions ?? []);
  const [scan, setScan] = useState<{ busy: boolean; frac: number }>({ busy: false, frac: 0 });
  const [render, setRender] = useState<{ busy: boolean; frac: number; phase: string } | null>(null);
  const [style, setStyle] = useState<RedactionStyle>('blur');
  const [strength, setStrength] = useState(14);
  const [err, setErr] = useState<string | null>(null);
  // True after a scan if the BlazeFace face model failed to load (CSP block,
  // offline, CDN down…). Faces were NOT scanned — operators must be told so
  // they don't trust an under-redacted clip with bystander faces still visible.
  const [faceModelFailed, setFaceModelFailed] = useState(false);
  const [deepScan, setDeepScan] = useState<{ busy: boolean; done: number; total: number } | null>(null);
  const [deepScanError, setDeepScanError] = useState<string | null>(null);

  const natW = nat?.w || 1280, natH = nat?.h || 720;

  const runScan = async () => {
    const v = videoRef.current; if (!v) return;
    setScan({ busy: true, frac: 0 }); setErr(null); setFaceModelFailed(false);
    try {
      // Probe the face model up front. scanClip() loads it internally too, but
      // both share the same cached promise (loadFaceDetector memoises), so this
      // is a free check — null means BlazeFace weights never loaded and the
      // scan found plates only, with faces silently skipped.
      const faceModel = await loadFaceDetector();
      const found = await scanClip(v, { intervalSec: 0.25, includePeople: false, onProgress: (f) => setScan({ busy: true, frac: f }) });
      setRegions(found.map((r) => ({ ...r, style, strength })));
      setFaceModelFailed(!faceModel);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Scan failed'); }
    setScan({ busy: false, frac: 1 });
  };

  const runDeepScan = async () => {
    const v = videoRef.current; if (!v || deepScan?.busy) return;
    if (source !== 'bodycam') { setDeepScanError('Deep Scan is only available for body-cam videos right now.'); return; }
    setDeepScan({ busy: true, done: 0, total: 0 }); setDeepScanError(null);
    try {
      const frames = await sampleFramesForDeepScan(v, {
        onProgress: (done, total) => setDeepScan({ busy: true, done, total }),
      });
      if (frames.length === 0) {
        setDeepScanError('Could not capture any frames from this video.');
        return;
      }
      const fd = new FormData();
      frames.forEach((f) => fd.append('frame', f.blob, `frame_${f.timestamp}.jpg`));
      fd.append('timestamps', JSON.stringify(frames.map((f) => f.timestamp)));
      // Sized for up to 30 sequential per-frame Workers AI calls — same
      // rationale as VideoPlayer.tsx's /:id/analyze timeout override.
      const result = await apiPostForm<{ samples: DeepScanDetectorSample[] }>(
        `/personnel/bodycam-videos/${eventId}/deep-scan`,
        fd,
        { timeoutMs: 180_000 },
      );
      const asRegionSamples: RegionDetectorSample[] = result.samples.map((s) => ({ kind: s.kind, box: s.box, t: s.t }));
      const found = mergeSamples(asRegionSamples, { scanInterval: 2 }).map((r) => ({ ...r, style, strength, source: 'deep-scan' as const }));
      setRegions((rs) => [...rs, ...found]);
    } catch (e) {
      setDeepScanError(e instanceof Error ? e.message : 'Deep scan failed');
    } finally {
      setDeepScan(null);
    }
  };

  const toggleKind = (kind: RedactionKind, on: boolean) =>
    setRegions((rs) => rs.map((r) => (r.kind === kind ? { ...r, enabled: on } : r)));

  const addManual = () => {
    const v = videoRef.current; if (!v) return;
    const at = v.currentTime;
    setRegions((rs) => [...rs, {
      id: `manual_${Date.now()}`, kind: 'manual', keyframes: [{ t: at, box: [0.4, 0.4, 0.2, 0.2] }],
      tStart: Math.max(0, at - 1), tEnd: at + 1, style, strength, source: 'manual', enabled: true,
    }]);
  };

  const removeRegion = (id: string) => setRegions((rs) => rs.filter((r) => r.id !== id));

  const exportRedacted = async () => {
    const v = videoRef.current; if (!v) return;
    setRender({ busy: true, frac: 0, phase: 'frames' }); setErr(null);
    try {
      const { blob, ext } = await renderRedacted(v, regions, {
        stamp: stampLines,
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      });
      const fileName = `redacted-${eventId}.${ext}`;
      const kinds = Array.from(new Set(regions.filter((r) => r.enabled).map((r) => (r.kind === 'plate' ? 'license_plate' : r.kind))));
      const fd = new FormData();
      fd.append('video', blob, fileName);
      const sourceField = source === 'bodycam' ? { source_bodycam_video_id: eventId } : { event_id: eventId };
      fd.append('metadata', JSON.stringify({ ...sourceField, kinds, region_count: regions.filter((r) => r.enabled).length, style, format: ext, regions: regions }));
      await apiPostForm('/redactions', fd).catch((e) => {
        console.warn('[redaction] custody upload failed:', e);
        setErr('Exported & downloaded OK — but the custody copy upload failed. Re-export to retry.');
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Export failed'); }
    setRender(null);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of regions) c[r.kind] = (c[r.kind] || 0) + 1;
    return c;
  }, [regions]);

  const visible = activeRegionsAt(regions, t);

  return (
    <div className="fixed inset-0 z-[70] bg-black/95 flex flex-col tactical-dark" role="dialog" aria-label="Redaction studio">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default shrink-0">
        <span className="flex items-center gap-2 text-[11px] font-semibold tracking-wider [color:var(--panel-header-color)]">
          <ShieldOff className="w-4 h-4" /> REDACTION STUDIO — {source === 'bodycam' ? 'BODYCAM VIDEO' : 'EVENT'} #{eventId}
        </span>
        <button onClick={onClose} className="text-rmpg-400 hover:text-rmpg-100 p-1" aria-label="Close redaction studio"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_300px] overflow-hidden">
        <div className="relative bg-black flex items-center justify-center overflow-hidden">
          <div className="relative inline-flex max-h-full max-w-full">
            <video ref={videoRef} src={authedImageUrl(streamUrl)} controls preload="auto" playsInline
              onLoadedMetadata={(e) => setNat({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} className="block max-h-full max-w-full" />
            {nat && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${natW} ${natH}`} preserveAspectRatio="none">
                {visible.map((r) => {
                  const [x, y, w, h] = interpBox(r, t).map((v, i) => v * (i % 2 === 0 ? natW : natH));
                  return <rect key={r.id} x={x} y={y} width={w} height={h} fill="none" stroke={KIND_COLOR[r.kind]} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
                })}
              </svg>
            )}
          </div>
        </div>

        <div className="border-l border-border-default overflow-auto p-3 space-y-3 text-[11px] text-rmpg-200">
          <button onClick={runScan} disabled={scan.busy} className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border [border-color:var(--field-label-color)] [color:var(--panel-header-color)] hover:bg-[#1a1400] disabled:opacity-60">
            {scan.busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning… {Math.round(scan.frac * 100)}%</> : <><ScanSearch className="w-3.5 h-3.5" /> Auto-detect plates + faces</>}
          </button>

          {source === 'bodycam' && (
            <button
              onClick={runDeepScan}
              disabled={!!deepScan?.busy}
              title="Higher-accuracy AI scan for faces/plates the fast pass may have missed — samples 2s intervals from the current playhead, up to 18 frames (~36 seconds of footage)"
              className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-purple-500/60 text-purple-300 hover:bg-purple-950/30 disabled:opacity-60"
            >
              {deepScan?.busy
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deep scanning… {deepScan.total ? `frame ${deepScan.done} of ${deepScan.total}` : ''}</>
                : <><Sparkles className="w-3.5 h-3.5" /> Deep Scan (from playhead)</>}
            </button>
          )}
          {deepScanError && <div className="text-[10px] text-red-400">{deepScanError}</div>}

          {faceModelFailed && (
            <div role="alert" className="flex items-start gap-1.5 px-2 py-1.5 border border-amber-600/60 bg-amber-950/30 text-[10px] text-amber-300 leading-snug">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
              <span>Face detection unavailable — the face model failed to load, so <strong>only plates were scanned</strong>. Review the clip and add manual boxes over any bystander faces before exporting.</span>
            </div>
          )}

          {(['plate', 'face', 'person', 'manual'] as RedactionKind[]).map((k) => counts[k] ? (
            <label key={k} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block" style={{ background: KIND_COLOR[k] }} /> Blur all {k}s <span className="text-fg-muted">({counts[k]})</span></span>
              <input type="checkbox" checked={regions.some((r) => r.kind === k && r.enabled)} onChange={(e) => toggleKind(k, e.target.checked)} />
            </label>
          ) : null)}

          <div className="border-t border-border-default pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span>Style</span>
              <select value={style} onChange={(e) => { const s = e.target.value as RedactionStyle; setStyle(s); setRegions((rs) => rs.map((r) => ({ ...r, style: s }))); }} className="bg-black border border-border-default px-1 py-0.5">
                <option value="blur">Blur</option><option value="pixelate">Pixelate</option><option value="box">Black box</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Strength</span>
              <input type="range" min={4} max={40} value={strength} onChange={(e) => { const v = Number(e.target.value); setStrength(v); setRegions((rs) => rs.map((r) => ({ ...r, strength: v }))); }} />
            </div>
            <button onClick={addManual} className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 border border-border-default hover:[border-color:var(--field-label-color)]"><Square className="w-3.5 h-3.5" /> Add manual box (at playhead)</button>
          </div>

          <div className="border-t border-border-default pt-2 max-h-40 overflow-auto space-y-1">
            {regions.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate flex items-center gap-1">
                  <span style={{ color: KIND_COLOR[r.kind] }}>{r.kind} · {r.tStart.toFixed(1)}–{r.tEnd.toFixed(1)}s</span>
                  {r.source === 'deep-scan' && <span className="text-[8px] px-1 py-px border border-purple-500/60 text-purple-300 uppercase tracking-wide shrink-0">Deep</span>}
                </span>
                <button onClick={() => removeRegion(r.id)} aria-label="Delete region" className="text-fg-muted hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {!regions.length && <div className="text-fg-muted italic">No regions yet — run auto-detect or add a box.</div>}
          </div>

          <button onClick={exportRedacted} disabled={!!render || !regions.length} className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-green-700 text-green-300 bg-green-950/30 hover:bg-green-900/40 disabled:opacity-60">
            {render ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {render.phase === 'encode' ? 'Encoding MP4…' : `Rendering… ${Math.round(render.frac * 100)}%`}</> : <><Download className="w-3.5 h-3.5" /> Export redacted MP4</>}
          </button>
          {render && <div className="text-[9px] text-fg-muted">Runs in your browser — keep this tab open. Short clips take a minute or two.</div>}
          {err && <div className="text-[10px] text-red-400">{err}</div>}
        </div>
      </div>
    </div>
  );
}
