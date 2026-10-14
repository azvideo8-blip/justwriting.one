// FX-3: пунктуация диктовки подключается побочным импортом мостика
// (`src/app/dictationAiWiring.ts` из `WritingPage.tsx:9`). Такой импорт легко
// потерять при рефакторинге — линтер считает его «ненужным», а без него диктовка
// молча возвращается к прежнему поведению: текст вставляется как сказан, ни метки,
// ни предупреждения про запрос. Тест фиксирует сам факт подключения.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Страница письма тянет за собой редактор, облачную сессию и тему — проверка
// читает только факт импорта, поэтому тяжёлое мокается целиком.
vi.mock('../../core/settings/WritingSettingsContext', () => ({ useWritingSettings: () => ({ settings: {} }) }));
vi.mock('../../features/writing/contexts/WritingSessionContext', () => ({
  WritingSessionProvider: (props: { children?: unknown }) => props.children,
  useWritingSessionContext: () => ({ session: null }),
}));
vi.mock('../../features/writing/hooks/useGuestWritingSession', () => ({ useGuestWritingSession: () => ({}) }));
vi.mock('../../features/writing/hooks/useCloudWritingSession', () => ({ useCloudWritingSession: () => ({}) }));
vi.mock('../../features/writing/components/MobileWriteScreen', () => ({ MobileWriteScreen: () => null }));
vi.mock('../../features/writing/components/MobileSessionSetupSheet', () => ({ MobileSessionSetupSheet: () => null }));
vi.mock('../../features/writing/components/WritingFinishModal', () => ({ WritingFinishModal: () => null }));
vi.mock('../../features/writing/components/ShortcutsModal', () => ({ ShortcutsModal: () => null }));
vi.mock('../../core/theme/FlowPulse', () => ({ FlowPulse: () => null }));

beforeEach(() => { vi.resetModules(); });

async function probe() {
  const mod = await import('../../features/writing/hooks/useDictation');
  return mod.dictationAiIsWired();
}

describe('FX-3: проводка пунктуации диктовки подключена страницей письма', () => {
  it('без страницы письма проба красная — то есть есть что ломать', async () => {
    await import('../../features/writing/hooks/useDictation');
    expect(await probe()).toBe(false);
  });

  it('импорт WritingPage регистрирует разрешения: проба зелёная', async () => {
    await import('../../app/pages/WritingPage');
    expect(await probe()).toBe(true);
  });
});
