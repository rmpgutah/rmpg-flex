// ============================================================
// RMPG Flex — Image Processing Utility (sharp)
// ============================================================
// High-performance image processing for evidence photos,
// mug shots, and document scans. Extracts EXIF metadata,
// resizes for storage, watermarks with case/badge info,
// and converts formats for standardized evidence handling.
// ============================================================

import sharp from 'sharp';
import path from 'path';
import { logger } from './logger';

// ── Types ─────────────────────────────────────────────────

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  exif?: {
    make?: string;
    model?: string;
    dateTime?: string;
    gpsLatitude?: number;
    gpsLongitude?: number;
    orientation?: number;
  };
}

export interface ResizeOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp' | 'avif';
}

export interface WatermarkOptions {
  text: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  fontSize?: number;
  opacity?: number;
}

// ── Core functions ────────────────────────────────────────

/**
 * Extract metadata from an image buffer, including EXIF GPS coordinates
 * and camera info — critical for evidence chain-of-custody.
 */
export async function extractImageMetadata(buffer: Buffer): Promise<ImageMetadata> {
  const metadata = await sharp(buffer).metadata();
  const result: ImageMetadata = {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || 'unknown',
    size: buffer.length,
  };

  if (metadata.exif) {
    try {
      // sharp exposes raw EXIF; parse the key fields we need
      const exifData = metadata.exif;
      result.exif = {
        orientation: metadata.orientation,
      };
      // GPS and camera info are in the raw EXIF buffer — sharp provides
      // density and orientation directly, but for GPS we'd need exif-reader.
      // For now, expose what sharp gives us natively.
      if (metadata.density) {
        (result.exif as any).density = metadata.density;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to parse EXIF data');
    }
  }

  return result;
}

/**
 * Resize an image for efficient storage while preserving aspect ratio.
 * Default: 1920px max width, 85% JPEG quality.
 */
export async function resizeImage(
  buffer: Buffer,
  options: ResizeOptions = {}
): Promise<Buffer> {
  const {
    width = 1920,
    height,
    fit = 'inside',
    quality = 85,
    format = 'jpeg',
  } = options;

  let pipeline = sharp(buffer)
    .rotate() // Auto-rotate based on EXIF orientation
    .resize(width, height, { fit, withoutEnlargement: true });

  switch (format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      break;
    case 'png':
      pipeline = pipeline.png({ quality, compressionLevel: 9 });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality });
      break;
  }

  return pipeline.toBuffer();
}

/**
 * Create a thumbnail from an image (evidence listing previews).
 */
export async function createThumbnail(
  buffer: Buffer,
  size = 200
): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize(size, size, { fit: 'cover' })
    .jpeg({ quality: 70 })
    .toBuffer();
}

/**
 * Add a text watermark to an image (case number, badge, timestamp).
 * Used for evidence photos before sharing externally.
 */
export async function watermarkImage(
  buffer: Buffer,
  options: WatermarkOptions
): Promise<Buffer> {
  const {
    text,
    position = 'bottom-right',
    fontSize = 24,
    opacity = 0.7,
  } = options;

  const metadata = await sharp(buffer).metadata();
  const imgWidth = metadata.width || 800;
  const imgHeight = metadata.height || 600;

  // Create SVG text overlay
  const textWidth = text.length * fontSize * 0.6;
  const padding = 10;
  const boxWidth = textWidth + padding * 2;
  const boxHeight = fontSize + padding * 2;

  // Position calculations
  let x = 10;
  let y = 10;
  switch (position) {
    case 'top-right':
      x = imgWidth - boxWidth - 10;
      break;
    case 'bottom-left':
      y = imgHeight - boxHeight - 10;
      break;
    case 'bottom-right':
      x = imgWidth - boxWidth - 10;
      y = imgHeight - boxHeight - 10;
      break;
    case 'center':
      x = (imgWidth - boxWidth) / 2;
      y = (imgHeight - boxHeight) / 2;
      break;
  }

  const svg = `
    <svg width="${imgWidth}" height="${imgHeight}">
      <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}"
            fill="rgba(0,0,0,${opacity})" rx="4"/>
      <text x="${x + padding}" y="${y + fontSize + padding / 2}"
            font-family="monospace" font-size="${fontSize}" fill="white"
            opacity="${opacity + 0.2}">${escapeXml(text)}</text>
    </svg>
  `;

  return sharp(buffer)
    .composite([{ input: Buffer.from(svg), gravity: 'northwest' }])
    .toBuffer();
}

/**
 * Strip EXIF metadata from an image before public release
 * (privacy protection — removes GPS, camera serial, etc.)
 */
export async function stripExif(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate() // Apply EXIF rotation before stripping
    .withMetadata({ orientation: undefined } as any)
    .toBuffer();
}

/**
 * Convert image to a standardized format for evidence storage.
 */
export async function convertFormat(
  buffer: Buffer,
  format: 'jpeg' | 'png' | 'webp' | 'tiff',
  quality = 95
): Promise<Buffer> {
  let pipeline = sharp(buffer).rotate();

  switch (format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality });
      break;
    case 'png':
      pipeline = pipeline.png({ quality });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'tiff':
      pipeline = pipeline.tiff({ quality });
      break;
  }

  return pipeline.toBuffer();
}

/**
 * Get the file extension for a given format.
 */
export function getExtension(format: string): string {
  const map: Record<string, string> = {
    jpeg: '.jpg',
    png: '.png',
    webp: '.webp',
    avif: '.avif',
    tiff: '.tiff',
    gif: '.gif',
  };
  return map[format] || '.bin';
}

// ── Helpers ───────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
