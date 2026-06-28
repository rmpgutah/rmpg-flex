import { describe, it, expect, vi } from 'vitest';
import {
  sendSuccess,
  sendPaginated,
  sendError,
  sendValidationError,
  sendNotFound,
  sendCreated,
  asyncHandler,
} from '../../src/utils/apiResponse';

// ── Helper to create mock Express Response ──────────────
function mockRes() {
  const res: any = {
    statusCode: 200,
    _json: null,
    headersSent: false,
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((data: any) => {
    res._json = data;
    return res;
  });
  return res;
}

// ────────────────────────────────────────────────────────
// sendSuccess
// ────────────────────────────────────────────────────────
describe('sendSuccess', () => {
  it('sends 200 status with data by default', () => {
    const res = mockRes();
    sendSuccess(res, { id: 1, name: 'Test' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._json).toEqual({ id: 1, name: 'Test' });
  });

  it('sends custom status code', () => {
    const res = mockRes();
    sendSuccess(res, { id: 1 }, 201);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('handles null data', () => {
    const res = mockRes();
    sendSuccess(res, null);
    expect(res._json).toBeNull();
  });

  it('handles array data', () => {
    const res = mockRes();
    sendSuccess(res, [1, 2, 3]);
    expect(res._json).toEqual([1, 2, 3]);
  });
});

// ────────────────────────────────────────────────────────
// sendPaginated
// ────────────────────────────────────────────────────────
describe('sendPaginated', () => {
  it('includes data and pagination with computed totalPages', () => {
    const res = mockRes();
    const items = [{ id: 1 }, { id: 2 }];
    sendPaginated(res, items, { page: 1, limit: 25, total: 50 });
    expect(res._json.data).toEqual(items);
    expect(res._json.pagination).toEqual({
      page: 1,
      limit: 25,
      total: 50,
      totalPages: 2,
    });
  });

  it('correctly computes totalPages with remainder', () => {
    const res = mockRes();
    sendPaginated(res, [], { page: 1, limit: 25, total: 51 });
    expect(res._json.pagination.totalPages).toBe(3); // ceil(51/25) = 3
  });

  it('returns 1 page when total is less than limit', () => {
    const res = mockRes();
    sendPaginated(res, [{ id: 1 }], { page: 1, limit: 25, total: 1 });
    expect(res._json.pagination.totalPages).toBe(1);
  });

  it('returns 0 pages when total is 0', () => {
    const res = mockRes();
    sendPaginated(res, [], { page: 1, limit: 25, total: 0 });
    expect(res._json.pagination.totalPages).toBe(0);
  });
});

// ────────────────────────────────────────────────────────
// sendError
// ────────────────────────────────────────────────────────
describe('sendError', () => {
  it('sends 500 by default', () => {
    const res = mockRes();
    sendError(res, 'Something went wrong');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._json.error).toBe('Something went wrong');
  });

  it('sends custom status code', () => {
    const res = mockRes();
    sendError(res, 'Not found', 404);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('includes details when provided', () => {
    const res = mockRes();
    sendError(res, 'Validation failed', 400, { fields: { name: 'Required' } });
    expect(res._json.details).toEqual({ fields: { name: 'Required' } });
  });

  it('does not include details key when not provided', () => {
    const res = mockRes();
    sendError(res, 'Error');
    expect(res._json).not.toHaveProperty('details');
  });
});

// ────────────────────────────────────────────────────────
// sendValidationError
// ────────────────────────────────────────────────────────
describe('sendValidationError', () => {
  it('sends 400 with validation error structure', () => {
    const res = mockRes();
    sendValidationError(res, {
      name: 'Required',
      email: 'Invalid format',
    });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toBe('Validation failed');
    expect(res._json.fields).toEqual({
      name: 'Required',
      email: 'Invalid format',
    });
  });
});

// ────────────────────────────────────────────────────────
// sendNotFound
// ────────────────────────────────────────────────────────
describe('sendNotFound', () => {
  it('sends 404 with default entity name', () => {
    const res = mockRes();
    sendNotFound(res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res._json.error).toBe('Resource not found');
  });

  it('sends 404 with custom entity name', () => {
    const res = mockRes();
    sendNotFound(res, 'Warrant');
    expect(res._json.error).toBe('Warrant not found');
  });
});

// ────────────────────────────────────────────────────────
// sendCreated
// ────────────────────────────────────────────────────────
describe('sendCreated', () => {
  it('sends 201 with data', () => {
    const res = mockRes();
    sendCreated(res, { id: 42, name: 'New Warrant' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res._json).toEqual({ id: 42, name: 'New Warrant' });
  });
});

// ────────────────────────────────────────────────────────
// asyncHandler
// ────────────────────────────────────────────────────────
describe('asyncHandler', () => {
  it('calls the wrapped function normally on success', async () => {
    const fn = vi.fn(async (_req: any, res: any) => {
      res.json({ ok: true });
    });
    const wrapped = asyncHandler(fn);
    const req = { method: 'GET', path: '/test' };
    const res = mockRes();
    const next = vi.fn();

    wrapped(req, res, next);
    // Wait for the promise to resolve
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(fn).toHaveBeenCalledWith(req, res, next);
    expect(res._json).toEqual({ ok: true });
  });

  it('catches errors and sends 500 response', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Database connection failed');
    });
    const wrapped = asyncHandler(fn);
    const req = { method: 'GET', path: '/test' };
    const res = mockRes();
    const next = vi.fn();

    // Suppress the console.error output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    wrapped(req, res, next);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res._json.error).toBe('Database connection failed');

    consoleSpy.mockRestore();
  });

  it('does not send error if headers already sent', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Late error');
    });
    const wrapped = asyncHandler(fn);
    const req = { method: 'GET', path: '/test' };
    const res = mockRes();
    res.headersSent = true;
    const next = vi.fn();

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    wrapped(req, res, next);
    await new Promise(resolve => setTimeout(resolve, 10));

    // Should NOT call res.status() since headers are already sent
    expect(res.status).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('sends "Internal server error" when error has no message', async () => {
    const fn = vi.fn(async () => {
      throw new Error();
    });
    const wrapped = asyncHandler(fn);
    const req = { method: 'GET', path: '/test' };
    const res = mockRes();
    const next = vi.fn();

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    wrapped(req, res, next);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(res._json.error).toBe('Internal server error');

    consoleSpy.mockRestore();
  });
});
