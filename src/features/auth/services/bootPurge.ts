import { processPendingPurges } from '../../../core/storage/localDb';
import { clearAccountScopedStorage } from './accountScopedKeys';

/**
 * S-63 (S-48): доочистка удалённого аккаунта на старте — не только базы, но и
 * ключи localStorage этого uid (в том числе открытый `draft-<uid>`), как делает
 * wipeDeviceDataForUid. Живёт в auth: core не импортирует features.
 */
export async function finishPendingPurges(): Promise<void> {
  for (const uid of await processPendingPurges()) clearAccountScopedStorage(uid);
}
