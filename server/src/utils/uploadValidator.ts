// File upload validation utility

interface UploadValidation {
  valid: boolean;
  error?: string;
}

/** Allowed MIME types by category */
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  spreadsheet: [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'],
};

/** Maximum file sizes by category (in bytes) */
const MAX_FILE_SIZES: Record<string, number> = {
  image: 10 * 1024 * 1024, // 10 MB
  document: 50 * 1024 * 1024, // 50 MB
  spreadsheet: 25 * 1024 * 1024, // 25 MB
  video: 500 * 1024 * 1024, // 500 MB
  audio: 50 * 1024 * 1024, // 50 MB
};

/** Validate a file upload */
export function validateUpload(
  filename: string,
  mimeType: string,
  size: number,
  allowedCategories: string[] = ['image', 'document', 'spreadsheet']
): UploadValidation {
  if (!filename || typeof filename !== 'string') {
    return { valid: false, error: 'Filename is required' };
  }

  // Check for path traversal in filename
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return { valid: false, error: 'Invalid filename' };
  }

  // Check for null bytes
  if (filename.includes('\0')) {
    return { valid: false, error: 'Invalid filename (null byte detected)' };
  }

  // Validate MIME type
  const allowed = allowedCategories.flatMap((cat) => ALLOWED_MIME_TYPES[cat] || []);
  if (allowed.length > 0 && !allowed.includes(mimeType)) {
    return { valid: false, error: `File type ${mimeType} is not allowed` };
  }

  // Validate file size
  for (const cat of allowedCategories) {
    const maxSize = MAX_FILE_SIZES[cat];
    if (maxSize && size > maxSize) {
      return {
        valid: false,
        error: `File size ${Math.round(size / 1024 / 1024)}MB exceeds maximum of ${Math.round(maxSize / 1024 / 1024)}MB`,
      };
    }
  }

  // Check for dangerous extensions
  const dangerousExtensions = [
    '.exe',
    '.bat',
    '.cmd',
    '.com',
    '.msi',
    '.scr',
    '.pif',
    '.vbs',
    '.js',
    '.wsf',
    '.ps1',
    '.sh',
  ];
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  if (dangerousExtensions.includes(ext)) {
    return { valid: false, error: `File extension ${ext} is not allowed` };
  }

  return { valid: true };
}

/** Get the file category from MIME type */
export function getFileCategory(mimeType: string): string | null {
  for (const [category, types] of Object.entries(ALLOWED_MIME_TYPES)) {
    if (types.includes(mimeType)) return category;
  }
  return null;
}

/** Generate a safe filename for storage */
export function safeFilename(original: string): string {
  const parts = original.split('.');
  const ext = parts.length > 1 ? `.${parts.pop()!.toLowerCase()}` : '';
  const base = parts.join('.').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  const timestamp = Date.now();
  return `${base}_${timestamp}${ext}`;
}
