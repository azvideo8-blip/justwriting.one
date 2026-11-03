/**
 * DW4-1 (шаг 1, утверждение 3): один (де)сериализатор всех адресов строки
 * черновика читает строки прошлых версий, и служебные поля спора с облаком
 * (`_cloudUpdatedAt`/`_cloudAckedHash`/`_cloudSentHashes`) переживают чтение.
 * Без них следующий спор копий теряет память и возвращается к часам прибора
 * (SF-2, SF2-1). Поля только добавляются: неизвестное поле обязано пережить
 * круговой обход serialize → parse.
 */
import { describe, expect, it } from 'vitest';
import { buildGuestDraftRecord, parseDraftRow, serializeDraftRow } from '../draftWriter';

// Фикстуры хранящихся строк: 0.10 — без _cloud*; 0.11 — с _cloud*; 0.11.4 —
// текущая полная форма; гостевая строка прошлой формы — только `timestamp`.
const ROW_0_10 = {
  userId: 'u-fix10', title: 'заголовок', content: 'текст 0.10', seconds: 30, wpm: 20,
  wordCount: 5, updatedAt: 1_700_000_000_000,
};
const ROW_0_11 = {
  ...ROW_0_10, userId: 'u-fix11', content: 'текст 0.11',
  _cloudUpdatedAt: 1_700_000_060_000, _cloudAckedHash: '0123456789abcdef',
  _cloudSentHashes: ['0123456789abcdef', 'fedcba9876543210'],
};
const ROW_0_11_4 = {
  ...ROW_0_11, userId: 'u-fix114', content: 'текст 0.11.4', savedDocumentId: 'local_x',
  initialWordCount: 2, accumulatedDuration: 90, totalPauseSeconds: 7,
};
const GUEST_ROW_OLD = { content: 'гостевой текст прошлой формы', timestamp: 1_690_000_000_000 };

describe('DW4-1: один (де)сериализатор всех адресов строки черновика', () => {
  it('фикстуры строк 0.10/0.11/0.11.4 читаются, _cloud* после чтения те же', () => {
    const r10 = parseDraftRow(ROW_0_10);
    expect(r10?.content, 'строка 0.10 читается').toBe('текст 0.10');
    expect(r10?._cloudUpdatedAt, 'в 0.10 служебных полей нет').toBeUndefined();

    const r11 = parseDraftRow(ROW_0_11);
    expect(r11?._cloudUpdatedAt, 'метка облачной версии пережила чтение').toBe(1_700_000_060_000);
    expect(r11?._cloudAckedHash, 'принятый хэш пережил чтение').toBe('0123456789abcdef');
    expect(r11?._cloudSentHashes, 'список отправленных пережил чтение')
      .toEqual(['0123456789abcdef', 'fedcba9876543210']);

    const r114 = parseDraftRow(ROW_0_11_4);
    expect(r114?.savedDocumentId, 'строка 0.11.4 читается с полями идентичности').toBe('local_x');
    expect(r114?._cloudAckedHash, 'у полной строки _cloud* тоже на месте').toBe('0123456789abcdef');

    const guest = parseDraftRow(GUEST_ROW_OLD);
    expect(guest?.content, 'гостевая строка прошлой формы читается').toBe('гостевой текст прошлой формы');
    expect(guest?.timestamp, 'старая метка на месте').toBe(1_690_000_000_000);
  });

  it('круговой обход serialize → parse сохраняет поля, включая _cloud*', () => {
    const rec = parseDraftRow(ROW_0_11);
    expect(rec).not.toBeNull();
    const idb = serializeDraftRow(rec as NonNullable<typeof rec>, { kind: 'idb', key: 'u-fix11' });
    const back = parseDraftRow(idb);
    expect(back).toEqual(rec);
    expect(idb.userId, 'IDB-строка несёт userId адреса').toBe('u-fix11');

    const ls = serializeDraftRow(rec as NonNullable<typeof rec>, { kind: 'ls', key: 'draft-u-fix11' });
    expect(ls.userId, 'LS-копия userId не несёт — адрес и есть ключ').toBeUndefined();
    expect(ls._cloudAckedHash, 'и в LS-копии служебные поля на месте').toBe('0123456789abcdef');
  });

  it('обе гостевые записи из одного билдера: одна форма для IDB и LS, поля идентичности на месте', () => {
    const snapshot = {
      content: 'текст', title: '', seconds: 4, wpm: 10, wordCount: 2, initialWordCount: 0,
      sessionStartTime: undefined, activeSessionId: null, savedDocumentId: 'local_a',
      tags: [] as string[], labelId: undefined, accumulatedDuration: 11, totalPauseSeconds: 2,
      status: 'writing', timestamp: Date.now(),
    };
    const rec = buildGuestDraftRecord(snapshot);
    expect(rec.savedDocumentId, 'маркер продолженной заметки в записи').toBe('local_a');
    expect(rec.accumulatedDuration, 'накопленное время в записи').toBe(11);
    expect(rec.totalPauseSeconds, 'секунды паузы в записи').toBe(2);
    expect(rec.initialWordCount, 'исходное число слов в записи').toBe(0);
    expect(typeof rec.updatedAt, 'билдер ставит метку записи').toBe('number');

    const idb = serializeDraftRow(rec, { kind: 'idb', key: 'guest_draft' });
    const ls = serializeDraftRow(rec, { kind: 'ls', key: 'jw_guest_draft' });
    expect(idb.userId, 'гостевая строка IDB — литеральный ключ').toBe('guest_draft');
    expect(ls.userId, 'гостевой LS-ключ не несёт userId').toBeUndefined();
    const lsFields = Object.keys(ls).sort();
    const idbFields = Object.keys(idb).filter(k => k !== 'userId').sort();
    expect(lsFields, 'одна форма: поля LS-ключа и строки IDB совпадают').toEqual(idbFields);
  });
});
