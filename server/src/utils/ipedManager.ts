// ============================================================
// IPED Digital Forensics — Manager Utility
// ============================================================
// Manages IPED installation, hash computation (built-in + IPED),
// job processing, Web API proxy, and hash set operations.
// Two tiers: Tier 1 uses Node.js crypto (no deps), Tier 2 uses IPED CLI.
// ============================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execFileSync, ChildProcess, exec } from 'child_process';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import config from '../config';

// ── Types ───────────────────────────────────────────────────

export interface IpedConfig {
  installPath: string | null;
  javaHome: string | null;
  webApiUrl: string | null;
  webApiPort: string | null;
  defaultProfile: string;
  photodnaEnabled: boolean;
  autoHashOnUpload: boolean;
  hashSetsPath: string | null;
  configured: boolean;
  installed: boolean;
}

export interface IpedValidationResult {
  valid: boolean;
  ipedFound: boolean;
  ipedVersion: string | null;
  javaFound: boolean;
  javaVersion: string | null;
  platform: string;
  errors: string[];
}

export interface FileHashes {
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
}

export interface HashSetMatch {
  hashType: string;
  hashValue: string;
  setName: string;
  setCategory: string;
  confidence: number;
}

export interface IpedJobProgress {
  jobId: number;
  status: string;
  progressPercent: number;
  itemsFound: number;
  itemsProcessed: number;
}

export interface IpedProcessOpts {
  jobId: number;
  evidenceId?: number;
  inputPath: string;
  outputPath: string;
  profile?: string;
  jobType: 'hash' | 'process' | 'triage' | 'csam_scan';
  createdBy: number;
}

// ── Config Keys ─────────────────────────────────────────────

const CONFIG_KEYS = {
  installPath:      'iped_install_path',
  javaHome:         'iped_java_home',
  webApiUrl:        'iped_web_api_url',
  webApiPort:       'iped_web_api_port',
  defaultProfile:   'iped_default_profile',
  photodnaEnabled:  'iped_photodna_enabled',
  autoHashOnUpload: 'iped_auto_hash_on_upload',
  hashSetsPath:     'iped_hash_sets_path',
} as const;

// ── Encryption helpers (same as microbilt.ts / arrests.ts) ──

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(stored: string): string {
  const key = deriveKey();
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format — expected iv:authTag:ciphertext');
  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Config helpers ──────────────────────────────────────────

function getConfigValue(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

function setConfigValue(key: string, value: string, shouldEncrypt = false): void {
  const db = getDb();
  const now = localNow();
  const stored = shouldEncrypt ? encrypt(value) : value;

  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);

  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)"
  ).run(key, stored, now, now);
}

function deleteConfigValue(key: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);
}

// ── Public Config Functions ─────────────────────────────────

export function getIpedConfig(): IpedConfig {
  const installPath = getConfigValue(CONFIG_KEYS.installPath);
  const javaHome = getConfigValue(CONFIG_KEYS.javaHome);

  return {
    installPath,
    javaHome,
    webApiUrl: getConfigValue(CONFIG_KEYS.webApiUrl),
    webApiPort: getConfigValue(CONFIG_KEYS.webApiPort) || '8888',
    defaultProfile: getConfigValue(CONFIG_KEYS.defaultProfile) || 'forensic',
    photodnaEnabled: getConfigValue(CONFIG_KEYS.photodnaEnabled) === 'true',
    autoHashOnUpload: getConfigValue(CONFIG_KEYS.autoHashOnUpload) === 'true',
    hashSetsPath: getConfigValue(CONFIG_KEYS.hashSetsPath),
    configured: !!(installPath || javaHome),
    installed: !!installPath && fs.existsSync(installPath),
  };
}

export function setIpedConfigValues(values: Partial<Record<string, string>>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const configKey = (CONFIG_KEYS as any)[key];
    if (configKey) {
      setConfigValue(configKey, value);
    }
  }
}

export function clearIpedConfig(): void {
  Object.values(CONFIG_KEYS).forEach(key => deleteConfigValue(key));
}

// ── Platform Detection ──────────────────────────────────────

function getPlatform(): 'darwin' | 'win32' | 'linux' {
  return os.platform() as 'darwin' | 'win32' | 'linux';
}

function getJavaExecutable(javaHome: string): string {
  const platform = getPlatform();
  if (platform === 'darwin') {
    // macOS JDK structure: Contents/Home/bin/java
    const macPath = path.join(javaHome, 'Contents', 'Home', 'bin', 'java');
    if (fs.existsSync(macPath)) return macPath;
    return path.join(javaHome, 'bin', 'java');
  }
  return path.join(javaHome, 'bin', platform === 'win32' ? 'java.exe' : 'java');
}

