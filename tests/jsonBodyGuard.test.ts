// Unit tests for src/middleware/jsonBodyGuard.ts.
//
// The guard turns a malformed JSON request body into 400 instead of the 500 it
// produced everywhere before (c.req.json() throws SyntaxError; 58 handlers had
// no catch at all and the rest had a catch written for DB errors that returned
// 500 anyway).
//
// The multipart tests below are the important ones. Reading the body in
// middleware primes Hono's body cache, and doing that on a multipart request
// makes the handler's later formData() fail with a TypeError — which would
// break every file upload in the app. The content-type guard is what prevents
// that, so it gets explicit regression coverage rather than being trusted.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { jsonBodyGuard } from '../src/middleware/jsonBodyGuard';

function makeApp() {
  const app = new Hono();
  app.use('*', jsonBodyGuard);
  // Mirrors the 58 real handlers: no catch around json(), so an unguarded
  // SyntaxError escapes to onError as a 500.
  app.post('/bare', async (c) => c.json({ ok: true, body: await c.req.json() }));
  app.put('/bare', async (c) => c.json({ ok: true, body: await c.req.json() }));
  app.patch('/bare', async (c) => c.json({ ok: true, body: await c.req.json() }));
  app.delete('/bare', async (c) => c.json({ ok: true, body: await c.req.json() }));
  app.get('/bare', (c) => c.json({ ok: true, method: 'GET' }));
  // Mirrors the tolerant handlers (alpr.ts) that treat "no body" as "no edits".
  app.post('/tolerant', async (c) => {
    let body: unknown = null;
    try { body = await c.req.json(); } catch { /* empty body is fine */ }
    return c.json({ ok: true, body });
  });
  app.post('/upload', async (c) => {
    const form = await c.req.formData();
    return c.json({ field: form.get('a') });
  });
  app.onError((_e, c) => c.json({ error: 'Internal server error' }, 500));
  return app;
}

const json = (body: string, method = 'POST', path = '/bare') =>
  makeApp().request(path, { method, headers: { 'Content-Type': 'application/json' }, body });

describe('jsonBodyGuard — malformed JSON', () => {
  it('returns 400 instead of 500 for a malformed body', async () => {
    const res = await json('{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body', code: 'INVALID_JSON' });
  });

  it('rejects other common malformed shapes', async () => {
    for (const bad of ['{"a":}', '[1,2', 'undefined', "{'a':1}", '{"a":1,}']) {
      const res = await json(bad);
      expect(res.status, `should reject ${bad}`).toBe(400);
    }
  });

  it('applies to PUT, PATCH and DELETE as well as POST', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await json('{oops', method);
      expect(res.status, `${method} should be 400`).toBe(400);
    }
  });
});

describe('jsonBodyGuard — must not change working requests', () => {
  it('passes a valid JSON body through to the handler', async () => {
    const res = await json('{"a":1,"nested":{"b":[1,2,3]}}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, body: { a: 1, nested: { b: [1, 2, 3] } } });
  });

  it('accepts a charset suffix on the content type', async () => {
    const res = await makeApp().request('/bare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: '{"a":1}',
    });
    expect(res.status).toBe(200);
  });

  it('accepts +json media types (e.g. application/merge-patch+json)', async () => {
    const res = await makeApp().request('/bare', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: '{"a":1}',
    });
    expect(res.status).toBe(200);
  });

  it('leaves an EMPTY body alone so tolerant handlers keep working', async () => {
    // Deliberate: several routes treat "no body" as "no edits". Rejecting it
    // here would break them, so the guard only rejects a body that is present
    // and unparseable.
    const res = await makeApp().request('/tolerant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, body: null });
  });

  it('ignores GET requests entirely', async () => {
    const res = await makeApp().request('/bare', { method: 'GET' });
    expect(res.status).toBe(200);
  });
});

describe('jsonBodyGuard — must not break file uploads (regression)', () => {
  it('leaves multipart/form-data untouched so formData() still works', async () => {
    // If the guard ever reads a multipart body, Hono's primed body cache makes
    // this formData() throw a TypeError and the upload 500s. Every ALPR
    // capture, bodycam video and field photo upload goes through this path.
    const fd = new FormData();
    fd.append('a', 'hello');
    const res = await makeApp().request('/upload', { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ field: 'hello' });
  });

  it('ignores urlencoded and octet-stream bodies', async () => {
    for (const ct of ['application/x-www-form-urlencoded', 'application/octet-stream', 'text/plain']) {
      const res = await makeApp().request('/tolerant', {
        method: 'POST',
        headers: { 'Content-Type': ct },
        body: 'not json at all',
      });
      expect(res.status, `${ct} should pass through`).toBe(200);
    }
  });

  it('ignores a body with no content type at all', async () => {
    const res = await makeApp().request('/tolerant', { method: 'POST', body: 'raw bytes' });
    expect(res.status).toBe(200);
  });
});
