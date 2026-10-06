import { getLocalDb } from '../storage/localDb';
import type { AIDocumentEmbedding } from '../storage/localDb';
import { getCurrentUser } from '../auth';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

/**
 * X-5: кэш векторного индекса заметок.
 *
 * `AIEmbeddingService.getAll()` вызывался практически на каждый ход диалога —
 * проактивный блок, лайт-поиск, поиск по вопросу о заметке — и каждый раз
 * поднимал из IndexedDB весь стор: 12 заметок это 400 КБ JSON за ход,
 * 150 заметок ≈ 5 МБ, 500 ≈ 16 МБ.
 *
 * Живёт в `core`, а не в `features/ai`, потому что стор чистят и писатели из
 * ядра (удаление заметки, очистка производных данных), а ядро не может
 * импортировать фичи.
 *
 * Кэш не доверяет писателям: перед выдачей он сверяет набор ключей стора с
 * тем, на котором построен. `getAllKeys` — один дешёвый обход без векторов, и
 * он ловит любое добавление, удаление и `clear()` стора, даже сделанного мимо
 * этого модуля. Меняется набор ключей — индекс перечитывается.
 *
 * Перезапись под тем же ключом (перевекторизация после правки) набор ключей не
 * меняет. В своей вкладке её ловит сброс от писателя, а у других вкладок свой
 * кэш — им сброс передаётся поколением в localStorage: писатель меняет его после
 * записи, читатель сверяет перед выдачей. Без этого вторая вкладка слала модели
 * текст, который человек из заметки уже удалил.
 *
 * Возвращаемый массив общий — читать его, а не менять на месте.
 */
let indexCache: {
  uid: string;
  gen: string;
  keys: Set<string>;
  entries: AIDocumentEmbedding[];
  byId: Map<string, AIDocumentEmbedding>;
} | null = null;

function currentOwner(): string {
  return getCurrentUser()?.uid ?? 'guest';
}

/** Сброс кэша: смена аккаунта, выход, или заведомо групповая чистка стора. */
export function invalidateEmbeddingIndexCache(): void {
  indexCache = null;
  try {
    localStorage.setItem(STORAGE_KEYS.EMB_INDEX_GEN, `${Date.now()}-${Math.random()}`);
  } catch { /* хранилище недоступно: остаётся сверка набора ключей */ }
}

function readGen(): string {
  try { return localStorage.getItem(STORAGE_KEYS.EMB_INDEX_GEN) ?? ''; } catch { return ''; }
}

/** Индекс целиком; перечитывается, если набор ключей в сторе разошёлся. */
export async function readEmbeddingIndex(): Promise<AIDocumentEmbedding[]> {
  const owner = currentOwner();
  // Поколение снимается до чтения стора: запись другой вкладки посреди getAll
  // сменит его, и следующий вызов перечитает индекс.
  const gen = readGen();
  const db = await getLocalDb();
  if (indexCache && indexCache.uid === owner && indexCache.gen === gen) {
    const keys = await db.getAllKeys('aiEmbeddings');
    if (keys.length === indexCache.keys.size && keys.every(k => indexCache!.keys.has(String(k)))) {
      return indexCache.entries;
    }
  }
  const entries = await db.getAll('aiEmbeddings');
  indexCache = {
    uid: owner,
    gen,
    keys: new Set(entries.map(e => e.documentId)),
    entries,
    byId: new Map(entries.map(e => [e.documentId, e])),
  };
  return entries;
}

/** Одна запись из уже сверенного индекса; `null` — кэша нет, читайте точечно. */
export function getCachedEmbedding(documentId: string): AIDocumentEmbedding | undefined | null {
  if (!indexCache || indexCache.uid !== currentOwner() || indexCache.gen !== readGen()) return null;
  return indexCache.byId.get(documentId);
}

if (typeof window !== 'undefined') {
  // Выход стирает локальные хранилища (SEC-29) — индекс обязан уйти вместе с ними.
  window.addEventListener('auth:signed-out', () => { invalidateEmbeddingIndexCache(); });
}
