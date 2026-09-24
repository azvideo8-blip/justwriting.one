import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { RecoveryCodeGate } from '../RecoveryCodeGate';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ user: { uid: 'u1' }, isGuest: false }) }));
vi.mock('../../../../shared/components/RecoveryCodeDisplayModal', () => ({ RecoveryCodeDisplayModal: () => null }));

// R3-2: код восстановления — второй фактор сейфа. В localStorage он жил
// бессрочно и переживал выход; теперь — только в sessionStorage вкладки.
describe('R3-2: the pending recovery code does not stay in localStorage', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('moves a legacy code out of localStorage into the tab session', () => {
    const key = STORAGE_KEYS.PENDING_RECOVERY_CODE('u1');
    localStorage.setItem(key, 'ABCD-EFGH');
    render(<RecoveryCodeGate />);
    expect(localStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem(key)).toBe('ABCD-EFGH');
  });
});
