// ============================================================
// RMPG Flex — Video Overlay Processing Engine
// ============================================================
// Burns permanent metadata overlays onto body camera and dash
// camera video files using FFmpeg drawtext filters. Processing
// runs in the background after upload — the overlaid version is
// served for streaming and download.
//
// Body Camera Overlay:
//   BWC | OFC. NAME #BADGE | CAM: SERIAL
//   MM/DD/YYYY HH:MM:SSH (advancing) | CASE: NUMBER
//   CLASSIFICATION: EVIDENCE
//
// Dash Camera Overlay:
//   MVR | UNIT: CALLSIGN | VEH: YEAR MAKE MODEL
//   MM/DD/YYYY HH:MM:SSH (advancing) | SPD: XX MPH
//   LAT° N, LON° W  (bottom)
//   STREET ADDRESS   (bottom)
// ============================================================

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Interfaces ──────────────────────────────────────────────

export interface BodyCamOverlayConfig {
  type: 'bodycam';
  officerName: string;
  badgeNumber: string;
  cameraSerial: string;
  recordedAtUnix: number;
  caseNumber: string;
  classification: string;
}

export interface DashCamOverlayConfig {
  type: 'dashcam';
  unitCallSign: string;
  vehicleDescription: string;
  recordedAtUnix: number;
  speedMph: number | null;
  latitude: number | null;
  longitude: number | null;
  address: string;
}

export type OverlayConfig = BodyCamOverlayConfig | DashCamOverlayConfig;
export type OverlayStatus = 'pending' | 'processing' | 'complete' | 'error';

// ── Constants ───────────────────────────────────────────────

const FFMPEG_TIMEOUT_MS = 30 * 60_000; // 30 minutes max per video
const REPROCESS_BATCH_SIZE = 5;
const REPROCESS_DELAY_MS = 60_000; // 60s after startup
const INTER_PROCESS_DELAY_MS = 5_000; // 5s between batch items

// ── Helpers ─────────────────────────────────────────────────

/** Escape special characters for FFmpeg drawtext filter values */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;');
}

