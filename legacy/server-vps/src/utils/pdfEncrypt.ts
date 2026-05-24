// ============================================================
// PDF Encryption Utility
// ============================================================
// Wraps the `qpdf` binary (industry standard, present on every
// Linux distro) to apply AES-256 encryption + granular permission
// flags to a PDF byte stream.
//
// Why qpdf and not a pure-JS solution:
//  - pdf-lib has no encryption support.
//  - Maintained pure-JS forks (e.g. pdf-lib-with-encrypt) are
//    abandoned and the encryption math is non-trivial — wrong
//    implementations have led to FOIA disclosures.
//  - qpdf is the reference implementation; Adobe engineers cite
//    it in PDF spec discussions.
//
// Deployment note (CLAUDE.md):
//  Production VPS must have `qpdf` installed:
//    apt install -y qpdf
//  This route returns 503 with a clear message if the binary is
//  missing, so failures are loud and not silent.

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export interface PdfPermissions {
  /** Allow printing. 'full' = high-res, 'low' = low-res only, 'none' = no printing. */
  print?: 'full' | 'low' | 'none';
  /** Modification permissions. */
  modify?: 'all' | 'annotate' | 'form' | 'assembly' | 'none';
  /** Allow text/image extraction. */
  extract?: boolean;
  /** Required to be true for accessibility tools (screen readers). */
  accessibility?: boolean;
  /** Allow form field filling specifically. */
  fillForms?: boolean;
}

export interface EncryptOptions {
  userPassword?: string;          // Empty string = anyone can open
  ownerPassword?: string;         // Required to change permissions; auto-generated if absent
  bitLength?: 40 | 128 | 256;     // AES-256 by default (PDF 2.0)
  permissions?: PdfPermissions;
  /** When the user password is empty, viewers open the file without prompting,
   *  but permission flags still apply. Common for "view-only / no-copy" PDFs. */
}

const DEFAULT_PERMISSIONS: PdfPermissions = {
  print: 'full',
  modify: 'none',
  extract: false,
  accessibility: true,
  fillForms: false,
};

// Hard cap on input size — the route-level multer also caps at 50MB, but
// callers may invoke encryptPdf/decryptPdf directly. Don't write attacker-
// controlled bytes of unbounded size to a temp file.
const MAX_INPUT_BYTES = 100 * 1024 * 1024;

// Magic-byte sniff — PDFs start with "%PDF-" (0x25 0x50 0x44 0x46 0x2D).
// Refuse to spawn qpdf on anything that isn't a PDF; CodeQL flags
// fs.writeFile(untrustedBytes) (js/http-to-file-access) and this verifies
// the bytes are at least syntactically a PDF before they reach disk.
function assertIsPdfBuffer(input: Buffer): void {
  if (!Buffer.isBuffer(input)) {
    throw new Error('pdfEncrypt: input must be a Buffer');
  }
  if (input.length === 0 || input.length > MAX_INPUT_BYTES) {
    throw new Error(`pdfEncrypt: input size out of range (0 < n <= ${MAX_INPUT_BYTES})`);
  }
  if (input.length < 5
    || input[0] !== 0x25 || input[1] !== 0x50 || input[2] !== 0x44
    || input[3] !== 0x46 || input[4] !== 0x2D) {
    throw new Error('pdfEncrypt: input does not begin with %PDF- header');
  }
}

let qpdfAvailability: 'unknown' | 'present' | 'missing' = 'unknown';

/** Check whether qpdf is on PATH. Cached after the first probe. */
export async function isQpdfAvailable(): Promise<boolean> {
  if (qpdfAvailability !== 'unknown') return qpdfAvailability === 'present';
  return new Promise((resolve) => {
    const proc = spawn('qpdf', ['--version']);
    proc.on('error', () => { qpdfAvailability = 'missing'; resolve(false); });
    proc.on('exit', (code) => {
      qpdfAvailability = code === 0 ? 'present' : 'missing';
      resolve(qpdfAvailability === 'present');
    });
  });
}

function buildArgs(opts: EncryptOptions, inPath: string, outPath: string): string[] {
  const user = opts.userPassword ?? '';
  const owner = opts.ownerPassword ?? crypto.randomBytes(24).toString('base64url');
  const bits = opts.bitLength ?? 256;
  const perms = { ...DEFAULT_PERMISSIONS, ...(opts.permissions ?? {}) };

  const args: string[] = ['--encrypt', user, owner, String(bits)];

  // Permission flags (qpdf accepts these between user/owner/bits and the `--`).
  if (perms.print) args.push(`--print=${perms.print}`);
  if (perms.modify) args.push(`--modify=${perms.modify}`);
  if (perms.extract !== undefined) args.push(`--extract=${perms.extract ? 'y' : 'n'}`);
  if (perms.accessibility !== undefined) args.push(`--accessibility=${perms.accessibility ? 'y' : 'n'}`);
  if (perms.fillForms !== undefined) args.push(`--form=${perms.fillForms ? 'y' : 'n'}`);

  args.push('--', inPath, outPath);
  return args;
}

/**
 * Apply password + permission encryption to a PDF byte buffer.
 * Uses temp files because qpdf doesn't accept piped input/output for
 * the encrypt operation.
 */
export async function encryptPdf(input: Buffer, opts: EncryptOptions): Promise<Buffer> {
  assertIsPdfBuffer(input);
  if (!(await isQpdfAvailable())) {
    const err = new Error('qpdf is not installed on the server. Run `apt install -y qpdf` on the VPS.');
    (err as any).code = 'QPDF_MISSING';
    throw err;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmpg-pdfenc-'));
  const inPath = path.join(tmpDir, 'in.pdf');
  const outPath = path.join(tmpDir, 'out.pdf');

  try {
    await fs.writeFile(inPath, input);
    const args = buildArgs(opts, inPath, outPath);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('qpdf', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        // qpdf exit codes: 0 = ok, 3 = warnings only (still valid output)
        if (code === 0 || code === 3) resolve();
        else reject(new Error(`qpdf failed (exit ${code}): ${stderr.slice(0, 500)}`));
      });
    });

    return await fs.readFile(outPath);
  } finally {
    // Best-effort temp cleanup.
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Strip encryption from a PDF when the caller knows the owner password.
 * Useful for re-encrypting with a new policy.
 */
export async function decryptPdf(input: Buffer, password: string): Promise<Buffer> {
  assertIsPdfBuffer(input);
  if (!(await isQpdfAvailable())) {
    const err = new Error('qpdf is not installed on the server.');
    (err as any).code = 'QPDF_MISSING';
    throw err;
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmpg-pdfdec-'));
  const inPath = path.join(tmpDir, 'in.pdf');
  const outPath = path.join(tmpDir, 'out.pdf');
  try {
    await fs.writeFile(inPath, input);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('qpdf', [`--password=${password}`, '--decrypt', inPath, outPath]);
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0 || code === 3) resolve();
        else reject(new Error(`qpdf decrypt failed (exit ${code}): ${stderr.slice(0, 500)}`));
      });
    });
    return await fs.readFile(outPath);
  } finally {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
