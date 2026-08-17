import { useEffect, useState } from 'react';

const FZ55_CLASS = 'device-fz55';

function detectFz55(): boolean {
  return (
    navigator.maxTouchPoints > 0 &&
    screen.width >= 1300 && screen.width <= 1960 &&
    screen.height >= 700 && screen.height <= 1120 &&
    !/Mobi|Android/i.test(navigator.userAgent)
  );
}

export function useDeviceClass(): { isFz55: boolean } {
  const [isFz55, setIsFz55] = useState(() => {
    const match = detectFz55();
    if (match) {
      document.documentElement.classList.add(FZ55_CLASS);
    }
    return match;
  });

  useEffect(() => {
    function handleResize() {
      const match = detectFz55();
      if (match) {
        document.documentElement.classList.add(FZ55_CLASS);
      } else {
        document.documentElement.classList.remove(FZ55_CLASS);
      }
      setIsFz55(match);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return { isFz55 };
}
