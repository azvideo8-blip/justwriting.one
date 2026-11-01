// N1-2 (дейлик 01.11, Н-4): журнал на устройстве фильтруется по ИМЕНИ ключа, а
// `error` и `reason` в PII_KEYS нет. `uploadDialogue` кладёт туда `e.message`, а
// внутри try лежит `JSON.parse` уже расшифрованного текста диалога — V8 (и
// JavaScriptCore) вшивает в сообщение SyntaxError кусок разбираемой строки в
// кавычках. `scrubMessage` сворачивает только кавычки от 20 знаков, а этот
// фрагмент короче. Тот же стока у `SyncService` и `CloudSyncService` под ключом
// `reason`.
// Правка — в одной точке, `redactValue`: оба входа (`reportError` и `addActivity`)
// идут через `scrubPii`, поэтому фильтрация по значению стоит именно там.
// Мутация: вернуть прежний `redactValue` → «в сохранённом журнале нет фрагмента»
// красный.
import { describe, it, expect, beforeEach } from 'vitest';
import { useActivityLogStore } from '../../activity/useActivityLogStore';
import { scrubPii } from '../piiScrub';
import { reportError } from '../reportError';

// Ключ журнала (`useActivityLogStore.ts:38`) — читаем именно сохранённое, а не
// только состояние стора: дыра в том, что лежит на устройстве и уезжает кнопкой
// «скопировать журнал».
const ACTIVITY_LOG_KEY = 'activity_log_v1';

// Синтетический маркер: живых дневниковых строк в тесте нет.
const MARKER = 'МАРКЕР_N12_СВИДЕТЕЛЬ_дневника_о_разводе';

