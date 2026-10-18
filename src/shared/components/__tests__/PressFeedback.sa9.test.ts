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

  // B-8 (ревью 0.10.1): прежняя проверка «в окне ±300 символов вокруг якоря есть
  // `press` или тег `<Button`» не ловила снятие отклика: класс искался в тексте
  // файла, а не на кнопке. Отклик контролов панели письма и читалки теперь
  // проверяется на рендере — `src/features/writing/components/__tests__/
  // PressTargetsRender.b8.test.tsx` (мутация «убрать press» → красный). Кнопка
  // выбора собеседника в шапке ИИ и чип метки в «Записано.» своей рендер-проверки
  // не имеют (нужна полная обвязка чата и окна сохранения), но оба собраны на
  // общих `IconButton`/`Button`: их отклик держится базовым классом общего
  // компонента — он закреплён кейсом выше и мутацией в `PressTargetsRender.b8`.

  it.each([
    ['features/writing/components/MobileSessionSetupSheet.tsx'],
    ['features/archive/components/MobileArchiveSidebarSheet.tsx'],
  ])('%s: the sheet close button is 44 px', (file) => {
    expect(read(file)).not.toMatch(/w-8 h-8 rounded-full/);
  });
});
