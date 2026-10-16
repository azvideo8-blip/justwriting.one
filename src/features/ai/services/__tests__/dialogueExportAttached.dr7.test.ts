// DR-7: экспорт диалога в markdown терял две вещи, без которых разбор хода
// мыслей невозможен: текст приложенной заметки (ход хранит маркер и вопрос,
// тело едет отдельно) и «ход мыслей» ответа. Тесты на синтетических текстах.
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { AIDialogueService } from '../AIDialogueService';
import { getLocalDb } from '../../../../core/storage/localDb';

const NOTE_ID = 'local_dr7_note';
const NOTE_TEXT = 'Текст заметки для экспорта: вечер, лампа и три шага на завтра.';
const LONG_FILLER = 'Длинная строка тела заметки, которая не влезает в ход. '.repeat(200);

async function seedDialogue(userContent: string, extra: { reasoning?: string } = {}) {
  const d = await AIDialogueService.create({
    title: 'Диалог для экспорта', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    documentId: NOTE_ID,
    messages: [
      { role: 'user', content: userContent, type: 'chat' },
      { role: 'assistant', content: 'Ответ модели без хода мыслей.', type: 'chat', reasoning: extra.reasoning },
    ],
  } as never);
  return d;
}

async function seedNote(doc: Record<string, unknown> = {}, content = NOTE_TEXT) {
  const db = await getLocalDb();
  await db.put('documents', {
    id: NOTE_ID, title: 'Заметка для экспорта', currentVersion: 1, lastSessionAt: Date.now(), ...doc,
  } as never);
  await db.put('versions', {
    id: 'dr7_v1', documentId: NOTE_ID, version: 1, content, wordCount: 10, duration: 1, wpm: 10,
    sessionStartedAt: new Date(), updatedAt: new Date(),
  } as never);
}

