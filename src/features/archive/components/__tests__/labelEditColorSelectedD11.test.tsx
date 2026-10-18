// D-11: в листе правки метки нельзя было увидеть, какой цвет выбран — `editLabelColor`
// в компонент приходил, но не использовался (`_editLabelColor`). В ветке добавления
// такой отметка есть, поэтому правка приводит лист правки к тому же виду.
// B-6: подписи кружков цвета теперь приходят из словаря
// (`archive_label_color_aria`), поэтому ожидаемое имя берётся оттуда же, а не
// литералом из теста.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArchiveLabelBar } from '../ArchiveLabelBar';
import { LanguageProvider } from '../../../../shared/i18n';
import { archiveTranslations } from '../../../../shared/i18n/translations/archive';
import { LABEL_PRESET_COLORS } from '../../../../core/constants/labelColors';

const colorName = (c: string) => (archiveTranslations.archive_label_color_aria?.ru ?? '').replace('{color}', c);

function bar(props: { editLabelColor: string; newLabelColor: string; addingLabel: boolean; editingLabelId: string | null }) {
  return render(
    <LanguageProvider>
      <ArchiveLabelBar
        labels={[{ id: 'l1', name: 'Работа', color: props.editLabelColor }]}
        selectedLabels={['l1']}
        labelCounts={{ l1: 2 }}
        onToggleLabel={vi.fn()}
        addingLabel={props.addingLabel}
        setAddingLabel={vi.fn()}
        newLabelName=""
        setNewLabelName={vi.fn()}
        newLabelColor={props.newLabelColor}
        setNewLabelColor={vi.fn()}
        onAddLabel={vi.fn()}
        editingLabelId={props.editingLabelId}
        setEditingLabelId={vi.fn()}
        editLabelName="Работа"
        setEditLabelName={vi.fn()}
        editLabelColor={props.editLabelColor}
        setEditLabelColor={vi.fn()}
        onUpdateLabel={vi.fn()}
        onDeleteLabel={vi.fn()}
        showControls
      />
    </LanguageProvider>,
  );
}

// Знак выбора — кольцо цветом токена; `focus-visible:ring-2` есть у любой кнопки
// общего `Button`, поэтому по нему выбранное не отличить.
const colorButtons = () => screen
  .getAllByRole('button')
  .filter(btn => LABEL_PRESET_COLORS.some(c => btn.getAttribute('aria-label') === colorName(c as string)));

const marked = () => colorButtons().filter(btn => btn.className.includes('ring-text-main'));

describe('D-11: выбранный цвет метки отмечен', () => {
  it('лист правки: кольцо ровно на одном цвете — на текущем', () => {
    bar({ editLabelColor: LABEL_PRESET_COLORS[2] as string, newLabelColor: LABEL_PRESET_COLORS[0] as string, addingLabel: false, editingLabelId: 'l1' });
    const picked = marked();
    expect(picked).toHaveLength(1);
    expect(picked[0]).toHaveAttribute('aria-label', colorName(LABEL_PRESET_COLORS[2] as string));
  });

  it('лист добавления: тот же знак на выбранном цвете', () => {
    bar({ editLabelColor: LABEL_PRESET_COLORS[2] as string, newLabelColor: LABEL_PRESET_COLORS[1] as string, addingLabel: true, editingLabelId: null });
    const picked = marked();
    expect(picked).toHaveLength(1);
    expect(picked[0]).toHaveAttribute('aria-label', colorName(LABEL_PRESET_COLORS[1] as string));
  });

  it('лист правки следует за переданным цветом: кольцо переезжает', () => {
    const first = bar({ editLabelColor: LABEL_PRESET_COLORS[2] as string, newLabelColor: LABEL_PRESET_COLORS[0] as string, addingLabel: false, editingLabelId: 'l1' });
    expect(marked()[0]).toHaveAttribute('aria-label', colorName(LABEL_PRESET_COLORS[2] as string));
    first.unmount();
    bar({ editLabelColor: LABEL_PRESET_COLORS[0] as string, newLabelColor: LABEL_PRESET_COLORS[0] as string, addingLabel: false, editingLabelId: 'l1' });
    expect(marked()[0]).toHaveAttribute('aria-label', colorName(LABEL_PRESET_COLORS[0] as string));
  });
});
