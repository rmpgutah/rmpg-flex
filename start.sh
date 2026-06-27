#!/bin/bash
set -e

echo "📧 Building email service Docker image..."
docker build -t email-service:latest .

echo "🚀 Starting email service with docker-compose..."
docker-compose up -d

echo "⏳ Waiting for services to be ready..."
sleep 5

echo "✅ Services started:"
docker-compose ps

echo ""
echo "📋 Service endpoints:"
echo "  Email API: http://localhost:8787"
echo "  Proxy: https://localhost:443 (nginx)"
echo "  Database: sqlite at .wrangler/state/d1.db"
echo ""
echo "🔍 View logs:"
echo "  docker-compose logs -f email-worker"
echo ""
echo "🛑 To stop:"
echo "  docker-compose down"
