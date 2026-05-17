import { useState, useEffect } from 'react';

type Listener = (online: boolean) => void;

let _isOnline = navigator.onLine;
const _listeners = new Set<Listener>();

function notify() {
  _listeners.forEach(fn => fn(_isOnline));
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { _isOnline = true; notify(); });
  window.addEventListener('offline', () => { _isOnline = false; notify(); });
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => _isOnline);

  useEffect(() => {
    _listeners.add(setOnline);
    return () => { _listeners.delete(setOnline); };
  }, []);

  return online;
}
