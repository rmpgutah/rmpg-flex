# ============================================================
# RMPG Flex - Full Restoration Script
# Restores codebase AND database/uploads to 2026-05-13 11PM MST
# Target commit: 59ffccdc2245bd58e3c1e053c93d41b9ffb38d50
#
# Usage:
#   .\server\scripts\restore-to-20260513.ps1
#   .\server\scripts\restore-to-20260513.ps1 -DryRun
#   .\server\scripts\restore-to-20260513.ps1 -SkipData
# ============================================================

param(
    [switch]$DryRun,
    [switch]$PatchOnly,
    [switch]$SkipData,
    [string]$VpsUser = "root",
    [string]$VpsHost = "194.113.64.90",
    [string]$VpsAppDir = "/opt/rmpg-flex"
)

$ErrorActionPreference = "Stop"
$git = "C:\Program Files\Git\bin\git.exe"
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$targetCommit = "59ffccdc2245bd58e3c1e053c93d41b9ffb38d50"
$baselineCommit = "ae402c39bb518e65b8ca59483ca957a16676b641"
$patchFile = Join-Path $repoRoot "docs\restore-to-20260513.patch"
$dataDir = Join-Path $repoRoot "server\data"
$uploadsDir = Join-Path $repoRoot "server\uploads"
$vpsRemote = "${VpsUser}@${VpsHost}"

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  RMPG Flex - Full Restoration Script" -ForegroundColor Cyan
Write-Host "  Target: 2026-05-13 11:00 PM MST" -ForegroundColor Cyan
Write-Host "  Commit: $($targetCommit.Substring(0,12))..." -ForegroundColor Cyan
Write-Host "  Includes: Code + Database + Uploads" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

$remoteUrl = & $git -C $repoRoot remote get-url origin 2>$null
if ($remoteUrl -notlike "*rmpg-flex*") {
    Write-Host "  X Not the rmpg-flex repository." -ForegroundColor Red
    exit 1
}

# ================================================================
# PHASE 1: Code Restoration
# ================================================================

$currentHead = & $git -C $repoRoot rev-parse HEAD
Write-Host "  Current HEAD: $currentHead"
Write-Host "  Target:       $targetCommit"
Write-Host ""

$codeRestored = $false

if ($currentHead -eq $targetCommit) {
    Write-Host "  [OK] Code already at target commit." -ForegroundColor Green
    Write-Host ""
    $codeRestored = $true
}

if ((-not $codeRestored) -and (-not $PatchOnly)) {
    $commitExists = & $git -C $repoRoot cat-file -t $targetCommit 2>$null
    if ($commitExists -eq "commit") {
        if ($DryRun) {
            Write-Host "  [DRY RUN] Would reset to $targetCommit" -ForegroundColor Yellow
            & $git -C $repoRoot diff --stat $currentHead $targetCommit
            Write-Host ""
        }
        else {
            $status = & $git -C $repoRoot status --porcelain
            if ($status) {
                Write-Host "  Stashing uncommitted changes..." -ForegroundColor Yellow
                & $git -C $repoRoot stash push -m "pre-restoration-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            }
            Write-Host "  Resetting to target commit..." -ForegroundColor Yellow
            & $git -C $repoRoot reset --hard $targetCommit
            Write-Host "  [OK] Codebase restored." -ForegroundColor Green
            Write-Host ""
        }
        $codeRestored = $true
    }
}

if (-not $codeRestored) {
    if (-not (Test-Path $patchFile)) {
        Write-Host "  X Patch file not found: $patchFile" -ForegroundColor Red
        exit 1
    }
    $patchSize = [math]::Round((Get-Item $patchFile).Length / 1KB, 1)
    Write-Host "  Using patch file ($patchSize KB)" -ForegroundColor Yellow

    if ($DryRun) {
        Write-Host "  [DRY RUN] Checking patch..." -ForegroundColor Yellow
        & $git -C $repoRoot apply --stat $patchFile
        & $git -C $repoRoot apply --check $patchFile 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] Patch applies cleanly." -ForegroundColor Green
        }
        else {
            Write-Host "  X Patch has conflicts." -ForegroundColor Red
        }
        Write-Host ""
    }
    else {
        Write-Host "  Resetting to baseline..." -ForegroundColor Yellow
        & $git -C $repoRoot reset --hard $baselineCommit
        Write-Host "  Applying patch..." -ForegroundColor Yellow
        & $git -C $repoRoot apply $patchFile
        if ($LASTEXITCODE -ne 0) {
            & $git -C $repoRoot apply --3way $patchFile
        }
        & $git -C $repoRoot add -A
        & $git -C $repoRoot commit -m "restore: codebase to 2026-05-13 23:00 MST state"
        Write-Host "  [OK] Codebase restored via patch." -ForegroundColor Green
        Write-Host ""
    }
}

# ================================================================
# PHASE 2: Database and Uploads from VPS
# ================================================================

