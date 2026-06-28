// ============================================================
// RMPG Flex — Video Overlay Burner & Source File Generator
// ============================================================
// Burns HUD overlay data (timestamp, officer, camera serial,
// case #, interaction type, speed, GPS, etc.) permanently into
// video pixels using FFmpeg drawbox + drawtext filters.
//
// Also generates source.txt sidecar files with chain-of-custody
// metadata and video technical specifications for evidence packages.
//
// Filter builders:
//   buildBwcFilter()     — Body Camera overlay (chain-of-custody)
//   buildDashcamFilter() — Dashcam overlay (vehicle telemetry)
//
// Source file:
//   generateSourceFile() — Writes source.txt alongside the video
// ============================================================

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// ── Types ───────────────────────────────────────────────

export interface VideoProbeResult {
  width: number;
  height: number;
  duration: number;
}

export interface BwcBurnMetadata {
  cameraSerial: string;
  officerName: string;
  caseNumber: string;
  interactionType: string | null;
  classification: string;
  recordedAt: string | null; // ISO datetime
}

export interface DashcamBurnMetadata {
  officerName: string;
  callSign: string;
  speedMph: number | null;
  heading: number | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  recordedAt: string | null; // ISO datetime
}

// ── Helpers ─────────────────────────────────────────────

const FONT_PATHS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
];

/** Find a monospace TTF font on disk. Returns fontfile= clause or font= fallback. */
function fontClause(): string {
  for (const fp of FONT_PATHS) {
    if (fs.existsSync(fp)) return `fontfile='${fp}'`;
  }
  return `font='mono'`;
}

/**
 * Escape text for FFmpeg drawtext filter (inside single-quoted values).
 * Must escape: backslash, single-quote, percent, colon, semicolon.
 */
function esc(text: string): string {
  return text
    .replace(/\\/g, '\\\\')   // \ → \\
    .replace(/'/g, "'\\\\''")  // ' → escape out and back in
    .replace(/%/g, '%%')      // % → %% (avoid strftime expansion)
    .replace(/:/g, '\\:')     // : → \: (filter separator)
    .replace(/;/g, '\\;');    // ; → \; (filter chain separator)
}

/** Convert ISO date string to Unix epoch seconds. */
function toEpoch(isoDate: string | null): number {
  if (!isoDate) return Math.floor(Date.now() / 1000);
  const t = new Date(isoDate).getTime();
  return isFinite(t) ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000);
}

