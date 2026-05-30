---
name: deploy
description: Build and deploy RMPG Flex to production VPS with safety checks
disable-model-invocation: true
---

# Deploy RMPG Flex

Deploy the application to production at https://rmpgutah.us.

## Pre-Deploy Checks

Before deploying, run these checks and STOP if any fail:

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# 1. TypeScript check (must pass with 0 errors)
cd client && npx tsc --noEmit

# 2. Build client
npx vite build

# 3. Bump service worker cache (REQUIRED for client changes)
# Edit client/public/sw.js — increment CACHE_NAME version number
```

**IMPORTANT**: Ask the user to confirm before proceeding to deployment.

## Deploy Commands

```bash
# Code only (most common)
bash deploy/deploy.sh

# Code + desktop installers
bash deploy/deploy.sh --all
```

## Post-Deploy Verification

```bash
# Health check
curl -sf https://rmpgutah.us/api/health

# Check service status on VPS
ssh root@194.113.64.90 "systemctl status rmpg-flex | head -10"
```

If health check fails, check VPS logs:
```bash
ssh root@194.113.64.90 "journalctl -u rmpg-flex --since '5 min ago' --no-pager | tail -30"
```

## Manual Deploy (bypasses deploy script)

Only use if deploy.sh is broken:
```bash
cd client && npx vite build && cd ..
rsync -avz --delete \
  --exclude='server/data' --exclude='server/certs' \
  --exclude='server/.env' --exclude='server/uploads' \
  --exclude='.git' --exclude='node_modules' --exclude='.claude' \
  . root@194.113.64.90:/opt/rmpg-flex/
ssh root@194.113.64.90 "cd /opt/rmpg-flex/server && npm install --legacy-peer-deps && systemctl restart rmpg-flex"
```
