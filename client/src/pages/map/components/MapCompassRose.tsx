import React, { useEffect, useState, useRef } from 'react';

interface MapCompassRoseProps {
  mapInstance: google.maps.Map | null;
}

export default function MapCompassRose({ mapInstance }: MapCompassRoseProps) {
  const [heading, setHeading] = useState(0);
  const [hovered, setHovered] = useState(false);
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);

  useEffect(() => {
    if (!mapInstance) return;

    const update = () => {
      const h = mapInstance.getHeading?.() || 0;
      setHeading(h);
    };

    update();

    // heading_changed fires when the user rotates the map (tilt mode or 45-degree imagery)
    listenerRef.current = google.maps.event.addListener(mapInstance, 'heading_changed', update);

    return () => {
      if (listenerRef.current) {
        google.maps.event.removeListener(listenerRef.current);
        listenerRef.current = null;
      }
    };
  }, [mapInstance]);

  if (!mapInstance) return null;

  // SVG rotates opposite to map heading so north always points to geographic north
  const rotation = -heading;

  return (
    <div
      aria-label="Compass rose"
      title="Compass - Click to reset north"
      className="backdrop-blur-md shadow-xl"
      style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: 'rgba(13, 21, 32, 0.88)',
        border: '1px solid #2b2b2b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        boxShadow: hovered ? '0 0 12px rgba(212,160,23,0.3)' : undefined,
        transition: 'box-shadow 0.2s ease',
      }}
      onClick={() => { if (mapInstance) mapInstance.setHeading?.(0); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg
        role="img"
        aria-label="Compass pointing north"
        width="40"
        height="40"
        viewBox="0 0 40 40"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 0.25s ease-out',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
        }}
      >
        {/* Cross lines (E-W and N-S subtle lines) */}
        <line x1="20" y1="6" x2="20" y2="34" stroke="#3a4f66" strokeWidth="0.5" />
        <line x1="6" y1="20" x2="34" y2="20" stroke="#3a4f66" strokeWidth="0.5" />

        {/* 45-degree tick marks (NE, SE, SW, NW) */}
        <line x1="29.9" y1="10.1" x2="28.5" y2="11.5" stroke="#3a4f66" strokeWidth="0.5" />
        <line x1="29.9" y1="29.9" x2="28.5" y2="28.5" stroke="#3a4f66" strokeWidth="0.5" />
        <line x1="10.1" y1="29.9" x2="11.5" y2="28.5" stroke="#3a4f66" strokeWidth="0.5" />
        <line x1="10.1" y1="10.1" x2="11.5" y2="11.5" stroke="#3a4f66" strokeWidth="0.5" />

        {/* #16: North arrow with brighter hover state */}
        <polygon points="20,4 17.5,18 20,16 22.5,18" fill={hovered ? '#e8c44a' : '#d4a017'} opacity={1} />
        {/* South arrow (dim white) */}
        <polygon points="20,36 17.5,22 20,24 22.5,22" fill="#666666" />
        {/* East arrow */}
        <polygon points="36,20 22,17.5 24,20 22,22.5" fill="#666666" />
        {/* West arrow */}
        <polygon points="4,20 18,17.5 16,20 18,22.5" fill="#666666" />

        {/* Cardinal letters */}
        <text x="20" y="3.5" textAnchor="middle" fill={hovered ? '#e8c44a' : '#d4a017'} fontSize="5" fontFamily="monospace" fontWeight="bold">N</text>
        <text x="20" y="39.5" textAnchor="middle" fill="#666666" fontSize="4.5" fontFamily="monospace" fontWeight="bold">S</text>
        <text x="39" y="21.5" textAnchor="middle" fill="#666666" fontSize="4.5" fontFamily="monospace" fontWeight="bold">E</text>
        <text x="1" y="21.5" textAnchor="middle" fill="#666666" fontSize="4.5" fontFamily="monospace" fontWeight="bold">W</text>

        {/* #17: Center dot with hover glow */}
        <circle cx="20" cy="20" r="2" fill="#d4a017" opacity={hovered ? 1 : 0.75}>
          {hovered && <animate attributeName="r" values="2;2.5;2" dur="1.5s" repeatCount="indefinite" />}
        </circle>
      </svg>
    </div>
  );
}