/** Format lat/lon as degrees string: "40.7608° N, 111.8910° W" */
function formatCoordinates(lat: number | null, lon: number | null): string {
  if (lat == null || lon == null) return 'NO GPS DATA';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)} ${latDir}, ${Math.abs(lon).toFixed(4)} ${lonDir}`;
}

// ── Filter Graph Builders ───────────────────────────────────

/**
 * Build FFmpeg video filter string for body camera overlay.
 * Three lines of text in the top-left corner with semi-transparent background.
 */
function buildBodyCamFilterGraph(config: BodyCamOverlayConfig): string {
  const line1 = escapeDrawtext(
    `BWC | OFC. ${config.officerName.toUpperCase()}${config.badgeNumber ? ` #${config.badgeNumber}` : ''} | CAM${config.cameraSerial ? `: ${config.cameraSerial}` : ''}`
  );

  const caseStr = config.caseNumber ? ` | CASE${escapeDrawtext(`: ${config.caseNumber}`)}` : '';

  const line3 = escapeDrawtext(`CLASSIFICATION: ${config.classification.toUpperCase()}`);

  // Classification color: evidence=yellow, flagged=orange, restricted=red, routine=white
  const classColor = {
    EVIDENCE: 'yellow',
    FLAGGED: 'orange',
    RESTRICTED: 'red',
    ROUTINE: 'white',
  }[config.classification.toUpperCase()] || 'white';

  const filters = [
    // Line 1: BWC | OFC. NAME #BADGE | CAM: SERIAL
    `drawtext=text='${line1}':fontsize=18:fontcolor=white:font=monospace:box=1:boxcolor=black@0.65:boxborderw=8:x=12:y=12`,
    // Line 2: Advancing timestamp + case number
    `drawtext=text='%{pts\\:localtime\\:${config.recordedAtUnix}\\:%m/%d/%Y %T}H${caseStr}':fontsize=16:fontcolor=white:font=monospace:box=1:boxcolor=black@0.65:boxborderw=8:x=12:y=40`,
    // Line 3: Classification
    `drawtext=text='${line3}':fontsize=14:fontcolor=${classColor}:font=monospace:box=1:boxcolor=black@0.65:boxborderw=8:x=12:y=66`,
  ];

  return filters.join(',');
}

/**
 * Build FFmpeg video filter string for dash camera overlay.
 * Two lines top-left, two lines bottom-left.
 */
function buildDashCamFilterGraph(config: DashCamOverlayConfig): string {
  const line1 = escapeDrawtext(
    `MVR | UNIT${config.unitCallSign ? `: ${config.unitCallSign}` : ''} | VEH${config.vehicleDescription ? `: ${config.vehicleDescription.toUpperCase()}` : ''}`
  );

  const speedStr = config.speedMph != null ? ` | SPD${escapeDrawtext(`: ${config.speedMph} MPH`)}` : '';

  const coordStr = escapeDrawtext(formatCoordinates(config.latitude, config.longitude));
  const addrStr = escapeDrawtext(config.address ? config.address.toUpperCase() : 'NO ADDRESS DATA');

  const filters = [
    // Top Line 1: MVR | UNIT: CALLSIGN | VEH: DESCRIPTION
    `drawtext=text='${line1}':fontsize=18:fontcolor=white:font=monospace:box=1:boxcolor=black@0.65:boxborderw=8:x=12:y=12`,
    // Top Line 2: Advancing timestamp + speed
    `drawtext=text='%{pts\\:localtime\\:${config.recordedAtUnix}\\:%m/%d/%Y %T}H${speedStr}':fontsize=16:fontcolor=white:font=monospace:box=1:boxcolor=black@0.65:boxborderw=8:x=12:y=40`,
    // Bottom Line 1: Coordinates
    `drawtext=text='${coordStr}':fontsize=14:fontcolor=cyan:font=monospace:box=1:boxcolor=black@0.65:boxborderw=8:x=12:y=h-56`,
    // Bottom Line 2: Address
    `drawtext=text='${addrStr}':fontsize=14:fontcolor=white:font=monospace:box=1:boxcolor=black@0.65:boxborderw=8:x=12:y=h-32`,
  ];

  return filters.join(',');
}

// ── Core Processing ─────────────────────────────────────────

/**
 * Process a video file with FFmpeg overlay.
 * @param inputPath  Absolute path to original video
 * @param outputPath Absolute path for processed output (always .mp4)
 * @param config     Overlay configuration
 * @returns Promise that resolves on success, rejects on error
 */
export async function processVideoOverlay(
  inputPath: string,
  outputPath: string,
  config: OverlayConfig,
): Promise<void> {
  // Validate input file extension — only process known video formats
  const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.ts', '.m4v'];
  const inputExt = path.extname(inputPath).toLowerCase();
  if (!ALLOWED_VIDEO_EXTENSIONS.includes(inputExt)) {
    throw new Error(`Unsupported video format: ${inputExt}`);
  }

  // Verify input file exists and is not suspiciously large (prevent DoS via huge files)
  const MAX_VIDEO_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${path.basename(inputPath)}`);
  }
  const inputStat = fs.statSync(inputPath);
  if (inputStat.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(`Input file too large: ${(inputStat.size / (1024 * 1024 * 1024)).toFixed(1)} GB exceeds 10 GB limit`);
  }

  const filterGraph = config.type === 'bodycam'
    ? buildBodyCamFilterGraph(config)
    : buildDashCamFilterGraph(config);

  // Use execFile (no shell) to prevent command injection via file paths
  const args = [
    '-i', inputPath,
    '-vf', filterGraph,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];

  console.log(`[Video Overlay] Processing: ${path.basename(inputPath)} → ${path.basename(outputPath)}`);

  try {
    await execFileAsync('ffmpeg', args, { timeout: FFMPEG_TIMEOUT_MS });
    console.log(`[Video Overlay] Complete: ${path.basename(outputPath)}`);
  } catch (err: any) {
    // Extract useful error info from stderr
    const stderr = err.stderr ? err.stderr.slice(-500) : err.message;
    console.error(`[Video Overlay] FAILED: ${path.basename(inputPath)} — ${stderr}`);
    throw new Error(`FFmpeg failed: ${stderr}`);
  }
}

