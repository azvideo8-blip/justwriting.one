// PA-2 (тикет 26.10) к PR-2: потолок перечня и счётчик «Показаны N из M».
// Тест PR-2 проверял 25 коротких записей и утверждение
// `toMatch(/Показаны 25 из 25|Все записи периода/)` — вторая ветка есть всегда,
// поэтому срез по LIST_MAX_CHARS не проверялся вовсе. Здесь перечень realно
// переполняет потолок, и M считается по видимым записям: скрытые и корзина
// не входят ни в строки, ни в счётчик (иначе «Показаны 44 из 53» выдаёт, что
// скрытых 9, хотя их в перечне нет).
//
// Второе отделение: FACTS_ASK_RE после фикса `81d46284` не должен включаться
// на «фактически» и «фактор» — там «факт» внутри слова.
//
// Мутация: M = все документы окна (снять фильтр видимости до подсчёта) → (1)
// красный; LIST_MAX_CHARS = Infinity → (1) красный (срез не происходит);
// вернуть FACTS_ASK_RE на /факт[аыо]?\b/ → (3) красный (сторож тот же).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { buildTemporalBlocks } from '../chatContext/temporalBlocks';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const DAY = 86_400_000;
const OCT_1 = Date.UTC(2026, 9, 1);
const LONG = 'Д'.repeat(240);

async function clear() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiTimeline'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  return db;
}

async function putNote(db: { put(s: 'documents', r: never): Promise<unknown>; put(s: 'aiSummaries', r: never): Promise<unknown> }, id: string, day: number, mark: string, extra: Record<string, unknown> = {}) {
  const at = OCT_1 + (day - 1) * DAY;
  await db.put('documents', {
    id, guestId: 'u1', title: `Запись ${mark}`, currentVersion: 1,
    firstSessionAt: at, lastSessionAt: at, tags: [], ...extra,
  } as never);
  await db.put('aiSummaries', {
    documentId: id, processedAt: OCT_1, summary: `СУТЬ_${mark}`, themes: [],
    insights: [`ОЗАРЕНИЕ_${mark} ${LONG}`], extractedFacts: [`ФАКТ_${mark}`],
  } as never);
}

async function block(text: string): Promise<string> {
  const res = await buildTemporalBlocks({
    text, effectiveQuery: text, explicitSearch: false, lastSearchQuery: '', db: await getLocalDb(),
  });
  return res.appended;
}

describe('PA-2: потолок перечня и счётчик по видимым', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('сверх LIST_MAX_CHARS — «Показаны N из M», M без скрытых и корзины', async () => {
    const db = await clear();
    // 50 видимых записей с длинными осознаниями: строки по 240 знаков,
    // потолок 12 000 знаков не влезает целиком.
    for (let i = 1; i <= 50; i++) {
      await putNote(db, `local_pr2n_${String(i).padStart(2, '0')}`, ((i * 3) % 28) + 1, `ВИД_${i}`);
    }
    await putNote(db, 'local_pr2n_hidden_1', 2, 'СКРЫТ_1', { excludedFromAI: true });
    await putNote(db, 'local_pr2n_hidden_2', 4, 'СКРЫТ_2', { excludedFromAI: true });
    await putNote(db, 'local_pr2n_trash', 6, 'КОРЗИНА', { trashedAt: OCT_1 });

    const text = await block('перечисли все мои осознания за октябрь 2026');

    const shown = text.match(/Показаны (\d+) из (\d+)\./);
    expect(shown, `строки «Показаны N из M» нет:\n${text.slice(-400)}`).not.toBeNull();
    expect(Number(shown![2]), 'M считает не видимые записи').toBe(50);
    expect(Number(shown![1]) < Number(shown![2]), 'срез по знакам не произошёл').toBe(true);
    expect(text).toContain('50 шт.');
    expect(text).not.toMatch(/5[123] шт\./);
    for (const forbidden of ['СКРЫТ_1', 'СКРЫТ_2', 'КОРЗИНА', 'local_pr2n_hidden', 'local_pr2n_trash']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('срез идёт по датам: последние по дате записи остаются за потолком', async () => {
    const db = await clear();
    // Две записи в день, дни 1..25 (октябрь): id идут по возрастанию даты,
    // поэтому «показаны первые N» = первые N по дате. Сортировка `sort` стабильна
    // по спеке, так что порядок при равных сутках детерминирован.
    for (let i = 1; i <= 50; i++) {
      await putNote(db, `local_pr2o_${String(i).padStart(2, '0')}`, 1 + Math.floor((i - 1) / 2), `ВИД_${i}`);
    }
    const text = await block('перечисли все мои осознания за октябрь 2026');
    const m = text.match(/Показаны (\d+) из 50\./);
    expect(m, `среза по знакам нет:\n${text.slice(-300)}`).not.toBeNull();
    const shown = Number(m![1]);
    expect(text).toContain('ВИД_1');
    expect(text).toContain(`ВИД_${shown}`);
    expect(text, 'за потолком оказалась не последняя по дате запись').not.toContain(`ВИД_${shown + 1}`);
    expect(text).not.toContain('ВИД_50');
  });

  it('«фактически» и «фактор» не включают режим фактов', async () => {
    const db = await clear();
    await putNote(db, 'local_pr2f_a', 3, 'А');
    await putNote(db, 'local_pr2f_b', 9, 'Б');

    // Перечень в этих ходах обязан быть (иначе not.toContain проходил бы вакуумно):
    // строки идут с подписью разбора, а не с фактами.
    const faktich = await block('перечисли за октябрь 2026 — фактически всё расплывается');
    expect(faktich).toContain('[Все записи периода');
    expect(faktich).toContain('СУТЬ_А');
    expect(faktich, '«фактически» включил перечень фактов').not.toContain('ФАКТ_А');

    const faktor = await block('перечисли за октябрь 2026: главный фактор — усталость');
    expect(faktor).toContain('[Все записи периода');
    expect(faktor).toContain('СУТЬ_Б');
    expect(faktor, '«фактор» включил перечень фактов').not.toContain('ФАКТ_Б');
  });

  it('контроль: настоящее «факты» режим фактов включает', async () => {
    const db = await clear();
    await putNote(db, 'local_pr2f_c', 5, 'В');
    const text = await block('перечисли все мои факты за октябрь 2026');
    expect(text).toContain('[Все записи периода');
    expect(text).toContain('ФАКТ_В');
  });
});
