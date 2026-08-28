import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { apiHttpBase, WORKER_HTTP_ORIGIN } from '../utils/apiOrigin';

function cloudApiBase(): string {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    const relative = apiHttpBase();
    return relative || window.location.origin;
  }
  return WORKER_HTTP_ORIGIN;
}

const CLOUD_BASE = cloudApiBase();
const LOCAL_BASE: string | null = import.meta.env.VITE_LOCAL_SERVER_URL ?? null;
const PROBE_TIMEOUT_MS = 500;
const REPROBE_INTERVAL_MS = 30_000;

export interface ApiBaseValue {
  cloudBase: string;
  localBase: string | null;
  activeBase: string;
  mode: 'local' | 'cloud';
  isProbing: boolean;
}

export async function probeLocal(localBase: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${localBase}/api/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const ApiBaseContext = createContext<ApiBaseValue>({
  cloudBase: CLOUD_BASE,
  localBase: LOCAL_BASE,
  activeBase: CLOUD_BASE,
  mode: 'cloud',
  isProbing: false,
});

export function useApiBase(): ApiBaseValue {
  return useContext(ApiBaseContext);
}

export function ApiBaseProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'local' | 'cloud'>('cloud');
  const [isProbing, setIsProbing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runProbe = useCallback(async () => {
    if (!LOCAL_BASE) return;
    setIsProbing(true);
    const ok = await probeLocal(LOCAL_BASE);
    setMode(ok ? 'local' : 'cloud');
    setIsProbing(false);
  }, []);

  useEffect(() => {
    runProbe();
    intervalRef.current = setInterval(runProbe, REPROBE_INTERVAL_MS);

    const onFocus = () => runProbe();
    const onOnline = () => runProbe();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [runProbe]);

  const activeBase = mode === 'local' && LOCAL_BASE ? LOCAL_BASE : CLOUD_BASE;

  return (
    <ApiBaseContext.Provider
      value={{ cloudBase: CLOUD_BASE, localBase: LOCAL_BASE, activeBase, mode, isProbing }}
    >
      {children}
    </ApiBaseContext.Provider>
  );
}
