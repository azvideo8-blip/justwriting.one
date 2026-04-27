import { useState, useCallback } from 'react';
import { useToast } from '../../../shared/components/Toast';
import { useLanguage } from '../../../core/i18n';

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

  const execute = useCallback(async <T>(
    action: () => Promise<T>,
    options: ServiceActionOptions = {}
  ): Promise<T | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await action();

      if (options.successMessage) {
        showToast(options.successMessage, 'success');
      }

      options.onSuccess?.();
      return result;

    } catch (err) {
      const message = options.errorMessage || t('error_generic_action');
      setError(message);
      showToast(message, 'error');
      options.onError?.(err);
      if (import.meta.env.DEV) {
        console.error('[useServiceAction]', err);
      }
      return null;

    } finally {
      setIsLoading(false);
    }
  }, [showToast, t]);

  return { execute, isLoading, error };
}
