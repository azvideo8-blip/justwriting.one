import { describe, it, expect } from 'vitest';
import { cloudTimestampSchema, versionDbSchema, userProfileDbSchema, documentDbSchema } from '../schemas';
import { LocalVersionService } from '../../services/LocalVersionService';
import { getLocalDb } from '../../storage/localDb';

describe('LIFE-5: cloudTimestampSchema normalisation', () => {
  const tsMs = 1700000000000;

  it('normalises all accepted input shapes to Date | null', () => {
    const fromFirestore = cloudTimestampSchema.parse({ seconds: 1700000000, nanoseconds: 0 });
    const fromDate = cloudTimestampSchema.parse(new Date(tsMs));
    const fromNumber = cloudTimestampSchema.parse(tsMs);
    const fromNull = cloudTimestampSchema.parse(null);

    expect(fromFirestore).toBeInstanceOf(Date);
    expect(fromFirestore?.getTime()).toBe(tsMs);

    expect(fromDate).toBeInstanceOf(Date);
    expect(fromDate?.getTime()).toBe(tsMs);

    expect(fromNumber).toBeInstanceOf(Date);
    expect(fromNumber?.getTime()).toBe(tsMs);

    expect(fromNull).toBeNull();
  });

  /**
   * Приведение обязано менять ФОРМУ значения, а не появление значения там, где
   * его не было. Если схема примет `undefined`, то `.optional()` на поле
   * обесценится: отсутствующее поле материализуется как `null` — разбор
   * придумает данные, которых в записи нет.
   *
   * Проверять надо оба конца. У профиля отметки согласия необязательны, и
   * отсутствие обязано остаться отсутствием. У документа `firstSessionAt`
   * обязателен — запись без него должна разбор ПРОВАЛИТЬ, а не молча получить
   * `null`: по этому времени идёт сверка при перепривязке.
   */
  it('отсутствие остаётся отсутствием, а нехватка обязательного — ошибкой', () => {
    const parsed = userProfileDbSchema.safeParse({
      uid: 'u1', createdAt: tsMs, earnedAchievements: [],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(
      Object.keys(parsed.data),
      'разбор не должен добавлять поля, которых не было в записи',
    ).not.toContain('aiConsentAt');

    expect(
      documentDbSchema.safeParse({ id: 'd1', lastSessionAt: tsMs }).success,
      'документ без обязательного firstSessionAt — ошибка разбора, а не null',
    ).toBe(false);
  });

  it('version parsed with numeric savedAt has Date and addVersion does not throw', async () => {
    const rawVersion = {
      id: 'v1',
      version: 1,
      content: 'Hello world',
      previousContent: '',
      wordCount: 2,
      duration: 10,
      wpm: 12,
      savedAt: tsMs, // Numeric savedAt from cloud
      sessionStartedAt: tsMs, // Numeric sessionStartedAt
    };

    const parsed = versionDbSchema.safeParse(rawVersion);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // parsed.data.savedAt must be Date, NOT number!
    expect(parsed.data.savedAt).toBeInstanceOf(Date);
    expect(parsed.data.savedAt?.getTime()).toBe(tsMs);

    // Calling LocalVersionService.addVersion with parsed.data.savedAt must succeed without throwing .getTime is not a function
    const versionId = await LocalVersionService.addVersion('user_test', 'doc_test', {
      content: parsed.data.content,
      previousContent: '',
      wordCount: parsed.data.wordCount,
      duration: parsed.data.duration,
      wpm: parsed.data.wpm,
      versionNumber: parsed.data.version,
      sessionStartedAt: parsed.data.sessionStartedAt ?? new Date(),
      savedAt: parsed.data.savedAt ?? undefined,
    });

    expect(versionId).toBeDefined();

    const db = await getLocalDb('user_test');
    const stored = await db.get('versions', versionId);
    expect(stored?.savedAt).toBe(tsMs);
  });

  it('E-10: preserves createdAt across documentDbSchema and versionDbSchema', () => {
    const doc = documentDbSchema.parse({
      id: 'doc_1',
      firstSessionAt: tsMs,
      lastSessionAt: tsMs,
      createdAt: tsMs,
    });
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.createdAt?.getTime()).toBe(tsMs);

    const ver = versionDbSchema.parse({
      id: 'ver_1',
      documentId: 'doc_1',
      savedAt: tsMs,
      sessionStartedAt: tsMs,
      createdAt: tsMs,
    });
    expect(ver.createdAt).toBeInstanceOf(Date);
    expect(ver.createdAt?.getTime()).toBe(tsMs);
  });
});
