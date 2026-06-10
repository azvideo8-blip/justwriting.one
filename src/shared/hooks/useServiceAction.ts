import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from '../components/Toast';
import { useLanguage } from '../../shared/i18n';
import { reportError } from '../../shared/errors/reportError';

interface ServiceActionOptions {
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export function useServiceAction() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const { t } = useLanguage();
  const callIdRef = useRef(0);
  const abortedRef = useRef(false);

  useEffect(() => {
    // re-arm on mount: StrictMode runs mount → cleanup → mount, and without
    // this reset the ref stays true forever, silently swallowing onSuccess
    abortedRef.current = false;
    return () => { abortedRef.current = true; };
  }, []);

  const execute = useCallback(async <T>(
    action: (signal?: AbortSignal) => Promise<T>,
    options: ServiceActionOptions = {}
  ): Promise<T | null> => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    callIdRef.current++;
    const callId = callIdRef.current;

    try {
      const result = await action(controller.signal);

      if (abortedRef.current) return null;

      if (options.successMessage) {
        showToast(options.successMessage, 'success');
      }

      options.onSuccess?.();
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
      if (callIdRef.current === callId && !abortedRef.current) setIsLoading(false);
    }
  }, [showToast, t]);

  return { execute, isLoading, error };
}
