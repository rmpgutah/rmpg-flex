#!/usr/bin/env bash
set -euo pipefail

# Firecrawl deployment script for RMPG Flex VPS
# Deploys self-hosted Firecrawl + Redis on localhost:3002

FIRECRAWL_DIR="/opt/firecrawl"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Firecrawl Deployment ==="

# 1. Create directory on VPS
echo "[1/4] Creating ${FIRECRAWL_DIR}..."
mkdir -p "${FIRECRAWL_DIR}"

# 2. Copy docker-compose.yml
echo "[2/4] Copying docker-compose.yml..."
cp "${SCRIPT_DIR}/docker-compose.yml" "${FIRECRAWL_DIR}/docker-compose.yml"

# 3. Pull images and start containers
echo "[3/4] Pulling images and starting containers..."
cd "${FIRECRAWL_DIR}"
docker compose pull
docker compose up -d

# 4. Health check (retry up to 30 seconds)
echo "[4/4] Waiting for Firecrawl health check..."
RETRIES=15
for i in $(seq 1 $RETRIES); do
  if curl -sf http://localhost:3002/v1/health > /dev/null 2>&1; then
    echo ""
    echo "=== Firecrawl is running ==="
    echo "  URL:    http://localhost:3002"
    echo "  Health: http://localhost:3002/v1/health"
    echo "  Logs:   cd ${FIRECRAWL_DIR} && docker compose logs -f"
    exit 0
  fi
  printf "."
  sleep 2
done

echo ""
echo "WARNING: Health check failed after ${RETRIES} attempts."
echo "Check logs: cd ${FIRECRAWL_DIR} && docker compose logs"
exit 1
