// MQ-7: панель тегов и меток на телефоне — по правилам телефона (подпись строчная,
// фишки Inter 14 и 44 px), десктопная панель не меняется.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArchiveTagBar } from '../ArchiveTagBar';
import { ArchiveLabelBar } from '../ArchiveLabelBar';
import { LanguageProvider } from '../../../../shared/i18n';

const t = (k: string) => k;
const tagBar = (variant?: 'sheet') => render(
  <LanguageProvider><ArchiveTagBar
    allTags={['глина', 'утро']} selectedTags={['глина']} tagCounts={{ глина: 3, утро: 1 }} onToggleTag={vi.fn()}
    renamingTag={null} renameTagValue="" setRenameTagValue={vi.fn()} onStartRename={vi.fn()} onRenameSubmit={vi.fn()}
    onRenameCancel={vi.fn()} onDeleteTag={vi.fn()} onResetTags={vi.fn()} showControls={false} t={t}
    {...(variant ? { variant } : {})}
  /></LanguageProvider>,
);
const labelBar = (variant?: 'sheet') => render(
  <LanguageProvider><ArchiveLabelBar
    labels={[{ id: 'l1', name: 'Работа', color: '#7D4FD1' }]} selectedLabels={['l1']} labelCounts={{ l1: 2 }} onToggleLabel={vi.fn()}
    addingLabel={false} setAddingLabel={vi.fn()} newLabelName="" setNewLabelName={vi.fn()} newLabelColor="#fff" setNewLabelColor={vi.fn()}
    onAddLabel={vi.fn()} editingLabelId={null} setEditingLabelId={vi.fn()} editLabelName="" setEditLabelName={vi.fn()}
    editLabelColor="" setEditLabelColor={vi.fn()} onUpdateLabel={vi.fn()} onDeleteLabel={vi.fn()} showControls={false} t={t}
    {...(variant ? { variant } : {})}
  /></LanguageProvider>,
);

describe('MQ-7: панель тегов и меток на телефоне', () => {
  it('теги: подпись строчная, без моно, фишки min-h-11', () => {
    const { container } = tagBar('sheet');
    expect(container.innerHTML).not.toContain('uppercase');
    expect(container.innerHTML).not.toContain('font-mono');
    expect(container.innerHTML).not.toContain('text-[9px]');
    expect(container.innerHTML).not.toContain('text-[10px]');
    for (const name of [/#глина/, /#утро/, /archive_tags_reset/]) {
      expect(screen.getByRole('button', { name }).className, String(name)).toContain('min-h-11');
    }
  });

  it('метки: подпись строчная, без моно, фишки min-h-11', () => {
    const { container } = labelBar('sheet');
    expect(container.innerHTML).not.toContain('uppercase');
    expect(container.innerHTML).not.toContain('font-mono');
    for (const name of [/Работа/, /archive_tags_reset/]) {
      expect(screen.getByRole('button', { name }).className, String(name)).toContain('min-h-11');
    }
  });

  it('десктопная панель не изменилась: моно-капс и маленькие фишки', () => {
    const { container } = tagBar();
    expect(container.innerHTML).toContain('uppercase');
    expect(container.innerHTML).toContain('font-mono');
    expect(screen.getByRole('button', { name: /#утро/ }).className).not.toContain('min-h-11');
    const labels = labelBar();
    expect(labels.container.innerHTML).toContain('uppercase');
  });

  it('ArchivePage на телефоне отдаёт обеим панелям вариант sheet', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/pages/ArchivePage.tsx', 'utf8');
    const mobile = src.slice(src.indexOf('testId="archive-tags-panel"'), src.indexOf('showTagLabelBars && (\n                  <>'));
    expect(mobile.match(/variant="sheet"/g)?.length).toBe(2);
  });
});
