// F5 (emil-review, хвост MQ-15): в окне завершения письма лежала мёртвая анимация —
// `AnimatePresence mode="wait" initial={false}` вокруг ребёнка с ключом, который
// не меняется никогда (`isMobile` не переключается при открытом окне): вход глушил
// `initial={false}`, уходу не было откуда начаться. Код выглядел как движение,
// которого нет. Обёртка и motion-свойства убраны, разметка и поведение те же.
//
// Это храповик по исходнику: он краснеет, если мёртвый паттерн вернут. Поведение
// после удаления проверяют существующие спеки окна — FinishModalHeadingDcW3,
// sheets-opaque-motion.mf20 (уход «Записано.») и MobileNoteReaderMp1.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/features/writing/components/WritingFinishModal.tsx', 'utf8');

describe('F5: в окне завершения нет анимации, которая не может сыграть', () => {
  it('нет AnimatePresence mode="wait" c initial={false}', () => {
    expect(src).not.toMatch(/<AnimatePresence[^>]*mode="wait"[^>]*initial=\{false\}/);
    expect(src).not.toMatch(/<AnimatePresence[^>]*initial=\{false\}[^>]*mode="wait"/);
  });

  it('нет motion-ветки с initial/exit, у которой ключ не меняется', () => {
    expect(src).not.toMatch(/key="form"[\s\S]{0,240}initial=\{reducedMotion/);
  });

  it('само окно по-прежнему собирается из ModalShell (правка не вырезала разметку)', () => {
    expect(src).toContain('<ModalShell');
    expect(src).toMatch(/variant=\{isMobile \? 'sheet' : 'modal'\}|variant="sheet"/);
  });
});
