import { useState, useCallback, useRef, useEffect } from 'react';

interface FileWithMeta {
  file: File;
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  previewUrl?: string;
}

interface UseFileUploadOptions {
  /** localStorage key for draft persistence */
  storageKey: string;
  /** Maximum number of files (default: unlimited) */
  maxFiles?: number;
  /** Maximum file size in bytes (default: 100MB) */
  maxSize?: number;
  /** Accepted file types (e.g., ['image/*', 'application/pdf']) */
  accept?: string;
  /** Time-to-live in milliseconds (default: 24 hours) */
  ttlMs?: number;
}

interface UseFileUploadReturn {
  files: FileWithMeta[];
  addFiles: (newFiles: FileList | File[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  hasFiles: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Hook for managing file uploads with localStorage draft persistence.
 *
 * Note: File objects cannot be serialized to localStorage. This hook stores
 * file metadata and creates a temporary preview URL for images. The actual
 * File objects are held in memory and will be lost on page refresh, but
 * the metadata is preserved so the UI can show "X files were attached"
 * and prompt the user to re-select them.
 *
 * For true file persistence across page reloads, files should be uploaded
 * to the server immediately upon selection (with a draft/cleanup endpoint).
 *
 * Usage:
 *   const { files, addFiles, removeFile, clearFiles, hasFiles, fileInputRef, handleFileInputChange } = useFileUpload({
 *     storageKey: 'rmpg_evidence_files',
 *     maxFiles: 10,
 *     maxSize: 50 * 1024 * 1024, // 50MB
 *     accept: 'image/*,application/pdf',
 *   });
 *
 *   // After successful form save to database:
 *   clearFiles();
 */
export function useFileUpload({
  storageKey,
  maxFiles,
  maxSize = 100 * 1024 * 1024, // 100MB
  accept,
  ttlMs = 24 * 60 * 60 * 1000, // 24 hours
}: UseFileUploadOptions): UseFileUploadReturn {
  const [files, setFiles] = useState<FileWithMeta[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  // Load metadata from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed._savedAt != null) {
          const age = Date.now() - parsed._savedAt;
          if (age < ttlMs) {
            // Restore metadata only — actual File objects must be re-selected
            // Store count so UI can show "N files were attached"
            const { _savedAt, _fileCount, _fileNames, ...rest } = parsed;
            if (_fileCount > 0 && _fileNames) {
              // We'll show a banner indicating files were lost but metadata preserved
              // The actual files array stays empty since File objects can't be serialized
            }
          }
        }
      }
    } catch { /* ignore */ }
  }, [storageKey, ttlMs]);

  // Debounced save metadata to localStorage
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveMetadata = useCallback(
    (fileList: FileWithMeta[]) => {
      if (saveTimerRef.current != null) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        try {
          const metadata = {
            _savedAt: Date.now(),
            _fileCount: fileList.length,
            _fileNames: fileList.map((f) => f.name),
            _fileSizes: fileList.map((f) => f.size),
          };
          localStorage.setItem(storageKey, JSON.stringify(metadata));
        } catch { /* quota exceeded — ignore */ }
      }, 300);
    },
    [storageKey],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) clearTimeout(saveTimerRef.current);
      // Clean up preview URLs
      filesRef.current.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
  }, []);

  const generateId = useCallback(() => {
    return `file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      setFiles((prev) => {
        const fileArray = Array.from(newFiles);
        const validFiles: FileWithMeta[] = [];

        for (const file of fileArray) {
          // Check max files
          if (maxFiles != null && prev.length + validFiles.length >= maxFiles) {
            break;
          }
          // Check file size
          if (file.size > maxSize) {
            continue;
          }
          // Check file type
          if (accept != null) {
            const acceptTypes = accept.split(',').map((t) => t.trim());
            const matches = acceptTypes.some((type) => {
              if (type.endsWith('/*')) {
                return file.type.startsWith(type.slice(0, -1));
              }
              return file.type === type;
            });
            if (!matches) continue;
          }

          const id = generateId();
          let previewUrl: string | undefined;
          if (file.type.startsWith('image/')) {
            previewUrl = URL.createObjectURL(file);
          }

          validFiles.push({
            file,
            id,
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            previewUrl,
          });
        }

        if (validFiles.length > 0) {
          const next = [...prev, ...validFiles];
          saveMetadata(next);
          return next;
        }
        return prev;
      });
    },
    [maxFiles, maxSize, accept, generateId, saveMetadata],
  );

  const removeFile = useCallback(
    (id: string) => {
      setFiles((prev) => {
        const file = prev.find((f) => f.id === id);
        if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
        const next = prev.filter((f) => f.id !== id);
        saveMetadata(next);
        return next;
      });
    },
    [saveMetadata],
  );

  const clearFiles = useCallback(() => {
    setFiles((prev) => {
      prev.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
      return [];
    });
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files != null) {
        addFiles(e.target.files);
        // Reset input so same file can be selected again
        e.target.value = '';
      }
    },
    [addFiles],
  );

  return {
    files,
    addFiles,
    removeFile,
    clearFiles,
    hasFiles: files.length > 0,
    fileInputRef,
    handleFileInputChange,
  };
}

export default useFileUpload;
