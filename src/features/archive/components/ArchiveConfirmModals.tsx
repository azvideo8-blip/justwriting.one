import { ConfirmModal } from '../../../shared/components/ConfirmModal';
import { useTagEditor } from '../hooks/useTagEditor';
import { useLabelEditor } from '../hooks/useLabelEditor';
import { ArchiveSession } from '../types';

interface ArchiveConfirmModalsProps {
  tagEditor: ReturnType<typeof useTagEditor>;
  labelEditor: ReturnType<typeof useLabelEditor>;
  deleteConfirm: ArchiveSession | null;
  onDeleteConfirm: () => Promise<void>;
  onDeleteCancel: () => void;
  permanentDeleteConfirm?: ArchiveSession | null;
  onPermanentDeleteConfirm?: () => Promise<void>;
  onPermanentDeleteCancel?: () => void;
  emptyTrashConfirm?: boolean;
  onEmptyTrashConfirm?: () => Promise<void>;
  onEmptyTrashCancel?: () => void;
  t: (key: string, args?: Record<string, string | number>) => string;
}

export function ArchiveConfirmModals({
  tagEditor, labelEditor, deleteConfirm,
  onDeleteConfirm, onDeleteCancel,
  permanentDeleteConfirm, onPermanentDeleteConfirm, onPermanentDeleteCancel,
  emptyTrashConfirm, onEmptyTrashConfirm, onEmptyTrashCancel,
  t,
}: ArchiveConfirmModalsProps) {
  return (
    <>
      <ConfirmModal
        isOpen={!!tagEditor.tagDeleteConfirm}
        title={t('archive_tags_label')}
        message={t('archive_tag_delete_confirm', { tag: tagEditor.tagDeleteConfirm ?? '' })}
        confirmLabel={t('storage_delete_confirm')}
        cancelLabel={t('common_cancel')}
        onConfirm={() => void tagEditor.handleDeleteTag()}
        onCancel={() => tagEditor.setTagDeleteConfirm(null)}
      />
      <ConfirmModal
        isOpen={!!labelEditor.labelDeleteConfirm}
        title={t('archive_labels')}
        message={t('archive_label_delete_confirm')}
        confirmLabel={t('storage_delete_confirm')}
        cancelLabel={t('common_cancel')}
        onConfirm={() => void labelEditor.confirmDeleteLabel()}
        onCancel={() => labelEditor.setLabelDeleteConfirm(null)}
      />
      <ConfirmModal
        isOpen={!!deleteConfirm}
        title={t('archive_delete_confirm')}
        message={`${deleteConfirm?.title ? `«${deleteConfirm.title}»\n\n` : ''}${t('session_delete_confirm_desc')}`}
        confirmLabel={t('storage_delete_confirm')}
        cancelLabel={t('common_cancel')}
        onConfirm={() => void onDeleteConfirm()}
        onCancel={onDeleteCancel}
      />
      <ConfirmModal
        isOpen={!!permanentDeleteConfirm}
        title={t('archive_trash_delete_forever')}
        message={`${permanentDeleteConfirm?.title ? `«${permanentDeleteConfirm.title}»\n\n` : ''}${t('archive_trash_delete_forever_confirm')}`}
        confirmLabel={t('storage_delete_confirm')}
        cancelLabel={t('common_cancel')}
        onConfirm={() => { void onPermanentDeleteConfirm?.(); }}
        onCancel={() => onPermanentDeleteCancel?.()}
      />
      <ConfirmModal
        isOpen={!!emptyTrashConfirm}
        title={t('archive_trash_clear')}
        message={t('archive_trash_clear_confirm')}
        confirmLabel={t('storage_delete_confirm')}
        cancelLabel={t('common_cancel')}
        onConfirm={() => { void onEmptyTrashConfirm?.(); }}
        onCancel={() => onEmptyTrashCancel?.()}
      />
    </>
  );
}
