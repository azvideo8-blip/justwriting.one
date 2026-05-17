let _lastCheck = 0;
let _lastUsage = 0;

export function getLocalStorageUsageKB(): number {
  const now = Date.now();
  if (now - _lastCheck < 60_000) return _lastUsage;
  let total = 0;
  for (const key in localStorage) {
    if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
      total += (localStorage[key].length + key.length) * 2;
    }
  }
  _lastCheck = now;
  _lastUsage = total / 1024;
  return _lastUsage;
}