function getIpedJar(installPath: string): string {
  const entries = fs.readdirSync(installPath).filter(f => f.match(/^iped.*\.jar$/i));
  if (entries.length > 0) return path.join(installPath, entries[0]);
  return path.join(installPath, 'iped.jar');
}

// ── Installation Validation ─────────────────────────────────

export function validateIpedInstallation(): IpedValidationResult {
  const cfg = getIpedConfig();
  const result: IpedValidationResult = {
    valid: false,
    ipedFound: false,
    ipedVersion: null,
    javaFound: false,
    javaVersion: null,
    platform: getPlatform(),
    errors: [],
  };

  // Check IPED installation
  if (!cfg.installPath) {
    result.errors.push('IPED installation path not configured');
  } else if (!fs.existsSync(cfg.installPath)) {
    result.errors.push(`IPED path does not exist: ${cfg.installPath}`);
  } else {
    const jarPath = getIpedJar(cfg.installPath);
    if (fs.existsSync(jarPath)) {
      result.ipedFound = true;
      // Try multiple sources for version: version.txt, ReleaseNotes.txt, parent dir name, JAR name
      const versionFile = path.join(cfg.installPath, 'version.txt');
      if (fs.existsSync(versionFile)) {
        result.ipedVersion = fs.readFileSync(versionFile, 'utf-8').trim();
      } else {
        const releaseNotes = path.join(cfg.installPath, 'ReleaseNotes.txt');
        if (fs.existsSync(releaseNotes)) {
          const firstLine = fs.readFileSync(releaseNotes, 'utf-8').split('\n')[0];
          const rnMatch = firstLine.match(/IPED[- ]?(\d+\.\d+\.\d+)/i);
          if (rnMatch) { result.ipedVersion = rnMatch[1]; }
        }
        if (!result.ipedVersion) {
          // Try parent directory name (e.g., iped-4.3.0)
          const dirMatch = path.basename(cfg.installPath).match(/(\d+\.\d+\.\d+)/);
          const jarMatch = path.basename(jarPath).match(/(\d+\.\d+\.\d+)/);
          result.ipedVersion = dirMatch?.[1] || jarMatch?.[1] || 'unknown';
        }
      }
    } else {
      result.errors.push(`IPED JAR not found in: ${cfg.installPath}`);
    }
  }

  // Check Java — use execFileSync (safe, no shell injection)
  if (!cfg.javaHome) {
    result.errors.push('Java Home path not configured');
  } else {
    const javaExe = getJavaExecutable(cfg.javaHome);
    if (fs.existsSync(javaExe)) {
      result.javaFound = true;
      try {
        // Java 17+: --version writes to stdout; older: -version writes to stderr
        const stdout = execFileSync(javaExe, ['--version'], {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const match = (stdout || '').match(/(?:openjdk|java)\s+(\S+)/i);
        result.javaVersion = match ? match[1] : 'installed';
      } catch (err: any) {
        // Fallback for older Java or if --version fails
        try {
          const stderr = err?.stderr?.toString() || '';
          const match = stderr.match(/version "([^"]+)"/);
          if (match) {
            result.javaVersion = match[1];
          } else {
            // Try -version as last resort
            execFileSync(javaExe, ['-version'], { timeout: 5000, stdio: 'pipe' });
            result.javaVersion = 'installed';
          }
        } catch { result.javaVersion = 'installed'; }
      }
    } else {
      result.errors.push(`Java executable not found at: ${javaExe}`);
    }
  }

  result.valid = result.ipedFound && result.javaFound && result.errors.length === 0;
  return result;
}

// ── Tier 1: Built-in Hash Computation (no IPED needed) ──────

export function computeFileHashes(filePath: string): Promise<FileHashes> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }

    const md5 = crypto.createHash('md5');
    const sha1 = crypto.createHash('sha1');
    const sha256 = crypto.createHash('sha256');
    const sha512 = crypto.createHash('sha512');

    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => {
      md5.update(chunk);
      sha1.update(chunk);
      sha256.update(chunk);
      sha512.update(chunk);
    });
    stream.on('end', () => {
      resolve({
        md5: md5.digest('hex'),
        sha1: sha1.digest('hex'),
        sha256: sha256.digest('hex'),
        sha512: sha512.digest('hex'),
      });
    });
    stream.on('error', reject);
  });
}

