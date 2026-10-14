import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../shared/utils/cn';
import { useLayoutMode } from '../hooks/useLayoutMode';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning', action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = React.useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success', action?: ToastAction) => {
    const id = ++nextIdRef.current;
    setToasts(prev => [...prev, action ? { id, message, type, action } : { id, message, type }]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current.delete(id);
    }, 3000);
    timersRef.current.set(id, timer);
  }, []);

  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const { layoutMode } = useLayoutMode();
  // EA-12: стабильное значение контекста — иначе каждый тост перерисовывал всех потребителей.
  const toastValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={toastValue}>
      {children}
      <div
        className={cn(
          'fixed z-[var(--z-skip)] flex flex-col gap-2 pointer-events-none',
          // MC-4 §5: на телефоне тост не ложится на панель инструментов —
          // отступ равен высоте панели вкладок (+ безопасная зона) плюс 12 px,
          // и сам он на всю ширину с полями 16 px.
          layoutMode === 'mobile'
            ? 'left-4 right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+var(--bottom-nav-height,56px)+12px)]'
            : 'bottom-24 right-4',
        )}
        aria-live="polite"
        aria-atomic="false"
        role="status"
      >
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.9 }}
              className={cn(
                "px-4 py-3 rounded-2xl text-sm font-medium backdrop-blur-xl border shadow-lg pointer-events-auto flex items-center gap-3",
                toast.type === 'error'
                  ? "bg-accent-danger/10 border-accent-danger/30 text-accent-danger"
                  : toast.type === 'warning'
                  ? "bg-accent-warning/10 border-accent-warning/30 text-accent-warning"
                  : toast.type === 'info'
                  ? "bg-accent-info/10 border-accent-info/30 text-accent-info"
                  : "bg-accent-success/10 border-accent-success/30 text-accent-success"
              )}
            >
              <span>{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  onClick={toast.action.onClick}
                  className="shrink-0 underline underline-offset-2 text-xs font-semibold opacity-80 hover:opacity-100 transition-opacity"
                >
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

