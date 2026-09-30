import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from '../components/Toast';
import { useLanguage } from '../../shared/i18n';
import { reportError } from '../../shared/errors/reportError';

interface ServiceActionOptions<T = unknown> {
  successMessage?: string | ((result: T) => string | undefined);
  errorMessage?: string;
  onSuccess?: (result: T) => void;
  onError?: (error: unknown) => void;
}

export function useServiceAction() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const { t } = useLanguage();
  const callIdRef = useRef(0);
  const abortedRef = useRef(false);
  // R4-077: повторный клик по кнопке запускал вторую параллельную операцию,
  // пока первая ещё летит.
  const inFlightRef = useRef(false);

  useEffect(() => {
    // re-arm on mount: StrictMode runs mount → cleanup → mount, and without
    // this reset the ref stays true forever, silently swallowing onSuccess
    abortedRef.current = false;
    return () => { abortedRef.current = true; };
  }, []);

  const execute = useCallback(async <T>(
    action: (signal?: AbortSignal) => Promise<T>,
    options: ServiceActionOptions<T> = {}
  ): Promise<T | null> => {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    callIdRef.current++;
    const callId = callIdRef.current;

    try {
      const result = await action(controller.signal);

      if (abortedRef.current) return null;

      if (options.successMessage !== undefined) {
        const msg = typeof options.successMessage === 'function' ? options.successMessage(result) : options.successMessage;
        if (msg) showToast(msg, 'success');
      }

      options.onSuccess?.(result);
      return result;

    } catch (err) {
      if (abortedRef.current) return null;
      reportError(err, { action: 'serviceAction/execute' });
      const message = options.errorMessage || t('error_generic_action');
      setError(message);
      showToast(message, 'error');
      options.onError?.(err);
      return null;

    } finally {
      inFlightRef.current = false;
      if (callIdRef.current === callId && !abortedRef.current) setIsLoading(false);
    }
  }, [showToast, t]);

  return { execute, isLoading, error };
}