describe('DR-7: экспорт диалога с заметкой и ходом мыслей', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const store of ['aiDialogues', 'documents', 'versions'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) {
        const key = (rec as { id?: string; documentId?: string }).id
          ?? (rec as { documentId: string }).documentId;
        await db.delete(store, key);
      }
    }
  });

  it('(a) ход с маркером: в экспорт попадает текущий текст заметки', async () => {
    await seedNote();
    const d = await seedDialogue(
      `[#${NOTE_ID} · 2026-10-09]\n[Прикреплена заметка: "Заметка для экспорта"]\n\n— — —\nВопрос: разбери глубоко`,
    );
    const md = await AIDialogueService.exportAsMarkdown(d.id);
    expect(md).toContain(NOTE_TEXT);
    expect(md).toContain('> ');
    // вопрос и маркер остаются на месте
    expect(md).toContain('[Прикреплена заметка: "Заметка для экспорта"]');
  });

  it('(b) скрытая от ИИ и выброшенная заметка: заглушка вместо текста', async () => {
    for (const doc of [{ excludedFromAI: true }, { trashedAt: new Date().toISOString() }]) {
      await seedNote(doc);
      const d = await seedDialogue(
        `[#${NOTE_ID} · 2026-10-09]\n[Прикреплена заметка: "Заметка для экспорта"]\n\n— — —\nВопрос: разбери`,
      );
      const md = await AIDialogueService.exportAsMarkdown(d.id);
      expect(md).toContain('[текст заметки не выгружен: скрыта от ИИ]');
      expect(md).not.toContain(NOTE_TEXT);
    }
  });

  it('R7F-012: скрытую ПОСЛЕ хода заметку плашка не объявляет не выгруженным то, что в ходе есть', async () => {
    // Короткая заметка (≤9000 знаков) попадает в ход дословно (useAIPageData,
    // inline). Прежним кодом экспорт при этом печатал и тело, и строку
    // «[текст заметки не выгружен: скрыта от ИИ]» под ним.
    await seedNote({ excludedFromAI: true });
    const d = await seedDialogue(
      `[#${NOTE_ID} · 2026-10-09]\n[Прикреплена заметка: "Заметка для экспорта"]\n\n— — —\n${NOTE_TEXT}\n\nВопрос: разбери`,
    );
    const md = await AIDialogueService.exportAsMarkdown(d.id);

    expect(md, 'тело осталось в самой реплике — это текст человека').toContain(NOTE_TEXT);
    expect(md, 'но экспорт не утверждает, что текст не выгружен')
      .not.toContain('[текст заметки не выгружен: скрыта от ИИ]');
  });

  it('R7F-012: длинная скрытая заметка по-прежнему заменяется заглушкой', async () => {
    await seedNote({ excludedFromAI: true }, LONG_FILLER);
    const d = await seedDialogue(
      `[#${NOTE_ID} · 2026-10-09]\n[Прикреплена заметка: "Заметка для экспорта"]\n\n— — —\nВопрос: разбери`,
    );
    const md = await AIDialogueService.exportAsMarkdown(d.id);

    expect(md).toContain('[текст заметки не выгружен: скрыта от ИИ]');
    expect(md).not.toContain(LONG_FILLER.slice(0, 60));
  });

  it('(c) ход мыслей ответа уезжает свёрнутым блоком перед ответом', async () => {
    await seedNote();
    const d = await AIDialogueService.create({
      title: 'Диалог с рассуждением', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      documentId: NOTE_ID,
      messages: [
        { role: 'user', content: 'Привет', type: 'chat' },
        { role: 'assistant', content: 'Ответ.', type: 'chat', reasoning: 'Первые мысли модели: проверить, о чём спрашивают.' },
      ],
    } as never);
    const md = await AIDialogueService.exportAsMarkdown(d.id);
    expect(md).toContain('<details><summary>Ход мыслей</summary>');
    expect(md).toContain('Первые мысли модели');
    // блок стоит перед репликой, а строка `**Коуч:** …` остаётся целой
    expect(md).toContain('**Коуч:** Ответ.');
    expect(md.indexOf('Первые мысли модели')).toBeLessThan(md.indexOf('**Коуч:** Ответ.'));
    expect(md.indexOf('</details>')).toBeLessThan(md.indexOf('**Коуч:** Ответ.'));
  });

  it('(d) диалог без заметки и без рассуждения экспортится как раньше', async () => {
    const d = await AIDialogueService.create({
      title: 'Обычный диалог', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [
        { role: 'user', content: 'Привет', type: 'chat' },
        { role: 'assistant', content: 'Здравствуй.', type: 'chat' },
      ],
    } as never);
    const md = await AIDialogueService.exportAsMarkdown(d.id);
    expect(md).toContain('# Диалог с Коуч');
    expect(md).toContain('**Пользователь:** Привет');
    expect(md).toContain('**Коуч:** Здравствуй.');
    expect(md).not.toContain('<details>');
    expect(md).not.toContain('[текст заметки не выгружен');
    expect(md).not.toContain(NOTE_TEXT);
  });

  it('(e) тело, которое уже стоит в ходу, не удваивается', async () => {
    await seedNote();
    const d = await seedDialogue(
      `[#${NOTE_ID} · 2026-10-09]\n[Прикреплена заметка: "Заметка для экспорта"]\n${NOTE_TEXT}\n\n— — —\nВопрос: разбери`,
    );
    const md = await AIDialogueService.exportAsMarkdown(d.id);
    expect(md.split(NOTE_TEXT).length - 1).toBe(1);
  });

  it('(f) длинное тело заметки выгружается целиком под маркером', async () => {
    await seedNote({}, LONG_FILLER + NOTE_TEXT);
    const d = await seedDialogue(
      `[Прикреплена заметка: "Заметка для экспорта"]\n\n— — —\nВопрос: разбери глубоко`,
    );
    const md = await AIDialogueService.exportAsMarkdown(d.id);
    expect(md).toContain(NOTE_TEXT);
    // без `[#id · дата]` в шапке текст берётся по documentId диалога
    expect(md).toContain(LONG_FILLER.slice(0, 40));
  });
});