/**
 * Compute a content fingerprint for similarity detection.
 * Uses multi-segment hashing as a lightweight perceptual hash approximation.
 */
export function computeContentFingerprint(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  const chunks: Buffer[] = [];
  const chunkSize = Math.max(1, Math.floor(buffer.length / 16));
  for (let i = 0; i < 16 && i * chunkSize < buffer.length; i++) {
    chunks.push(buffer.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, buffer.length)));
  }
  const segmentHashes = chunks.map(chunk => {
    return crypto.createHash('md5').update(chunk).digest('hex').substring(0, 4);
  });
  return segmentHashes.join('');
}

/**
 * Compute Hamming distance between two hex hash strings.
 */
export function hammingDistance(hash1: string, hash2: string): number {
  let distance = 0;
  const len = Math.min(hash1.length, hash2.length);
  for (let i = 0; i < len; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  distance += Math.abs(hash1.length - hash2.length);
  return distance;
}

/**
 * Hash all attachments for an evidence record (Tier 1 — built-in).
 */
export async function hashEvidenceAttachments(evidenceId: number): Promise<{
  hashed: number;
  errors: number;
  flagged: number;
}> {
  const db = getDb();
  const now = localNow();

  const attachments = db.prepare(`
    SELECT id, original_name, stored_name, file_path, mime_type, file_size
    FROM attachments
    WHERE entity_type = 'evidence' AND entity_id = ?
  `).all(evidenceId) as any[];

  let hashed = 0;
  let errors = 0;
  let flagged = 0;

  const uploadsDir = process.env.RMPG_UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');

  for (const att of attachments) {
    try {
      const existing = db.prepare(
        'SELECT id FROM digital_evidence_hashes WHERE evidence_id = ? AND attachment_id = ?'
      ).get(evidenceId, att.id) as any;

      if (existing) continue;

      const fullPath = path.join(uploadsDir, att.file_path);
      if (!fs.existsSync(fullPath)) { errors++; continue; }

      const hashes = await computeFileHashes(fullPath);
      let fingerprint: string | null = null;
      try { fingerprint = computeContentFingerprint(fullPath); } catch { /* non-critical */ }

      const matches = checkAgainstHashSets(hashes);
      const isMatch = matches.length > 0;
      if (isMatch) flagged++;

      db.prepare(`
        INSERT INTO digital_evidence_hashes
          (evidence_id, attachment_id, file_name, file_path, file_size, mime_type,
           md5, sha1, sha256, sha512, phash, dhash,
           hash_set_match, hash_set_name, hash_set_category, match_confidence,
           flagged, flag_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        evidenceId, att.id, att.original_name, att.file_path, att.file_size, att.mime_type,
        hashes.md5, hashes.sha1, hashes.sha256, hashes.sha512,
        fingerprint, null,
        isMatch ? 1 : 0,
        isMatch ? matches[0].setName : null,
        isMatch ? matches[0].setCategory : null,
        isMatch ? matches[0].confidence : null,
        isMatch ? 1 : 0,
        isMatch ? `Hash set match: ${matches[0].setName}` : null,
        now
      );
      hashed++;
    } catch (err) {
      console.error(`[IPED] Hash error for attachment ${att.id}:`, err);
      errors++;
    }
  }

  // Update evidence record counts
  const counts = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN flagged = 1 THEN 1 ELSE 0 END) as flaggedCount
    FROM digital_evidence_hashes WHERE evidence_id = ?
  `).get(evidenceId) as any;

  db.prepare('UPDATE evidence SET hash_count = ?, flagged_hash_count = ? WHERE id = ?')
    .run(counts?.total || 0, counts?.flaggedCount || 0, evidenceId);

  return { hashed, errors, flagged };
}

// ── Auto-Hash Single Attachment (called on upload) ──────────

/**
 * Automatically compute hashes for a single newly-uploaded evidence attachment,
 * check against loaded hash sets, and persist the results.
 */
export async function autoHashAttachment(
  attachmentId: number,
  evidenceId: number,
  filePath: string
): Promise<{ hashes: FileHashes; flagged: boolean; matchInfo: HashSetMatch | null }> {
  const db = getDb();
  const now = localNow();

  const hashes = await computeFileHashes(filePath);
  const matches = checkAgainstHashSets(hashes);
  const isMatch = matches.length > 0;
  const flagged = isMatch && matches[0].setCategory === 'known_bad';

  db.prepare(`
    INSERT INTO digital_evidence_hashes
      (evidence_id, attachment_id, file_name, file_path,
       md5, sha1, sha256, sha512,
       hash_set_match, hash_set_name, hash_set_category, match_confidence,
       flagged, flag_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidenceId,
    attachmentId,
    path.basename(filePath),
    filePath,
    hashes.md5, hashes.sha1, hashes.sha256, hashes.sha512,
    isMatch ? 1 : 0,
    isMatch ? matches[0].setName : null,
    isMatch ? matches[0].setCategory : null,
    isMatch ? matches[0].confidence : null,
    flagged ? 1 : 0,
    flagged ? `Hash set match: ${matches[0].setName}` : null,
    now
  );

  // Update evidence record: increment hash_count, flagged_hash_count, mark processed
  db.prepare(`
    UPDATE evidence
    SET hash_count = COALESCE(hash_count, 0) + 1,
        flagged_hash_count = COALESCE(flagged_hash_count, 0) + ?,
        iped_processed = 1
    WHERE id = ?
  `).run(flagged ? 1 : 0, evidenceId);

  return { hashes, flagged, matchInfo: isMatch ? matches[0] : null };
}

// ── Hash Set Management ─────────────────────────────────────

export function importHashSet(
  filePath: string, setName: string, category: string, hashType: string = 'md5'
): number {
  const db = getDb();
  const now = localNow();

  if (!fs.existsSync(filePath)) throw new Error(`Hash set file not found: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));

  db.exec(`
    CREATE TABLE IF NOT EXISTS hash_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_name TEXT NOT NULL,
      category TEXT NOT NULL,
      hash_type TEXT NOT NULL DEFAULT 'md5',
      hash_value TEXT NOT NULL,
      file_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_hash_sets_value ON hash_sets(hash_value);
    CREATE INDEX IF NOT EXISTS idx_hash_sets_name ON hash_sets(set_name);
  `);

  const insert = db.prepare(
    'INSERT INTO hash_sets (set_name, category, hash_type, hash_value, file_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const tx = db.transaction(() => {
    let count = 0;
    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim());
      const hashValue = parts[0]?.toLowerCase();
      const fileName = parts[1] || null;
      if (hashValue && hashValue.match(/^[a-f0-9]{32,128}$/)) {
        insert.run(setName, category, hashType, hashValue, fileName, now);
        count++;
      }
    }
    return count;
  });

  return tx();
}

