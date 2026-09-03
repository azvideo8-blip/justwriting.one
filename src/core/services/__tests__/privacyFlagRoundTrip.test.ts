import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * «Не показывать эту заметку ИИ» должно пережить дорогу в облако и обратно.
 *
 * Колонка `excluded_from_ai` в базе есть, а выгрузка её не отправляла и
 * загрузка не восстанавливала. То есть на втором устройстве флаг молча
 * сбрасывался, и заметку, которую человек прямо запретил показывать модели,
 * начинал читать индексатор.
 */

const { LocalDocumentService } = await import('../LocalDocumentService');
const { getLocalDb } = await import('../../storage/localDb');

describe('флаг «исключить из ИИ» переживает создание заметки', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const r of await db.getAll('documents')) await db.delete('documents', r.id);
  });

  it('сохраняется, когда заметка создаётся из облачной копии', async () => {
    const id = await LocalDocumentService.createDocument('u1', {
      title: 'Личное',
      excludedFromAI: true,
      mood: 'тревожно',
    });

    const db = await getLocalDb();
    const saved = await db.get('documents', id);

    expect(saved?.excludedFromAI).toBe(true);
    expect(saved?.mood).toBe('тревожно');
  });

  it('без флага заметка остаётся обычной, а не «исключённой по умолчанию»', async () => {
    const id = await LocalDocumentService.createDocument('u1', { title: 'Обычная' });

    const db = await getLocalDb();
    const saved = await db.get('documents', id);

    expect(saved?.excludedFromAI).toBeUndefined();
  });
});
