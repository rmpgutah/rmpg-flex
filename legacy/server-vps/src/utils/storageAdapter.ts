// ============================================================
// storageAdapter — pluggable evidence storage
// ============================================================
// v0 ships with a filesystem implementation only. v1 adds an
// S3/MinIO adapter behind the same interface so route handlers
// don't change. Path layout per design decision (Option A):
//
//   ${baseDir}/${YYYY-MM-DD}/unit-${unit_id|unknown}/${artifact_id}-${safeFilename}
//
// Filename sanitization is rigorous: anything client-supplied
// gets stripped of path separators, control bytes, and capped
// in length. The final resolved path is verified to stay inside
// baseDir as a defense-in-depth check against any sanitization
// bypass we missed.
//
// URIs are file:// for v0; the route handler treats them as
// opaque strings. When we add MinIO, storage_uri becomes
// s3://bucket/key with no schema migration required.

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);
const chmod = promisify(fs.chmod);

const MAX_FILENAME_BYTES = 200; // leaves room under 255-byte FS limits
const DEFAULT_FILENAME = 'clip.bin';

export interface StoragePutInput {
  body: Buffer;
  sha256: string;
  artifact_type: string;
  artifact_id: number;
  unit_id?: number;
  captured_at: string;
  /** Original filename hint — sanitized before use. */
  filename?: string;
}

export interface StoragePutResult {
  storage_uri: string;
  size_bytes: number;
}

export interface StorageAdapter {
  put(input: StoragePutInput): Promise<StoragePutResult>;
  get(storage_uri: string): Promise<Buffer>;
}

export interface FilesystemStorageOptions {
  /** When true, chmod 0444 after writing so subsequent rm/edit
   *  operations require root or chmod first. Approximates MinIO
   *  Object Lock at the filesystem level for v0. Default: false
   *  (so dev/test environments don't accumulate read-only files
   *  that complicate cleanup). */
  writeOnce?: boolean;
}

/** Extract YYYY-MM-DD from various captured_at formats. */
function extractDate(captured_at: string): string {
  // Accept 'YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DDTHH:MM:SS...', 'YYYY-MM-DD'
  const m = captured_at.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) {
    throw new Error(`storageAdapter: unparseable captured_at '${captured_at}'`);
  }
  return m[1];
}

/**
 * Sanitize a client-supplied filename to a single safe path
 * component. Strips:
 *   - path separators ('/' and '\\')
 *   - any '..' segments and leading dots
 *   - NUL bytes and ASCII control chars (0x00-0x1f, 0x7f)
 *   - leading/trailing whitespace
 * Then truncates to MAX_FILENAME_BYTES while preserving the
 * file extension if present.
 */
function sanitizeFilename(raw: string): string {
  // Strip path separators by taking the basename only
  let name = path.basename(raw);

  // Remove control bytes (0x00-0x1f, 0x7f) and path separators that
  // basename() may have left on some platforms
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1f\x7f/\\]/g, '');

  // Remove '..' patterns aggressively (basename should already, but defense)
  name = name.replace(/\.\.+/g, '');

  // Trim whitespace and leading dots (hidden-file convention)
  name = name.replace(/^[.\s]+/, '').replace(/\s+$/, '');

  if (!name) name = DEFAULT_FILENAME;

  // Length cap, preserving extension
  if (Buffer.byteLength(name, 'utf8') > MAX_FILENAME_BYTES) {
    const ext = path.extname(name).slice(0, 16); // bound the extension
    const stem = name.slice(0, name.length - ext.length);
    const allowed = MAX_FILENAME_BYTES - Buffer.byteLength(ext, 'utf8');
    let truncated = stem;
    while (Buffer.byteLength(truncated, 'utf8') > allowed) {
      truncated = truncated.slice(0, -1);
    }
    name = truncated + ext;
  }

  return name;
}

function fileUriFromPath(absPath: string): string {
  return 'file://' + absPath;
}

function pathFromFileUri(uri: string): string {
  if (!uri.startsWith('file://')) {
    throw new Error(`storageAdapter: unsupported URI scheme: ${uri}`);
  }
  return uri.slice('file://'.length);
}

export function createFilesystemStorage(
  baseDir: string,
  options: FilesystemStorageOptions = {},
): StorageAdapter {
  const resolvedBase = path.resolve(baseDir);
  const writeOnce = options.writeOnce ?? (process.env.DASHCAM_AI_WRITE_ONCE === '1' || process.env.DASHCAM_AI_WRITE_ONCE === 'true');

  return {
    async put(input: StoragePutInput): Promise<StoragePutResult> {
      const date = extractDate(input.captured_at);
      const unitDir = input.unit_id != null ? `unit-${input.unit_id}` : 'unit-unknown';
      const safeName = sanitizeFilename(input.filename ?? DEFAULT_FILENAME);
      const objectKey = path.join(date, unitDir, `${input.artifact_id}-${safeName}`);
      const fullPath = path.resolve(resolvedBase, objectKey);

      // Defense-in-depth: ensure resolved path stays inside baseDir.
      // (Sanitization should already guarantee this; belt-and-suspenders.)
      if (!fullPath.startsWith(resolvedBase + path.sep) && fullPath !== resolvedBase) {
        throw new Error(`storageAdapter: resolved path escapes baseDir`);
      }

      // Create parent dir; fail if file already exists.
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, input.body, { flag: 'wx' });

      // Optional write-once approximation: chmod 0444. A subsequent
      // rm requires the user to chmod 0644 first (or be root) — not
      // a hard guarantee like MinIO Object Lock, but a meaningful
      // additional step that defeats casual tampering and shows up
      // in audit logs as deliberate.
      if (writeOnce) {
        try {
          await chmod(fullPath, 0o444);
        } catch (err: any) {
          // Best-effort — don't fail the write if chmod fails (e.g.
          // on a Windows host or weird filesystem). Operators see
          // the failure in logs and can decide whether to enforce.
          // eslint-disable-next-line no-console
          console.warn(`storageAdapter: chmod 0444 failed for ${fullPath}: ${err?.message ?? err}`);
        }
      }

      return {
        storage_uri: fileUriFromPath(fullPath),
        size_bytes: input.body.length,
      };
    },

    async get(storage_uri: string): Promise<Buffer> {
      const absPath = pathFromFileUri(storage_uri);
      const resolved = path.resolve(absPath);
      if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
        throw new Error(`storageAdapter: path resolves outside base directory`);
      }
      return await readFile(resolved);
    },
  };
}
