type FeatureFlag = 'ai_enabled' | 'sync_enabled' | 'encryption_enabled' | 'export_enabled';

const DEFAULTS: Record<FeatureFlag, boolean> = {
  ai_enabled: true,
  sync_enabled: true,
  encryption_enabled: true,
  export_enabled: true,
};

function getRemoteConfigVal(key: string): boolean | undefined {
  try {
    const stored = localStorage.getItem(`ff_${key}`);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch { /* localStorage unavailable */ }
  return undefined;
}

export const featureFlags = {
  isEnabled(flag: FeatureFlag): boolean {
    return getRemoteConfigVal(flag) ?? DEFAULTS[flag];
  },
  setOverride(flag: FeatureFlag, value: boolean): void {
    try {
      localStorage.setItem(`ff_${flag}`, value ? 'true' : 'false');
    } catch { /* localStorage unavailable */ }
  },
  clearOverride(flag: FeatureFlag): void {
    try {
      localStorage.removeItem(`ff_${flag}`);
    } catch { /* localStorage unavailable */ }
  },
};