/** Настоящее сообщение V8 о синтаксической ошибке на расшифрованном тексте. */
function realSyntaxErrorText(): string {
  try {
    JSON.parse(MARKER);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('JSON.parse не бросил исключение — проверка больше не доказывает ничего');
}

function storedLog(): string {
  return localStorage.getItem(ACTIVITY_LOG_KEY) ?? '';
}

beforeEach(() => {
  localStorage.clear();
  useActivityLogStore.setState({ entries: [], panelOpen: false });
});

describe('N1-2: фрагмент расшифрованного текста не остаётся в журнале', () => {
  it('что делает движок: сообщение JSON.parse действительно несёт фрагмент', () => {
    expect(realSyntaxErrorText()).toContain('МАРКЕР_N12');
  });

  it('addActivity с { error } (LocalStoreSyncService) — в сохранённом журнале нет фрагмента', () => {
    useActivityLogStore.getState().addActivity(
      'activity_dialogue_cloud_unreadable',
      { action: 'uploadDialogue_unreadable', store: 'aiDialogues', key: 'k_n12', error: realSyntaxErrorText() },
      'warning',
      'sync',
    );

    expect(storedLog()).not.toContain('МАРКЕР_N12');
    expect(JSON.parse(storedLog())[0]?.context?.error).toContain('is not valid JSON');
  });

  it('addActivity с { reason } (SyncService, CloudSyncService) — то же', () => {
    useActivityLogStore.getState().addActivity('sync_task_quarantined', { taskId: 't_n12', reason: realSyntaxErrorText() }, 'warning', 'sync');

    expect(storedLog()).not.toContain('МАРКЕР_N12');
  });

  it('reportError идёт через тот же фильтр, что и журнал активности', () => {
    reportError(new Error('Sync task quarantined'), { taskId: 't_n12', reason: realSyntaxErrorText() }, 'warning');

    expect(storedLog()).not.toContain('МАРКЕР_N12');
  });

  it('контроль: uuid и почта в значении вырезаются по-прежнему', () => {
    const scrubbed = scrubPii({
      detail: 'row 3f1a2b4c-5d6e-7f80-91a2-b3c4d5e6f7a8 is broken',
      note: 'and someone@example.com too',
    });
    expect(String(scrubbed.detail)).toContain('<uuid>');
    expect(String(scrubbed.note)).toContain('<email>');
    expect(JSON.stringify(scrubbed)).not.toContain('3f1a2b4c-5d6e-7f80-91a2-b3c4d5e6f7a8');
    expect(JSON.stringify(scrubbed)).not.toContain('someone@example.com');
  });

  it('контроль: форма ошибки живёт — «Unexpected token …, … is not valid JSON»', () => {
    const scrubbed = scrubPii({ error: realSyntaxErrorText() });
    const out = String(scrubbed.error);
    expect(out).toContain('Unexpected token');
    expect(out).toContain('is not valid JSON');
    expect(out).not.toContain('МАРКЕР_N12');
  });

  // Ревью 0.11.3: кавычки внутри фрагмента и обрезанный на середине фрагмент.
  // Мутация: вернуть попарный разбор кавычек → красный.
  it('фрагмент с кавычками внутри и обрезанный фрагмент тоже не проходят', () => {
    let nested = '';
    try { JSON.parse('{"a":МАРКЕР_N12 день 4}'); } catch (e) { nested = (e as Error).message; }
    let arr = '';
    try { JSON.parse('["МАРКЕР_N12", день 4]'); } catch (e) { arr = (e as Error).message; }
    const cut = `Unexpected token 'С', "МАРКЕР_N12_cut`;
    for (const msg of [nested, arr, cut]) {
      const out = String(scrubPii({ error: msg }).error);
      expect(out, msg).not.toContain('МАРКЕР_N12');
      expect(out, msg).not.toContain('день 4');
    }
    expect(String(scrubPii({ error: "Can't read 'x' now" }).error)).toBe("Can't read … now");
  });

  it('контроль: значение без кавычек проходит целиком', () => {
    expect(scrubPii({ action: 'uploadDialogue_unreadable', store: 'aiDialogues' })).toEqual({
      action: 'uploadDialogue_unreadable',
      store: 'aiDialogues',
    });
  });

  it('кавычки всех трёх видов: одинарные, двойные и «ёлочки»', () => {
    expect(String(scrubPii({ a: `перед 'МАРКЕР_N12' после` }).a)).not.toContain('МАРКЕР_N12');
    expect(String(scrubPii({ b: `перед "МАРКЕР_N12" после` }).b)).not.toContain('МАРКЕР_N12');
    expect(String(scrubPii({ c: `перед «МАРКЕР_N12» после` }).c)).not.toContain('МАРКЕР_N12');
  });

  /**
   * Самопроверка (сверка 28): `addActivity` принимает `Record<string, unknown>`,
   * поэтому вложенный объект или список в контексте — не выдумка вызывающего, а
   * разрешённая форма. Прежний фильтр смотрел только верхний уровень.
   */
  it('вложенный контекст проходит тот же фильтр, что и плоский', () => {
    const scrubbed = scrubPii({
      meta: { note: `внутри "МАРКЕР_N12_nested"`, code: 'OK' },
      rows: [`строка 'МАРКЕР_N12_arr'`],
    });
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain('МАРКЕР_N12_nested');
    expect(json).not.toContain('МАРКЕР_N12_arr');
    expect(String((scrubbed.meta as { code?: string }).code)).toBe('OK');
  });

  it('PII-имя ключа вычёркивается и на глубине', () => {
    const scrubbed = scrubPii({ meta: { title: 'Развод, день 4', content: 'текст заметки' }, keep: 1 });
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain('Развод');
    expect(json).not.toContain('текст заметки');
    expect(scrubbed.keep).toBe(1);
  });

  it('цикл не роняет журнал, глубина ограничена и это известно', () => {
    const loop: Record<string, unknown> = { note: `«МАРКЕР_N12_loop»` };
    loop.self = loop;
    const cyclical = JSON.stringify(scrubPii({ ctx: loop }));
    expect(cyclical).not.toContain('МАРКЕР_N12_loop');
    expect(cyclical).toContain('[circular]');

    // MAX_DEPTH = 4: глубже предела объект заменяется меткой, а не уходит как есть
    // (ревью N1: иначе текст на пятом уровне проходил фильтр дословно).
    // Мутация: вернуть `return value` на пределе → красный.
    let deep: Record<string, unknown> = { note: `МАРКЕР_N12_deep`, title: 'МАРКЕР_N12_title' };
    for (let i = 0; i < 8; i++) deep = { level: deep };
    expect(() => scrubPii({ deep })).not.toThrow();
    const deepJson = JSON.stringify(scrubPii({ deep }));
    expect(deepJson).not.toContain('МАРКЕР_N12');
    expect(deepJson).toContain('[depth]');
  });
});
