import { reportError } from '../../../shared/errors/reportError';
import { ownRow } from './pageAll';
import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import {
  USER_FIELDS, USER_REV, toDb, fromDb, ADMIN_USER_COLUMNS,
} from './fields';

export async function getProfile(userId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('uid', userId)
    .maybeSingle();
  if (error != null) throw error;
  if (!ownRow(data, userId, 'uid')) return null;
  return fromDb(USER_REV, data);
}

export async function updateProfile(userId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(USER_FIELDS, data);
  delete payload.uid;
  const { error } = await getSupabase()
    .from('users')
    .update(payload)
    .eq('uid', userId);
  if (error != null) throw error;
}

const PROFILE_RETRY_MIN_MS = 5_000;
const PROFILE_RETRY_MAX_MS = 60_000;

export function subscribeToProfile(
  userId: string,
  // SB-5: второй аргумент отделяет «строки нет» от «не смогли прочитать». Без
  // него отказ чтения выглядел как пустой профиль, и контекст шёл создавать
  // строку — подставляя вместо ника человека локальную часть адреса почты.
  onUpdate: (data: ProviderRecord | null, unavailable?: boolean) => void,
): () => void {
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = PROFILE_RETRY_MIN_MS;

  // Первичное чтение обязательно. Firestore onSnapshot отдавал текущий
  // документ сразу, а postgres_changes присылает только изменения: без этого
  // профиль оставался пустым до первой чужой записи в строку, и приложение
  // считало, что у человека нет ни ника, ни роли, ни сейфа шифрования.
  const read = async (): Promise<void> => {
    const { data, error } = await getSupabase().from('users').select('*').eq('uid', userId).maybeSingle();
    if (cancelled) return;
    if (error != null) {
      // Сообщаем один раз: офлайн повторы идут до возвращения сети.
      if (retryDelay === PROFILE_RETRY_MIN_MS) reportError(error, { action: 'subscribeToProfile_read', uid: userId }, 'warning');
      onUpdate(null, true);
      // SB-5: «не прочитали» оставляет профиль незагруженным, а без него облачные
      // записи падают с ENCRYPT_REQUIRED. Приложение, открытое офлайн, без
      // повтора так и не синхронизировалось бы до перезагрузки страницы.
      retryTimer = setTimeout(() => { retryTimer = undefined; void read(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, PROFILE_RETRY_MAX_MS);
      return;
    }
    // TB-14 / N-31: тот же запрос, что в getProfile, и та же проверка владельца.
    // Отсюда профиль попадает в приложение: чужая строка включила бы этому
    // аккаунту сейф и согласие на ИИ, а её метки записались бы в его профиль.
    try { ownRow(data, userId, 'uid'); } catch (e) {
      reportError(e, { action: 'subscribeToProfile_foreignRow' });
      onUpdate(null, true);
      return;
    }
    onUpdate(data ? fromDb(USER_REV, data as ProviderRecord) : null);
  };
  void read();

  // Сеть вернулась — не ждать конца паузы.
  const onOnline = () => {
    if (retryTimer === undefined) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    void read();
  };
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  // N-11: подписки на изменения строки нет. Публикация supabase_realtime на
  // сервере пуста (проверено 2026-09-25), поэтому канал держал вебсокет впустую;
  // а включать её для users нельзя не глядя — там сейф и портрет.
  return () => {
    cancelled = true;
    clearTimeout(retryTimer);
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  };
}

export async function getUsers(limitCount: number): Promise<ProviderRecord[]> {
  const { data, error } = await getSupabase()
    .from('admin_users_view')
    .select(ADMIN_USER_COLUMNS)
    .limit(limitCount);
  if (error != null) throw error;
  // Список колонок собран строкой, поэтому supabase-js не выводит тип строки.
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(row => fromDb(USER_REV, row));
}

export async function getAIProfile(userId: string): Promise<ProviderRecord | null> {
  return getProfile(userId);
}

export async function saveAIProfile(userId: string, data: ProviderRecord): Promise<void> {
  return updateProfile(userId, data);
}

export async function getEncryptionMeta(userId: string): Promise<ProviderRecord | null> {
  return getProfile(userId);
}

export async function saveEncryptionMeta(userId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(USER_FIELDS, data);
  delete payload.uid;
  
  const { error } = await getSupabase()
    .from('users')
    .update({
      ...payload,
      encryption_salt: null,
      encrypted_data_key: null,
    })
    .eq('uid', userId);
  if (error != null) throw error;
}

export async function hasLegacyKey(userId: string): Promise<boolean> {
  const profile = await getProfile(userId);
  if (!profile) return false;
  return !!profile.encryptedDataKey && !profile.encryptionMeta;
}
