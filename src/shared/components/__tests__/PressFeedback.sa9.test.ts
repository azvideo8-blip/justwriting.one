// SA-9: `.press` затирал переходы кнопки целиком, на тех же кнопках лежал второй
// масштаб `active:scale`, часть кнопок отклика не имела, «×» листов были 32 px.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');

describe('SA-9: press feedback', () => {
  it('.press transition keeps opacity, border-color and box-shadow', () => {
    const css = read('index.css');
    const block = css.slice(css.indexOf('.press {'), css.indexOf('.press:active'));
    for (const prop of ['transform', 'background-color', 'color', 'opacity', 'border-color', 'box-shadow']) {
      expect(block, prop).toContain(prop);
    }
  });

  // Общий Button и IconButton несут отклик в своих базовых классах. Отдельная
  // проверка нужна затем, чтобы ниже можно было засчитывать `<Button …>` без
  // литерала `press` в файле: иначе храповик слепеет ровно в тот момент, когда
  // кнопку выносят в общий компонент (мутация «убрать press из Button» красна
  // здесь).
  it('shared Button and IconButton carry .press themselves', () => {
    expect(read('shared/components/Button.tsx')).toMatch(/transition-colors press/);
    expect(read('shared/components/IconButton.tsx')).toMatch(/clickable-target-expansion press/);
  });

  it.each([
    ['features/writing/components/MobileSessionSetupSheet.tsx'],
    ['features/archive/components/MobileArchiveSidebarSheet.tsx'],
    ['features/archive/components/MobileNoteReader.tsx'],
    ['features/writing/components/MobileWriteToolbar.tsx'],
    ['features/ai/components/chat/AIChatHeader.tsx'],
  ])('%s: no active:scale on top of .press', (file) => {
    expect(read(file)).not.toMatch(/active:scale-\[/);
  });

  it.each([
    ['features/writing/components/MobileWriteToolbar.tsx', 'data-write-chip'],
    ['features/writing/components/MobileWriteToolbar.tsx', "aria-label={t('topbar_save')}"],
    ['features/archive/components/MobileNoteReader.tsx', 'onSelectRelated(note.documentId)'],
    ['features/ai/components/chat/AIChatHeader.tsx', 'setPersonaSheetOpen(true)'],
    ['features/writing/components/WritingFinishModal.tsx', 'aria-pressed={active}'],
  ])('%s: the control next to «%s» has press', (file, anchor) => {
    const src = read(file);
    const at = src.indexOf(anchor);
    expect(at, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
    // className стоит в пределах тега кнопки — в 600 знаках от якоря. С
    // 2026-10-18 (U-6) частью кнопок управляет общий Button: `press` уже в его
    // базовых классах, поэтому литерала в файле нет — считаем и такую форму.
    const window = src.slice(Math.max(0, at - 300), at + 300);
    expect(window.match(/['"` ]press[ '"`]/) || window.match(/<Button\b/), 'ни press, ни общего Button').not.toBeNull();
  });

  it.each([
    ['features/writing/components/MobileSessionSetupSheet.tsx'],
    ['features/archive/components/MobileArchiveSidebarSheet.tsx'],
  ])('%s: the sheet close button is 44 px', (file) => {
    expect(read(file)).not.toMatch(/w-8 h-8 rounded-full/);
  });
});
