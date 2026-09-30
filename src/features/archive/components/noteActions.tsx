import { Cloud, ExternalLink, EyeOff, HardDrive, Pencil, Sparkles, Tag, Trash2, type LucideIcon } from 'lucide-react';
import { Label } from '../../../types';
import { MenuEntry } from '../../../shared/components/Menu';
import { AIExclusion, NoteStorageActions, StorageDoc } from './useNoteStorageActions';

export type NoteActionId =
  | 'open'
  | 'rename'
  | 'addTag'
  | 'download'
  | 'upload'
  | 'removeLocal'
  | 'removeCloud'
  | 'excludeAi'
  | 'analyzeAi'
  | 'delete';

/** Группы разделяются в меню; пустая группа не даёт лишнего разделителя. */
export type NoteActionGroup = 'main' | 'organize' | 'storage' | 'danger';

export interface NoteActionItem {
  kind: 'action';
  id: NoteActionId;
  group: NoteActionGroup;
  label: string;
  icon: LucideIcon;
  destructive: boolean;
  onSelect: () => void;
}

export interface NoteLabelOption {
  key: string;
  label: string;
  color?: string | undefined;
  dashed: boolean;
  checked: boolean;
  onSelect: () => void;
}

export interface NoteLabelsSection {
  kind: 'labels';
  group: 'organize';
  heading: string;
  options: NoteLabelOption[];
}

export type NoteMenuSection = NoteActionItem | NoteLabelsSection;

export interface NoteAIState {
  processed: boolean;
  loading: boolean;
  onClick: () => void;
}

export interface NoteActionsInput {
  t: (key: string) => string;
  doc: StorageDoc;
  userId: string;
  storage: Pick<NoteStorageActions, 'uploading' | 'downloading' | 'requestLocal' | 'requestCloud' | 'requestExclusion'>;
  labels?: Label[] | undefined;
  currentLabelId?: string | undefined;
  onLabelChange?: ((labelId: string | undefined) => void) | undefined;
  onOpen: () => void;
  onRename: () => void;
  /** Пункт «Добавить тег» — только там, где есть инлайн-поле ввода (десктоп, DC-A4). */
  onAddTag?: (() => void) | undefined;
  ai?: NoteAIState | undefined;
  exclusion?: AIExclusion | undefined;
  onDelete: () => void;
}

const isGuest = (userId: string) => !userId || userId.startsWith('guest_');

/** DC-A3: один источник списка действий — его читают и меню в строке заметки,
 *  и лист действий на телефоне. Разойтись по составу, порядку, подписям и
 *  обработчикам они уже не могут. */
export function buildNoteActions(input: NoteActionsInput): NoteMenuSection[] {
  const { t, doc, userId, storage, labels, currentLabelId, onLabelChange, onOpen, onRename, onAddTag, ai, exclusion, onDelete } = input;

  const sections: NoteMenuSection[] = [];
  const action = (
    id: NoteActionId,
    group: NoteActionGroup,
    label: string,
    icon: LucideIcon,
    onSelect: () => void,
    opts: { destructive?: boolean } = {},
  ): void => {
    sections.push({
      kind: 'action',
      id,
      group,
      label,
      icon,
      destructive: opts.destructive === true,
      onSelect,
    });
  };

  action('open', 'main', t('archive_preview'), ExternalLink, onOpen);
  action('rename', 'main', t('archive_rename_title'), Pencil, onRename);

  if (onLabelChange && ((labels !== undefined && labels.length > 0) || currentLabelId)) {
    const options: NoteLabelOption[] = [];
    if (currentLabelId) {
      options.push({ key: 'none', label: t('archive_no_label'), dashed: true, checked: false, onSelect: () => onLabelChange(undefined) });
    }
    for (const l of labels ?? []) {
      options.push({
        key: l.id,
        label: l.name,
        color: l.color,
        dashed: false,
        checked: currentLabelId === l.id,
        onSelect: () => onLabelChange(currentLabelId === l.id ? undefined : l.id),
      });
    }
    if (options.length > 0) {
      sections.push({ kind: 'labels', group: 'organize', heading: t('archive_assign_label'), options });
    }
  }

  if (onAddTag) {
    action('addTag', 'organize', t('archive_add_tag_aria'), Tag, onAddTag);
  }

  const isTooLarge = doc.isTooLargeForSync === true;
  const isUnsynced = !!doc.hasPendingSync && !isTooLarge;
  const canUpload = !doc.hasCloud && !isTooLarge && !!doc.localId && !isGuest(userId);
  const canDownload = !doc.hasLocal && doc.hasCloud && !!doc.cloudId;

  // G-6 (R3-031): недоступное сейчас действие не показывается вовсе, а не
  // стоит серой кнопкой — в том числе то, которое уже идёт.
  if (canDownload && !storage.downloading) {
    action('download', 'storage', t('storage_download_to_local'), HardDrive, storage.requestLocal);
  }
  if ((canUpload || isUnsynced) && !storage.uploading) {
    action('upload', 'storage', isUnsynced ? t('storage_sync_now') : t('storage_upload_to_cloud'), Cloud, storage.requestCloud);
  }
  if (doc.hasLocal && doc.hasCloud) {
    action('removeLocal', 'storage', t('storage_remove_local'), HardDrive, storage.requestLocal);
  }
  if (doc.hasCloud && !isUnsynced) {
    action('removeCloud', 'storage', t('storage_remove_cloud'), Cloud, storage.requestCloud);
  }
  if (exclusion && !exclusion.loading) {
    action(
      'excludeAi',
      'storage',
      exclusion.excluded ? t('ai_note_include') : t('ai_note_exclude'),
      EyeOff,
      storage.requestExclusion,
    );
  }
  // Скрытую от ИИ заметку разбирать нельзя: пункта нет, а о скрытии говорит
  // сосед «Вернуть в ИИ» и значок в строке.
  if (ai && !ai.loading && exclusion?.excluded !== true) {
    action('analyzeAi', 'storage', ai.processed ? t('ai_note_clear') : t('ai_note_analyze'), Sparkles, ai.onClick);
  }

  action('delete', 'danger', t('archive_delete'), Trash2, onDelete, { destructive: true });

  return sections;
}

/** Десктопное меню: группы разделяются чертой, метки становятся списком
 *  `menuitemradio`. На телефоне те же секции рисуются списком кнопок. */
export function sectionsToMenuEntries(sections: NoteMenuSection[], iconSize = 15): MenuEntry[] {
  const entries: MenuEntry[] = [];
  let prevGroup: NoteActionGroup | null = null;
  for (const section of sections) {
    if (prevGroup !== null && section.group !== prevGroup) {
      entries.push({ kind: 'separator', key: `sep-${section.group}` });
    }
    prevGroup = section.group;
    if (section.kind === 'labels') {
      entries.push({ kind: 'heading', key: 'labels', label: section.heading });
      for (const option of section.options) {
        entries.push({
          kind: 'radio',
          key: `label-${option.key}`,
          label: option.label,
          icon: option.dashed
            ? <span className="w-2.5 h-2.5 rounded-full border border-dashed border-text-main/30 shrink-0" />
            : <span className="w-2.5 h-2.5 rounded-full shrink-0" style={option.color ? { background: option.color } : undefined} />,
          checked: option.checked,
          onSelect: option.onSelect,
        });
      }
      continue;
    }
    const Icon = section.icon;
    entries.push({
      kind: 'item',
      key: section.id,
      label: section.label,
      icon: <Icon size={iconSize} aria-hidden="true" />,
      destructive: section.destructive,
      onSelect: section.onSelect,
    });
  }
  return entries;
}
