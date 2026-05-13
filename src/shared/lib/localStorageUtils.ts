export function getLocalStorageUsageKB(): number {
  let total = 0;
  for (const key in localStorage) {
    if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
      total += (localStorage[key].length + key.length) * 2;
    }
  }
  return total / 1024;
}
