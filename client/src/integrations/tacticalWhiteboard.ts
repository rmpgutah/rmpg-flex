// ============================================================
// RMPG Flex — Tactical Whiteboard (Excalidraw)
// ============================================================
// Collaborative whiteboard for tactical planning:
// - SWAT operation layouts
// - Crime scene diagrams
// - Perimeter planning
// - Evacuation route mapping
// - Unit positioning
//
// Lazy-loaded to avoid impacting main bundle size.
// ============================================================

import React, { useCallback, useState, lazy, Suspense } from 'react';

// Lazy-load Excalidraw to avoid 2MB+ bundle impact on initial load
const ExcalidrawComponent = lazy(() =>
  import('@excalidraw/excalidraw').then(mod => ({ default: mod.Excalidraw }))
);

// ── Types ─────────────────────────────────────────────────

export interface WhiteboardProps {
  /** Initial scene data (from saved state) */
  initialData?: any;
  /** Called when the scene changes */
  onChange?: (elements: any[], appState: any) => void;
  /** Read-only mode */
  viewMode?: boolean;
  /** Collaboration room ID (enables real-time sync) */
  roomId?: string;
  /** CSS class for the container */
  className?: string;
}

// ── Component ─────────────────────────────────────────────

/**
 * Tactical planning whiteboard component.
 * Wraps Excalidraw with RMPG Flex dark theme and
 * pre-loaded tactical planning templates.
 */
export function TacticalWhiteboard({
  initialData,
  onChange,
  viewMode = false,
  className = '',
}: WhiteboardProps): React.ReactElement {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);

  const handleChange = useCallback((elements: readonly any[], appState: any) => {
    onChange?.([...elements], appState);
  }, [onChange]);

  return React.createElement('div', {
    className: `tactical-whiteboard w-full h-full min-h-[500px] ${className}`,
    style: { background: '#0a0a0a' },
  },
    React.createElement(Suspense, {
      fallback: React.createElement('div', {
        className: 'flex items-center justify-center h-full text-[#888]',
      }, 'Loading whiteboard...'),
    },
      React.createElement(ExcalidrawComponent, {
        initialData: initialData || undefined,
        onChange: handleChange as any,
        viewModeEnabled: viewMode,
        theme: 'dark',
        UIOptions: {
          canvasActions: {
            loadScene: true,
            saveToActiveFile: false,
            export: { saveFileToDisk: true },
          },
        },
        langCode: 'en',
      } as any),
    ),
  );
}

// ── Template generators ───────────────────────────────────

/**
 * Generate a basic tactical planning template with perimeter markers.
 */
export function createTacticalTemplate() {
  return {
    elements: [
      {
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 400,
        height: 300,
        strokeColor: '#d4a017',
        backgroundColor: 'transparent',
        label: { text: 'TARGET BUILDING' },
      },
    ],
    appState: {
      viewBackgroundColor: '#0a0a0a',
      theme: 'dark',
    },
  };
}

/**
 * Generate a crime scene diagram template.
 */
export function createCrimeSceneTemplate() {
  return {
    elements: [
      {
        type: 'text',
        x: 200,
        y: 50,
        text: 'CRIME SCENE DIAGRAM',
        fontSize: 24,
        strokeColor: '#d4a017',
      },
    ],
    appState: {
      viewBackgroundColor: '#0a0a0a',
      theme: 'dark',
    },
  };
}

/**
 * Export whiteboard as PNG image (for reports/court).
 */
export async function exportWhiteboardAsPng(
  excalidrawAPI: any
): Promise<Blob | null> {
  if (!excalidrawAPI) return null;
  try {
    const { exportToBlob } = await import('@excalidraw/excalidraw');
    const elements = excalidrawAPI.getSceneElements();
    const appState = excalidrawAPI.getAppState();
    return await exportToBlob({
      elements,
      appState: { ...appState, exportBackground: true },
      mimeType: 'image/png',
    });
  } catch {
    return null;
  }
}

export default TacticalWhiteboard;
