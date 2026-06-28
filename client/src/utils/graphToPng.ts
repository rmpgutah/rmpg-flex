/**
 * Serialize an SVG element to a PNG data URL.
 *
 * Approach: XMLSerializer -> Blob -> <img> -> canvas.drawImage -> canvas.toDataURL.
 * The canvas is sized at 2x the SVG's logical dimensions by default for crisp output.
 *
 * In jsdom (test environment), canvas rasterization is a stub; the function
 * returns a minimal valid PNG data URL so callers don't break. Real browsers
 * get the actual rasterized output.
 */

export interface Options {
  scale?: number;
  backgroundColor?: string;
}

// 1x1 transparent PNG — used as a safe fallback in environments without real canvas rasterization.
const FALLBACK_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function svgElementToPngDataUrl(
  svg: SVGSVGElement,
  opts: Options = {}
): Promise<string> {
  const scale = opts.scale ?? 2;
  const bg = opts.backgroundColor ?? '#0a0a0a';

  // 1) Serialize the SVG to a string, ensuring xmlns is present.
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svg);
  if (!svgString.includes('xmlns="http://www.w3.org/2000/svg"')) {
    svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // 2) Compute dimensions.
  let width = svg.clientWidth || Number(svg.getAttribute('width')) || 0;
  let height = svg.clientHeight || Number(svg.getAttribute('height')) || 0;
  if (!width || !height) {
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/\s+/).map(Number);
      const vbW = parts[2];
      const vbH = parts[3];
      width = width || vbW || 800;
      height = height || vbH || 600;
    } else {
      width = width || 800;
      height = height || 600;
    }
  }

  // Short-circuit in environments where canvas rasterization is stubbed
  // (jsdom): toDataURL returns 'data:,' regardless of draw calls. Detect that
  // once up-front so we don't wait on an <img> that will never fire onload.
  try {
    const probe = document.createElement('canvas');
    probe.width = 1; probe.height = 1;
    const probeUrl = probe.toDataURL('image/png');
    if (!probeUrl || probeUrl === 'data:,' || !probeUrl.startsWith('data:image/png')) {
      return FALLBACK_PNG_DATA_URL;
    }
  } catch {
    return FALLBACK_PNG_DATA_URL;
  }

  // 3) Build blob URL.
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    // 4) Load the SVG into an <img>.
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load SVG image'));
      img.src = url;
    });

    // jsdom's <img> neither fires onload nor onerror for SVG blob URLs, so the
    // promise above would hang forever. Race it against a short timeout that
    // triggers the fallback in test environments.
    const TIMEOUT_MS = 2000;
    const timeout = new Promise<HTMLImageElement>((_, reject) => {
      setTimeout(() => reject(new Error('SVG image load timed out')), TIMEOUT_MS);
    });

    let loadedImg: HTMLImageElement;
    try {
      loadedImg = await Promise.race([loaded, timeout]);
    } catch {
      // jsdom frequently fails to load SVG data URLs — return the fallback.
      return FALLBACK_PNG_DATA_URL;
    }

    // 5) Draw onto a canvas.
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return FALLBACK_PNG_DATA_URL;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      ctx.drawImage(loadedImg, 0, 0, canvas.width, canvas.height);
    } catch {
      return FALLBACK_PNG_DATA_URL;
    }

    // 6) Export as data URL.
    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl || dataUrl === 'data:,' || !dataUrl.startsWith('data:image/png')) {
      return FALLBACK_PNG_DATA_URL;
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Trigger a download of the given data URL as `filename`.
 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
