# FZ-55 Local Server — Setup Guide

This guide turns the secondary Panasonic FZ-55 into a local SQLite server
for RMPG Flex. It runs the exact same Worker code as Cloudflare, persisted
to a local SQLite file via `wrangler dev --local`.

---

## Prerequisites

- Windows 10/11 or Windows Server on the FZ-55
- Node.js LTS (https://nodejs.org) — verify with `node -v`
- Git for Windows (https://git-scm.com)
- NSSM (https://nssm.cc/download) — place `nssm.exe` in `C:\Windows\System32\`

---

## Step 1: Clone the Repository

Open PowerShell as Administrator:

```powershell
git clone https://github.com/rmpgutah/rmpg-flex C:\rmpg-flex
cd C:\rmpg-flex
npm install
```

---

## Step 2: Set Secrets

Set the JWT secret to the SAME value used on Cloudflare:

```powershell
npx wrangler secret put JWT_SECRET
```

When prompted, paste the production JWT_SECRET value (get it from 1Password or
the Cloudflare dashboard → Workers → rmpg-flex-api → Settings → Variables).

---

## Step 3: Apply Migrations

```powershell
npm run migrate:local
```

This runs all 250+ migrations against the local SQLite file at:
`C:\rmpg-flex\.wrangler\state\v3\d1\`

Verify:

```powershell
npx wrangler d1 execute rmpg-flex --local --command "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
```

Expected: ~50+ tables.

---

## Step 4: Create Log Directory

```powershell
New-Item -ItemType Directory -Force -Path C:\rmpg-flex\logs
New-Item -ItemType Directory -Force -Path C:\rmpg-flex\local-db
```

---

## Step 5: Install Windows Service (NSSM)

```powershell
nssm install RMPG-Flex-Local
```

In the NSSM GUI that opens:

| Field | Value |
|-------|-------|
| Path | `C:\Windows\System32\cmd.exe` |
| Arguments | `/c "npx wrangler dev --local --port 8787 --persist-to C:\rmpg-flex\local-db"` |
| Startup directory | `C:\rmpg-flex` |

Click **Details** tab:
- Display name: `RMPG Flex Local Server`
- Startup type: `Automatic (Delayed Start)`

Click **I/O** tab:
- Output: `C:\rmpg-flex\logs\wrangler-out.log`
- Error: `C:\rmpg-flex\logs\wrangler-err.log`

Click **Install service**, then:

```powershell
nssm start RMPG-Flex-Local
```

---

## Step 6: Configure Windows Firewall

```powershell
New-NetFirewallRule `
  -DisplayName "RMPG Flex Local Server" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8787 `
  -Profile Private `
  -Action Allow
```

This allows LAN clients but blocks internet access.

---

## Step 7: Verify

```powershell
curl http://localhost:8787/api/health
```

Expected: `{"status":"ok",...}`

From a dispatch workstation on the same LAN:

```powershell
curl http://<FZ55-IP>:8787/api/health
```

---

## Step 8: Configure Dispatch Workstations

On each dispatch PC, add to `client/.env`:

```
VITE_LOCAL_SERVER_URL=http://<FZ55-IP>:8787
```

Then rebuild/redeploy the client, or restart the Electron desktop app.
The nav bar will show a `LOCAL` chip when the FZ-55 is reachable.

---

## Ongoing Maintenance

### After every merged PR that changes schema:

```powershell
cd C:\rmpg-flex
git pull origin main
npm run migrate:local
nssm restart RMPG-Flex-Local
```

### Check service status:

```powershell
nssm status RMPG-Flex-Local
```

### Check logs:

```powershell
Get-Content C:\rmpg-flex\logs\wrangler-err.log -Tail 50
```

### Backup the SQLite file:

```powershell
Copy-Item "C:\rmpg-flex\local-db" "D:\backups\rmpg-flex-local-$(Get-Date -Format yyyyMMdd)" -Recurse
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Nav bar stays on CLOUD | `VITE_LOCAL_SERVER_URL` not set or wrong IP | Check `client/.env`, rebuild |
| `curl localhost:8787` times out | Service not running | `nssm start RMPG-Flex-Local` |
| Auth errors from local server | JWT_SECRET mismatch | Re-run `npx wrangler secret put JWT_SECRET` |
| `sync_queue` has failed rows | Check `wrangler-err.log` | Fix cause, then trigger manual replay in Admin → Sync Status |
| Migrations fail on `npm run migrate:local` | Duplicate column error (idempotent) | Ignore — `continue-on-error` applies |
