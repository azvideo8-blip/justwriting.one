// BS (N-2): имена событий сейфа живут отдельно от EncryptionService — оболочка
// слушает «пароль сошёлся» на каждом входе, а тянуть из-за строки весь сервис
// шифрования (и его рёбра в SyncService) в стартовый кусок незачем.
export const VAULT_PASSWORD_CONVERGED_EVENT = 'vault-password-converged';
