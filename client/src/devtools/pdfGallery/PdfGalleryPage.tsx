import { useEffect, useMemo, useState } from 'react';
import type { jsPDF } from 'jspdf';
import { PDF_REGISTRY, entriesByCriticality } from './registry';
import { BATCH_ORDER, REQUIRED_VARIANTS } from './types';
import type { FixtureVariant, PdfRegistryEntry } from './types';
import { renderPdfToCanvases } from './renderToCanvas';
import { extractPdfText, findPlaceholderLeaks } from '../../utils/pdf/audit/textLayer';
import type { PlaceholderLeak } from '../../utils/pdf/audit/textLayer';

// Dev-only harness chrome. Never ships — literal hex is acceptable here
// per project convention (see CLAUDE.md "Never hardcode hex" section).
const styles = {
  page: {
    display: 'flex',
    height: '100vh',
    background: '#111318',
    color: '#e6e8ef',
    fontFamily: 'Arial, sans-serif',
  },
  sidebar: {
    width: 280,
    overflowY: 'auto' as const,
    borderRight: '1px solid #2a2e3a',
    padding: '12px 0',
    flexShrink: 0,
  },
  batchHeading: {
    padding: '8px 16px 4px',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#8b90a3',
  },
  entryButton: (active: boolean) => ({
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    background: active ? '#2b3450' : 'transparent',
    color: active ? '#ffffff' : '#c7cad6',
    border: 'none',
    padding: '6px 16px',
    cursor: 'pointer',
    fontSize: 13,
  }),
  main: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 24,
  },
  variantBar: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
  },
  variantButton: (active: boolean) => ({
    padding: '6px 14px',
    borderRadius: 4,
    border: active ? '1px solid #5b7fff' : '1px solid #3a3f4f',
    background: active ? '#20305c' : 'transparent',
    color: '#e6e8ef',
    cursor: 'pointer',
    fontSize: 13,
  }),
  errorBlock: {
    background: '#3a1418',
    border: '1px solid #b91c1c',
    color: '#ffd7d7',
    padding: 16,
    borderRadius: 4,
    whiteSpace: 'pre-wrap' as const,
    fontFamily: 'Arial, sans-serif',
    fontSize: 12,
    marginBottom: 16,
  },
  leakBlock: {
    background: '#3a2f14',
    border: '1px solid #b98a1c',
    color: '#ffe8b3',
    padding: 12,
    borderRadius: 4,
    fontSize: 12,
    marginBottom: 16,
  },
  docLabel: {
    fontSize: 12,
    color: '#8b90a3',
    marginBottom: 8,
  },
  pageLabel: {
    fontSize: 12,
    color: '#8b90a3',
    margin: '12px 0 4px',
  },
  canvasWrap: {
    marginBottom: 8,
  },
  canvasStyle: {
    display: 'block',
    maxWidth: '100%',
    border: '1px solid #2a2e3a',
  },
};

/**
 * A single rendered document: a label (which engine/pass produced it) plus
 * its rasterized pages. The render pane below takes a LIST of these rather
 * than a single document so that a future side-by-side comparison against
 * the v2 rendering engine (client/src/utils/pdf/v2/) is a prop change, not
 * a rewrite. Only one entry is populated today; no engine-switching UI
 * exists yet.
 */
interface LabelledDocument {
  label: string;
  canvases: HTMLCanvasElement[];
}

function RenderPane({ documents }: { documents: LabelledDocument[] }) {
  return (
    <div style={{ display: 'flex', gap: 24 }}>
      {documents.map((doc) => (
        <div key={doc.label}>
          <div style={styles.docLabel}>{doc.label}</div>
          {doc.canvases.map((canvas, i) => (
            <CanvasHost key={i} canvas={canvas} pageNumber={i + 1} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CanvasHost({ canvas, pageNumber }: { canvas: HTMLCanvasElement; pageNumber: number }) {
  return (
    <div style={styles.canvasWrap}>
      <div style={styles.pageLabel}>Page {pageNumber}</div>
      <div
        style={styles.canvasStyle}
        ref={(host) => {
          if (host && canvas.parentElement !== host) {
            host.innerHTML = '';
            host.appendChild(canvas);
          }
        }}
      />
    </div>
  );
}

interface RenderResult {
  documents: LabelledDocument[];
  leaks: PlaceholderLeak[];
}

function useFixtureRender(entry: PdfRegistryEntry | undefined, variant: FixtureVariant) {
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!entry) {
      setResult(null);
      setError(null);
      return undefined;
    }
    const fixture = entry.fixtures.find((f) => f.variant === variant);
    if (!fixture) {
      setResult(null);
      setError(new Error(`No "${variant}" fixture registered for "${entry.id}".`));
      return undefined;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    (async () => {
      try {
        const doc: jsPDF = await entry.generate(fixture.input);
        const canvases = await renderPdfToCanvases(doc);
        const leaks = findPlaceholderLeaks(await extractPdfText(doc));
        if (!cancelled) {
          setResult({ documents: [{ label: entry.label, canvases }], leaks });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry, variant]);

  return { result, error, loading };
}

export default function PdfGalleryPage() {
  const [selectedId, setSelectedId] = useState<string>(PDF_REGISTRY[0]?.id ?? '');
  const [variant, setVariant] = useState<FixtureVariant>('typical');

  const entry = useMemo(() => PDF_REGISTRY.find((e) => e.id === selectedId), [selectedId]);
  const { result, error, loading } = useFixtureRender(entry, variant);

  return (
    <div style={styles.page}>
      <div style={styles.sidebar}>
        {BATCH_ORDER.map((criticality) => {
          const entries = entriesByCriticality(criticality);
          if (entries.length === 0) return null;
          return (
            <div key={criticality}>
              <div style={styles.batchHeading}>{criticality}</div>
              {entries.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  style={styles.entryButton(e.id === selectedId)}
                  onClick={() => setSelectedId(e.id)}
                >
                  {e.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div style={styles.main}>
        <h1 style={{ fontSize: 18, marginTop: 0 }}>PDF Gallery — Render Audit Harness</h1>
        <p style={{ fontSize: 12, color: '#8b90a3' }}>
          Dev-only. Rasterizes each Rocky Mountain Protective Group PDF output at print
          DPI with a margin guide, so layout defects (clipped text, overflow) are visible
          rather than inferred from the text layer alone.
        </p>

        <div style={styles.variantBar}>
          {REQUIRED_VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              style={styles.variantButton(v === variant)}
              onClick={() => setVariant(v)}
            >
              {v}
            </button>
          ))}
        </div>

        {loading && <div style={{ fontSize: 12, color: '#8b90a3' }}>Rendering…</div>}

        {error && (
          <div style={styles.errorBlock}>
            <strong>Generator threw an error — this is itself an audit finding:</strong>
            {'\n\n'}
            {error.message}
            {'\n\n'}
            {error.stack}
          </div>
        )}

        {result && result.leaks.length > 0 && (
          <div style={styles.leakBlock}>
            <strong>{result.leaks.length} placeholder leak(s) in the text layer:</strong>
            <ul>
              {result.leaks.map((l, i) => (
                <li key={i}>
                  page {l.page}: "{l.token}" in "…{l.context}…"
                </li>
              ))}
            </ul>
          </div>
        )}

        {result && <RenderPane documents={result.documents} />}
      </div>
    </div>
  );
}