export function checkAgainstHashSets(hashes: FileHashes): HashSetMatch[] {
  const db = getDb();
  const matches: HashSetMatch[] = [];

  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='hash_sets'"
    ).get();
    if (!tableExists) return matches;

    for (const [hashType, hashValue] of [['md5', hashes.md5], ['sha256', hashes.sha256]] as const) {
      if (!hashValue) continue;
      const rows = db.prepare(
        "SELECT DISTINCT set_name, category FROM hash_sets WHERE hash_type = ? AND hash_value = ?"
      ).all(hashType, hashValue.toLowerCase()) as any[];

      for (const m of rows) {
        matches.push({ hashType, hashValue, setName: m.set_name, setCategory: m.category, confidence: 1.0 });
      }
    }
  } catch { /* Hash sets not loaded */ }

  return matches;
}

export function getHashSetSummary(): { name: string; category: string; count: number }[] {
  const db = getDb();
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='hash_sets'"
    ).get();
    if (!tableExists) return [];

    return db.prepare(
      'SELECT set_name as name, category, COUNT(*) as count FROM hash_sets GROUP BY set_name, category'
    ).all() as any[];
  } catch { return []; }
}

export function removeHashSet(setName: string): number {
  const db = getDb();
  try {
    return db.prepare('DELETE FROM hash_sets WHERE set_name = ?').run(setName).changes;
  } catch { return 0; }
}

/**
 * Import a hash set file into IPED's native hash database using HashDBTool.
 * Supports: CSV, NSRL RDS v2/v3, ProjectVIC JSON, INTERPOL ICSE CSV.
 * The IPED hash database is used during case processing for hash lookups.
 */