if ($SkipData) {
    Write-Host "  Skipping data restoration (-SkipData)" -ForegroundColor Yellow
    exit 0
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Phase 2: Database and Uploads from VPS ($vpsRemote)" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "  Testing VPS connectivity..." -ForegroundColor Yellow
$sshOk = $false
try {
    $sshTest = ssh -o ConnectTimeout=10 -o BatchMode=yes $vpsRemote "echo OK" 2>&1
    if ("$sshTest".Trim() -eq "OK") { $sshOk = $true }
} catch {}

if (-not $sshOk) {
    Write-Host "  SSH key auth not available. Will prompt for password." -ForegroundColor Yellow
    try {
        $sshTest = ssh -o ConnectTimeout=10 $vpsRemote "echo OK" 2>&1
        if ("$sshTest".Trim() -eq "OK") { $sshOk = $true }
    } catch {}
}

if (-not $sshOk) {
    Write-Host "  X Cannot connect to VPS at $vpsRemote" -ForegroundColor Red
    Write-Host "    Restore data manually:" -ForegroundColor Yellow
    Write-Host "      scp ${vpsRemote}:${VpsAppDir}/server/data/rmpg-flex.db server\data\" -ForegroundColor White
    Write-Host "      scp -r ${vpsRemote}:${VpsAppDir}/server/uploads/ server\uploads\" -ForegroundColor White
    exit 1
}
Write-Host "  [OK] VPS connection OK" -ForegroundColor Green
Write-Host ""

# Check remote data
Write-Host "  Checking remote data..." -ForegroundColor Yellow
$remoteCheck = ssh $vpsRemote "du -sh ${VpsAppDir}/server/data/rmpg-flex.db 2>/dev/null; echo XSEPX; du -sh ${VpsAppDir}/server/uploads 2>/dev/null; echo XSEPX; ls ${VpsAppDir}/server/data/rmpg-flex-backup-*.db 2>/dev/null | wc -l"

$remoteParts = "$remoteCheck" -split "XSEPX"
$dbInfo = ""; $uploadsInfo = ""; $bkCount = "0"
if ($remoteParts.Count -gt 0) { $dbInfo = $remoteParts[0].Trim() }
if ($remoteParts.Count -gt 1) { $uploadsInfo = $remoteParts[1].Trim() }
if ($remoteParts.Count -gt 2) { $bkCount = $remoteParts[2].Trim() }

if ([string]::IsNullOrWhiteSpace($dbInfo)) {
    Write-Host "  X No database found on VPS" -ForegroundColor Red
    exit 1
}

Write-Host "    Database:    $dbInfo" -ForegroundColor White
Write-Host "    Uploads:     $(if($uploadsInfo){$uploadsInfo}else{'none'})" -ForegroundColor White
Write-Host "    VPS backups: $bkCount file(s)" -ForegroundColor White
Write-Host ""

if ($DryRun) {
    Write-Host "  [DRY RUN] Would download:" -ForegroundColor Yellow
    Write-Host "    - rmpg-flex.db -> server\data\rmpg-flex.db" -ForegroundColor White
    Write-Host "    - rmpg-flex-backup-*.db -> server\data\" -ForegroundColor White
    Write-Host "    - rmpg-flex.db-wal/shm -> server\data\" -ForegroundColor White
    if ($uploadsInfo) {
        Write-Host "    - uploads/ -> server\uploads\" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "  [DRY RUN] Complete. Run without -DryRun to execute." -ForegroundColor Yellow
    exit 0
}

# Remote backup
Write-Host "  Creating remote backup on VPS..." -ForegroundColor Yellow
$ts = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
ssh $vpsRemote "cp ${VpsAppDir}/server/data/rmpg-flex.db ${VpsAppDir}/server/data/rmpg-flex-pre-restore-${ts}.db 2>/dev/null"
Write-Host "  [OK] Remote backup created" -ForegroundColor Green
Write-Host ""

# Local backup
if (Test-Path (Join-Path $dataDir "rmpg-flex.db")) {
    $localSize = (Get-Item (Join-Path $dataDir "rmpg-flex.db")).Length
    if ($localSize -gt 0) {
        $bkName = "rmpg-flex-local-backup-$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').db"
        Copy-Item (Join-Path $dataDir "rmpg-flex.db") (Join-Path $dataDir $bkName)
        Write-Host "  [OK] Local DB backed up as $bkName" -ForegroundColor Green
    }
}

# Ensure dirs
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
New-Item -ItemType Directory -Path $uploadsDir -Force | Out-Null

# Download database
Write-Host "  Downloading database..." -ForegroundColor Yellow
scp "${vpsRemote}:${VpsAppDir}/server/data/rmpg-flex.db" (Join-Path $dataDir "rmpg-flex.db")
if ($LASTEXITCODE -ne 0) {
    Write-Host "  X Database download failed" -ForegroundColor Red
    exit 1
}
$dbSizeMB = [math]::Round((Get-Item (Join-Path $dataDir "rmpg-flex.db")).Length / 1MB, 2)
Write-Host "  [OK] Database restored: ${dbSizeMB} MB" -ForegroundColor Green

# WAL/SHM
scp "${vpsRemote}:${VpsAppDir}/server/data/rmpg-flex.db-wal" $dataDir 2>$null
scp "${vpsRemote}:${VpsAppDir}/server/data/rmpg-flex.db-shm" $dataDir 2>$null

# Backup files
Write-Host "  Downloading backup files..." -ForegroundColor Yellow
$null = scp "${vpsRemote}:${VpsAppDir}/server/data/rmpg-flex-backup-*.db" $dataDir 2>&1
if ($LASTEXITCODE -eq 0) {
    $dlBk = (Get-ChildItem $dataDir -Filter "rmpg-flex-backup-*.db" -ErrorAction SilentlyContinue).Count
    Write-Host "  [OK] Downloaded $dlBk backup file(s)" -ForegroundColor Green
}
else {
    Write-Host "  No backup files found" -ForegroundColor Yellow
}

# Uploads
if ($uploadsInfo) {
    Write-Host "  Downloading uploads..." -ForegroundColor Yellow
    scp -r "${vpsRemote}:${VpsAppDir}/server/uploads/" $uploadsDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Warning: Some uploads may have failed" -ForegroundColor Yellow
    }
    else {
        $ulCount = (Get-ChildItem $uploadsDir -Recurse -File -ErrorAction SilentlyContinue).Count
        Write-Host "  [OK] Uploads restored: $ulCount file(s)" -ForegroundColor Green
    }
}
else {
    Write-Host "  No uploads on VPS" -ForegroundColor Yellow
}

# ================================================================
# PHASE 3: Verify Database
# ================================================================

Write-Host ""
Write-Host "  Verifying database integrity..." -ForegroundColor Yellow

$vfPath = Join-Path $repoRoot "server\scripts\_verify-db-temp.mjs"
$vfLines = @()
$vfLines += "import Database from 'better-sqlite3';"
$vfLines += "import path from 'path';"
$vfLines += "import { fileURLToPath } from 'url';"
$vfLines += "const d = path.dirname(fileURLToPath(import.meta.url));"
$vfLines += "const db = new Database(path.resolve(d, '../data/rmpg-flex.db'), { readonly: true });"
$vfLines += "const integrity = db.pragma('integrity_check');"
$vfLines += "const ok = integrity.length === 1 ? (integrity[0].integrity_check === 'ok') : false;"
$vfLines += "const tables = db.prepare(""SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"").all();"
$vfLines += "let totalRows = 0; const summary = [];"
$vfLines += "for (const t of tables) { try { const r = db.prepare('SELECT COUNT(*) as c FROM [' + t.name + ']').get(); if (r.c > 0) { summary.push(t.name + ': ' + r.c); totalRows += r.c; } } catch {} }"
$vfLines += "console.log(JSON.stringify({ ok, tables: tables.length, totalRows, populated: summary.length, top: summary.slice(0, 15) }));"
$vfLines += "db.close();"
$vfLines -join "`n" | Set-Content -Path $vfPath -Encoding UTF8

try {
    $result = & node $vfPath 2>&1
    $info = "$result" | ConvertFrom-Json
    Remove-Item $vfPath -Force -ErrorAction SilentlyContinue

    if ($info.ok) {
        Write-Host "  [OK] Database integrity: PASSED" -ForegroundColor Green
    }
    else {
        Write-Host "  Warning: integrity issues detected" -ForegroundColor Yellow
    }
    Write-Host "    Tables: $($info.tables) total, $($info.populated) with data" -ForegroundColor White
    Write-Host "    Total rows: $($info.totalRows)" -ForegroundColor White
    Write-Host ""
    Write-Host "    Data summary:" -ForegroundColor White
    foreach ($t in $info.top) {
        Write-Host "      $t" -ForegroundColor Gray
    }
}
catch {
    Remove-Item $vfPath -Force -ErrorAction SilentlyContinue
    Write-Host "  Could not verify (run 'cd server; npm install' first)" -ForegroundColor Yellow
}

# ================================================================
# Summary
# ================================================================

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Full Restoration Complete" -ForegroundColor Green
Write-Host "  Code:     Commit $($targetCommit.Substring(0,12))..." -ForegroundColor Green
Write-Host "  Database: server/data/rmpg-flex.db (${dbSizeMB} MB)" -ForegroundColor Green
Write-Host "  Uploads:  server/uploads/" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host "    1. cd server; npm install" -ForegroundColor White
Write-Host "    2. npm run dev" -ForegroundColor White
Write-Host "    3. Verify data in the application" -ForegroundColor White
Write-Host ""
