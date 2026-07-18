import { useState, useEffect } from 'react';

const TIME_ZONE = 'America/Denver';

function format(): { time: string; date: string } {
  const now = new Date();
  return {
    time: new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(now),
    date: new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    }).format(now),
  };
}

export function useClock(): { time: string; date: string } {
  const [now, setNow] = useState(format);

  useEffect(() => {
    const interval = setInterval(() => setNow(format()), 1000);
    return () => clearInterval(interval);
  }, []);

  return now;
}