/** Compass heading to cardinal direction string. */
function headingToCardinal(deg: number | null): string {
  if (deg == null || !isFinite(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/** Interaction type → FFmpeg-safe hex color for badge background. */
function interactionBadgeColor(type: string | null): string {
  if (!type) return '';
  switch (type) {
    case 'use_of_force':
    case 'foot_pursuit':
    case 'vehicle_pursuit':
      return 'red@0.75';
    case 'arrest':
    case 'search_warrant':
    case 'domestic_violence':
      return '0xF59E0B@0.75'; // amber
    case 'evidence_collection':
    case 'interview':
      return '0x8B5CF6@0.70'; // purple
    default:
      return '0x0891B2@0.70'; // cyan
  }
}

// ── Probe ───────────────────────────────────────────────

/** Get video dimensions and duration via ffprobe. */
export async function probeVideo(filePath: string): Promise<VideoProbeResult> {
  const { stdout } = await execAsync(
    `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`,
    { timeout: 30000 }
  );
  const info = JSON.parse(stdout);
  const vs = info.streams?.find((s: any) => s.codec_type === 'video');
  if (!vs) throw new Error('No video stream found');

  return {
    width: parseInt(vs.width, 10) || 1920,
    height: parseInt(vs.height, 10) || 1080,
    duration: parseFloat(info.format?.duration || '0'),
  };
}

// ── BWC Filter ──────────────────────────────────────────

/**
 * Build FFmpeg filter string for body-worn camera overlay.
 *
 * Layout matches BodyCamHudOverlay.tsx:
 *   Top bar:    BWC · Camera Serial · [Interaction Badge] · REC
 *   Bottom bar: Ticking Timestamp · Officer Name · Classification + Case #
 */
export function buildBwcFilter(w: number, h: number, meta: BwcBurnMetadata): string {
  const font = fontClause();
  const barH = Math.round(h * 0.042);
  const mainSize = Math.max(12, Math.round(h * 0.022));
  const smallSize = Math.max(10, Math.round(h * 0.018));
  const tinySize = Math.max(8, Math.round(h * 0.013));
  const pad = Math.round(w * 0.012);
  const epoch = toEpoch(meta.recordedAt);

  const filters: string[] = [];

  // ── Top bar background ──
  filters.push(`drawbox=x=0:y=0:w=${w}:h=${barH}:color=black@0.55:t=fill`);

  // Top-left: "BWC" label
  filters.push(
    `drawtext=${font}:text='BWC':fontcolor=white@0.40:fontsize=${tinySize}:x=${pad}:y=${Math.round(barH / 2 - tinySize / 2)}`
  );

  // Top-left: camera serial (after BWC)
  if (meta.cameraSerial) {
    filters.push(
      `drawtext=${font}:text='${esc(meta.cameraSerial)}':fontcolor=white@0.80:fontsize=${smallSize}:x=${pad + tinySize * 3 + 6}:y=${Math.round(barH / 2 - smallSize / 2)}`
    );
  }

  // Top-center: interaction type badge
  if (meta.interactionType) {
    const badgeText = meta.interactionType.replace(/_/g, ' ').toUpperCase();
    const badgeColor = interactionBadgeColor(meta.interactionType);
    filters.push(
      `drawtext=${font}:text='${esc(badgeText)}':fontcolor=white:fontsize=${tinySize}:x=(w-text_w)/2:y=${Math.round(barH / 2 - tinySize / 2)}:box=1:boxcolor=${badgeColor}:boxborderw=3`
    );
  }

  // Top-right: "REC"
  filters.push(
    `drawtext=${font}:text='REC':fontcolor=red@0.85:fontsize=${tinySize}:x=w-text_w-${pad}:y=${Math.round(barH / 2 - tinySize / 2)}`
  );

  // ── Bottom bar background ──
  const bottomY = h - barH;
  filters.push(`drawbox=x=0:y=${bottomY}:w=${w}:h=${barH}:color=black@0.55:t=fill`);

  // Bottom-left: ticking timestamp
  filters.push(
    `drawtext=${font}:text='%{pts\\:localtime\\:${epoch}\\:%m/%d/%Y %T}':fontcolor=white:fontsize=${mainSize}:x=${pad}:y=${bottomY + Math.round(barH / 2 - mainSize / 2)}`
  );

  // Bottom-center: officer name
  if (meta.officerName) {
    filters.push(
      `drawtext=${font}:text='${esc(meta.officerName)}':fontcolor=white@0.85:fontsize=${smallSize}:x=(w-text_w)/2:y=${bottomY + Math.round(barH / 2 - smallSize / 2)}`
    );
  }

  // Bottom-right: classification + case #
  const rightParts: string[] = [];
  if (meta.classification && meta.classification !== 'routine') {
    rightParts.push(meta.classification.toUpperCase());
  }
  if (meta.caseNumber) {
    rightParts.push(`Case #${meta.caseNumber}`);
  } else {
    rightParts.push('No Case');
  }
  const rightText = rightParts.join('  ');
  const rightColor = meta.classification === 'evidence' ? '0xFBBF24'
    : meta.classification === 'flagged' ? '0xF87171'
    : meta.classification === 'restricted' ? '0xFCA5A5'
    : 'white@0.60';
  filters.push(
    `drawtext=${font}:text='${esc(rightText)}':fontcolor=${rightColor}:fontsize=${smallSize}:x=w-text_w-${pad}:y=${bottomY + Math.round(barH / 2 - smallSize / 2)}`
  );

  return filters.join(',');
}

// ── Dashcam Filter ──────────────────────────────────────

/**
 * Build FFmpeg filter string for dashcam overlay.
 *
 * Layout matches DashCamHudOverlay.tsx:
 *   Top bar:    Ticking Timestamp · Officer + Call Sign · REC
 *   Bottom bar: Speed + Heading · Address · GPS Coordinates
 */
export function buildDashcamFilter(w: number, h: number, meta: DashcamBurnMetadata): string {
  const font = fontClause();
  const barH = Math.round(h * 0.042);
  const mainSize = Math.max(12, Math.round(h * 0.022));
  const smallSize = Math.max(10, Math.round(h * 0.018));
  const tinySize = Math.max(8, Math.round(h * 0.013));
  const pad = Math.round(w * 0.012);
  const epoch = toEpoch(meta.recordedAt);

  const filters: string[] = [];

  // ── Top bar background ──
  filters.push(`drawbox=x=0:y=0:w=${w}:h=${barH}:color=black@0.60:t=fill`);

  // Top-left: ticking timestamp
  filters.push(
    `drawtext=${font}:text='%{pts\\:localtime\\:${epoch}\\:%m/%d/%Y %T}':fontcolor=white:fontsize=${mainSize}:x=${pad}:y=${Math.round(barH / 2 - mainSize / 2)}`
  );

  // Top-center: officer name + call sign
  const officerText = [meta.officerName, meta.callSign].filter(Boolean).join(' | ');
  if (officerText) {
    filters.push(
      `drawtext=${font}:text='${esc(officerText)}':fontcolor=0xFBBF24:fontsize=${smallSize}:x=(w-text_w)/2:y=${Math.round(barH / 2 - smallSize / 2)}`
    );
  }

  // Top-right: "REC"
  filters.push(
    `drawtext=${font}:text='REC':fontcolor=red@0.85:fontsize=${tinySize}:x=w-text_w-${pad}:y=${Math.round(barH / 2 - tinySize / 2)}`
  );

  // ── Bottom bar background ──
  const bottomY = h - barH;
  filters.push(`drawbox=x=0:y=${bottomY}:w=${w}:h=${barH}:color=black@0.60:t=fill`);

  // Bottom-left: speed + heading
  const speedParts: string[] = [];
  if (meta.speedMph != null) {
    speedParts.push(`${Math.round(meta.speedMph)} MPH`);
  }
  if (meta.heading != null) {
    const cardinal = headingToCardinal(meta.heading);
    speedParts.push(`${Math.round(meta.heading)}° ${cardinal}`);
  }
  const speedText = speedParts.join('  ');
  if (speedText) {
    const speedColor = (meta.speedMph ?? 0) > 80 ? '0xF87171'
      : (meta.speedMph ?? 0) > 60 ? '0xFBBF24'
      : 'white';
    filters.push(
      `drawtext=${font}:text='${esc(speedText)}':fontcolor=${speedColor}:fontsize=${mainSize}:x=${pad}:y=${bottomY + Math.round(barH / 2 - mainSize / 2)}`
    );
  }

  // Bottom-center: address
  if (meta.address) {
    filters.push(
      `drawtext=${font}:text='${esc(meta.address)}':fontcolor=white@0.85:fontsize=${smallSize}:x=(w-text_w)/2:y=${bottomY + Math.round(barH / 2 - smallSize / 2)}`
    );
  }

  // Bottom-right: GPS coordinates
  if (meta.latitude != null && meta.longitude != null) {
    const gps = `${meta.latitude.toFixed(5)}, ${meta.longitude.toFixed(5)}`;
    filters.push(
      `drawtext=${font}:text='${esc(gps)}':fontcolor=white@0.40:fontsize=${tinySize}:x=w-text_w-${pad}:y=${bottomY + Math.round(barH / 2 - tinySize / 2)}`
    );
  }

  return filters.join(',');
}

// ── Burn ────────────────────────────────────────────────

/**
 * Run FFmpeg to burn the overlay filter into the video.
 * Returns a promise that resolves when encoding finishes.
 * 10-minute timeout.
 */
export function burnOverlay(inputPath: string, outputPath: string, filterString: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',                           // overwrite output
      '-i', inputPath,
      '-vf', filterString,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'copy',                 // keep original audio
      '-movflags', '+faststart',      // web-compatible MP4
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('FFmpeg timed out after 10 minutes'));
    }, 600000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        // Extract last meaningful FFmpeg error line
        const lines = stderr.split('\n').filter(l => l.trim());
        const lastLine = lines[lines.length - 1] || 'Unknown error';
        reject(new Error(`FFmpeg exited with code ${code}: ${lastLine}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

// ── Source File Generator ───────────────────────────────

export interface DashcamSourceData {
  videoId: number;
  title: string;
  source: string;          // 'manual' | 'cpg_sync' | 'cpg_proxy'
  officerName: string;
  callSign: string;
  deviceName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  durationSeconds: number | null;
  recordedAt: string | null;
  eventType: string | null;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  speedMph: number | null;
  address: string;
  caseNumber: string;
  classification: string;
  retentionStatus: string;
  notes: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface BwcSourceData {
  videoId: number;
  title: string;
  officerName: string;
  cameraSerial: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  durationSeconds: number | null;
  recordedAt: string | null;
  interactionType: string | null;
  caseNumber: string;
  classification: string;
  retentionStatus: string;
  notes: string;
  uploadedBy: string;
  uploadedAt: string;
}

/** Probe extended video technical data via ffprobe for source.txt */
async function probeVideoDetails(filePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath}"`,
      { timeout: 30000 }
    );
    const info = JSON.parse(stdout);
    const vs = info.streams?.find((s: any) => s.codec_type === 'video');
    const as = info.streams?.find((s: any) => s.codec_type === 'audio');
    const fmt = info.format || {};

    const lines: string[] = [];
    lines.push('--- VIDEO TECHNICAL SPECIFICATIONS ---');
    if (vs) {
      lines.push(`Resolution:         ${vs.width}x${vs.height}`);
      lines.push(`Video Codec:        ${vs.codec_long_name || vs.codec_name || 'Unknown'}`);
      if (vs.bit_rate) lines.push(`Video Bitrate:      ${Math.round(parseInt(vs.bit_rate) / 1000)} kbps`);
      if (vs.r_frame_rate) {
        const [num, den] = vs.r_frame_rate.split('/');
        const fps = den ? (parseInt(num) / parseInt(den)).toFixed(2) : num;
        lines.push(`Frame Rate:         ${fps} fps`);
      }
      if (vs.pix_fmt) lines.push(`Pixel Format:       ${vs.pix_fmt}`);
      if (vs.display_aspect_ratio) lines.push(`Aspect Ratio:       ${vs.display_aspect_ratio}`);
      if (vs.nb_frames) lines.push(`Total Frames:       ${vs.nb_frames}`);
    }
    if (as) {
      lines.push(`Audio Codec:        ${as.codec_long_name || as.codec_name || 'None'}`);
      if (as.sample_rate) lines.push(`Audio Sample Rate:  ${as.sample_rate} Hz`);
      if (as.channels) lines.push(`Audio Channels:     ${as.channels}`);
      if (as.bit_rate) lines.push(`Audio Bitrate:      ${Math.round(parseInt(as.bit_rate) / 1000)} kbps`);
    }
    if (fmt.format_long_name) lines.push(`Container Format:   ${fmt.format_long_name}`);
    if (fmt.bit_rate) lines.push(`Overall Bitrate:    ${Math.round(parseInt(fmt.bit_rate) / 1000)} kbps`);
    if (fmt.duration) lines.push(`Exact Duration:     ${parseFloat(fmt.duration).toFixed(3)} seconds`);

    return lines.join('\n');
  } catch {
    return '--- VIDEO TECHNICAL SPECIFICATIONS ---\n(ffprobe not available)';
  }
}

/** Format file size to human-readable string. */
function fmtFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format duration seconds to HH:MM:SS. */
function fmtDuration(sec: number | null): string {
  if (!sec) return 'Unknown';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Generate a source.txt sidecar file alongside a dashcam video.
 * Contains chain-of-custody metadata + video technical specs.
 * File is written to the same directory as the video with .source.txt extension.
 */
export async function generateDashcamSourceFile(videoFilePath: string, data: DashcamSourceData): Promise<string> {
  const techDetails = await probeVideoDetails(videoFilePath);
  const heading = data.heading != null ? `${Math.round(data.heading)}° ${headingToCardinal(data.heading)}` : 'N/A';
  const gps = (data.latitude != null && data.longitude != null)
    ? `${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`
    : 'N/A';

  const content = `================================================================
  RMPG FLEX — DASHCAM VIDEO SOURCE RECORD
================================================================
  Generated: ${new Date().toISOString()}
  System:    RMPG Flex CAD/RMS
================================================================

--- EVIDENCE IDENTIFICATION ---
Video ID:           ${data.videoId}
Title:              ${data.title}
Case Number:        ${data.caseNumber || 'Not Assigned'}
Classification:     ${(data.classification || 'routine').toUpperCase()}
Retention Status:   ${(data.retentionStatus || 'active').replace(/_/g, ' ').toUpperCase()}

--- PERSONNEL & EQUIPMENT ---
Officer:            ${data.officerName || 'Unknown'}
Unit / Call Sign:   ${data.callSign || 'N/A'}
Device:             ${data.deviceName || 'N/A'}
Source:             ${data.source === 'cpg_sync' ? 'GPS Sync' : data.source === 'cpg_proxy' ? 'GPS Proxy' : 'Manual Upload'}

--- DATE & TIME ---
Recorded At:        ${data.recordedAt ? new Date(data.recordedAt).toLocaleString('en-US', { timeZone: 'America/Denver' }) : 'Unknown'}
Recorded (UTC):     ${data.recordedAt || 'Unknown'}
Uploaded At:        ${data.uploadedAt}
Uploaded By:        ${data.uploadedBy}

--- LOCATION & TELEMETRY ---
Address:            ${data.address || 'N/A'}
GPS Coordinates:    ${gps}
Heading:            ${heading}
Speed:              ${data.speedMph != null ? `${data.speedMph} mph` : 'N/A'}
Event Type:         ${data.eventType ? data.eventType.replace(/_/g, ' ').toUpperCase() : 'N/A'}

--- FILE INFORMATION ---
File Name:          ${data.fileName}
File Size:          ${fmtFileSize(data.fileSize)} (${data.fileSize.toLocaleString()} bytes)
Duration:           ${fmtDuration(data.durationSeconds)}
MIME Type:          ${data.mimeType || 'video/mp4'}

${techDetails}

--- NOTES ---
${data.notes || '(No notes)'}

================================================================
  This file is automatically generated by RMPG Flex and should
  accompany the video file for chain-of-custody documentation.
================================================================
`;

  const ext = path.extname(videoFilePath);
  const sourcePath = videoFilePath.replace(ext, '.source.txt');
  fs.writeFileSync(sourcePath, content, 'utf-8');
  return sourcePath;
}

/**
 * Generate a source.txt sidecar file alongside a BWC video.
 * Contains chain-of-custody metadata + video technical specs.
 */
export async function generateBwcSourceFile(videoFilePath: string, data: BwcSourceData): Promise<string> {
  const techDetails = await probeVideoDetails(videoFilePath);
  const interactionLabel = data.interactionType
    ? data.interactionType.replace(/_/g, ' ').toUpperCase()
    : 'N/A';

  const content = `================================================================
  RMPG FLEX — BODY WORN CAMERA VIDEO SOURCE RECORD
================================================================
  Generated: ${new Date().toISOString()}
  System:    RMPG Flex CAD/RMS
================================================================

--- EVIDENCE IDENTIFICATION ---
Video ID:           ${data.videoId}
Title:              ${data.title}
Case Number:        ${data.caseNumber || 'Not Assigned'}
Classification:     ${(data.classification || 'routine').toUpperCase()}
Retention Status:   ${(data.retentionStatus || 'active').replace(/_/g, ' ').toUpperCase()}
Interaction Type:   ${interactionLabel}

--- PERSONNEL & EQUIPMENT ---
Officer:            ${data.officerName || 'Unknown'}
Camera Serial:      ${data.cameraSerial || 'N/A'}

--- DATE & TIME ---
Recorded At:        ${data.recordedAt ? new Date(data.recordedAt).toLocaleString('en-US', { timeZone: 'America/Denver' }) : 'Unknown'}
Recorded (UTC):     ${data.recordedAt || 'Unknown'}
Uploaded At:        ${data.uploadedAt}
Uploaded By:        ${data.uploadedBy}

--- FILE INFORMATION ---
File Name:          ${data.fileName}
File Size:          ${fmtFileSize(data.fileSize)} (${data.fileSize.toLocaleString()} bytes)
Duration:           ${fmtDuration(data.durationSeconds)}
MIME Type:          ${data.mimeType || 'video/mp4'}

${techDetails}

--- NOTES ---
${data.notes || '(No notes)'}

================================================================
  This file is automatically generated by RMPG Flex and should
  accompany the video file for chain-of-custody documentation.
================================================================
`;

  const ext = path.extname(videoFilePath);
  const sourcePath = videoFilePath.replace(ext, '.source.txt');
  fs.writeFileSync(sourcePath, content, 'utf-8');
  return sourcePath;
}
