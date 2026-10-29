// Дейлик 29.10 Н-1 (DY9-1): «Удалить данные с этого устройства» после «сессия
// оборвалась» (wipeDeviceDataForUid) стирало заметки и localStorage, но не
// запомненный ключ сейфа — обычный выход (signOut) его стирает. При следующем
// входе в этот аккаунт сейф открывался без пароля.
// Мутация: убрать clearDeviceKey из wipeDeviceDataForUid → красный.
import { describe, it, expect } from 'vitest';
import { generateDataKey } from '../../../../core/crypto/encrypt';
import { saveDeviceKey, loadDeviceKey } from '../../../../core/crypto/keyVaultCache';
import { AuthService } from '../AuthService';

const UID = '00000000-0000-4000-8000-00000000d29c';

describe('DY9-1: стирание с устройства после оборванной сессии', () => {
  it('запомненный ключ сейфа этого аккаунта тоже стирается', async () => {
    await saveDeviceKey(UID, await generateDataKey());
    expect(await loadDeviceKey(UID)).not.toBeNull();
    await AuthService.wipeDeviceDataForUid(UID);
    expect(await loadDeviceKey(UID)).toBeNull();
  });
});