export async function importToIpedHashDb(filePath: string): Promise<string> {
  const cfg = getIpedConfig();
  if (!cfg.installPath || !cfg.javaHome) {
    throw new Error('IPED not configured: set install path and Java home first');
  }

  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const javaExe = getJavaExecutable(cfg.javaHome);
  const hashDbJar = path.join(cfg.installPath, 'lib', 'iped-hashdb.jar');
  if (!fs.existsSync(hashDbJar)) throw new Error('iped-hashdb.jar not found');

  const hashDbPath = path.join(cfg.installPath, '..', 'hashdb', 'iped-hashes.db');
  const hashDbDir = path.dirname(hashDbPath);
  if (!fs.existsSync(hashDbDir)) fs.mkdirSync(hashDbDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const args = [
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '-jar', hashDbJar,
      '-d', filePath,
      '-o', hashDbPath,
    ];

    const child = spawn(javaExe, args, {
      env: { ...process.env, JAVA_HOME: cfg.javaHome! },
      cwd: cfg.installPath!,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[IPED HashDB] Import complete: ${filePath}`);
        resolve(stdout.trim());
      } else {
        reject(new Error(`HashDBTool failed (exit ${code}): ${stderr || stdout}`));
      }
    });
    child.on('error', (err) => reject(err));
  });
}

// ── Tier 2: IPED CLI Integration ────────────────────────────

const activeJobs = new Map<number, ChildProcess>();

/**
 * Build the Java classpath for IPED — includes iped.jar + all lib/*.jar files.
 * Required because we run iped.app.processing.Main directly (not through Bootstrap)
 * to avoid the StartUpControlClient crash that causes processing cancellation.
 */
function buildIpedClasspath(installPath: string): string {
  const separator = getPlatform() === 'win32' ? ';' : ':';
  const entries = [path.join(installPath, 'iped.jar')];

  const libDir = path.join(installPath, 'lib');
  if (fs.existsSync(libDir)) {
    const jars = fs.readdirSync(libDir).filter(f => f.endsWith('.jar'));
    entries.push(...jars.map(j => path.join(libDir, j)));
  }
  return entries.join(separator);
}

/**
 * Launch an IPED processing job via CLI.
 *
 * Uses shell exec to pipe stdin (sleep) to the Java process, preventing
 * IPED's interruptIfBootstrapDied() from canceling processing when
 * Main is called directly (not through Bootstrap).
 */
export async function runIpedProcess(opts: IpedProcessOpts): Promise<void> {
  const cfg = getIpedConfig();
  const db = getDb();
  const now = localNow();

  if (!cfg.installPath || !cfg.javaHome) {
    throw new Error('IPED not configured — set installation and Java paths first');
  }

  const validation = validateIpedInstallation();
  if (!validation.valid) {
    throw new Error(`IPED installation invalid: ${validation.errors.join(', ')}`);
  }

  const javaExe = getJavaExecutable(cfg.javaHome);
  const classpath = buildIpedClasspath(cfg.installPath);
  const rawProfile = opts.profile || cfg.defaultProfile || 'forensic';
  // Sanitize profile to prevent shell injection — only allow alphanumeric, dash, underscore
  const profile = rawProfile.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!profile) {
    throw new Error('Invalid IPED profile name — must contain only alphanumeric characters, dashes, or underscores');
  }

  db.prepare('UPDATE iped_jobs SET status = ?, started_at = ?, updated_at = ? WHERE id = ?')
    .run('running', now, now, opts.jobId);

  // Build the command — pipe stdin from sleep to keep IPED alive.
  // IPED's Main class monitors stdin to detect if the Bootstrap parent died;
  // without a live stdin pipe, it cancels processing immediately.
  // We call iped.app.processing.Main directly (bypassing Bootstrap) because
  // Bootstrap starts StartUpControlClient which crashes on Java 9+ due to
  // ClassLoader reflection that was removed in the module system.
  const escapePath = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
  const javaArgs = [
    '-Xmx2g',
    '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
    '--add-opens', 'java.base/java.lang.reflect=ALL-UNNAMED',
    '--add-opens', 'java.base/java.util=ALL-UNNAMED',
    `-Djava.library.path=${path.join(cfg.installPath, 'lib')}`,
    '-cp', escapePath(classpath),
    'iped.app.processing.Main',
    '-d', escapePath(opts.inputPath),
    '-o', escapePath(opts.outputPath),
    '-profile', escapePath(profile),
    '--nogui',
  ].join(' ');

  const fullCmd = `sleep 86400 | ${escapePath(javaExe)} ${javaArgs}`;

  return new Promise((resolve, reject) => {
    const child = exec(fullCmd, {
      env: { ...process.env, JAVA_HOME: cfg.javaHome! },
      cwd: cfg.installPath!,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for IPED output
    });

    activeJobs.set(opts.jobId, child);
    let stderr = '';

    child.stdout?.on('data', (data: string | Buffer) => {
      const text = data.toString();
      // Parse IPED progress: "Processing 5/5 (42%) 1GB/h Finish in ..."
      const progressMatch = text.match(/\((\d+)%\)/);
      if (progressMatch) {
        db.prepare('UPDATE iped_jobs SET progress_percent = ?, updated_at = ? WHERE id = ?')
          .run(parseInt(progressMatch[1], 10), localNow(), opts.jobId);
      }
      // Parse item counts: "Found 5 files" or "Total items found: 5"
      const foundMatch = text.match(/(?:Found|Total items found:?)\s+(\d+)/i);
      if (foundMatch) {
        db.prepare('UPDATE iped_jobs SET items_found = ?, updated_at = ? WHERE id = ?')
          .run(parseInt(foundMatch[1], 10), localNow(), opts.jobId);
      }
      // Parse "Total processed: N items"
      const processedMatch = text.match(/Total processed:\s+(\d+)/i);
      if (processedMatch) {
        db.prepare('UPDATE iped_jobs SET items_processed = ?, updated_at = ? WHERE id = ?')
          .run(parseInt(processedMatch[1], 10), localNow(), opts.jobId);
      }
      // Detect completion message
      if (text.includes('IPED finished') || text.includes('Finished')) {
        db.prepare('UPDATE iped_jobs SET progress_percent = 100, updated_at = ? WHERE id = ?')
          .run(localNow(), opts.jobId);
      }
    });

    child.stderr?.on('data', (data: string | Buffer) => {
      const text = data.toString();
      // Filter out NoSuchFieldException spam from StartUpControl
      if (!text.includes('NoSuchFieldException') && !text.includes('StartUpControl')) {
        stderr += text;
      }
    });

    child.on('close', (code) => {
      activeJobs.delete(opts.jobId);
      const endNow = localNow();
      if (code === 0) {
        db.prepare("UPDATE iped_jobs SET status = 'completed', completed_at = ?, progress_percent = 100, updated_at = ? WHERE id = ?")
          .run(endNow, endNow, opts.jobId);
        resolve();
      } else {
        db.prepare("UPDATE iped_jobs SET status = 'failed', completed_at = ?, error_message = ?, updated_at = ? WHERE id = ?")
          .run(endNow, (stderr.substring(0, 2000) || `Exit code: ${code}`).replace(/\/[^\s]+/g, '[path]').replace(/at\s+\S+\s+\([^)]+\)/g, '[stack]'), endNow, opts.jobId);
        reject(new Error(`IPED exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      activeJobs.delete(opts.jobId);
      const endNow = localNow();
      db.prepare("UPDATE iped_jobs SET status = 'failed', completed_at = ?, error_message = ?, updated_at = ? WHERE id = ?")
        .run(endNow, err.message, endNow, opts.jobId);
      reject(err);
    });
  });
}

