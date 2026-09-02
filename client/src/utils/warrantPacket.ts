import { jsPDF } from 'jspdf';
import { renderWarrantIntoDoc, type WarrantPdfData } from './recordPdfGenerator';
import { registerArialFont } from './pdf/fonts/registerArial';
import { localToday } from './dateUtils';
import { resolveApiHttpBase, WORKER_HTTP_ORIGIN } from './apiOrigin';

function apiBase(): string {
  if (typeof window === 'undefined') return WORKER_HTTP_ORIGIN;
  return resolveApiHttpBase({
    isDev: Boolean(import.meta.env?.DEV),
    hostname: window.location.hostname,
  });
}

// Isolated fetch (Pattern E fix, Wave 3.1): the pre-wave-3.1 code used
// apiFetch from hooks/useApi, which is auth-coupled — on a 401 it
// attempts a token refresh and on failure does window.location.href =
// '/login', tearing down the entire SPA mid-PDF-generation. The same
// bug was fixed in pdfStaticMap.ts (c0f34f20) and pdfImageHelpers.ts
// (Wave 3.1). Now uses raw fetch + localStorage JWT + 7s timeout.
function getToken(): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem('rmpg_token') : null; }
  catch { return null; }
}

async function fetchWarrant(id: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${apiBase()}/api/warrants/${id}`, { signal: controller.signal, headers });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function buildWarrantPacketPdf(
  warrantIds: number[],
  currentUser?: { full_name?: string; badge_number?: string }
): Promise<void> {
  const doc = new jsPDF();
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  let first = true;
  for (const id of warrantIds) {
    // Isolate each warrant — one failed fetch/render must not void the whole
    // packet; emit an error-stub page and continue.
    try {
      const raw = await fetchWarrant(id);
      if (!raw) throw new Error(`Warrant ${id} not found or fetch failed`);
      const data: WarrantPdfData = {
        ...raw,
        printed_by_name: currentUser?.full_name,
        printed_by_badge: currentUser?.badge_number,
        printed_at: new Date().toISOString(),
      };
      if (!first) doc.addPage();
      first = false;
      await renderWarrantIntoDoc(doc, data);
    } catch (err) {
      if (!first) doc.addPage();
      first = false;
      doc.setFontSize(12);
      doc.text(`WARRANT #${id} — unavailable`, 20, 30);
      console.error(`[warrantPacket] warrant ${id} failed:`, err);
    }
  }
  doc.save(`warrant-packet-${localToday()}.pdf`);
}
