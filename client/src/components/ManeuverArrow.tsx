// ============================================================
// RMPG Flex — Maneuver Arrow
// Crisp SVG turn-by-turn direction indicator for the dispatch
// mini-map nav banner. Replaces the old single Unicode glyph
// (▲ ↰ ↑), which rendered fuzzy and inconsistently across fonts.
//
// A filled navigation pointer is rotated to the maneuver bearing
// for directional turns; 'arrive' and 'roundabout' get bespoke
// shapes where a rotated arrow would read wrong. The arrow sits in
// a beveled chip so it stays defined against the live map tiles.
// ============================================================

import React from 'react';

interface ManeuverArrowProps {
  /** Mapbox maneuver type: depart | turn | merge | arrive | roundabout … */
  type?: string;
  /** Mapbox maneuver modifier: left | right | slight left | uturn … */
  modifier?: string;
  /** Overall chip size in px (default 26). */
  size?: number;
  /** Arrow color (default brand gold). */
  color?: string;
}

/**
 * Map a Mapbox maneuver type/modifier to a clockwise rotation in degrees,
 * where 0° points straight up (direction of travel). Returns null for
 * maneuvers that have their own dedicated glyph (arrive, roundabout).
 */
function maneuverAngle(type?: string, modifier?: string): number {
  if (modifier === 'uturn') return 180;
  if (modifier === 'slight left') return -45;
  if (modifier === 'sharp left') return -135;
  if (modifier === 'slight right') return 45;
  if (modifier === 'sharp right') return 135;
  if (modifier?.includes('left')) return -90;
  if (modifier?.includes('right')) return 90;
  // depart / continue / merge / straight → straight ahead
  return 0;
}

export default function ManeuverArrow({
  type,
  modifier,
  size = 26,
  color = '#d4a017',
}: ManeuverArrowProps) {
  const special =
    type === 'arrive' ? 'arrive'
    : (type === 'roundabout' || type === 'rotary') ? 'roundabout'
    : null;
  const angle = maneuverAngle(type, modifier);

  const glyphLabel =
    special === 'arrive' ? 'Arrive at destination'
    : special === 'roundabout' ? 'Enter roundabout'
    : modifier ? `Maneuver: ${modifier}`
    : 'Continue straight';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        background: '#161616',
        border: '1px solid #2e2e2e',
        borderRadius: 4,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.5)',
        flexShrink: 0,
      }}
    >
      <svg
        width={size * 0.74}
        height={size * 0.74}
        viewBox="0 0 24 24"
        role="img"
        aria-label={glyphLabel}
      >
        {special === 'arrive' ? (
          // Target / destination reticle
          <g>
            <circle cx="12" cy="12" r="7" fill="none" stroke={color} strokeWidth="2.2" />
            <circle cx="12" cy="12" r="2.6" fill={color} />
          </g>
        ) : special === 'roundabout' ? (
          // Loop with an exit arrow toward the upper-right
          <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21 V15.5" />
            <circle cx="12" cy="10.5" r="4.7" />
            <path d="M16.4 6.6 L18.4 4.2 L19 7.4" fill={color} stroke="none" />
          </g>
        ) : (
          // Directional navigation pointer, rotated to the maneuver bearing.
          // Concave-bottom arrow = the classic GPS heading shape.
          <g transform={`rotate(${angle} 12 12)`}>
            <path
              d="M12 3 L19 19 L12 15 L5 19 Z"
              fill={color}
              stroke="#000000"
              strokeWidth="0.85"
              strokeLinejoin="round"
            />
          </g>
        )}
      </svg>
    </span>
  );
}
