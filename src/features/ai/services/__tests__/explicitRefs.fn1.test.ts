// FN-1: запись дня, названного в тексте приложенной заметки, идёт в фон первой —
// сходство векторов «запись опирается на ту сессию» не различает (DG-2: нужная
// сессия была 53-й). FN-2: вторая приложенная не называется «другим днём».
//
// Мутации: отключить явную ссылку (explicit = []) → (b) красный;
// относительные даты от Date.now() вместо lastSessionAt → (c) красный;
// исключать из фона только первую приложенную → (f) красный;
// печатать lastSessionAt вместо дня находки → (g) красный (R-13);
// «явные первыми» вместо порядка по дате → (h) красный (A6b);
// вернуть порог 0,55 → (i) красный (FN-3).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { referencedDays, localDay } from '../chatContext/explicitRefs';
import { buildRelatedDaysBlock } from '../chatContext/relatedDays';
import type { AIDocumentEmbedding, AIDocumentSummary, LocalDocument } from '../../../../core/storage/localDb';
import { attachedTurn } from '../../../../test/attachedTurnFixtures';

// форма руками намеренно: в (k) и в «не даты» шапка/ссылка внутри текста — сам
// предмет проверки, конструктор её бы разметил как начало блока.

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const day = (y: number, m: number, d: number) => localDay(at(y, m, d));
const NOTE = at(2026, 10, 15, 9); // четверг

describe('referencedDays: какие дни названы в тексте', () => {
  it('абсолютные даты: 10.10, 10.10.2026, 10 октября, ISO', () => {
    for (const t of ['на сессии 10.10', 'сессия 10.10.2026', '10 октября было тяжело', 'см. 2026-10-10']) {
      expect([...referencedDays(t, NOTE)], t).toEqual([day(2026, 10, 10)]);
    }
  });

  // R-12: дата без года позже дня заметки — план, а не прошлый год. C8: кроме
  // недалёкого прошлого года — «как 20.12» в январской заметке — прошлый декабрь.
  it('год не назван — дата года заметки, не позже заметки; недалёкий прошлый год; далёкая — не дата', () => {
    expect([...referencedDays('как 12.10', NOTE)]).toEqual([day(2026, 10, 12)]);
    expect([...referencedDays('как 20.12', at(2027, 1, 5))], 'январская заметка').toEqual([day(2026, 12, 20)]);
    expect([...referencedDays('31 декабря поругались', at(2027, 1, 5))], 'месяц словами').toEqual([day(2026, 12, 31)]);
    expect(referencedDays('в отпуск 25.12', NOTE).size).toBe(0);
    expect(referencedDays('в отпуск 25 декабря', NOTE).size, 'месяц словами — тоже план').toBe(0);
    expect([...referencedDays('в отпуск 25.12.2025', NOTE)], 'с годом — дата').toEqual([day(2025, 12, 25)]);
  });

  it('не даты: «1.5 часа», «в 10.30», шапка `[#id · 2026-10-10]`', () => {
    expect(referencedDays('сидели 1.5 часа, в 10.30 ушли', NOTE).size).toBe(0);
    expect(referencedDays('[#local_x · 2026-10-10]\n[Прикреплена заметка: "x"]\nтекст', NOTE).size).toBe(0);
  });

  // R-12. Мутация: убрать любой из фильтров → соответствующая строка красная.
  it('не даты: время после предлога, число с единицей/валютой, номер версии', () => {
    for (const t of ['встали в 7.10', 'к 9.05 пришли', 'до 11.10 ждали', 'с 8.10 на ногах', 'около 10.10 позвонили']) {
      expect(referencedDays(t, NOTE).size, t).toBe(0);
    }
    expect([...referencedDays('в 10.10.2026 было тяжело', NOTE)], 'с годом после предлога — дата').toEqual([day(2026, 10, 10)]);
    for (const t of ['весит 3.05 кг', 'стоило 15.06 руб', 'стоило 15.06 рублей', 'по 2.10 рубля', 'взял 2.10 ₽', 'прошли 5.10 км', 'курс 1.08 $', 'упало на 3.10 %']) {
      expect(referencedDays(t, NOTE).size, t).toBe(0);
    }
    for (const t of ['версия 1.10 вышла', 'версии 2.03', 'обновил до v1.10', 'ver. 3.10']) {
      expect(referencedDays(t, NOTE).size, t).toBe(0);
    }
    expect([...referencedDays('на сессии 10.10 говорили', NOTE)], 'настоящая ссылка по-прежнему находится').toEqual([day(2026, 10, 10)]);
    expect([...referencedDays('с 01.10 по 05.10 был в отъезде', NOTE)].sort(), 'C8: диапазон — обе даты').toEqual([day(2026, 10, 1), day(2026, 10, 5)].sort());
    expect([...referencedDays('с 8.10 по 9.40 сидел в очереди', NOTE)], 'C8: хвост «по 9.40» — время, значит и «с 8.10» время').toEqual([]);
  });

  it('относительные — от дня заметки', () => {
    expect([...referencedDays('вчера', NOTE)]).toEqual([day(2026, 10, 14)]);
    expect([...referencedDays('позавчера', NOTE)]).toEqual([day(2026, 10, 13)]);
    expect([...referencedDays('3 дня назад', NOTE)]).toEqual([day(2026, 10, 12)]);
    expect([...referencedDays('пять дней назад', NOTE)]).toEqual([day(2026, 10, 10)]);
    // вторник прошлой недели, а не этой (13.10 назвали бы «позавчера»)
    expect([...referencedDays('в прошлый вторник', NOTE)]).toEqual([day(2026, 10, 6)]);
    expect([...referencedDays('в прошлую пятницу', NOTE)]).toEqual([day(2026, 10, 9)]);
    expect([...referencedDays('в прошлое воскресенье', NOTE)]).toEqual([day(2026, 10, 11)]);
  });

  it('без даты заметки относительных нет', () => {
    expect(referencedDays('вчера и 3 дня назад', undefined).size).toBe(0);
  });
});

