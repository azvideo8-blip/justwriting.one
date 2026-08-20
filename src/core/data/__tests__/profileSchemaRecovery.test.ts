import { describe, it, expect, expectTypeOf } from 'vitest';
import { userProfileDbSchema, UserProfileDb } from '../schemas';
import { UserProfile } from '../../../shared/types/common';

// Регрессия: код восстановления создан, а плашка «не создан» продолжает висеть.
// Интерфейс читает признак из профиля, профиль проходит через эту схему, а Zod
// по умолчанию выбрасывает поля, которых в схеме нет. Так же молча терялись
// метки и вся статистика.
describe('userProfileDbSchema', () => {
  it('описывает ровно те же поля, что и UserProfile', () => {
    // Проверяется при `tsc --noEmit`: добавили поле в тип и забыли схему —
    // сборка падает здесь, а не через полгода в интерфейсе.
    expectTypeOf<keyof UserProfileDb>().toEqualTypeOf<keyof UserProfile>();
  });

  it('не теряет recoveryWrappedDataKey и recoverySalt', () => {
    const parsed = userProfileDbSchema.safeParse({
      uid: 'u1',
      email: 'a@b.c',
      nickname: 'a',
      encryptionMeta: {
        salt: 'c2FsdA==',
        version: 2,
        wrappedDataKey: 'd3JhcHBlZA==',
        verification: 'dmVyaWZ5',
        recoveryWrappedDataKey: 'cmVjb3Zlcnk=',
        recoverySalt: 'cmVjb3ZlcnlTYWx0',
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.encryptionMeta?.recoveryWrappedDataKey).toBe('cmVjb3Zlcnk=');
    expect(parsed.data.encryptionMeta?.recoverySalt).toBe('cmVjb3ZlcnlTYWx0');
  });

  it('кривая метка не роняет весь профиль', () => {
    // Разбор идёт целиком: без `.catch` одна плохая метка в jsonb означала бы
    // профиль `null`, то есть «шифрование не настроено» на ровном месте.
    const parsed = userProfileDbSchema.safeParse({
      uid: 'u1',
      email: 'a@b.c',
      nickname: 'a',
      labels: [{ id: 'l1' }],
      totalWordCount: 10,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.labels).toBeUndefined();
    expect(parsed.data.totalWordCount).toBe(10);
  });

  it('не теряет метки и статистику', () => {
    const full = {
      uid: 'u1',
      email: 'a@b.c',
      nickname: 'a',
      role: 'user' as const,
      labels: [{ id: 'l1', name: 'Дневник', color: '#ff0000' }],
      earnedAchievements: ['first'],
      totalWordCount: 12345,
      sessionsCount: 42,
      streakDays: 7,
      totalDuration: 3600,
      avgWpm: 55,
      avgSessionWords: 300,
      privacyAcceptedAt: 1755000000000,
      privacyVersion: 3,
      aiConsentAt: 1755000000000,
      aiConsentVersion: 3,
      aiPortrait: 'portrait',
      encryptionSalt: 'c2FsdA==',
      encryptedDataKey: 'a2V5',
      encryptionMeta: {
        salt: 'c2FsdA==',
        version: 2,
        wrappedDataKey: 'd3JhcHBlZA==',
        verification: 'dmVyaWZ5',
      },
      _encrypted: true,
    };

    const parsed = userProfileDbSchema.safeParse(full);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // Ни одно поле не должно исчезнуть при разборе.
    expect(Object.keys(parsed.data).sort()).toEqual(Object.keys(full).sort());
    expect(parsed.data.labels).toEqual([{ id: 'l1', name: 'Дневник', color: '#ff0000' }]);
    expect(parsed.data.privacyAcceptedAt).toBe(1755000000000);
    expect(parsed.data.avgSessionWords).toBe(300);
    expect(parsed.data.streakDays).toBe(7);
  });
});
