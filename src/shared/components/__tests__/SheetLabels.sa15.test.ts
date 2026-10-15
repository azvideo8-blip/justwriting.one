// SA-15: капс с разрядкой над секциями вернулся в листы и «Записано.». Метки на
// телефоне — одна строчная (SECTION_LABEL); тест держит мобильные файлы без `uppercase`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SECTION_LABEL } from '../ModalShell';

const read = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');
// Комментарии вроде «mono-uppercase ярлыков» классом не являются.
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const MOBILE_ONLY = [
  'features/archive/components/MobileNoteReader.tsx',
  'features/archive/components/MobileArchiveSidebarSheet.tsx',
  'features/writing/components/MobileSessionSetupSheet.tsx',
  'features/writing/components/MobileWriteScreen.tsx',
  'features/writing/components/MobileWriteToolbar.tsx',
  'features/ai/components/chat/MobileDialogueListSheet.tsx',
  'app/components/MobileNoteActionsSheet.tsx',
  'app/pages/MobileMeScreen.tsx',
];

describe('SA-15: mobile section labels are sentence case', () => {
  it('the shared label has no caps and no tracking', () => {
    expect(SECTION_LABEL).not.toMatch(/uppercase|tracking|font-mono/);
  });

  it.each(MOBILE_ONLY)('%s has no uppercase class', (file) => {
    expect(code(file)).not.toMatch(/\buppercase\b/);
  });

  it('«Записано.»: the phone (plain) branch of FinishModalTags has no uppercase', () => {
    const src = code('features/writing/components/FinishModalTags.tsx');
    const plain = src.slice(0, src.indexOf('  if (isMobile) {'));
    expect(plain).not.toMatch(/\buppercase\b/);
  });
});
