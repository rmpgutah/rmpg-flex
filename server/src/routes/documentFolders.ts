import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ── Helper: ensure year/month/case folder path exists ──
export function ensureIntakeFolderPath(
  db: ReturnType<typeof getDb>,
  userId: number,
  jobNumber: string,
  caseName: string,
  createdAt?: string,
): number {
  const now = localNow();
  const d = createdAt ? new Date(createdAt) : new Date();
  const year = String(d.getFullYear());
  const month = MONTHS[d.getMonth()];

  // 1. Year folder
  const yearPath = `/${year}`;
  let yearFolder = db.prepare('SELECT id FROM document_folders WHERE folder_path = ?').get(yearPath) as any;
  if (!yearFolder) {
    const r = db.prepare('INSERT INTO document_folders (name, parent_id, folder_path, created_by, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)').run(year, yearPath, userId, now, now);
    yearFolder = { id: Number(r.lastInsertRowid) };
  }

  // 2. Month folder
  const monthPath = `/${year}/${month}`;
  let monthFolder = db.prepare('SELECT id FROM document_folders WHERE folder_path = ?').get(monthPath) as any;
  if (!monthFolder) {
    const r = db.prepare('INSERT INTO document_folders (name, parent_id, folder_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(month, yearFolder.id, monthPath, userId, now, now);
    monthFolder = { id: Number(r.lastInsertRowid) };
  }

  // 3. Case folder: "15752529 - Nyanah"
  const caseFolderName = `${jobNumber} - ${caseName}`.trim() || jobNumber || caseName || 'Untitled';
  const casePath = `/${year}/${month}/${caseFolderName}`;
  let caseFolder = db.prepare('SELECT id FROM document_folders WHERE folder_path = ?').get(casePath) as any;
  if (!caseFolder) {
    const r = db.prepare('INSERT INTO document_folders (name, parent_id, folder_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(caseFolderName, monthFolder.id, casePath, userId, now, now);
    caseFolder = { id: Number(r.lastInsertRowid) };
  }

  return caseFolder.id;
}

// ── GET /api/documents/folders — List root or children of a folder ──
router.get('/folders', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const parentId = req.query.parent_id ? parseInt(req.query.parent_id as string, 10) : null;

    let folders: any[];
    if (parentId) {
      folders = db.prepare(`
        SELECT f.*,
          (SELECT COUNT(*) FROM document_folders WHERE parent_id = f.id) as child_count,
          (SELECT COUNT(*) FROM attachments WHERE folder_id = f.id) as file_count
        FROM document_folders f WHERE f.parent_id = ? ORDER BY f.name
      `).all(parentId);
    } else {
      // Root folders (year folders)
      folders = db.prepare(`
        SELECT f.*,
          (SELECT COUNT(*) FROM document_folders WHERE parent_id = f.id) as child_count,
          (SELECT COUNT(*) FROM attachments WHERE folder_id = f.id) as file_count
        FROM document_folders f WHERE f.parent_id IS NULL ORDER BY f.name DESC
      `).all();
    }

    // Also get files in the current folder
    const files = parentId
      ? db.prepare('SELECT * FROM attachments WHERE folder_id = ? ORDER BY original_name').all(parentId)
      : [];

    // Get breadcrumb path
    const breadcrumbs: { id: number; name: string }[] = [];
    if (parentId) {
      let current = db.prepare('SELECT id, name, parent_id FROM document_folders WHERE id = ?').get(parentId) as any;
      while (current) {
        breadcrumbs.unshift({ id: current.id, name: current.name });
        current = current.parent_id
          ? db.prepare('SELECT id, name, parent_id FROM document_folders WHERE id = ?').get(current.parent_id) as any
          : null;
      }
    }

    res.json({ folders, files, breadcrumbs });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list folders: ' + err.message });
  }
});

// ── POST /api/documents/folders — Create a new folder ──
router.post('/folders', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, parent_id } = req.body;
    if (!name) { res.status(400).json({ error: 'Folder name required' }); return; }

    const now = localNow();
    let parentPath = '';
    if (parent_id) {
      const parent = db.prepare('SELECT folder_path FROM document_folders WHERE id = ?').get(parent_id) as any;
      if (!parent) { res.status(404).json({ error: 'Parent folder not found' }); return; }
      parentPath = parent.folder_path;
    }
    const folderPath = `${parentPath}/${name}`;

    const existing = db.prepare('SELECT id FROM document_folders WHERE folder_path = ?').get(folderPath);
    if (existing) { res.status(409).json({ error: 'Folder already exists' }); return; }

    const result = db.prepare('INSERT INTO document_folders (name, parent_id, folder_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, parent_id || null, folderPath, req.user!.userId, now, now);

    res.json({ success: true, id: result.lastInsertRowid, folder_path: folderPath });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create folder: ' + err.message });
  }
});

// ── PUT /api/documents/folders/:id — Rename a folder ──
router.put('/folders/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: 'New name required' }); return; }

    const folder = db.prepare('SELECT * FROM document_folders WHERE id = ?').get(id) as any;
    if (!folder) { res.status(404).json({ error: 'Folder not found' }); return; }

    const oldPath = folder.folder_path;
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = `${parentPath}/${name}`;
    const now = localNow();

    // Update this folder and all children's paths
    db.prepare('UPDATE document_folders SET name = ?, folder_path = ?, updated_at = ? WHERE id = ?').run(name, newPath, now, id);
    // Update child paths (replace old prefix with new)
    db.prepare("UPDATE document_folders SET folder_path = REPLACE(folder_path, ?, ?), updated_at = ? WHERE folder_path LIKE ?")
      .run(oldPath + '/', newPath + '/', now, oldPath + '/%');

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to rename folder: ' + err.message });
  }
});

// ── DELETE /api/documents/folders/:id — Delete a folder (CASCADE deletes children) ──
router.delete('/folders/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);

    // Unlink files from this folder (don't delete the actual files)
    db.prepare('UPDATE attachments SET folder_id = NULL WHERE folder_id = ?').run(id);
    // Also unlink files from child folders
    const childIds = db.prepare('SELECT id FROM document_folders WHERE folder_path LIKE (SELECT folder_path || \'/%\' FROM document_folders WHERE id = ?)').all(id) as any[];
    for (const child of childIds) {
      db.prepare('UPDATE attachments SET folder_id = NULL WHERE folder_id = ?').run(child.id);
    }

    // Delete folder + children (CASCADE)
    db.prepare('DELETE FROM document_folders WHERE id = ?').run(id);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete folder: ' + err.message });
  }
});

// ── POST /api/documents/folders/:id/move-file — Move a file into a folder ──
router.post('/folders/:id/move-file', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const folderId = parseInt(req.params.id, 10);
    const { file_id } = req.body;
    if (!file_id) { res.status(400).json({ error: 'file_id required' }); return; }

    db.prepare('UPDATE attachments SET folder_id = ? WHERE file_id = ?').run(folderId, file_id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to move file: ' + err.message });
  }
});

export default router;
