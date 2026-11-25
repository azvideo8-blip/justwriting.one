import { Label } from '../../types';
import { maybeEncrypt, maybeDecrypt, getEncryptionEnabled } from './cryptoHelpers';
import { getSessionKey, decryptContent } from './encrypt';
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
export function undecryptedPlaceholder(label: Record<string, unknown>): Label {
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

type RawLabels = Array<Record<string, unknown>>;

/**
 * LB-1: разовый проход над списком меток. `fix` отдаёт исправленный список или
 * null, если чинить нечего. Сначала — на списке вызывающего (здоровый профиль не
 * стоит ни одного запроса), затем на свежем чтении, и запись идёт под версией
 * строки этого чтения: проход запускают без ожидания, и список вызывающего к
 * моменту записи уже мог устареть — раньше он ложился поверх свежей метки.
 * Строку записали между чтением и записью — выходим, следующее чтение профиля
 * запустит проход заново.
 */
async function rewriteLabels(
  userId: string,
  seen: RawLabels,
  action: string,
  fix: (labels: RawLabels) => Promise<RawLabels | null>,
): Promise<boolean> {
  if (!userId || userId.startsWith('guest') || !Array.isArray(seen) || seen.length === 0) return false;
  if (!getEncryptionEnabled(userId) || !getSessionKey()) return false;
  try {
    if (!(await fix(seen))) return false;
    const row = await DataProvider.getProfileLabels(userId);
    if (!row || !Array.isArray(row.labels)) return false;
    const fixed = await fix(row.labels as RawLabels);
    return fixed ? await DataProvider.replaceProfileLabels(userId, row.version, fixed) : false;
  } catch (err) {
    reportError(err, { action, userId });
    return false;
  }
}

/**
 * Идемпотентная миграция существующих незашифрованных меток в профиле.
 * Выполняется, когда сейф разблокирован и обнаружены незашифрованные метки.
 */
export function migrateUnencryptedLabels(userId: string, rawLabels: RawLabels): Promise<boolean> {
  return rewriteLabels(userId, rawLabels, 'migrateUnencryptedLabels', async labels =>
    labels.some(l => l._encrypted !== true)
      ? (await encryptLabels(await decryptLabels(labels), userId)) as unknown as RawLabels
      : null);
}

/**
 * SEC-7b: Идемпотентный ремонт меток с двойным шифрованием.
 *
 * Если имя метки после расшифровки само по себе оказывается валидным
 * шифротекстом, значит список был зашифрован повторно (например, при чтении
 * через useProfileLabels до того, как ProfileService.getProfile научился расшифровке).
 *
 * Функция расшифровывает второй слой и сохраняет в облако правильно зашифрованный список.
 * При отсутствии двойного шифрования ничего в базу не пишет и возвращает false.
 */
export function repairDoubleEncryptedLabels(userId: string, rawLabels: RawLabels): Promise<boolean> {
  return rewriteLabels(userId, rawLabels, 'repairDoubleEncryptedLabels', async labels => {
    const key = getSessionKey();
    if (!key) return null;
    let hasDoubleEncrypted = false;
    const repaired: Label[] = [];
    for (const label of await decryptLabels(labels)) {
      if (label._undecrypted) { repaired.push(label); continue; }
      let name = label.name;
      try {
        name = await decryptContent(name, key);
        hasDoubleEncrypted = true;
      } catch {
        // Обычное одиночно зашифрованное имя: расшифровка не-шифротекста завершается с ошибкой
      }
      repaired.push({ id: label.id, name, color: label.color });
    }
    return hasDoubleEncrypted ? (await encryptLabels(repaired, userId)) as unknown as RawLabels : null;
  });
}
