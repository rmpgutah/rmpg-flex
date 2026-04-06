# Map System Visual & UX Polish — Design Document

**Date**: 2026-03-23
**Scope**: 500+ visual/UX changes across all map components
**Approach**: Component-by-component systematic polish

## Streams

### 1. Map Markers (~80 changes)
Unit, incident, property, self-position, and historical markers: shadow refinement, pulse/glow animations, hover scale, selected-state rings, call sign contrast, zoom-scaled sizing, fade transitions.

### 2. Info Windows (~60 changes)
Tab indicator animations, hover states, monospace alignment, section dividers, button hover/active states, scrollbar styling, mobile sizing, max-height constraints.

### 3. Sidebar & Panels (~150 changes)
All 27 panel components: surface hierarchy consistency (CSS variables), open/close slide animations, content fade-in, empty/loading/error states, custom dark scrollbars, header styling, toggle animations, button uniformity, focus rings.

### 4. Map Controls (~50 changes)
Layers panel toggle animations, legend compaction, compass rose rotation, scale bar animation, export menu dropdown, measurement overlay cursor/badge styling.

### 5. Heatmap & Overlays (~40 changes)
Gradient color ramp refinement, opacity slider tooltip, dynamic legend, geofence dash patterns by zone type, fill opacity, label positioning, toggle transitions.

### 6. Breadcrumb Trails (~30 changes)
Width zoom-scaling, path gradient coloring, endpoint markers, playback control bar styling, speed legend strip, unit selector dropdown, multi-trail differentiation.

### 7. Mobile & Responsive (~40 changes)
Bottom sheet drag handle, snap points, backdrop blur, 44px touch targets, compact panel layouts, gesture visual cues.

### 8. Accessibility & Micro-interactions (~50 changes)
Focus rings, ARIA labels, keyboard tab order, escape-to-close, 150ms ease timing, reduced-motion support, tooltip arrow styling.

### 9. mapConstants & mapMarkerBuilders (~30 changes)
Status color contrast refinement, emoji sizing, CSS class-based marker styling, entrance/exit animation keyframes.

### 10. googleMapsLoader & Utilities (~20 changes)
Dark style road label contrast, POI visibility, water feature colors, print style optimization, offline/error overlay styling.

## Design System Tokens
All changes follow existing design system: #141e2b surfaces, #1a5a9e brand blue, #d4a017 brand gold, 2px border-radius, JetBrains Mono for data, system sans-serif for UI.

## Constraints
- No functional changes — visual/UX only
- Maintain all existing hook interfaces
- No new dependencies
- Dark theme throughout
- Mobile-responsive
