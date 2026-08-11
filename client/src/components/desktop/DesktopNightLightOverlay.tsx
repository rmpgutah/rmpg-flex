import React from 'react';
import { useDesktopSystem } from '../../context/DesktopSystemContext';

export default function DesktopNightLightOverlay() {
  const { nightLightOn, nightLightIntensity } = useDesktopSystem();
  if (!nightLightOn) return null;
  const alpha = (nightLightIntensity / 100) * 0.45;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99990, pointerEvents: 'none',
      background: `rgba(255,160,50,${alpha})`,
      mixBlendMode: 'multiply',
    }} />
  );
}