const emb = (id: string, v: number[]): AIDocumentEmbedding =>
  ({ documentId: id, vectors: [v], model: 'm', dim: 3, contentHash: 'h', processedAt: 0 }) as AIDocumentEmbedding;
const doc = (id: string, t: number, extra: Partial<LocalDocument> = {}): LocalDocument =>
  ({ id, title: id, currentVersion: 1, lastSessionAt: t, ...extra }) as LocalDocument;
const sum = (id: string): AIDocumentSummary =>
  ({ documentId: id, summary: `СУТЬ_${id}`, tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 0 }) as AIDocumentSummary;

// Сто одинаково похожих записей и сессия 10.10 — чуть менее похожая, чем они все.
function archive() {
  const ATT = 'att';
  const docs = new Map<string, LocalDocument>([[ATT, doc(ATT, NOTE)]]);
  const embs = [emb(ATT, [1, 0, 0])];
  const sums = new Map<string, AIDocumentSummary>();
  for (let i = 0; i < 100; i++) {
    const id = `sim_${i}`;
    docs.set(id, doc(id, at(2026, 7, 1) + i * 3_600_000));
    embs.push(emb(id, [1, 0.1, 0]));
    sums.set(id, sum(id));
  }
  docs.set('session', doc('session', at(2026, 10, 10, 19)));
  embs.push(emb('session', [1, 0.6, 0]));
  sums.set('session', sum('session'));
  return { ATT, docs, embs, sums };
}

