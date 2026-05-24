// ============================================================
// RMPG Flex — document_folders (Cloudflare Worker)
// ============================================================
// Hierarchical folder browser backed by document_folders +
// attachments. Folders are pure-DB — actual file bytes live in
// R2 (UPLOADS bucket) via the attachments row. A file belongs
// to at most one folder via attachments.folder_id.
//
// Path layout: /<year>/<month>/<jobNumber - caseName>
// Built by ensureIntakeFolderPath() so a serve-intake job auto-
// files into the right year/month/case folder without the
// dispatcher creating the tree manually.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';

const folders = new Hono<Env>();

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ── Helper: ensure year/month/case folder path exists ──────────
// Exported so other routes (serve-intake) can call it directly.
// Idempotent — re-running with the same args returns the same id.
//
// Each level is upserted independently so a year/month already
// created during a prior intake doesn't fail.
export async function ensureIntakeFolderPath(
  db: ReturnType<typeof getDb>,
  userId: number,
  jobNumber: string,
  caseName: string,
  createdAt?: string,
): Promise<number> {
  const d = createdAt ? new Date(createdAt) : new Date();
  const year = String(d.getFullYear());
  const month = MONTHS[d.getMonth()];

  // 1. Year folder
  const yearPath = `/${year}`;
  let yearRow = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM document_folders WHERE folder_path = ?', yearPath,
  );
  if (!yearRow) {
    const r = await execute(
      db,
      `INSERT INTO document_folders (name, parent_id, folder_path, created_by)
       VALUES (?, NULL, ?, ?)`,
      year, yearPath, userId,
    );
    yearRow = { id: Number(r.meta.last_row_id) };
  }

  // 2. Month folder
  const monthPath = `/${year}/${month}`;
  let monthRow = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM document_folders WHERE folder_path = ?', monthPath,
  );
  if (!monthRow) {
    const r = await execute(
      db,
      `INSERT INTO document_folders (name, parent_id, folder_path, created_by)
       VALUES (?, ?, ?, ?)`,
      month, yearRow.id, monthPath, userId,
    );
    monthRow = { id: Number(r.meta.last_row_id) };
  }

  // 3. Case folder: "15752529 - Nyanah"
  const caseFolderName = `${jobNumber} - ${caseName}`.trim() || jobNumber || caseName || 'Untitled';
  const casePath = `/${year}/${month}/${caseFolderName}`;
  let caseRow = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM document_folders WHERE folder_path = ?', casePath,
  );
  if (!caseRow) {
    const r = await execute(
      db,
      `INSERT INTO document_folders (name, parent_id, folder_path, created_by)
       VALUES (?, ?, ?, ?)`,
      caseFolderName, monthRow.id, casePath, userId,
    );
    caseRow = { id: Number(r.meta.last_row_id) };
  }

  return caseRow.id;
}

