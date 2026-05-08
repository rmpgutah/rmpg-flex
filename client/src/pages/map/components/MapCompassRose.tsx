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

  // Generate degree tick marks for the outer ring
  const ticks: { angle: number; length: number; width: number; color: string }[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const isMajor = deg % 90 === 0;
    const isMinor = deg % 45 === 0 && !isMajor;
    const is15 = deg % 15 === 0 && !isMajor && !isMinor;
    ticks.push({
      angle: deg,
      length: isMajor ? 5 : isMinor ? 4 : is15 ? 3 : 2,
      width: isMajor ? 1.2 : isMinor ? 0.8 : 0.5,
      color: isMajor ? '#d4a017' : isMinor ? '#888888' : is15 ? '#555555' : '#333333',
    });
  }

  return (
    <div
      aria-label="Compass rose"
      title="Compass - Click to reset north"
      className="backdrop-blur-md shadow-xl"
      style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 50% 50%, rgba(20,28,38,0.95) 60%, rgba(10,14,20,0.98))',
        border: '1.5px solid #2b2b2b',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        boxShadow: hovered
          ? '0 0 16px rgba(212,160,23,0.35), inset 0 0 12px rgba(0,0,0,0.4)'
          : '0 4px 16px rgba(0,0,0,0.4), inset 0 0 12px rgba(0,0,0,0.3)',
        transition: 'box-shadow 0.25s ease',
      }}
    >
      <svg
        role="img"
        aria-label="Compass pointing north"
        width="48"
        height="48"
        viewBox="0 0 48 48"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          lineHeight: 1.1,
        }}
      >
        {/* Outer degree ring tick marks */}
        {ticks.map((tick) => {
          const rad = (tick.angle - 90) * Math.PI / 180;
          const outerR = 22;
          const innerR = outerR - tick.length;
          return (
            <line
              key={tick.angle}
              x1={24 + outerR * Math.cos(rad)}
              y1={24 + outerR * Math.sin(rad)}
              x2={24 + innerR * Math.cos(rad)}
              y2={24 + innerR * Math.sin(rad)}
              stroke={tick.color}
              strokeWidth={tick.width}
              strokeLinecap="round"
            />
          );
        })}

        {/* Inner circle ring */}
        <circle cx="24" cy="24" r="15" fill="none" stroke="#2a2a2a" strokeWidth="0.5" />

        {/* Cross lines (E-W and N-S subtle lines) */}
        <line x1="24" y1="10" x2="24" y2="38" stroke="#3b3b3b" strokeWidth="0.4" />
        <line x1="10" y1="24" x2="38" y2="24" stroke="#3b3b3b" strokeWidth="0.4" />

        {/* 45-degree tick marks (NE, SE, SW, NW) */}
        <line x1="33.9" y1="14.1" x2="32.5" y2="15.5" stroke="#3b3b3b" strokeWidth="0.5" />
        <line x1="33.9" y1="33.9" x2="32.5" y2="32.5" stroke="#3b3b3b" strokeWidth="0.5" />
        <line x1="14.1" y1="33.9" x2="15.5" y2="32.5" stroke="#3b3b3b" strokeWidth="0.5" />
        <line x1="14.1" y1="14.1" x2="15.5" y2="15.5" stroke="#3b3b3b" strokeWidth="0.5" />

        {/* North arrow with gold gradient */}
        <defs>
          <linearGradient id="northGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hovered ? '#f0d060' : '#e8c44a'} />
            <stop offset="100%" stopColor={hovered ? '#d4a017' : '#b8860b'} />
          </linearGradient>
        </defs>
        <polygon points="24,5 21,22 24,19 27,22" fill="url(#northGrad)" />
        {/* South arrow (dim) */}
        <polygon points="24,43 21,26 24,29 27,26" fill="#555555" />
        {/* East arrow */}
        <polygon points="43,24 26,21 29,24 26,27" fill="#555555" />
        {/* West arrow */}
        <polygon points="5,24 22,21 19,24 22,27" fill="#555555" />

        {/* Cardinal letters */}
        <text x="24" y="4" textAnchor="middle" fill={hovered ? '#f0d060' : '#d4a017'} fontSize="5" fontFamily="monospace" fontWeight="bold">N</text>
        <text x="24" y="47.5" textAnchor="middle" fill="#555555" fontSize="4" fontFamily="monospace" fontWeight="bold">S</text>
        <text x="46.5" y="25.5" textAnchor="middle" fill="#555555" fontSize="4" fontFamily="monospace" fontWeight="bold">E</text>
        <text x="1.5" y="25.5" textAnchor="middle" fill="#555555" fontSize="4" fontFamily="monospace" fontWeight="bold">W</text>

        {/* Center dot with glow */}
        <circle cx="24" cy="24" r="2.5" fill="#d4a017" opacity={hovered ? 1 : 0.75}>
          {hovered && <animate attributeName="r" values="2.5;3;2.5" dur="1.5s" repeatCount="indefinite" />}
        </circle>
        {/* Outer glow ring on hover */}
        {hovered && (
          <circle cx="24" cy="24" r="4" fill="none" stroke="#d4a01740" strokeWidth="1">
            <animate attributeName="r" values="4;5;4" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.5s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
    </div>
  );
}