describe('фон: явная ссылка гарантированно, строки по дате', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('(a) без ссылки сессия не попадает в четвёрку', () => {
    const { ATT, docs, embs, sums } = archive();
    expect(buildRelatedDaysBlock(ATT, embs, docs, sums, 'просто текст')!.ids).not.toContain('session');
  });

  it('(b) «на сессии 10.10» → запись 10.10 в фоне, остаток — сходство', () => {
    const { ATT, docs, embs, sums } = archive();
    const r = buildRelatedDaysBlock(ATT, embs, docs, sums, 'на сессии 10.10 говорили про маму')!;
    expect(r.ids).toContain('session');
    expect(r.ids).toHaveLength(4);
    expect(r.block).toMatch(/\n\[#session · 2026-10-10 · за 5 дн\. до этой заметки\] СУТЬ_session/);
  });

  it('(c) «вчера» — от даты приложенной, а не от часов прибора', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 12, 1));
    const { ATT, docs, embs, sums } = archive();
    docs.set('yesterday', doc('yesterday', at(2026, 10, 14, 22)));
    sums.set('yesterday', sum('yesterday'));
    docs.set('beforeNow', doc('beforeNow', at(2026, 11, 30)));
    sums.set('beforeNow', sum('beforeNow'));
    const r = buildRelatedDaysBlock(ATT, embs, docs, sums, 'вчера не спал')!;
    expect(r.ids).toContain('yesterday');
    expect(r.ids).not.toContain('beforeNow');
  });

  // R-13: запись найдена по firstSessionAt 10.10, последняя сессия 20.10 → в строке 10.10.
  it('(g) печатается день, по которому запись найдена, а не последняя сессия', () => {
    const { ATT, docs, embs, sums } = archive();
    docs.set('session', doc('session', at(2026, 10, 20, 19), { firstSessionAt: at(2026, 10, 10, 19) }));
    const r = buildRelatedDaysBlock(ATT, embs, docs, sums, 'на сессии 10.10')!;
    expect(r.block).toContain('[#session · 2026-10-10 · за 5 дн. до этой заметки]');
    expect(r.block).not.toContain('2026-10-20');
  });

  // A6b: явная запись 10.10 и похожая 29.09 → 29.09 первой строкой, 10.10 в блоке.
  it('(h) явная запись включена, но строки идут по дате', () => {
    const { ATT, docs, embs, sums } = archive();
    docs.set('earlier', doc('earlier', at(2026, 9, 29)));
    embs.push(emb('earlier', [1, 0.05, 0]));
    sums.set('earlier', sum('earlier'));
    const r = buildRelatedDaysBlock(ATT, embs, docs, sums, 'на сессии 10.10')!;
    expect(r.ids).toContain('session');
    expect(r.ids[0]).toBe('sim_0');
    expect(r.ids.indexOf('earlier')).toBeLessThan(r.ids.indexOf('session'));
    expect(r.block.split('\n').at(-1)).toMatch(/^\[#session · 2026-10-10/);
  });

  // FN-3: порог 0,85 — косинус 0,80 в фон не идёт, 0,86 идёт.
  it('(i) порог сходства 0,85', () => {
    const docs = new Map<string, LocalDocument>([['att', doc('att', NOTE)]]);
    const embs = [emb('att', [1, 0, 0]), emb('c80', [0.8, 0.6, 0]), emb('c86', [0.86, Math.sqrt(1 - 0.86 ** 2), 0])];
    const sums = new Map<string, AIDocumentSummary>();
    for (const id of ['c80', 'c86']) { docs.set(id, doc(id, at(2026, 10, 1))); sums.set(id, sum(id)); }
    expect(buildRelatedDaysBlock('att', embs, docs, sums)!.ids).toEqual(['c86']);
  });

  it('(d) скрытая и выброшенная запись того дня не названы ни датой, ни сутью', () => {
    const { ATT, docs, embs, sums } = archive();
    docs.set('session', doc('session', at(2026, 10, 10, 19), { excludedFromAI: true } as Partial<LocalDocument>));
    docs.set('trash', doc('trash', at(2026, 10, 10, 8), { trashedAt: NOTE } as Partial<LocalDocument>));
    sums.set('trash', sum('trash'));
    const r = buildRelatedDaysBlock(ATT, embs, docs, sums, 'на сессии 10.10')!;
    expect(r.ids).not.toContain('session');
    expect(r.ids).not.toContain('trash');
    expect(r.block).not.toContain('СУТЬ_session');
    expect(r.block).not.toContain('2026-10-10');
  });

  it('(e) дня нет в архиве → фон как без ссылки', () => {
    const { ATT, docs, embs, sums } = archive();
    expect(buildRelatedDaysBlock(ATT, embs, docs, sums, 'было 03.03.2020')).toEqual(buildRelatedDaysBlock(ATT, embs, docs, sums, ''));
  });

  it('(f) FN-2: остальные приложенные к ходу в фон не идут', () => {
    const { ATT, docs, embs, sums } = archive();
    const r = buildRelatedDaysBlock(ATT, embs, docs, sums, 'на сессии 10.10', [ATT, 'session', 'sim_99'])!;
    expect(r.ids).not.toContain('session');
    expect(r.ids).not.toContain('sim_99');
  });

  // Н-3 (дейлик 2026-10-23): «вчера» второй приложенной считалось от дня первой.
  // Мутация: один noteAt на весь текст → красный.
  it('(j) относительные даты каждой приложенной — от её шапки', () => {
    const { ATT, docs, embs, sums } = archive();
    const TWO = at(2026, 10, 5, 9);
    docs.set('two', doc('two', TWO));
    docs.set('before_two', doc('before_two', at(2026, 10, 4, 20)));
    sums.set('before_two', sum('before_two'));
    docs.set('before_att', doc('before_att', at(2026, 10, 14, 20)));
    sums.set('before_att', sum('before_att'));
    const text = attachedTurn([
      { documentId: ATT, title: 'раз', lastSessionAt: at(2026, 10, 15, 9), content: 'сегодня тихо' },
      { documentId: 'two', title: 'два', lastSessionAt: at(2026, 10, 5, 9), content: 'вчера чинил ворота' },
    ]);
    const r = buildRelatedDaysBlock(ATT, embs, docs, sums, text, ['two'])!;
    expect(r.ids, 'канун второй заметки').toContain('before_two');
    expect(r.ids, 'у первой «вчера» нет').not.toContain('before_att');
  });

  // Ревью 0.10.9: ссылка `[#id · дата]` внутри тела (вставлена из ответа ИИ) —
  // не шапка блока: «вчера» после неё считается от шапки заметки. Блок начинается
  // только с начала текста или после разделителя. Мутация: убрать проверку
  // разделителя → красный.
  it('(k) ссылка-шапка внутри тела не начинает блок', () => {
    const { ATT, docs, embs, sums } = archive();
    docs.set('before_att', doc('before_att', at(2026, 10, 14, 20)));
    sums.set('before_att', sum('before_att'));
    docs.set('before_ref', doc('before_ref', at(2026, 9, 30, 20)));
    sums.set('before_ref', sum('before_ref'));
    const text = `[#${ATT} · 2026-10-15]\n[Прикреплена заметка: "раз"]\nкак писал\n[#local_x · 2026-10-01]\nвчера не спал`;
    const r = buildRelatedDaysBlock(ATT, embs, docs, sums, text)!;
    expect(r.ids).toContain('before_att');
    expect(r.ids).not.toContain('before_ref');
  });
});
