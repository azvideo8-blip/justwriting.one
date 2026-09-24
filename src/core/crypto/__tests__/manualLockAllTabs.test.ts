import { describe, it, expect } from 'vitest';
import { useEncryptionStore, broadcastManualLock } from '../useEncryptionStore';

const tick = () => new Promise(r => setTimeout(r, 30));

// R4-6: «Заблокировать» в одной вкладке оставлял ключ в памяти других.
describe('R4-6: manual lock reaches other tabs', () => {
  it('a manual lock from another tab locks this one', async () => {
    useEncryptionStore.getState().setKey({} as CryptoKey);
    broadcastManualLock();
    await tick();
    expect(useEncryptionStore.getState().isVaultUnlocked).toBe(false);
  });

  it('a plain VAULT_LOCKED (tab closed, idle timeout) does not', async () => {
    useEncryptionStore.getState().setKey({} as CryptoKey);
    const ch = new BroadcastChannel('jw_vault_state');
    ch.postMessage({ type: 'VAULT_LOCKED', timestamp: Date.now() });
    ch.close();
    await tick();
    expect(useEncryptionStore.getState().isVaultUnlocked).toBe(true);
    useEncryptionStore.getState().lockVault();
  });
});
