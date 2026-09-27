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
  // ─── cloud sync ───────────────────────────────────────────────────────────
  activity_cloud_downloaded_all: {
    ru: 'Загружено заметок из облака: {downloaded}',
    en: 'Downloaded notes from cloud: {downloaded}',
  },
  activity_cloud_remote_edit: {
    ru: 'заметка изменилась на другом устройстве',
    en: 'note changed on another device',
  },
  activity_cloud_corrupted_versions: {
    ru: 'Часть истории заметки не читается и пропущена (версий: {count})',
    en: 'Part of note history is unreadable and was skipped ({count} versions)',
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
    ru: 'Заметка была в корзине на другом устройстве — после вашей правки она восстановлена',
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
  // ─── AI ───────────────────────────────────────────────────────────────────
  activity_ai_bg_sync_started: {
    ru: 'Фоновая синхронизация ИИ запущена',
    en: 'AI background sync started',
  },
  activity_ai_themes_updated: {
    ru: 'Темы обновлены',
    en: 'Themes updated',
  },
  activity_ai_consolidation_done: {
    ru: 'Консолидация завершена',
    en: 'Consolidation complete',
  },
  activity_ai_restore_done: {
    ru: 'Восстановление ИИ завершено',
    en: 'AI restore complete',
  },
};
