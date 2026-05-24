// ============================================================
// RMPG Flex — Document Folders (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/documentFolders.ts. Hierarchical
// folder browser backed by document_folders + attachments. The
// ensureIntakeFolderPath helper used to be exported for serve-
// intake; on Workers, callers in -worker.ts routes can import
// it directly from this module.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Idempotent: builds /YYYY/Month/<jobNumber - caseName> path of folders,
// creating each level only if missing. Returns the leaf folder id.
// Exported so other worker routes (serve-intake) can call it directly.
export async function ensureIntakeFolderPath(
  db: D1Db,
  userId: number,
  jobNumber: string,
  caseName: string,
  createdAt?: string,
): Promise<number> {
  const now = localNow();
  const d = createdAt ? new Date(createdAt) : new Date();
  const year = String(d.getFullYear());
  const month = MONTHS[d.getMonth()];

  // 1. Year folder
  const yearPath = `/${year}`;
  let yearFolder = await db.prepare('SELECT id FROM document_folders WHERE folder_path = ?').get(yearPath) as any;
  if (!yearFolder) {
    const r = await db.prepare(
      'INSERT INTO document_folders (name, parent_id, folder_path, created_by, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)'
    ).run(year, yearPath, userId, now, now);
    yearFolder = { id: Number(r.meta.last_row_id) };
  }

  // 2. Month folder
  const monthPath = `/${year}/${month}`;
  let monthFolder = await db.prepare('SELECT id FROM document_folders WHERE folder_path = ?').get(monthPath) as any;
  if (!monthFolder) {
    const r = await db.prepare(
      'INSERT INTO document_folders (name, parent_id, folder_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(month, yearFolder.id, monthPath, userId, now, now);
    monthFolder = { id: Number(r.meta.last_row_id) };
  }

  // 3. Case folder
  const caseFolderName = `${jobNumber} - ${caseName}`.trim() || jobNumber || caseName || 'Untitled';
  const casePath = `/${year}/${month}/${caseFolderName}`;
  let caseFolder = await db.prepare('SELECT id FROM document_folders WHERE folder_path = ?').get(casePath) as any;
  if (!caseFolder) {
    const r = await db.prepare(
      'INSERT INTO document_folders (name, parent_id, folder_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(caseFolderName, monthFolder.id, casePath, userId, now, now);
    caseFolder = { id: Number(r.meta.last_row_id) };
  }

  return caseFolder.id;
}

export function mountDocumentFoldersRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // D1 migrations may not define document_folders. Self-heal at first request.
  let schemaReady = false;
  async function ensureSchema(db: D1Db): Promise<void> {
    if (schemaReady) return;
    try {
      await db.prepare(`CREATE TABLE IF NOT EXISTS document_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER,
        folder_path TEXT NOT NULL UNIQUE,
        created_by INTEGER,
        created_at TEXT,
        updated_at TEXT
      )`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id)`).run();
      schemaReady = true;
    } catch { /* non-fatal */ }
  }

  // GET /api/documents/folders — list root folders or children of parent_id.
  // Also returns files in the current folder + breadcrumb path for the UI.
  api.get('/folders', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await ensureSchema(db);
      const parentIdRaw = c.req.query('parent_id');
      const parentId = parentIdRaw ? parseInt(parentIdRaw, 10) : null;

      const folders = parentId
        ? await db.prepare(`
            SELECT f.*,
              (SELECT COUNT(*) FROM document_folders WHERE parent_id = f.id) as child_count,
              (SELECT COUNT(*) FROM attachments WHERE folder_id = f.id) as file_count
            FROM document_folders f WHERE f.parent_id = ? ORDER BY f.name
          `).all(parentId)
        : await db.prepare(`
            SELECT f.*,
              (SELECT COUNT(*) FROM document_folders WHERE parent_id = f.id) as child_count,
              (SELECT COUNT(*) FROM attachments WHERE folder_id = f.id) as file_count
            FROM document_folders f WHERE f.parent_id IS NULL ORDER BY f.name DESC
          `).all();

      const files = parentId
        ? await db.prepare('SELECT * FROM attachments WHERE folder_id = ? ORDER BY original_name').all(parentId)
        : [];

      // Breadcrumb walk — bounded loop (max 32 iterations) protects against
      // a corrupted parent_id cycle creating an infinite loop on the worker.
      const breadcrumbs: { id: number; name: string }[] = [];
      if (parentId) {
        let current = await db.prepare('SELECT id, name, parent_id FROM document_folders WHERE id = ?').get(parentId) as any;
        let hops = 0;
        while (current && hops < 32) {
          breadcrumbs.unshift({ id: current.id, name: current.name });
          current = current.parent_id
            ? await db.prepare('SELECT id, name, parent_id FROM document_folders WHERE id = ?').get(current.parent_id) as any
            : null;
          hops++;
        }
      }

      return c.json({ folders, files, breadcrumbs });
    } catch (err: any) {
      return c.json({ error: 'Failed to list folders', code: 'LIST_FOLDERS_ERROR', detail: err?.message }, 500);
    }
  });

  // POST /api/documents/folders — create a new folder
  api.post('/folders', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await ensureSchema(db);
      const user = c.get('user');
      const body = await c.req.json<any>();
      const { name, parent_id } = body || {};
      if (!name) return c.json({ error: 'Folder name required', code: 'NAME_REQUIRED' }, 400);

      let parentPath = '';
      if (parent_id) {
        const parent = await db.prepare('SELECT folder_path FROM document_folders WHERE id = ?').get(parent_id) as any;
        if (!parent) return c.json({ error: 'Parent folder not found', code: 'PARENT_NOT_FOUND' }, 404);
        parentPath = parent.folder_path;
      }
      const folderPath = `${parentPath}/${name}`;

      const existing = await db.prepare('SELECT id FROM document_folders WHERE folder_path = ?').get(folderPath);
      if (existing) return c.json({ error: 'Folder already exists', code: 'FOLDER_EXISTS' }, 409);

      const now = localNow();
      const result = await db.prepare(
        'INSERT INTO document_folders (name, parent_id, folder_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(name, parent_id || null, folderPath, user?.userId ?? null, now, now);

      return c.json({ success: true, id: Number(result.meta.last_row_id), folder_path: folderPath });
    } catch (err: any) {
      return c.json({ error: 'Failed to create folder', code: 'CREATE_FOLDER_ERROR', detail: err?.message }, 500);
    }
  });

  // PUT /api/documents/folders/:id — rename a folder, cascading the path change
  // to every descendant via SQL REPLACE() on the folder_path prefix.
  api.put('/folders/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json<any>();
      const { name } = body || {};
      if (!name) return c.json({ error: 'New name required', code: 'NAME_REQUIRED' }, 400);

      const folder = await db.prepare('SELECT * FROM document_folders WHERE id = ?').get(id) as any;
      if (!folder) return c.json({ error: 'Folder not found', code: 'FOLDER_NOT_FOUND' }, 404);

      const oldPath = folder.folder_path as string;
      const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
      const newPath = `${parentPath}/${name}`;
      const now = localNow();

      await db.prepare('UPDATE document_folders SET name = ?, folder_path = ?, updated_at = ? WHERE id = ?')
        .run(name, newPath, now, id);
      await db.prepare(
        `UPDATE document_folders SET folder_path = REPLACE(folder_path, ?, ?), updated_at = ? WHERE folder_path LIKE ?`
      ).run(oldPath + '/', newPath + '/', now, oldPath + '/%');

      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to rename folder', code: 'RENAME_FOLDER_ERROR', detail: err?.message }, 500);
    }
  });

  // DELETE /api/documents/folders/:id — delete folder + descendants;
  // attachments are detached (folder_id → NULL), not deleted.
  api.delete('/folders/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));

      // Unlink files in this folder
      await db.prepare('UPDATE attachments SET folder_id = NULL WHERE folder_id = ?').run(id);
      // Unlink files in descendant folders (path-prefix scan)
      const childIds = await db.prepare(
        `SELECT id FROM document_folders WHERE folder_path LIKE (SELECT folder_path || '/%' FROM document_folders WHERE id = ?)`
      ).all(id) as any[];
      for (const child of childIds) {
        await db.prepare('UPDATE attachments SET folder_id = NULL WHERE folder_id = ?').run(child.id);
      }

      // Delete folder + descendants
      await db.prepare(
        `DELETE FROM document_folders WHERE id = ? OR folder_path LIKE (SELECT folder_path || '/%' FROM document_folders WHERE id = ?)`
      ).run(id, id);

      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to delete folder', code: 'DELETE_FOLDER_ERROR', detail: err?.message }, 500);
    }
  });

  // POST /api/documents/folders/:id/move-file — move a file into a folder
  api.post('/folders/:id/move-file', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const folderId = paramNum(c.req.param('id'));
      const body = await c.req.json<any>();
      const { file_id } = body || {};
      if (!file_id) return c.json({ error: 'file_id required', code: 'FILE_ID_REQUIRED' }, 400);

      await db.prepare('UPDATE attachments SET folder_id = ? WHERE file_id = ?').run(folderId, file_id);
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to move file', code: 'MOVE_FILE_ERROR', detail: err?.message }, 500);
    }
  });

  app.route('/api/documents', api);
}