// ── Queue Processing (Fire-and-Forget) ──────────────────────

/**
 * Queue overlay processing for a video. Updates DB status as it progresses.
 * Runs in background — does not block the calling function.
 *
 * @param videoId   Database ID of the video record
 * @param videoType 'bodycam' or 'dashcam'
 * @param inputPath Absolute path to the original video file
 * @param config    Overlay configuration
 */
export function queueOverlayProcessing(
  videoId: number | bigint,
  videoType: 'bodycam' | 'dashcam',
  inputPath: string,
  config: OverlayConfig,
): void {
  const table = videoType === 'bodycam' ? 'bodycam_videos' : 'dashcam_videos';

  // Run async processing without awaiting
  (async () => {
    const db = getDb();

    try {
      // Set status to processing
      db.prepare(`UPDATE ${table} SET overlay_status = 'processing', overlay_error = NULL, updated_at = ? WHERE id = ?`)
        .run(localNow(), videoId);

      // Build output path: same directory, add _overlay suffix, always .mp4
      const dir = path.dirname(inputPath);
      const baseName = path.basename(inputPath, path.extname(inputPath));
      const outputPath = path.join(dir, `${baseName}_overlay.mp4`);

      // Run FFmpeg
      await processVideoOverlay(inputPath, outputPath, config);

      // Verify output exists and has size
      if (!fs.existsSync(outputPath)) {
        throw new Error('Output file was not created');
      }
      const stat = fs.statSync(outputPath);
      if (stat.size < 1000) {
        throw new Error(`Output file suspiciously small: ${stat.size} bytes`);
      }

      // Get relative path for DB (relative to upload base dir)
      const baseDir = videoType === 'bodycam'
        ? (process.env.RMPG_UPLOADS_DIR ? path.join(process.env.RMPG_UPLOADS_DIR, 'bodycam') : path.resolve(__dirname, '../../uploads/bodycam'))
        : (process.env.RMPG_UPLOADS_DIR ? path.join(process.env.RMPG_UPLOADS_DIR, 'dashcam') : path.resolve(__dirname, '../../uploads/dashcam'));

      const relativePath = path.relative(baseDir, outputPath);

      // Update DB with success
      db.prepare(`UPDATE ${table} SET overlay_status = 'complete', processed_file_path = ?, overlay_error = NULL, updated_at = ? WHERE id = ?`)
        .run(relativePath, localNow(), videoId);

      console.log(`[Video Overlay] Saved: ${table}[${videoId}] → ${relativePath}`);

    } catch (err: any) {
      const errorMsg = err.message?.slice(0, 500) || 'Unknown error';
      console.error(`[Video Overlay] Error for ${table}[${videoId}]:`, errorMsg);

      try {
        db.prepare(`UPDATE ${table} SET overlay_status = 'error', overlay_error = ?, updated_at = ? WHERE id = ?`)
          .run(errorMsg, localNow(), videoId);
      } catch (dbErr) {
        console.error('[Video Overlay] Failed to update error status:', dbErr);
      }
    }
  })();
}

// ── Reprocess Pending Overlays ──────────────────────────────

/**
 * Batch-reprocess bodycam videos that have pending or errored overlays.
 * Called on server startup with a delay.
 */
