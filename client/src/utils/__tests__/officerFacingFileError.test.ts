import { describe, it, expect } from 'vitest';
import { officerFacingFileError } from '../officerFacingFileError';

describe('officerFacingFileError', () => {
  it('hides Worker secret-provisioning details', () => {
    expect(officerFacingFileError(
      new Error('FILE_ENCRYPTION_KEK is not set (wrangler secret put FILE_ENCRYPTION_KEK)'),
      'Upload failed',
    )).toBe('File storage is temporarily unavailable. Contact a supervisor.');
    expect(officerFacingFileError(new Error('ENCRYPTION_FAILED'), 'Upload failed'))
      .toBe('File storage is temporarily unavailable. Contact a supervisor.');
    expect(officerFacingFileError(new Error('Decryption failed — key may have changed'), 'Upload failed'))
      .toBe('File storage is temporarily unavailable. Contact a supervisor.');
  });

  it('passes through ordinary upload errors', () => {
    expect(officerFacingFileError(new Error('File type image/tiff is not allowed'), 'Upload failed'))
      .toBe('File type image/tiff is not allowed');
  });
});
