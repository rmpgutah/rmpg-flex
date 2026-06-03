import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  createdAt: number;
}

interface ToastContextValue {
  addToast: (message: string, type: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const TOAST_CONFIG = {
  success: {
    bgClass: 'bg-[#0a1a0a]',
    borderClass: 'border-[#2a5a2a]',
    textClass: 'text-[#86efac]',
    progressClass: 'bg-[#4ade80]',
    icon: CheckCircle,
    leftAccent: 'border-l-[3px] border-l-[#4ade80]',
  },
  error: {
    bgClass: 'bg-[#1a0a0a]',
    borderClass: 'border-[#5a2a2a]',
    textClass: 'text-[#fca5a5]',
    progressClass: 'bg-[#f87171]',
    icon: XCircle,
    leftAccent: 'border-l-[3px] border-l-[#f87171]',
  },
  warning: {
    bgClass: 'bg-[#1a1200]',
    borderClass: 'border-[#5a3a1a]',
    textClass: 'text-[#fcd34d]',
    progressClass: 'bg-[#fbbf24]',
    icon: AlertTriangle,
    leftAccent: 'border-l-[3px] border-l-[#fbbf24]',
  },
  info: {
    bgClass: 'bg-[#0a0a0a]',
    borderClass: 'border-[#3a3a3a]',
    textClass: 'text-[#d4a017]',
    progressClass: 'bg-[#d4a017]',
    icon: Info,
    leftAccent: 'border-l-[3px] border-l-[#d4a017]',
  },
};

// Feature 16: Toast notification improvements — Max 3 visible, auto-dismiss 5s, stack from bottom
const MAX_TOASTS = 3;
const DEFAULT_DURATION = 5000;

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ToastItem = ({ toast, onDismiss }: ToastItemProps) => {
  const [progress, setProgress] = useState(100);
  const [isExiting, setIsExiting] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = TOAST_CONFIG[toast.type];
  const Icon = config.icon;

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, 300);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    const endTime = toast.createdAt + toast.duration;

    const updateProgress = () => {
      const now = Date.now();
      const elapsed = now - toast.createdAt;
      const remaining = Math.max(0, 100 - (elapsed / toast.duration) * 100);

      setProgress(remaining);

      if (now >= endTime) {
        handleDismiss();
      }
    };

    const interval = setInterval(updateProgress, 50);

    return () => {
      clearInterval(interval);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [toast, handleDismiss]);

  return (
    <div
      className={`
        ${config.bgClass} ${config.borderClass} ${config.textClass} ${config.leftAccent}
        border backdrop-blur-sm shadow-lg overflow-hidden
        min-w-[320px] max-w-[420px]
        transition-all duration-300 ease-in-out
        ${isExiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
      `}
      style={{
        animation: isExiting ? 'none' : 'slideIn 0.3s ease-out',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <div className="flex items-start gap-3 p-3">
        <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ opacity: 0.9 }} />
        <p className="flex-1 text-[11px] leading-relaxed font-medium">{toast.message}</p>
        <button type="button"
          onClick={handleDismiss}
          className="flex-shrink-0 hover:opacity-70 transition-opacity"
          aria-label="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="h-[1px] bg-black/40">
        <div
          className={`h-full ${config.progressClass} transition-all duration-100 ease-linear`}
          style={{ width: `${progress}%`, opacity: 0.8 }}
        />
      </div>
    </div>
  );
};

const ToastContainer = ({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) => {
  return createPortal(
    <div className="fixed top-[130px] right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>,
    document.body
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType, duration = DEFAULT_DURATION) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast: Toast = {
      id,
      message,
      type,
      duration,
      createdAt: Date.now(),
    };

    setToasts((prev) => {
      const updated = [...prev, newToast];
      // Keep only the last MAX_TOASTS toasts
      if (updated.length > MAX_TOASTS) {
        return updated.slice(updated.length - MAX_TOASTS);
      }
      return updated;
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};