export async function reprocessPendingOverlays(): Promise<void> {
  const db = getDb();

  // Body cam videos
  const pendingBodycam = db.prepare(`
    SELECT v.id, v.file_path, v.recorded_at, v.case_number, v.classification,
           u.full_name as officer_name, u.badge_number,
           c.camera_id as camera_serial
    FROM bodycam_videos v
    LEFT JOIN users u ON v.officer_id = u.id
    LEFT JOIN body_cameras c ON v.camera_id = c.id
    WHERE v.overlay_status IN ('pending', 'error')
    ORDER BY v.id DESC
    LIMIT ?
  `).all(REPROCESS_BATCH_SIZE) as any[];

  if (pendingBodycam.length > 0) {
    console.log(`[Video Overlay] Reprocessing ${pendingBodycam.length} pending bodycam video(s)...`);
  }

  const BODYCAM_DIR = process.env.RMPG_UPLOADS_DIR
    ? path.join(process.env.RMPG_UPLOADS_DIR, 'bodycam')
    : path.resolve(__dirname, '../../uploads/bodycam');

  for (const video of pendingBodycam) {
    const inputPath = path.resolve(BODYCAM_DIR, video.file_path);
    if (!fs.existsSync(inputPath)) {
      console.warn(`[Video Overlay] Skipping bodycam[${video.id}]: file not found at ${inputPath}`);
      db.prepare(`UPDATE bodycam_videos SET overlay_status = 'error', overlay_error = 'Original file not found', updated_at = ? WHERE id = ?`)
        .run(localNow(), video.id);
      continue;
    }

    const recordedAt = video.recorded_at ? new Date(video.recorded_at) : new Date();
    const config: BodyCamOverlayConfig = {
      type: 'bodycam',
      officerName: video.officer_name || 'UNKNOWN',
      badgeNumber: video.badge_number || '',
      cameraSerial: video.camera_serial || '',
      recordedAtUnix: Math.floor(recordedAt.getTime() / 1000),
      caseNumber: video.case_number || '',
      classification: (video.classification || 'routine').toUpperCase(),
    };

    queueOverlayProcessing(video.id, 'bodycam', inputPath, config);

    // Delay between items to avoid CPU overload
    if (pendingBodycam.indexOf(video) < pendingBodycam.length - 1) {
      await new Promise(resolve => setTimeout(resolve, INTER_PROCESS_DELAY_MS));
    }
  }

  // Dash cam videos — guard against missing table (created by dashcamVideos route init)
  const dashcamTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dashcam_videos'").get();
  const pendingDashcam: any[] = dashcamTableExists ? db.prepare(`
    SELECT v.id, v.file_path, v.recorded_at, v.speed_mph, v.latitude, v.longitude, v.address,
           fv.vehicle_number, fv.year, fv.make, fv.model,
           un.call_sign
    FROM dashcam_videos v
    LEFT JOIN fleet_vehicles fv ON v.vehicle_id = fv.id
    LEFT JOIN units un ON v.unit_id = un.id
    WHERE v.overlay_status IN ('pending', 'error')
    ORDER BY v.id DESC
    LIMIT ?
  `).all(REPROCESS_BATCH_SIZE) as any[] : [];

  if (pendingDashcam.length > 0) {
    console.log(`[Video Overlay] Reprocessing ${pendingDashcam.length} pending dashcam video(s)...`);
  }

  const DASHCAM_DIR = process.env.RMPG_UPLOADS_DIR
    ? path.join(process.env.RMPG_UPLOADS_DIR, 'dashcam')
    : path.resolve(__dirname, '../../uploads/dashcam');

  for (const video of pendingDashcam) {
    const inputPath = path.resolve(DASHCAM_DIR, video.file_path);
    if (!fs.existsSync(inputPath)) {
      console.warn(`[Video Overlay] Skipping dashcam[${video.id}]: file not found at ${inputPath}`);
      db.prepare(`UPDATE dashcam_videos SET overlay_status = 'error', overlay_error = 'Original file not found', updated_at = ? WHERE id = ?`)
        .run(localNow(), video.id);
      continue;
    }

    const recordedAt = video.recorded_at ? new Date(video.recorded_at) : new Date();
    const vehDesc = [video.year, video.make, video.model].filter(Boolean).join(' ');
    const config: DashCamOverlayConfig = {
      type: 'dashcam',
      unitCallSign: video.call_sign || '',
      vehicleDescription: vehDesc,
      recordedAtUnix: Math.floor(recordedAt.getTime() / 1000),
      speedMph: video.speed_mph,
      latitude: video.latitude,
      longitude: video.longitude,
      address: video.address || '',
    };

    queueOverlayProcessing(video.id, 'dashcam', inputPath, config);

    if (pendingDashcam.indexOf(video) < pendingDashcam.length - 1) {
      await new Promise(resolve => setTimeout(resolve, INTER_PROCESS_DELAY_MS));
    }
  }
}

