// C-4 (R2-007): аудит i18n видел кириллицу только в JSX и в confirmDialog-ах.
// Текст, уходящий в UI через showToast/setError-подобные сеттеры/addActivity и
// поля title/label/currentStage, оставался невидимым — в английском интерфейсе
// он русский. Здесь стережётся, что эти стоки находятся, а журнал и промпты —
// нет.
//
// Фальсификация (проверена мутациями в /tmp/jw-sweep): убрать 'showToast' из
// UI_SINK_CALLEES и суффикс Toast из UI_SINK_SETTER — краснеют тесты 1, 6, 7, 8
// (поодиночке мутация не убивает: showToast совпадает и с CALLEES, и с регуляркой);
// убрать ветку isObjectLiteralExpression вне стоков — тесты 2 и 3; обнулить
// LOG_CALLEES — тест 4; добавить 'text'/'content' в UI_TEXT_FIELDS — тест 5;
// убрать дедуп в push — тест 8.
import { describe, it, expect } from 'vitest';
import { findHardcodedUiText, uiSinkKey } from '../../scripts/i18n-audit';

const scan = (src: string, file = 'src/features/x/Component.tsx') =>
  findHardcodedUiText(src, file).map(hit => `${hit.sink}|${hit.match}`);

describe('AG-I18N-SINKS-1 — findHardcodedUiText', () => {
  it('1. ловит кириллицу в аргументах showToast', () => {
    expect(scan(`
      export function Save({ showToast }) {
        const save = () => showToast('Заметка сохранена', 'success');
        return <button onClick={save} />;
      }
    `)).toEqual(['showToast|Заметка сохранена']);
  });

  it('2. ловит стадию в объекте, переданном сеттеру прогресса', () => {
    expect(scan(`
      export function Modal() {
        const run = () => setProgress({ currentStage: 'Загрузка заметок и версий...', percent: 10 });
        return null;
      }
    `)).toEqual(['currentStage|Загрузка заметок и версий...']);
  });

  it('3. ловит label из модульной константы, которую рендерит профиль', () => {
    expect(scan(`
      const LIFE_DOMAINS = [{ id: 'money', label: 'Деньги' }];
      export const useList = () => LIFE_DOMAINS;
    `, 'src/features/ai/utils/lifeDomains.ts')).toEqual(['label|Деньги']);
  });

  it('4. не считает журналом то, что пользователь не видит', () => {
    expect(scan(`
      export function load(api) {
        reportError(new Error('x'), { action: 'load', message: 'Не удалось загрузить' });
        console.warn('Не удалось загрузить');
        api.track({ message: 'Не удалось загрузить' });
        return null;
      }
    `)).toEqual([]);
  });

  it('5. не трогает промпты: text/content и собиратели промптов не стоки', () => {
    expect(scan(`
      export function build(memory) {
        const parts = [];
        parts.push({ text: '[Портрет пользователя]: ', value: memory });
        return profilePrompt({ content: 'Собери портрет автора' });
      }
    `)).toEqual([]);
  });

  it('6. ловит шаблон с подстановкой и сеттер ошибки', () => {
    expect(scan(`
      export function Chat({ setError, showToast }) {
        const onRateLimit = (sec) => {
          setError(\`Слишком частые запросы. Подождите \${sec} сек.\`);
          showToast(\`Готово: \${sec}\`, 'info');
        };
        return null;
      }
    `)).toEqual([
      'setError|Слишком частые запросы. Подождите ${…} сек.',
      'showToast|Готово: ${…}',
    ]);
  });

  it('7. ключ храповика стабилен: файл + сток + текст, без номера строки', () => {
    const [hit] = findHardcodedUiText(`export function C({ showToast }) { return showToast('Тест', 'info'); }`, 'src/a/C.tsx');
    expect(hit && uiSinkKey(hit)).toBe('src/a/C.tsx:showToast:Тест');
  });

  it('8. не дублирует один и тот же текст в одном файле', () => {
    expect(scan(`
      export function C({ showToast }) {
        showToast('Уже сохранено', 'info');
        showToast('Уже сохранено', 'info');
        return null;
      }
    `)).toHaveLength(1);
  });

  it('9. ключ храповика нормализует виндовые разделители пути (K-1/N-87)', () => {
    const [hit] = findHardcodedUiText(`export function C({ showToast }) { return showToast('Тест', 'info'); }`, 'src\\a\\C.tsx');
    expect(hit && uiSinkKey(hit)).toBe('src/a/C.tsx:showToast:Тест');
  });

  // G-5 (R5-023): начальное значение useState, тернар и склейка в аргументе
  // стока — тот же вшитый текст, гейт их раньше не видел.
  it('10. ловит кириллицу в начальном значении useState', () => {
    expect(scan(`
      export function Form() {
        const [err] = useState('Заполните поле');
        return <div>{err}</div>;
      }
    `)).toEqual(['useState|Заполните поле']);
  });

  it('11. ловит обе ветки тернара, t() в ветке не считается', () => {
    expect(scan(`
      export function C({ showToast, t, ok }) {
        showToast(ok ? 'Готово' : 'Ошибка', 'info');
        showToast(ok ? t('done') : ('Не удалось'), 'info');
        return null;
      }
    `)).toEqual(['showToast|Готово | Ошибка', 'showToast|Не удалось']);
  });

  it('12. ловит склейку строки с переменной', () => {
    expect(scan(`
      export function C({ setError, e }) {
        setError('Ошибка: ' + e.message);
        return null;
      }
    `)).toEqual(['setError|Ошибка: ${…}']);
  });

  it('13. ключ, обрезанный на пробеле, без хвостового пробела — иначе бейслайн (trim) не совпадёт', () => {
    const [hit] = findHardcodedUiText(`showToast('${'а'.repeat(79)} б')`, 'src/a/C.ts');
    expect(hit && uiSinkKey(hit)).toBe(`src/a/C.ts:showToast:${'а'.repeat(79)}`);
  });
});
