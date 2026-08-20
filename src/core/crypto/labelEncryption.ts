// src/core/crypto/labelEncryption.ts
import { Label } from '../../types';
import { maybeEncrypt, maybeDecrypt, getEncryptionEnabled } from './cryptoHelpers';
import { getSessionKey } from './encrypt';
import { DataProvider } from '../data';
import { reportError } from '../../shared/errors/reportError';

/**
 * SEC-7: Метки — такие же придуманные человеком строки, как теги: «Практика6»
 * рядом с датами описывает жизнь в общих чертах. Шифруется только name;
 * id и цвет нужны, чтобы нарисовать список до расшифровки, и ничего не рассказывают.
 */
export async function encryptLabel(label: Label, userId: string): Promise<Label & { _encrypted?: boolean }> {
  // Метка, чьё имя не расшифровалось, показывается как «…». Зашифровать эту
  // заглушку — значит стереть настоящее имя навсегда: шифротекст перезаписан,
  // восстанавливать нечего. Список меток пишется целиком при любой правке, так
  // что одно добавление метки при закрытом сейфе унесло бы все остальные.
  if (label._undecrypted && typeof label._cipherName === 'string') {
    return { id: label.id, name: label._cipherName, color: label.color, _encrypted: true };
  }
  const enc = await maybeEncrypt(
    { id: label.id, name: label.name, color: label.color },
    ['name'],
    [],
    userId,
  );
  return enc as unknown as Label & { _encrypted?: boolean };
}

export async function encryptLabels(labels: Label[], userId: string): Promise<Array<Label & { _encrypted?: boolean }>> {
  return Promise.all(labels.map(l => encryptLabel(l, userId)));
}

/**
 * Метка, имя которой сейчас не прочитать. Показывается «…», а исходный
 * шифротекст едет вместе с ней, чтобы обратная запись вернула его как есть.
 */
function undecryptedPlaceholder(label: Record<string, unknown>): Label {
  const placeholder: Label = {
    id: String(label.id || ''),
    name: '…',
    color: String(label.color || ''),
    _undecrypted: true,
  };
  if (typeof label.name === 'string') placeholder._cipherName = label.name;
  return placeholder;
}

export async function decryptLabel(label: Record<string, unknown>): Promise<Label> {
  const isEnc = label._encrypted === true;
  if (!isEnc) {
    return {
      id: String(label.id || ''),
      name: String(label.name || ''),
      color: String(label.color || ''),
    };
  }

  const key = getSessionKey();
  if (!key) {
    // При запертом сейфе сохраняем id и цвет, а имя отображаем нейтральной заглушкой
    return undecryptedPlaceholder(label);
  }

  try {
    const decrypted = await maybeDecrypt(label, ['name'], []);
    return {
      id: String(decrypted.id || ''),
      name: String(decrypted.name || ''),
      color: String(decrypted.color || ''),
    };
  } catch (err) {
    reportError(err, { action: 'decryptLabel', labelId: String(label.id) });
    return undecryptedPlaceholder(label);
  }
}

export async function decryptLabels(labels: Array<Record<string, unknown>>): Promise<Label[]> {
  return Promise.all(labels.map(l => decryptLabel(l)));
}

/**
 * Идемпотентная миграция существующих незашифрованных меток в профиле.
 * Выполняется один раз, когда сейф разблокирован и обнаружены незашифрованные метки.
 */
export async function migrateUnencryptedLabels(
  userId: string,
  rawLabels: Array<Record<string, unknown>>
): Promise<boolean> {
  if (!userId || userId.startsWith('guest') || !Array.isArray(rawLabels) || rawLabels.length === 0) {
    return false;
  }

  if (!getEncryptionEnabled(userId) || !getSessionKey()) {
    return false;
  }

  const hasUnencrypted = rawLabels.some(l => l._encrypted !== true);
  if (!hasUnencrypted) {
    return false;
  }

  try {
    const decrypted = await decryptLabels(rawLabels);
    const encrypted = await encryptLabels(decrypted, userId);
    await DataProvider.updateProfile(userId, { labels: encrypted });
    return true;
  } catch (err) {
    reportError(err, { action: 'migrateUnencryptedLabels', userId });
    return false;
  }
}