export function cancelIpedJob(jobId: number): boolean {
  const child = activeJobs.get(jobId);
  if (child) {
    child.kill('SIGTERM');
    activeJobs.delete(jobId);
    const db = getDb();
    db.prepare("UPDATE iped_jobs SET status = 'cancelled', completed_at = ?, updated_at = ? WHERE id = ?")
      .run(localNow(), localNow(), jobId);
    return true;
  }
  return false;
}

export function getJobProgress(jobId: number): IpedJobProgress | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id as jobId, status, progress_percent as progressPercent,
           items_found as itemsFound, items_processed as itemsProcessed
    FROM iped_jobs WHERE id = ?
  `).get(jobId) as IpedJobProgress | undefined;
  return row || null;
}

// ── IPED Web API Proxy ──────────────────────────────────────

export async function proxyIpedApi(
  endpoint: string, method: string = 'GET', body?: any
): Promise<any> {
  const cfg = getIpedConfig();
  if (!cfg.webApiUrl) throw new Error('IPED Web API URL not configured');

  const port = cfg.webApiPort || '8888';
  const url = `${cfg.webApiUrl}:${port}${endpoint}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const fetchOpts: RequestInit = {
      method,
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    };

    if (body && method !== 'GET') {
      fetchOpts.headers = { ...fetchOpts.headers as any, 'Content-Type': 'application/json' };
      fetchOpts.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOpts);
    if (!response.ok) throw new Error(`IPED API ${response.status}: ${response.statusText}`);

    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? await response.json() : await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function testIpedApiConnection(): Promise<{ success: boolean; message: string; details?: any }> {
  const cfg = getIpedConfig();

  // Check if Web API URL is configured
  if (!cfg.webApiUrl) {
    return {
      success: false,
      message: 'IPED Web API URL not configured. Set the Web API URL (e.g., http://localhost) and port (default: 8888) in the configuration above, then save.',
    };
  }

  // Check if cases directory has processed cases
  const casesPath = '/opt/iped/cases';
  const sourcesPath = path.join(casesPath, 'sources.json');

  let hasCases = false;
  try {
    if (fs.existsSync(sourcesPath)) {
      const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
      hasCases = Array.isArray(sources) && sources.length > 0;
    }
  } catch { /* ignore */ }

  if (!hasCases) {
    return {
      success: false,
      message: 'No processed IPED cases found. The Web API requires at least one case processed with IPED before it can start. Process evidence first, then the Web API will serve the results.',
      details: { casesPath, hasCases: false },
    };
  }

  // Try actual connection
  try {
    await proxyIpedApi('/');
    return { success: true, message: 'IPED Web API connection successful' };
  } catch (err: any) {
    return {
      success: false,
      message: `Web API not reachable at ${cfg.webApiUrl}:${cfg.webApiPort || '8888'}. Ensure the iped-webapi service is running. Error: ${err.message}`,
      details: { url: `${cfg.webApiUrl}:${cfg.webApiPort || '8888'}` },
    };
  }
}

