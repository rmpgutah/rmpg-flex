// ============================================================
// RMPG Flex — Evidence Archiver (archiver)
// ============================================================
// Creates ZIP/TAR packages of evidence files for case export,
// prosecutor disclosure, court submission, and long-term
// archival. Includes manifest, chain-of-custody metadata,
// and integrity checksums.
// ============================================================

import archiver from 'archiver';
import { Writable } from 'stream';
import crypto from 'crypto';
import { logger } from './logger';

// ── Types ─────────────────────────────────────────────────

export interface EvidenceFile {
  /** Display filename in the archive */
  name: string;
  /** File content as Buffer */
  content: Buffer;
  /** MIME type */
  mimeType?: string;
  /** Original evidence ID for manifest */
  evidenceId?: string;
  /** Description/notes */
  description?: string;
}

export interface ArchiveManifest {
  caseNumber: string;
  exportDate: string;
  exportedBy: string;
  agency: string;
  fileCount: number;
  files: Array<{
    name: string;
    size: number;
    sha256: string;
    evidenceId?: string;
    description?: string;
  }>;
  integrityHash: string;
}

export interface ArchiveOptions {
  /** Case number for manifest */
  caseNumber: string;
  /** Officer/user who created the export */
  exportedBy: string;
  /** Format: 'zip' or 'tar' */
  format?: 'zip' | 'tar';
  /** Compression level (0-9, default 6) */
  compressionLevel?: number;
  /** Include chain-of-custody manifest */
  includeManifest?: boolean;
  /** Include README with instructions */
  includeReadme?: boolean;
}

// ── Core functions ────────────────────────────────────────

/**
 * Create a ZIP/TAR archive of evidence files with chain-of-custody manifest.
 * Returns the archive as a Buffer.
 */
export async function createEvidenceArchive(
  files: EvidenceFile[],
  options: ArchiveOptions
): Promise<Buffer> {
  const {
    caseNumber,
    exportedBy,
    format = 'zip',
    compressionLevel = 6,
    includeManifest = true,
    includeReadme = true,
  } = options;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });

    const archive = archiver(format, {
      zlib: { level: compressionLevel },
    });

    archive.on('error', (err) => {
      logger.error({ err, caseNumber }, 'Evidence archive creation failed');
      reject(err);
    });

    output.on('finish', () => {
      const result = Buffer.concat(chunks);
      logger.info({ caseNumber, files: files.length, size: result.length },
        'Evidence archive created');
      resolve(result);
    });

    archive.pipe(output);

    // Build manifest as we add files
    const manifestFiles: ArchiveManifest['files'] = [];

    // Add each evidence file
    for (const file of files) {
      const sha256 = crypto.createHash('sha256').update(file.content).digest('hex');
      archive.append(file.content, { name: `evidence/${file.name}` });
      manifestFiles.push({
        name: file.name,
        size: file.content.length,
        sha256,
        evidenceId: file.evidenceId,
        description: file.description,
      });
    }

    // Create manifest
    if (includeManifest) {
      const manifest: ArchiveManifest = {
        caseNumber,
        exportDate: new Date().toISOString(),
        exportedBy,
        agency: 'Rocky Mountain Protective Group',
        fileCount: files.length,
        files: manifestFiles,
        integrityHash: '', // Set below
      };

      // Calculate integrity hash over all file hashes
      const allHashes = manifestFiles.map(f => f.sha256).sort().join('|');
      manifest.integrityHash = crypto.createHash('sha256').update(allHashes).digest('hex');

      const manifestJson = JSON.stringify(manifest, null, 2);
      archive.append(manifestJson, { name: 'MANIFEST.json' });
    }

    // Add README
    if (includeReadme) {
      const readme = generateReadme(caseNumber, exportedBy, files.length);
      archive.append(readme, { name: 'README.txt' });
    }

    archive.finalize();
  });
}

// ── Helpers ───────────────────────────────────────────────

function generateReadme(caseNumber: string, exportedBy: string, fileCount: number): string {
  return `EVIDENCE PACKAGE — ${caseNumber}
${'='.repeat(50)}

Agency:      Rocky Mountain Protective Group
Case Number: ${caseNumber}
Exported By: ${exportedBy}
Export Date:  ${new Date().toISOString()}
File Count:  ${fileCount}

CONTENTS
--------
evidence/     — Original evidence files
MANIFEST.json — Chain-of-custody metadata with SHA-256 checksums

INTEGRITY VERIFICATION
----------------------
Each file's SHA-256 hash is recorded in MANIFEST.json.
To verify integrity:

  1. Compute SHA-256 of each file in evidence/
  2. Compare against the sha256 values in MANIFEST.json
  3. The integrityHash field is SHA-256 of all sorted file hashes

LEGAL NOTICE
------------
This evidence package is the property of Rocky Mountain Protective Group
and is intended for authorized law enforcement and legal use only.
Unauthorized access, distribution, or tampering may violate federal
and state laws including 18 U.S.C. § 1030 (CFAA).

Generated by RMPG Flex CAD/RMS
`;
}
