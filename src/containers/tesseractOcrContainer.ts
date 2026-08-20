// ============================================================
// RMPG Flex — Custom Tesseract OCR Container (Cloudflare Containers)
// ============================================================
// Container subclass wrapping the Dockerfile under containers/tesseract-ocr/.
// Self-hosted, fine-tuned OCR — data-sovereignty motivated (see
// docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md).
//
// Follows the exact same shape as PdfToolsContainer
// (src/containers/pdfToolsContainer.ts) — one shared instance is fine
// because OCR is stateless per-request.
// ============================================================

import { Container } from '@cloudflare/containers';

export class TesseractOcrContainer extends Container {
  // Must match EXPOSE in containers/tesseract-ocr/Dockerfile.
  defaultPort = 8080;

  // Same rationale as PdfToolsContainer: keeps cold-starts off the hot
  // path during a working A/B session, releases the instance when idle.
  sleepAfter = '5m';

  // Matches FastAPI's GET /health route in containers/tesseract-ocr/server.py.
  pingEndpoint = 'localhost:8080/health';
}
