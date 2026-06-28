// ============================================================
// Drag-and-drop folder traversal helpers.
//
// Browsers expose dropped folders via the non-standard
// FileSystemEntry / FileSystemDirectoryEntry / FileSystemFileEntry
// interfaces returned by DataTransferItem.webkitGetAsEntry().
//
// Use case: dispatcher drops multiple folders onto the serve intake
// upload zone — each folder becomes its own intake "job" so several
// jobs can be queued in one drop. Plain files (not in a folder) are
// grouped under the synthetic name "(loose files)".
// ============================================================

export interface FolderGroup {
  /** Display name for the job — folder name, or "(loose files)" for top-level files. */
  name: string;
  /** Files within the folder, with relative paths preserved for context. */
  files: File[];
}

/**
 * Walk a single FileSystemEntry recursively and append every file found
 * (subject to optional accept-extension filter).
 */
async function walkEntry(entry: any, files: File[], accept?: (file: File) => boolean): Promise<void> {
  if (!entry) return;
  if (entry.isFile) {
    await new Promise<void>((resolve) => {
      entry.file(
        (file: File) => {
          if (!accept || accept(file)) files.push(file);
          resolve();
        },
        () => resolve(),
      );
    });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const children: any[] = await new Promise((resolve) => {
      const all: any[] = [];
      const readBatch = () => {
        reader.readEntries(
          (batch: any[]) => {
            if (batch.length === 0) resolve(all);
            else { all.push(...batch); readBatch(); }
          },
          () => resolve(all),
        );
      };
      readBatch();
    });
    for (const child of children) {
      await walkEntry(child, files, accept);
    }
  }
}

/**
 * Extract folder groups from a drag-drop DataTransfer.
 *
 * Each top-level folder in the drop becomes its own group (= its own job).
 * Top-level loose files are coalesced into a single "(loose files)" group.
 *
 * Returns at least one group when any acceptable file is dropped.
 *
 * `accept` lets callers filter to e.g. PDF only (the serve-intake page does this).
 */
export async function extractFolderGroups(
  dataTransfer: DataTransfer,
  accept?: (file: File) => boolean,
): Promise<FolderGroup[]> {
  const items = Array.from(dataTransfer.items || []);
  const groups: FolderGroup[] = [];
  const looseFiles: File[] = [];

  // Path 1: items with webkitGetAsEntry — supports folders.
  if (items.length > 0 && typeof (items[0] as any).webkitGetAsEntry === 'function') {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = (item as any).webkitGetAsEntry?.();
      if (!entry) continue;
      if (entry.isDirectory) {
        const folderFiles: File[] = [];
        await walkEntry(entry, folderFiles, accept);
        if (folderFiles.length > 0) {
          groups.push({ name: entry.name, files: folderFiles });
        }
      } else if (entry.isFile) {
        const file = item.getAsFile();
        if (file && (!accept || accept(file))) looseFiles.push(file);
      }
    }
  } else {
    // Path 2: plain DataTransfer.files (no folder support in this browser).
    for (const file of Array.from(dataTransfer.files || [])) {
      if (!accept || accept(file)) looseFiles.push(file);
    }
  }

  if (looseFiles.length > 0) {
    groups.unshift({ name: '(loose files)', files: looseFiles });
  }

  return groups;
}
