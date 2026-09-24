import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { RecoveryCodeGate } from '../RecoveryCodeGate';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { clearDeviceKey } from '../../../../core/crypto/keyVaultCache';
import { setRememberDevice } from '../../../../core/crypto/useEncryptionStore';

vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ user: { uid: 'u1' }, isGuest: false }) }));
vi.mock('../../../../core/crypto/keyVaultCache', () => ({ clearDeviceKey: vi.fn(async () => {}) }));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({ setRememberDevice: vi.fn() }));
vi.mock('../../../../shared/components/RecoveryCodeDisplayModal', () => ({
  RecoveryCodeDisplayModal: ({ onConfirm, askRememberDevice }: { onConfirm: (o: { rememberDevice: boolean }) => void; askRememberDevice?: boolean }) => (
    <>
      {askRememberDevice && <span>asks</span>}
      <button onClick={() => onConfirm({ rememberDevice: false })}>shared</button>
      <button onClick={() => onConfirm({ rememberDevice: true })}>mine</button>
    </>
  ),
}));

// R3-9: сейф, созданный при входе, сам включал «запомнить на этом устройстве» —
// на чужом компьютере первый же вход оставлял там авто-разблокировку.
describe('R3-9: the auto-created vault asks whether to remember this device', () => {
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.setItem(STORAGE_KEYS.PENDING_RECOVERY_CODE('u1'), 'ABCD'); });

  it('forgets the device key when the person unticks it', () => {
    render(<RecoveryCodeGate />);
    expect(screen.getByText('asks')).toBeTruthy();
    fireEvent.click(screen.getByText('shared'));
    expect(setRememberDevice).toHaveBeenCalledWith(false);
    expect(clearDeviceKey).toHaveBeenCalledWith('u1');
  });

  it('keeps it by default', () => {
    render(<RecoveryCodeGate />);
    fireEvent.click(screen.getByText('mine'));
    expect(clearDeviceKey).not.toHaveBeenCalled();
  });
});