// ── Usage Statistics ────────────────────────────────────────

export function getIpedUsageStats() {
  const db = getDb();
  const jobs = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running
    FROM iped_jobs
  `).get() as any;

  const hashes = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN flagged = 1 THEN 1 ELSE 0 END) as flagged
    FROM digital_evidence_hashes
  `).get() as any;

  return {
    totalJobs: jobs?.total || 0,
    completedJobs: jobs?.completed || 0,
    failedJobs: jobs?.failed || 0,
    runningJobs: jobs?.running || 0,
    totalHashes: hashes?.total || 0,
    flaggedHashes: hashes?.flagged || 0,
    hashSetCount: getHashSetSummary().length,
  };
}

// ── File Integrity Verification ─────────────────────────────

export interface VerifyFileResult {
  match: boolean;
  hashId: number;
  fileName: string | null;
  original: { md5: string | null; sha1: string | null; sha256: string | null; sha512: string | null };
  current: { md5: string | null; sha1: string | null; sha256: string | null; sha512: string | null };
  mismatches: string[];
}

export interface VerifyEvidenceResult {
  evidenceId: number;
  totalFiles: number;
  passed: number;
  failed: number;
  results: VerifyFileResult[];
}

export interface DuplicateCluster {
  hash: string;
  hashType: 'md5';
  files: { id: number; fileName: string | null; evidenceId: number | null; evidenceNumber: string | null; createdAt: string | null }[];
}

/**
 * Verify the integrity of a single hashed file by recomputing its hashes
 * and comparing against the stored values.
 */
export async function verifyFileIntegrity(hashRowId: number): Promise<VerifyFileResult> {
  const db = getDb();

  const row = db.prepare(`
    SELECT id, evidence_id, attachment_id, file_name, file_path,
           md5, sha1, sha256, sha512
    FROM digital_evidence_hashes WHERE id = ?
  `).get(hashRowId) as any;

  if (!row) throw new Error(`Hash record not found: ${hashRowId}`);

  // Resolve the file path — try stored file_path first, then look up attachments table
  const uploadsDir = process.env.RMPG_UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');
  let filePath = row.file_path ? path.join(uploadsDir, row.file_path) : null;

  if (!filePath || !fs.existsSync(filePath)) {
    if (row.attachment_id) {
      const att = db.prepare('SELECT file_path FROM attachments WHERE id = ?').get(row.attachment_id) as any;
      if (att?.file_path) {
        filePath = path.join(uploadsDir, att.file_path);
      }
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`File not found for hash record ${hashRowId}: ${row.file_name || row.file_path}`);
  }

  const current = await computeFileHashes(filePath);
  const mismatches: string[] = [];

  if (row.md5 && current.md5 !== row.md5) mismatches.push('md5');
  if (row.sha1 && current.sha1 !== row.sha1) mismatches.push('sha1');
  if (row.sha256 && current.sha256 !== row.sha256) mismatches.push('sha256');
  if (row.sha512 && current.sha512 !== row.sha512) mismatches.push('sha512');

  return {
    match: mismatches.length === 0,
    hashId: row.id,
    fileName: row.file_name,
    original: { md5: row.md5, sha1: row.sha1, sha256: row.sha256, sha512: row.sha512 },
    current: { md5: current.md5, sha1: current.sha1, sha256: current.sha256, sha512: current.sha512 },
    mismatches,
  };
}

