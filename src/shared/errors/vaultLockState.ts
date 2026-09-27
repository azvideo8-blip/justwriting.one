type VaultLockedChecker = () => boolean;

let vaultLockedChecker: VaultLockedChecker | null = null;

export function registerVaultLockedChecker(checker: VaultLockedChecker | null): void {
  vaultLockedChecker = checker;
}

export function isVaultLocked(): boolean {
  try {
    return vaultLockedChecker ? vaultLockedChecker() : false;
  } catch {
    return false;
  }
}
