let _lastCheck = 0;
let _lastUsage = 0;

export function getLocalStorageUsageKB(): number {
  const now = Date.now();
  if (now - _lastCheck < 60_000) return _lastUsage;
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    total += (value.length + key.length) * 2;
  }
  _lastCheck = now;
  _lastUsage = total / 1024;
  return _lastUsage;
}