// GET /api/documents/folders[?parent_id=N]
// Returns { folders, files, breadcrumbs }. parent_id absent =
// list root (year) folders, files=[].
folders.get('/folders', async (c) => {
  try {
    const db = getDb(c.env);
    const parentIdRaw = c.req.query('parent_id');
    const parentId = parentIdRaw ? parseInt(parentIdRaw, 10) : null;

    const folderRows = parentId
      ? await query<Record<string, unknown>>(
          db,
          `SELECT f.*,
                  (SELECT COUNT(*) FROM document_folders WHERE parent_id = f.id) as child_count,
                  (SELECT COUNT(*) FROM attachments WHERE folder_id = f.id) as file_count
           FROM document_folders f
           WHERE f.parent_id = ?
           ORDER BY f.name`,
          parentId,
        )
      : await query<Record<string, unknown>>(
          db,
          `SELECT f.*,
                  (SELECT COUNT(*) FROM document_folders WHERE parent_id = f.id) as child_count,
                  (SELECT COUNT(*) FROM attachments WHERE folder_id = f.id) as file_count
           FROM document_folders f
           WHERE f.parent_id IS NULL
           ORDER BY f.name DESC`,
        );

    const files = parentId
      ? await query<Record<string, unknown>>(
          db,
          'SELECT * FROM attachments WHERE folder_id = ? ORDER BY original_name',
          parentId,
        )
      : [];

    // Breadcrumb walk, bounded — protects against a corrupted
    // parent_id cycle creating an infinite loop on the Worker.
    const breadcrumbs: { id: number; name: string }[] = [];
    if (parentId) {
      let current = await queryFirst<{ id: number; name: string; parent_id: number | null }>(
        db, 'SELECT id, name, parent_id FROM document_folders WHERE id = ?', parentId,
      );
      let hops = 0;
      while (current && hops < 32) {
        breadcrumbs.unshift({ id: current.id, name: current.name });
        current = current.parent_id
          ? await queryFirst<{ id: number; name: string; parent_id: number | null }>(
              db, 'SELECT id, name, parent_id FROM document_folders WHERE id = ?', current.parent_id,
            )
          : null;
        hops++;
      }
    }

    return c.json({ folders: folderRows, files, breadcrumbs });
  } catch (err) {
    return c.json({
      error: 'Failed to list folders', code: 'LIST_FOLDERS_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// POST /api/documents/folders — create a new folder
folders.post('/folders', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json<{ name?: string; parent_id?: number | null }>();
    const { name, parent_id } = body || ({} as never);
    if (!name) return c.json({ error: 'Folder name required' }, 400);

    let parentPath = '';
    if (parent_id) {
      const parent = await queryFirst<{ folder_path: string }>(
        db, 'SELECT folder_path FROM document_folders WHERE id = ?', parent_id,
      );
      if (!parent) return c.json({ error: 'Parent folder not found' }, 404);
      parentPath = parent.folder_path;
    }
    const folderPath = `${parentPath}/${name}`;

    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM document_folders WHERE folder_path = ?', folderPath,
    );
    if (existing) return c.json({ error: 'Folder already exists' }, 409);

    const result = await execute(
      db,
      `INSERT INTO document_folders (name, parent_id, folder_path, created_by)
       VALUES (?, ?, ?, ?)`,
      name, parent_id ?? null, folderPath, userId ?? null,
    );
    return c.json(
      { success: true, id: Number(result.meta.last_row_id), folder_path: folderPath },
      201,
    );
  } catch (err) {
    return c.json({
      error: 'Failed to create folder', code: 'CREATE_FOLDER_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// PUT /api/documents/folders/:id — rename a folder, cascade the
// path change to every descendant via SQL REPLACE() on the
// folder_path prefix. Avoids reading every child into memory.
folders.put('/folders/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json<{ name?: string }>();
    const { name } = body || ({} as never);
    if (!name) return c.json({ error: 'New name required' }, 400);

    const folder = await queryFirst<{ folder_path: string }>(
      db, 'SELECT folder_path FROM document_folders WHERE id = ?', id,
    );
    if (!folder) return c.json({ error: 'Folder not found' }, 404);

    const oldPath = folder.folder_path;
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = `${parentPath}/${name}`;

    await execute(
      db,
      `UPDATE document_folders SET name = ?, folder_path = ?, updated_at = datetime('now') WHERE id = ?`,
      name, newPath, id,
    );
    // Cascade rename to descendants via path-prefix REPLACE.
    await execute(
      db,
      `UPDATE document_folders SET folder_path = REPLACE(folder_path, ?, ?), updated_at = datetime('now')
       WHERE folder_path LIKE ?`,
      oldPath + '/', newPath + '/', oldPath + '/%',
    );

    return c.json({ success: true });
  } catch (err) {
    return c.json({
      error: 'Failed to rename folder', code: 'RENAME_FOLDER_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// DELETE /api/documents/folders/:id — delete folder + descendants.
// Attachments are DETACHED (folder_id set NULL) rather than deleted
// — losing the folder shouldn't lose the file. The schema-level
// ON DELETE SET NULL on attachments.folder_id enforces this too,
// but we set explicitly so the behavior is obvious from the route.
folders.delete('/folders/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);

    // Detach files in THIS folder + every descendant in one statement
    // using the path-prefix scan. Cheaper than walking the tree.
    await execute(
      db,
      `UPDATE attachments SET folder_id = NULL
       WHERE folder_id IN (
         SELECT id FROM document_folders
         WHERE id = ? OR folder_path LIKE (
           SELECT folder_path || '/%' FROM document_folders WHERE id = ?
         )
       )`,
      id, id,
    );

    // Delete the folder + descendants. CASCADE on parent_id removes
    // children automatically, but the path-prefix predicate handles
    // the case where parent_id was ever broken (defensive).
    await execute(
      db,
      `DELETE FROM document_folders
       WHERE id = ? OR folder_path LIKE (
         SELECT folder_path || '/%' FROM document_folders WHERE id = ?
       )`,
      id, id,
    );

    return c.json({ success: true });
  } catch (err) {
    return c.json({
      error: 'Failed to delete folder', code: 'DELETE_FOLDER_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// POST /api/documents/folders/:id/move-file — file_id is the
// attachments.file_id UUID (not the row id). One-shot bucket move.
folders.post('/folders/:id/move-file', async (c) => {
  try {
    const db = getDb(c.env);
    const folderId = parseInt(c.req.param('id'), 10);
    const body = await c.req.json<{ file_id?: string }>();
    const { file_id } = body || ({} as never);
    if (!file_id) return c.json({ error: 'file_id required' }, 400);

    await execute(
      db, 'UPDATE attachments SET folder_id = ? WHERE file_id = ?', folderId, file_id,
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({
      error: 'Failed to move file', code: 'MOVE_FILE_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default folders;
