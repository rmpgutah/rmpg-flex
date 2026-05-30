---
name: new-route
description: Scaffold a new Express API route file following RMPG Flex patterns
---

# New Route Scaffolding

Create a new Express API route file following project conventions.

## Arguments

The user should provide:
- **name**: Route file name (e.g., "training", "equipment")
- **mount path**: API mount path (e.g., "/api/training")
- **roles**: Which roles can access (default: admin, officer)

## Template

Create the file at `server/src/routes/{name}.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

// GET all
router.get('/', requireRole('admin', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM {table} ORDER BY created_at DESC').all();
    res.json({ data: rows });
  } catch (error) {
    console.error('Get {name} error:', error);
    res.status(500).json({ error: 'Failed to get {name}', code: 'GET_{NAME}_ERROR' });
  }
});

// GET by ID
router.get('/:id', requireRole('admin', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM {table} WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (error) {
    console.error('Get {name} by id error:', error);
    res.status(500).json({ error: 'Failed to get {name}', code: 'GET_{NAME}_BY_ID_ERROR' });
  }
});

// POST create
router.post('/', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    // TODO: Insert logic
    // auditLog(req, 'CREATE', '{table}', id, null, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Create {name} error:', error);
    res.status(500).json({ error: 'Failed to create {name}', code: 'CREATE_{NAME}_ERROR' });
  }
});

export default router;
```

## After Creating the Route

1. **Register in `server/src/index.ts`**:
   ```typescript
   import {name}Routes from './routes/{name}';
   app.use('/api/{mount-path}', {name}Routes);
   ```

2. **Add database table** in `server/src/models/database.ts`:
   ```typescript
   db.prepare(`CREATE TABLE IF NOT EXISTS {table} (...)`).run();
   ```

3. **Add TypeScript types** in `client/src/types/index.ts` if the client needs them.
