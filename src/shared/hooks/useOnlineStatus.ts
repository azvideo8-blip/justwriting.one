import { useState, useEffect } from 'react';

type Listener = (online: boolean) => void;

let _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
const _listeners = new Set<Listener>();
let _refCount = 0;

function handleOnline() {
  _isOnline = true;
  _listeners.forEach(fn => fn(true));
}

function handleOffline() {
  _isOnline = false;
  _listeners.forEach(fn => fn(false));
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => _isOnline);

  useEffect(() => {
    _listeners.add(setOnline);
    
    if (_refCount === 0 && typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }
    _refCount++;

    return () => {
      _listeners.delete(setOnline);
      _refCount--;
      if (_refCount === 0 && typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, []);

  return online;
}
