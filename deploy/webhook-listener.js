#!/usr/bin/env node
// ============================================================
// RMPG Flex — GitHub Webhook Auto-Deploy Listener
// Listens for GitHub push webhooks on port 9000,
// validates HMAC-SHA256 signature, and triggers deploy.
// ============================================================

const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.WEBHOOK_PORT || '9000', 10);
const REPO_DIR = path.resolve(process.env.REPO_DIR || '/opt/rmpg-flex');
const DEPLOY_SCRIPT = path.resolve(process.env.DEPLOY_SCRIPT || '/opt/deploy-rmpg.sh');

// Validate paths to prevent command injection via env vars
if (!/^\/[\w./-]+$/.test(REPO_DIR) || !/^\/[\w./-]+$/.test(DEPLOY_SCRIPT)) {
  console.error('[Webhook] FATAL: REPO_DIR or DEPLOY_SCRIPT contain invalid characters');
  process.exit(1);
}
const SECRET_FILE = path.join(REPO_DIR, '.webhook-secret');
const LOG_FILE = path.join(REPO_DIR, 'deploy', 'webhook.log');

// ── Load secret ──
let webhookSecret = '';
try {
  webhookSecret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  if (!webhookSecret) throw new Error('Secret file is empty');
} catch (err) {
  console.error(`[Webhook] FATAL: Cannot read secret from ${SECRET_FILE}`);
  console.error(`[Webhook] Generate one with: openssl rand -hex 32 > ${SECRET_FILE}`);
  process.exit(1);
}

// ── Logging ──
function log(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* ignore log write errors */ }
}

// ── Signature validation ──
function verifySignature(body, signature) {
  if (!signature) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Deploy ──
function triggerDeploy(commitSha, branch, pusher) {
  // Sanitize inputs for logging — strip control chars and newlines
  const safeBranch = String(branch || '').replace(/[^\w/.-]/g, '').slice(0, 128);
  const safeSha = String(commitSha || '').replace(/[^a-f0-9]/gi, '').slice(0, 40);
  const safePusher = String(pusher || '').replace(/[^\w.-@]/g, '').slice(0, 64);
  log(`DEPLOY TRIGGERED — branch=${safeBranch}, commit=${safeSha}, by=${safePusher}`);

  // Run: git pull then deploy script — using execFile with args to avoid shell injection
  const child = execFile('/bin/bash', ['-c', 'git pull origin main && exec bash "$1"', '--', DEPLOY_SCRIPT], {
    cwd: REPO_DIR,
    timeout: 300000, // 5 minute timeout
    env: { ...process.env, HOME: '/root' },
  }, (error, stdout, stderr) => {
    if (error) {
      log(`DEPLOY FAILED — ${error.message}`);
      if (stderr) log(`STDERR: ${stderr.slice(0, 500)}`);
    } else {
      log(`DEPLOY SUCCESS — output: ${(stdout || '').slice(0, 300)}`);
    }
  });

  // Detach so webhook response isn't delayed
  child.unref();
}

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'rmpg-webhook' }));
    return;
  }

  // Only accept POST /webhook
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    // Limit body size to 5MB
    if (body.length > 5 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('Payload too large');
      req.destroy();
    }
  });

  req.on('end', () => {
    // Validate signature
    const signature = req.headers['x-hub-signature-256'];
    if (!verifySignature(body, signature)) {
      log('REJECTED — Invalid signature');
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Invalid signature');
      return;
    }

    // Parse event
    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      log(`IGNORED — Event type: ${event}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ignored', reason: `event=${event}` }));
      return;
    }

    // Parse payload
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (err) {
      log('REJECTED — Invalid JSON payload');
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid JSON');
      return;
    }

    // Only deploy on pushes to main
    const ref = payload.ref || '';
    if (ref !== 'refs/heads/main') {
      log(`IGNORED — Push to ${ref} (not main)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ignored', reason: `branch=${ref}` }));
      return;
    }

    const commitSha = (payload.after || '').slice(0, 8);
    const pusher = payload.pusher?.name || 'unknown';

    // Respond immediately, deploy runs async
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'deploying', commit: commitSha }));

    // Trigger deploy in background
    triggerDeploy(commitSha, 'main', pusher);
  });
});

server.listen(PORT, () => {
  log(`Webhook listener started on port ${PORT}`);
  log(`Repo: ${REPO_DIR}`);
  log(`Deploy script: ${DEPLOY_SCRIPT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...');
  server.close(() => process.exit(0));
});
