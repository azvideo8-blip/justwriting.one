import { useState, useEffect, useCallback, useRef } from 'react';
import { z } from 'zod';

export function useLocalStorage<T>(key: string, initialValue: T, schema?: z.ZodType<T>) {
  const initialValueRef = useRef(initialValue);
  const schemaRef = useRef(schema);

  const parseStoredValue = useCallback((): T => {
    if (typeof window === 'undefined') return initialValueRef.current;
    try {
      const item = localStorage.getItem(key);
      if (!item) return initialValueRef.current;
      const parsed = JSON.parse(item);
      if (schemaRef.current) {
        const result = schemaRef.current.safeParse(parsed);
        if (!result.success) {
          if (import.meta.env.DEV) {
            console.warn(`Storage schema mismatch for key "${key}":`, result.error);
          }
          try { localStorage.removeItem(key); } catch { /* ignore */ }
          return initialValueRef.current;
        }
        return result.data;
      }
      return parsed as T;
    } catch {
      return initialValueRef.current;
    }
  }, [key]);

  const [storedValue, setStoredValue] = useState<T>(parseStoredValue);

  useEffect(() => {
    setStoredValue(parseStoredValue());
  }, [key, parseStoredValue]);

  useEffect(() => {
    const handler = () => setStoredValue(parseStoredValue());
    window.addEventListener('storage', handler);
    window.addEventListener('local-storage', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('local-storage', handler);
    };
  }, [parseStoredValue]);

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    setStoredValue(prev => {
      const valueToStore = value instanceof Function ? value(prev) : value;
      try {
        localStorage.setItem(key, JSON.stringify(valueToStore));
        window.dispatchEvent(new Event('local-storage'));
      } catch { /* quota exceeded — silently ignore */ }
      return valueToStore;
    });
  }, [key]);

  return [storedValue, setValue] as const;
}
