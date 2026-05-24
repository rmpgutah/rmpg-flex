// ============================================================
// RMPG Flex — PDF Tools Container (Cloudflare Containers)
// ============================================================
// Container subclass that wraps the Dockerfile under
// containers/pdf-tools/. Provides the qpdf encryption + pdftotext/
// ocrmypdf extraction operations that can't run inside the Worker
// runtime (V8 isolates can't execute native binaries).
//
// The Container class extends DurableObject — each named instance
// corresponds to one running container. The Worker proxies via
// getContainer(env.PDF_TOOLS, "shared").fetch(req). One shared
// instance is fine because qpdf and OCR are stateless; if per-
// instance CPU contention becomes a problem we can switch to
// getRandom(env.PDF_TOOLS, N).
// ============================================================

import { Container } from '@cloudflare/containers';

export class PdfToolsContainer extends Container {
  // Must match EXPOSE in containers/pdf-tools/Dockerfile.
  defaultPort = 8080;

  // 5 minutes of idle keeps cold-starts off the hot path during a
  // working session, while still releasing the instance overnight.
  // First request to a stopped container pays ~2-5s spin-up.
  sleepAfter = '5m';

  // Probe that the container's FastAPI is actually listening before
  // the Worker proxies request bodies through. Matches FastAPI's GET
  // /health route in containers/pdf-tools/server.py.
  pingEndpoint = 'localhost:8080/health';
}
