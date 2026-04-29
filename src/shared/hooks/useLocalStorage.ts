import { useState, useEffect, useCallback, useRef } from 'react';
import { z } from 'zod';

export function useLocalStorage<T>(key: string, initialValue: T, schema?: z.ZodType<T>) {
  const initialValueRef = useRef(initialValue);
  const schemaRef = useRef(schema);

  const readValue = useCallback((): T => {
    if (typeof window === 'undefined') {
      return initialValueRef.current;
    }

    try {
      const item = window.localStorage.getItem(key);
      if (!item) return initialValueRef.current;

      const parsed = JSON.parse(item);

      if (schemaRef.current) {
        const result = schemaRef.current.safeParse(parsed);
        if (!result.success) {
          if (import.meta.env.DEV) {
            console.warn(`Storage schema mismatch for key "${key}":`, result.error);
          }
          return initialValueRef.current;
        }
        return result.data;
      }

      return parsed as T;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(`Error reading localStorage key "${key}":`, error);
      }
      return initialValueRef.current;
    }
  }, [key]);

  const [storedValue, setStoredValue] = useState<T>(readValue);

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      setStoredValue(prev => {
        const valueToStore = value instanceof Function ? value(prev) : value;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
          window.dispatchEvent(new Event('local-storage'));
        }
        return valueToStore;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        console.error(`localStorage quota exceeded for key "${key}"`);
      } else if (import.meta.env.DEV) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
    }
  }, [key]);

  useEffect(() => {
    setStoredValue(readValue());
  }, [readValue]);

  const handleStorageChange = useCallback(
    (event: StorageEvent | CustomEvent) => {
      if ((event as StorageEvent).key && (event as StorageEvent).key !== key) {
        return;
      }
      setStoredValue(readValue());
    },
    [key, readValue],
  );

  useEffect(() => {
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('local-storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('local-storage', handleStorageChange);
    };
  }, [handleStorageChange]);

  return [storedValue, setValue] as const;
}
