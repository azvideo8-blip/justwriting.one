import { getLocalDb } from '../storage/localDb';
import { localMonthKey } from '../utils/dateUtils';
import { invalidatePortrait } from '../ai/portraitEpoch';
import { LocalStoreSyncService } from './LocalStoreSyncService';
import { writeFacetStore } from './facetLock';
import { reportError } from '../../shared/errors/reportError';

/**
 * AP-3: производные профиля, которые пересказывают заметку дословно.
 *
 * Скрытие, корзина и полное удаление раньше расходились: скрытие чистило
 * хронологию, а грань с формулировкой заметки и портрет оставались и уходили
 * в промпты. Здесь одна уборка на все три пути: месячный дайджест (AP-1),
 * грани (id убирается, грань помечается dirty) и портрет с его кэшами.
 * Пересборка — только по действию человека: никаких вызовов ИИ отсюда.
 */
export async function purgeNoteDerivatives(noteId: string, ownerId?: string): Promise<void> {
  const db = await getLocalDb(ownerId);

  // Месяц дайджеста читается ДО удаления хронологии: на полном удалении это
  // единственный оставшийся след того, в каком месяце лежала заметка.
  // Приёмка ai-privacy (M-2): уборка вызывается и там, где заметка ничего ИИ не
  // давала (откат неудачной загрузки из облака в фоне, «убрать копию с
  // устройства», удаление неразобранной заметки). Портрет и дайджест удаляются,
  // только если у заметки были производные; иначе каждый проход синка стирал бы
  // портрет на всех устройствах. Не прочиталось — считаем, что были: «нет
  // ответа» не значит «не было».
  let hadDerivatives = false;
  const months = new Set<string>();
  try {
    const entry = await db.get('aiTimeline', noteId);
    if (entry) hadDerivatives = true;
    if (entry?.month) months.add(entry.month);
    const doc = await db.get('documents', noteId);
    if (doc?.aiProcessed) hadDerivatives = true;
    if (!hadDerivatives && (await db.get('aiSummaries', noteId) || (doc?.uuid && await db.get('aiSummaries', doc.uuid)))) hadDerivatives = true;
    // Диалог о заметке (её тема) питает память и через неё портрет — тоже вход.
    if (!hadDerivatives) {
      for (const key of [noteId, doc?.uuid].filter((x): x is string => !!x)) {
        if ((await db.getAllFromIndex('aiDialogues', 'by-document', key)).length > 0) { hadDerivatives = true; break; }
      }
    }
    const at = doc?.lastSessionAt ?? doc?.firstSessionAt;
    if (at) months.add(localMonthKey(at));
  } catch (e) {
    hadDerivatives = true;
    reportError(e, { action: 'purgeNoteDerivatives_months', noteId });
  }
  // Дайджест, собранный по этой заметке (noteIds), — удаляется в любом месяце;
  // старый дайджест без номеров — в месяцах заметки, если у неё были производные.
  try {
    for (const d of await db.getAll('aiMonthlyDigest')) {
      const byIds = d.noteIds?.includes(noteId) === true;
      const legacyHere = d.noteIds === undefined && hadDerivatives && months.has(d.month);
      if (!byIds && !legacyHere) continue;
      await db.delete('aiMonthlyDigest', d.month);
      LocalStoreSyncService.scheduleStoreDelete('aiMonthlyDigest', d.month);
    }
  } catch (e) {
    reportError(e, { action: 'purgeNoteDerivatives_digest', noteId });
  }

  try {
    await writeFacetStore(async (store) => {
      const facets = await store.getAll();
      const tx = store.transaction();
      for (const f of facets) {
        if (!f.noteIds.includes(noteId)) continue;
        hadDerivatives = true;
        f.noteIds = f.noteIds.filter(nid => nid !== noteId);
        if (f.primaryNoteIds) f.primaryNoteIds = f.primaryNoteIds.filter(nid => nid !== noteId);
        if (f.secondaryNoteIds) f.secondaryNoteIds = f.secondaryNoteIds.filter(nid => nid !== noteId);
        f.noteCount = Math.max(0, (f.noteCount ?? 1) - 1);
        // Приёмка ai-privacy (security-review, Vuln 1): номер ушёл из грани, а
        // пересказ остался — и все стражи на чтении (смотрят на скрытые номера
        // в noteIds) пропускали грань со смешанным пересказом в промпт. Пересказ
        // стирается вместе с номером; новый — только по действию человека.
        f.summary = '';
        // То же для выдержек ещё не пересказанной грани: _excerptSeed уходит модели
        // при следующем пересказе (AIProfileFacetSummarizer) и может держать фрагмент
        // скрытой заметки. Без него пересказчик берёт фрагменты только по текущим
        // noteIds. Придуманное по заметкам название — тоже пересказ: обезличиваем,
        // новое даст пересказчик. Фиксированные (доменные) названия не трогаем.
        delete f._excerptSeed;
        if (!f.fixedLabel) f.label = 'Тема';
        f.pendingSummary = true;
        f.dirty = true;
        f.updatedAt = Date.now();
        if (f.noteIds.length === 0 && (!f.dialogueIds || f.dialogueIds.length === 0)) {
          await tx.store.delete(f.id);
          LocalStoreSyncService.scheduleStoreDelete('aiProfileFacets', f.id);
        } else {
          await tx.store.put(f);
          LocalStoreSyncService.scheduleStoreSync('aiProfileFacets', f.id);
        }
      }
      await tx.done;
    });
  } catch (e) {
    reportError(e, { action: 'purgeNoteDerivatives_facets', noteId });
  }

  // Портрет — если у заметки были производные (разбор, хронология, грань): он мог
  // быть собран по сводкам, даже если заметка не попала ни в одну грань.
  if (hadDerivatives) try {
    invalidatePortrait();
    await db.delete('aiPortrait', 'singleton');
    LocalStoreSyncService.scheduleStoreDelete('aiPortrait', 'singleton');
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ai_user_portrait');
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('ai_user_portrait_') || k.startsWith('ai_portrait_sections')) {
          localStorage.removeItem(k);
        }
      }
    }
  } catch (e) {
    reportError(e, { action: 'purgeNoteDerivatives_portrait', noteId });
  }
}