/**
 * Schedule reprocessing of pending overlays on server startup.
 */
export function scheduleOverlayReprocessing(): void {
  setTimeout(() => {
    console.log('[Video Overlay] Checking for pending overlay processing...');
    reprocessPendingOverlays().catch(err => {
      console.error('[Video Overlay] Reprocessing error:', err);
    });
  }, REPROCESS_DELAY_MS);
}

// ── Burn Video With Progress ────────────────────────────────

export interface BurnConfig {
  agencyName: string;
  unitCallSign?: string;
  vehicleDescription?: string;
  caseNumber?: string;
  classification?: string;
  recordedAt?: string;
  speed?: number;
  latitude?: number;
  longitude?: number;
}

/**
 * Burn HUD metadata overlay onto a video file with real-time progress reporting.
 * Uses ffmpeg with -progress pipe:2 to track encoding progress.
 *
 * @param inputPath   Absolute path to source video
 * @param outputPath  Absolute path for burned output
 * @param config      Metadata to render on the video
 * @param onProgress  Callback invoked with percent (0-100), throttled to every 2s
 */
export async function burnVideoWithProgress(
  inputPath: string,
  outputPath: string,
  config: BurnConfig,
  onProgress: (percent: number) => void
): Promise<void> {
  // Validate input file
  const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.ts', '.m4v'];
  const inputExt = path.extname(inputPath).toLowerCase();
  if (!ALLOWED_VIDEO_EXTENSIONS.includes(inputExt)) {
    throw new Error(`Unsupported video format: ${inputExt}`);
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${path.basename(inputPath)}`);
  }

  // 1. Probe duration
  let durationSec = 0;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      inputPath,
    ], { timeout: 30_000 });
    const probe = JSON.parse(stdout);
    durationSec = parseFloat(probe?.format?.duration || '0');
  } catch (err: any) {
    console.warn(`[Burn] ffprobe failed, progress will be unavailable: ${err.message}`);
  }

  // 2. Build drawtext filters
  const filters: string[] = [];

  // Top-left: agency name
  const agencyText = escapeDrawtext(config.agencyName.toUpperCase());
  filters.push(
    `drawtext=text='${agencyText}':fontsize=16:fontcolor=white@0.9:font=monospace:box=1:boxcolor=black@0.5:boxborderw=6:x=12:y=12:shadowx=1:shadowy=1:shadowcolor=black@0.6`
  );

  // Top-right: "REC" indicator + timestamp
  const recordedAt = config.recordedAt ? new Date(config.recordedAt) : new Date();
  const recordedAtUnix = Math.floor(recordedAt.getTime() / 1000);
  filters.push(
    `drawtext=text='REC ●  %{pts\\:localtime\\:${recordedAtUnix}\\:%m/%d/%Y %T}H':fontsize=16:fontcolor=white@0.9:font=monospace:box=1:boxcolor=black@0.5:boxborderw=6:x=w-tw-12:y=12:shadowx=1:shadowy=1:shadowcolor=black@0.6`
  );

  // Bottom-left: unit, vehicle, speed, GPS
  const bottomLeftParts: string[] = [];
  if (config.unitCallSign) bottomLeftParts.push(`UNIT: ${config.unitCallSign}`);
  if (config.vehicleDescription) bottomLeftParts.push(`VEH: ${config.vehicleDescription.toUpperCase()}`);
  if (config.speed != null) bottomLeftParts.push(`SPD: ${config.speed} MPH`);
  if (config.latitude != null && config.longitude != null) {
    bottomLeftParts.push(formatCoordinates(config.latitude, config.longitude));
  }
  if (bottomLeftParts.length > 0) {
    const blText = escapeDrawtext(bottomLeftParts.join(' | '));
    filters.push(
      `drawtext=text='${blText}':fontsize=16:fontcolor=white@0.9:font=monospace:box=1:boxcolor=black@0.5:boxborderw=6:x=12:y=h-32:shadowx=1:shadowy=1:shadowcolor=black@0.6`
    );
  }

  // Bottom-right: case number, classification
  const bottomRightParts: string[] = [];
  if (config.caseNumber) bottomRightParts.push(`CASE: ${config.caseNumber}`);
  if (config.classification) bottomRightParts.push(config.classification.toUpperCase());
  if (bottomRightParts.length > 0) {
    const brText = escapeDrawtext(bottomRightParts.join(' | '));
    filters.push(
      `drawtext=text='${brText}':fontsize=16:fontcolor=white@0.9:font=monospace:box=1:boxcolor=black@0.5:boxborderw=6:x=w-tw-12:y=h-32:shadowx=1:shadowy=1:shadowcolor=black@0.6`
    );
  }

  const filterGraph = filters.join(',');

  // 3. Spawn ffmpeg with progress output
  const args = [
    '-i', inputPath,
    '-vf', filterGraph,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-progress', 'pipe:2',
    '-y',
    outputPath,
  ];

  console.log(`[Burn] Processing: ${path.basename(inputPath)} → ${path.basename(outputPath)}`);

  return new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let lastProgressTime = 0;
    let stderrBuffer = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();

      // Parse progress lines from -progress pipe:2
      if (durationSec > 0) {
        // Try out_time_ms first (microseconds), then out_time (HH:MM:SS.mmm)
        const msMatch = stderrBuffer.match(/out_time_ms=(\d+)/);
        const timeMatch = stderrBuffer.match(/out_time=(\d+):(\d+):(\d+\.\d+)/);

        let currentSec = 0;
        if (msMatch) {
          currentSec = parseInt(msMatch[1], 10) / 1_000_000;
        } else if (timeMatch) {
          currentSec = parseInt(timeMatch[1], 10) * 3600 +
                       parseInt(timeMatch[2], 10) * 60 +
                       parseFloat(timeMatch[3]);
        }

        if (currentSec > 0) {
          const now = Date.now();
          if (now - lastProgressTime >= 2000) {
            lastProgressTime = now;
            const pct = Math.min(99, Math.round((currentSec / durationSec) * 100));
            onProgress(pct);
          }
        }
      }

      // Keep only last 2KB of stderr to avoid memory buildup
      if (stderrBuffer.length > 2048) {
        stderrBuffer = stderrBuffer.slice(-2048);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        onProgress(100);
        console.log(`[Burn] Complete: ${path.basename(outputPath)}`);
        resolve();
      } else {
        const tail = stderrBuffer.slice(-500);
        console.error(`[Burn] FAILED (exit ${code}): ${path.basename(inputPath)} — ${tail}`);
        reject(new Error(`FFmpeg exited with code ${code}: ${tail}`));
      }
    });

    // Kill after 30 minutes
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      reject(new Error('FFmpeg burn timed out after 30 minutes'));
    }, FFMPEG_TIMEOUT_MS);
  });
}
