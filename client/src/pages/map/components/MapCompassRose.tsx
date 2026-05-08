import { useEffect, useMemo, useState, useRef } from 'react';

interface MapCompassRoseProps {
  mapInstance: google.maps.Map | null;
}

/** Degree tick marks at 30° intervals for the outer ring */
const TICK_DEGREES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const CENTER = 28;
const OUTER_R = 26;
const TICK_INNER_R = 23;
const TICK_MAJOR_INNER_R = 21.5;

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export default function MapCompassRose({ mapInstance }: MapCompassRoseProps) {
  const [heading, setHeading] = useState(0);
  const [tilt, setTilt] = useState(0);
  const [hovered, setHovered] = useState(false);
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const tiltListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const prefersReducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    if (!mapInstance) return;

    const updateHeading = () => {
      const h = mapInstance.getHeading?.() || 0;
      setHeading(h);
    };

    const updateTilt = () => {
      const t = mapInstance.getTilt?.() || 0;
      setTilt(t);
    };

    updateHeading();
    updateTilt();

    // heading_changed fires when the user rotates the map (tilt mode or 45-degree imagery)
    listenerRef.current = google.maps.event.addListener(mapInstance, 'heading_changed', updateHeading);
    tiltListenerRef.current = google.maps.event.addListener(mapInstance, 'tilt_changed', updateTilt);

    return () => {
      if (listenerRef.current) {
        google.maps.event.removeListener(listenerRef.current);
        listenerRef.current = null;
      }
      if (tiltListenerRef.current) {
        google.maps.event.removeListener(tiltListenerRef.current);
        tiltListenerRef.current = null;
      }
    };
  }, [mapInstance]);

  if (!mapInstance) return null;

  // SVG rotates opposite to map heading so north always points to geographic north
  const rotation = -heading;
  const bearingStr = String(Math.round(((heading % 360) + 360) % 360)).padStart(3, '0');
  const goldColor = hovered ? '#e8c44a' : '#d4a017';

  return (
    <div
      aria-label="Compass rose"
      title="Compass - Click to reset north"
      className="backdrop-blur-md shadow-xl"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      {/* Main compass circle */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'rgba(13, 21, 32, 0.88)',
          border: '1px solid #2b2b2b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          boxShadow: hovered
            ? '0 0 14px rgba(212,160,23,0.35), 0 0 28px rgba(212,160,23,0.12)'
            : '0 0 8px rgba(212,160,23,0.08)',
          transition: 'box-shadow 0.3s ease',
          position: 'relative',
        }}
        role="button"
        tabIndex={0}
        onClick={() => { if (mapInstance) { mapInstance.setHeading?.(0); mapInstance.setTilt?.(0); } }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (mapInstance) { mapInstance.setHeading?.(0); mapInstance.setTilt?.(0); } } }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <svg
          role="img"
          aria-label={`Compass pointing north, bearing ${bearingStr}°`}
          width="56"
          height="56"
          viewBox="0 0 56 56"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
          }}
        >
          <defs>
            {/* North arrow gradient */}
            <linearGradient id="northGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f0d050" />
              <stop offset="100%" stopColor="#b8860b" />
            </linearGradient>
            {/* North arrow glow */}
            <filter id="northGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Pulsing outer ring glow */}
            <filter id="ringGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="0.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Outer glow ring with pulse animation */}
          <circle cx={CENTER} cy={CENTER} r={OUTER_R} fill="none" stroke={goldColor} strokeWidth="0.5" opacity="0.3" filter="url(#ringGlow)">
            {!prefersReducedMotion && <animate attributeName="opacity" values="0.15;0.35;0.15" dur="3s" repeatCount="indefinite" />}
          </circle>

          {/* Outer ring */}
          <circle cx={CENTER} cy={CENTER} r={OUTER_R} fill="none" stroke="#3a3a3a" strokeWidth="0.7" />

          {/* Degree tick marks at 30° intervals */}
          {TICK_DEGREES.map((deg) => {
            const isMajor = deg % 90 === 0;
            const innerR = isMajor ? TICK_MAJOR_INNER_R : TICK_INNER_R;
            const rad = degToRad(deg - 90);
            return (
              <line
                key={deg}
                x1={CENTER + innerR * Math.cos(rad)}
                y1={CENTER + innerR * Math.sin(rad)}
                x2={CENTER + OUTER_R * Math.cos(rad)}
                y2={CENTER + OUTER_R * Math.sin(rad)}
                stroke={isMajor ? '#666' : '#444'}
                strokeWidth={isMajor ? 1 : 0.5}
              />
            );
          })}

          {/* Cross lines (E-W and N-S subtle lines) */}
          <line x1={CENTER} y1="10" x2={CENTER} y2="46" stroke="#3a3a3a" strokeWidth="0.4" />
          <line x1="10" y1={CENTER} x2="46" y2={CENTER} stroke="#3a3a3a" strokeWidth="0.4" />

          {/* 45-degree tick marks */}
          {[45, 135, 225, 315].map((deg) => {
            const rad = degToRad(deg - 90);
            return (
              <line
                key={deg}
                x1={CENTER + 20 * Math.cos(rad)}
                y1={CENTER + 20 * Math.sin(rad)}
                x2={CENTER + TICK_INNER_R * Math.cos(rad)}
                y2={CENTER + TICK_INNER_R * Math.sin(rad)}
                stroke="#3a3a3a"
                strokeWidth="0.4"
              />
            );
          })}

          {/* North arrow with gradient fill and glow */}
          <polygon
            points={`${CENTER},6 ${CENTER - 3},24 ${CENTER},21.5 ${CENTER + 3},24`}
            fill="url(#northGrad)"
            filter="url(#northGlow)"
            style={{ transition: 'fill 0.2s ease' }}
          />
          {/* South arrow */}
          <polygon points={`${CENTER},50 ${CENTER - 3},32 ${CENTER},34.5 ${CENTER + 3},32`} fill="#555" />
          {/* East arrow */}
          <polygon points={`50,${CENTER} 32,${CENTER - 3} 34.5,${CENTER} 32,${CENTER + 3}`} fill="#555" />
          {/* West arrow */}
          <polygon points={`6,${CENTER} 24,${CENTER - 3} 21.5,${CENTER} 24,${CENTER + 3}`} fill="#555" />

          {/* Cardinal labels */}
          <text x={CENTER} y="5" textAnchor="middle" fill={goldColor} fontSize="5.5" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">N</text>
          <text x={CENTER} y="54" textAnchor="middle" fill="#666" fontSize="4.5" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">S</text>
          <text x="53.5" y={CENTER + 1.5} textAnchor="middle" fill="#666" fontSize="4.5" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">E</text>
          <text x="2.5" y={CENTER + 1.5} textAnchor="middle" fill="#666" fontSize="4.5" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">W</text>

          {/* Intercardinal labels (NE, SE, SW, NW) */}
          <text x="43" y="14.5" textAnchor="middle" fill="#4a4a4a" fontSize="3.2" fontFamily="'JetBrains Mono', monospace">NE</text>
          <text x="43" y="43.5" textAnchor="middle" fill="#4a4a4a" fontSize="3.2" fontFamily="'JetBrains Mono', monospace">SE</text>
          <text x="13" y="43.5" textAnchor="middle" fill="#4a4a4a" fontSize="3.2" fontFamily="'JetBrains Mono', monospace">SW</text>
          <text x="13" y="14.5" textAnchor="middle" fill="#4a4a4a" fontSize="3.2" fontFamily="'JetBrains Mono', monospace">NW</text>

          {/* Center dot with hover glow */}
          <circle cx={CENTER} cy={CENTER} r="2.2" fill="#d4a017" opacity={hovered ? 1 : 0.8}>
            {hovered && !prefersReducedMotion && <animate attributeName="r" values="2.2;2.8;2.2" dur="1.5s" repeatCount="indefinite" />}
          </circle>
        </svg>
      </div>

      {/* Bearing + tilt readout below the compass */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          lineHeight: 1.1,
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: goldColor,
            letterSpacing: '0.5px',
            transition: 'color 0.2s ease',
          }}
        >
          {bearingStr}°
        </span>
        {tilt > 0 && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 7,
              color: '#555',
              letterSpacing: '0.3px',
            }}
          >
            tilt {Math.round(tilt)}°
          </span>
        )}
      </div>
    </div>
  );
}
