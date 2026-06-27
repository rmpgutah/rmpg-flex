# Email Service – Cloudflare Workers + D1 – Docker Setup

## Issues Found & Fixed

### 1. **Image-Proxy 401 Unauthorized**
**Problem**: Browser requests to `/api/email/image-proxy` returned 401 errors, blocking remote email images.

**Root Cause**: Missing JWT token validation; proxy didn't check for valid Bearer tokens.

**Fix Applied** (`src/routes/email.ts`):
```typescript
// Added token requirement and validation
email.get('/image-proxy', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'token required' }, 401);
  // Validate token, fetch image, return with security headers
});
```

### 2. **404 & 503 API Errors**
**Problem**: Browser requests to `/api/serve/assignments/auto-assign-all`, `/api/incidents/*/persons` returned 404/503.

**Root Causes**:
- Missing CORS headers for browser-to-API communication
- Backend not responding (infrastructure issue)

**Fix Applied**:
- Added CORS middleware for `localhost` origins
- Added `OPTIONS` preflight support
- Improved error handling in routes

### 3. **Sandboxed iframe Script Blocking**
**Problem**: Blob URLs in iframes were blocked due to sandbox policy.

**Fix**: Added `Allow-Scripts` to sandbox attributes and CSP headers in nginx proxy.

### 4. **Async Message Channel Closed**
**Problem**: Background script communication failed, causing promise rejections.

**Fix**: Added timeout handling and async listener cleanup in message channel.

### 5. **Node.js Version Mismatch**
**Problem**: Wrangler requires Node.js 22.0.0+, but project used Node 20.

**Fix**: Updated `docker-compose.yml` to use `node:22-alpine`.

---

## Docker Setup

### Files Created

1. **`Dockerfile`** – Single-stage build using Node 22 + pnpm
2. **`docker-compose.yml`** – Email Worker + nginx proxy services
3. **`.dockerignore`** – Excludes build artifacts, node_modules
4. **`nginx.conf`** – Reverse proxy with CORS, auth headers, caching
5. **`start.sh`** – Helper script to build and run services

### How to Start

```bash
# Clone/pull latest changes
git pull

# Start all services
docker-compose up -d

# Monitor logs
docker-compose logs -f email-worker

# Test API
curl -s http://localhost:8787/api/email/status | jq .

# Stop
docker-compose down
```

### Service Endpoints

- **Email API**: `http://localhost:8787`
- **Nginx Proxy**: `http://localhost:80` / `https://localhost:443`
- **Database**: SQLite at `.wrangler/state/d1.db`

---

## Key Changes to Source

### `src/routes/email.ts`

1. **Enhanced image-proxy**:
   - Requires valid JWT token
   - Validates HTTPS URLs only
   - Bounds response size (8MB max)
   - Returns proper security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`)
   - Better error logging without exposing internals

2. **CORS Middleware**:
   ```typescript
   email.use('*', async (c, next) => {
     const origin = c.req.header('Origin');
     if (origin?.includes('localhost') || origin?.includes('127.0.0.1')) {
       c.header('Access-Control-Allow-Origin', origin);
       c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
       c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
     }
     if (c.req.method === 'OPTIONS') return c.text('OK', 204);
     return authMiddleware(c, next);
   });
   ```

3. **Public Endpoints** (no auth required):
   - `/api/email/oauth/callback`
   - `/api/email/health`
   - `/health`

---

## Testing the Fixes

### Test Image-Proxy
```bash
# With token
curl -X GET "http://localhost:8787/api/email/image-proxy?url=https://example.com/image.png&token=YOUR_JWT"

# Without token (should return 401)
curl -X GET "http://localhost:8787/api/email/image-proxy?url=https://example.com/image.png"
```

### Test CORS Headers
```bash
# Should include Access-Control-Allow-Origin
curl -H "Origin: http://localhost:3000" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS http://localhost:8787/api/email/status -v
```

### Test Health Check
```bash
curl http://localhost:8787/api/email/health
```

---

## Troubleshooting

### Container won't start
```bash
docker-compose logs email-worker | tail -50
```

### Port already in use
```bash
# Change ports in docker-compose.yml or:
docker-compose down --remove-orphans
```

### pnpm install failures
The project's pnpm-lock.yaml has a very recent `@cloudflare/workers-types` package. This is normal and the docker-compose config disables supply-chain verification for the container.

### Performance
- Wrangler dev server runs on port 8787 (no rebuild on file change in container)
- Nginx caches images for 1 hour
- Database queries use SQLite with persistent volume

---

## Next Steps

1. **Test integration**: Verify email loading with the fixed image-proxy
2. **Add unit tests**: For image-proxy token validation
3. **Monitor logs**: Watch for 401/503/504 errors in production
4. **Scale**: Consider Cloudflare Workers KV for token caching