/**
 * Verify integrity of all hashed files for a given evidence record.
 */
export async function verifyEvidenceIntegrity(evidenceId: number): Promise<VerifyEvidenceResult> {
  const db = getDb();

  const rows = db.prepare(
    'SELECT id FROM digital_evidence_hashes WHERE evidence_id = ?'
  ).all(evidenceId) as { id: number }[];

  const results: VerifyFileResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await verifyFileIntegrity(row.id);
      results.push(result);
      if (result.match) passed++;
      else failed++;
    } catch (err: any) {
      results.push({
        match: false,
        hashId: row.id,
        fileName: null,
        original: { md5: null, sha1: null, sha256: null, sha512: null },
        current: { md5: null, sha1: null, sha256: null, sha512: null },
        mismatches: [`error: ${err.message}`],
      });
      failed++;
    }
  }

  return { evidenceId, totalFiles: rows.length, passed, failed, results };
}

// ── Duplicate Hash Detection ────────────────────────────────

/**
 * Find files with duplicate MD5 hashes across all evidence,
 * grouped into clusters with evidence details.
 */
export function findDuplicateHashes(): DuplicateCluster[] {
  const db = getDb();

  const dupes = db.prepare(`
    SELECT md5, COUNT(*) as count
    FROM digital_evidence_hashes
    WHERE md5 IS NOT NULL
    GROUP BY md5
    HAVING COUNT(*) > 1
  `).all() as { md5: string; count: number }[];

  const clusters: DuplicateCluster[] = [];

  for (const dupe of dupes) {
    const files = db.prepare(`
      SELECT deh.id, deh.file_name, deh.evidence_id, deh.created_at,
             e.evidence_number
      FROM digital_evidence_hashes deh
      LEFT JOIN evidence e ON e.id = deh.evidence_id
      WHERE deh.md5 = ?
    `).all(dupe.md5) as any[];

    clusters.push({
      hash: dupe.md5,
      hashType: 'md5',
      files: files.map(f => ({
        id: f.id,
        fileName: f.file_name,
        evidenceId: f.evidence_id,
        evidenceNumber: f.evidence_number || null,
        createdAt: f.created_at,
      })),
    });
  }

  return clusters;
}

// ── Enhanced Usage Statistics ────────────────────────────────

/**
 * Extended usage statistics including queue depth, processing speed,
 * 30-day history, and average processing time.
 */
export function getEnhancedUsageStats() {
  const db = getDb();
  const base = getIpedUsageStats();

  // Queue depth
  const queued = db.prepare(
    "SELECT COUNT(*) as count FROM iped_jobs WHERE status = 'queued'"
  ).get() as { count: number };

  // Processing speed for running jobs: items_processed / elapsed seconds
  const runningRows = db.prepare(`
    SELECT items_processed, started_at
    FROM iped_jobs
    WHERE status = 'running' AND started_at IS NOT NULL AND items_processed > 0
  `).all() as { items_processed: number; started_at: string }[];

  let processingSpeed: number | null = null;
  if (runningRows.length > 0) {
    const nowMs = Date.now();
    let totalFilesPerSec = 0;
    let count = 0;
    for (const row of runningRows) {
      const startedMs = new Date(row.started_at).getTime();
      const elapsedSec = (nowMs - startedMs) / 1000;
      if (elapsedSec > 0) {
        totalFilesPerSec += row.items_processed / elapsedSec;
        count++;
      }
    }
    if (count > 0) processingSpeed = Math.round((totalFilesPerSec / count) * 100) / 100;
  }

  // 30-day history of completed/failed per day
  const historyRows = db.prepare(`
    SELECT date(completed_at) as day, status, COUNT(*) as count
    FROM iped_jobs
    WHERE completed_at >= date('now', '-30 days')
    GROUP BY date(completed_at), status
    ORDER BY day
  `).all() as { day: string; status: string; count: number }[];

  // Average processing time in seconds for completed jobs
  const avgRow = db.prepare(`
    SELECT AVG(
      (julianday(completed_at) - julianday(started_at)) * 86400
    ) as avg_seconds
    FROM iped_jobs
    WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
  `).get() as { avg_seconds: number | null };

  return {
    ...base,
    queueDepth: queued?.count || 0,
    processingSpeed,
    history: historyRows,
    avgProcessingTime: avgRow?.avg_seconds != null ? Math.round(avgRow.avg_seconds) : null,
  };
}
