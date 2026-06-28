import React, { useEffect, useState, useRef } from 'react';
import { mapboxgl } from '../../../utils/mapboxLoader';

interface MapCompassRoseProps {
  mapInstance: mapboxgl.Map | null;
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

  useEffect(() => {
    if (!mapInstance) return;

    const update = () => {
      const h = (mapInstance as any).getBearing?.() || 0;
      setHeading(h);
    };

    const updateTilt = () => {
      const t = mapInstance.getTilt?.() || 0;
      setTilt(t);
    };

    updateHeading();
    updateTilt();

    mapInstance.on('rotate', update);

    return () => {
      mapInstance.off('rotate', update);
    };
  }, [mapInstance]);

  if (!mapInstance) return null;

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
        background: 'rgba(10, 10, 10, 0.88)',
        border: '1px solid #2b2b2b',
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
      onClick={() => { mapInstance.resetNorth(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
        <line x1="20" y1="6" x2="20" y2="34" stroke="#4b4b4b" strokeWidth="0.5" />
        <line x1="6" y1="20" x2="34" y2="20" stroke="#4b4b4b" strokeWidth="0.5" />
        <line x1="29.9" y1="10.1" x2="28.5" y2="11.5" stroke="#4b4b4b" strokeWidth="0.5" />
        <line x1="29.9" y1="29.9" x2="28.5" y2="28.5" stroke="#4b4b4b" strokeWidth="0.5" />
        <line x1="10.1" y1="29.9" x2="11.5" y2="28.5" stroke="#4b4b4b" strokeWidth="0.5" />
        <line x1="10.1" y1="10.1" x2="11.5" y2="11.5" stroke="#4b4b4b" strokeWidth="0.5" />
        <polygon points="20,4 17.5,18 20,16 22.5,18" fill={hovered ? '#e8c44a' : '#d4a017'} opacity={1} />
        <polygon points="20,36 17.5,22 20,24 22.5,22" fill="#666666" />
        <polygon points="36,20 22,17.5 24,20 22,22.5" fill="#666666" />
        <polygon points="4,20 18,17.5 16,20 18,22.5" fill="#666666" />
        <text x="20" y="3.5" textAnchor="middle" fill={hovered ? '#e8c44a' : '#d4a017'} fontSize="5" fontFamily="monospace" fontWeight="bold">N</text>
        <text x="20" y="39.5" textAnchor="middle" fill="#666666" fontSize="4.5" fontFamily="monospace" fontWeight="bold">S</text>
        <text x="39" y="21.5" textAnchor="middle" fill="#666666" fontSize="4.5" fontFamily="monospace" fontWeight="bold">E</text>
        <text x="1" y="21.5" textAnchor="middle" fill="#666666" fontSize="4.5" fontFamily="monospace" fontWeight="bold">W</text>
        <circle cx="20" cy="20" r="2" fill="#d4a017" opacity={hovered ? 1 : 0.75}>
          {hovered && <animate attributeName="r" values="2;2.5;2" dur="1.5s" repeatCount="indefinite" />}
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
