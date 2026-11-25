/**
 * N-75: Activity log i18n.
 * Ключи — машиночитаемые идентификаторы; значения — человеческие тексты.
 * Всё, что передаётся в addActivity() как первый аргумент, должно быть ключом
 * из этого файла (или из другого namespace), чтобы ActivityLogBadge мог
 * вызвать t(entry.message, entry.context) вместо показа сырой строки.
 *
 * Параметры в {фигурных_скобках} подставляются через entry.context.
 */
import { Translations } from '../types';

export const activityTranslations: Translations = {
  // ─── archive ─────────────────────────────────────────────────────────────
  activity_note_trashed: {
    ru: 'заметка удалена в корзину',
    en: 'note moved to trash',
  },
  activity_note_restored: {
    ru: 'заметка восстановлена из корзины',
    en: 'note restored from trash',
  },
  activity_note_deleted: {
    ru: 'заметка удалена навсегда',
    en: 'note permanently deleted',
  },
  activity_note_deleted_derivatives: {
    ru: 'заметка удалена, но часть связанных с ней разборов ИИ удалить не удалось — они уберутся при следующей очистке',
    en: 'note deleted, but some AI analyses could not be removed — they will be cleaned up later',
  },
  activity_trash_cleared: {
    ru: 'корзина очищена ({count})',
    en: 'trash cleared ({count})',
  },
  activity_trash_cleared_partial: {
    ru: 'корзина очищена не полностью: удалено {success}, не удалось {failed}',
    en: 'trash partially cleared: {success} deleted, {failed} failed',
  },
  activity_trash_cloud_pending: {
    ru: 'корзина: удалено на этом устройстве, из облака удалится позже ({count})',
    en: 'trash: deleted on this device, will be removed from the cloud later ({count})',
  },
  // ─── cloud sync ───────────────────────────────────────────────────────────
  activity_cloud_downloaded_all: {
    ru: 'Загружено заметок из облака: {downloaded}',
    en: 'Downloaded notes from cloud: {downloaded}',
  },
  activity_cloud_remote_edit: {
    ru: 'заметка изменилась на другом устройстве',
    en: 'note changed on another device',
  },
  activity_ai_record_oversized: {
    ru: 'Запись ИИ {store}/{key} ({kb} КБ) больше 4 МБ и остаётся только на устройстве',
    en: 'AI record {store}/{key} ({kb} KB) is over 4 MB and stays on this device only',
  },
  activity_cloud_corrupted_versions: {
    ru: 'Часть истории заметки не читается и пропущена (версий: {count})',
    en: 'Part of note history is unreadable and was skipped ({count} versions)',
  },
  activity_dialogue_cloud_unreadable: {
    ru: 'Диалог {key} не синхронизируется: облачная копия не читается',
    en: 'Dialogue {key} is not syncing: the cloud copy is unreadable',
  },
  activity_local_store_dead_upsert: {
    ru: 'Запись {store}/{key} не принята облаком {attempts} раз и осталась только на устройстве',
    en: 'Record {store}/{key} was rejected by the cloud {attempts} times and stays on this device only',
  },
  activity_cloud_restored_notes: {
    ru: 'Восстановлено заметок из облака: {restored}',
    en: 'Notes restored from the cloud: {restored}',
  },
  activity_restore_oversized_record: {
    ru: 'Запись {store}/{key} ({kb} КБ) в облаке превышает лимит размера 10 МБ и не может быть загружена на устройство',
    en: 'Cloud record {store}/{key} ({kb} KB) exceeds the 10 MB limit and cannot be downloaded to this device',
  },
  activity_analysis_reattached: {
    ru: 'Анализ привязан к заметкам (сводок: {summaries}, эмбеддингов: {embeddings})',
    en: 'Analysis re-attached to notes ({summaries} summaries, {embeddings} embeddings)',
  },
  activity_cloud_note_downloaded: {
    ru: 'Заметка загружена из облака',
    en: 'Note downloaded from cloud',
  },
  activity_cloud_local_only: {
    ru: 'Заметка помечена «только на устройстве» — в облако не отправлена',
    en: 'Note marked as local-only — not sent to cloud',
  },
  activity_cloud_tombstone: {
    ru: 'Облачная копия этой заметки была удалена. Заметка осталась на устройстве; повторное «отправить в облако» создаст новую облачную копию',
    en: 'Cloud copy of this note was deleted. Note remains on device; re-uploading will create a new cloud copy',
  },
  activity_cloud_unreadable_version: {
    ru: 'Синхронизация отложена: невозможно расшифровать или сравнить облачную версию',
    en: 'Sync deferred: cannot decrypt or compare cloud version',
  },
  activity_cloud_restored_from_trash: {
    ru: 'Заметка была в корзине на другом устройстве — после твоей правки она восстановлена',
    en: 'Note was in trash on another device — restored after your edit',
  },
  activity_cloud_new_identity: {
    ru: 'Создана новая облачная копия: прежний номер заметки занят удалённой строкой',
    en: 'New cloud copy created: the previous note ID was taken by a deleted record',
  },
  activity_cloud_note_saved: {
    ru: 'Заметка сохранена в облако',
    en: 'Note saved to cloud',
  },
  activity_cloud_changes_saved: {
    ru: 'Изменения сохранены в облако',
    en: 'Changes saved to cloud',
  },
  activity_cloud_relinked: {
    ru: 'Заметки заново связаны с облачными копиями: {count}',
    en: 'Notes relinked to cloud copies: {count}',
  },
  // ─── badge UI ─────────────────────────────────────────────────────────────
  activity_log_title: { ru: 'Журнал активности', en: 'Activity log' },
  activity_log_header: { ru: 'Активность ({count})', en: 'Activity ({count})' },
  activity_copy_all: { ru: 'Скопировать весь журнал', en: 'Copy entire log' },
  activity_copy: { ru: 'Копировать', en: 'Copy' },
  activity_copied: { ru: 'Скопировано', en: 'Copied' },
  activity_clear_all: { ru: 'Очистить все', en: 'Clear all' },
  activity_clear: { ru: 'Очистить', en: 'Clear' },
  activity_filter_all: { ru: 'Все события', en: 'All events' },
  activity_filter_error: { ru: 'Только ошибки', en: 'Errors only' },
  activity_context_details: { ru: 'Детали контекста', en: 'Context details' },
  activity_empty_error: { ru: 'Ошибок нет', en: 'No errors' },
  activity_empty_all: { ru: 'Журнал пуст', en: 'Log is empty' },
  activity_entry_delete: { ru: 'Удалить', en: 'Delete' },
};
