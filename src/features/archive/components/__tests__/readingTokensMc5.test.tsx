// MC-5: токены типографики чтения объявлены в `index.css` и работают только в
// мобильных ветках: читалка 17/1.6 в 20 px полей, ответ ИИ — 16/1.6 на всю
// ширину. Десктоп остаётся на 15 px.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const css = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

import { MobileNoteReader } from '../MobileNoteReader';
import { AssistantTurn } from '../../../ai/components/AIChatPresentational';
import type { ArchiveSession } from '../../types';

const PERSONA = 'Группа психологов';
const TITLE = 'Про обжиг';
const BODY = 'Длинный текст читалки, чтобы померять строку.';
const ANSWER = 'Ответ собеседника, который надо читать, а не рассматривать.';
const DESKTOP_ANSWER = 'Десктопный ответ.';
const session = {
  id: 'doc-mc5', userId: 'u1', title: TITLE, content: BODY,
  duration: 300, wordCount: 120, charCount: 400, wpm: 24, tags: [], createdAt: new Date(2026, 9, 14, 20, 15).getTime(),
  _isLocal: true,
} as unknown as ArchiveSession;

describe('MC-5: токены', () => {
  it('объявлены в @theme', () => {
    expect(css).toMatch(/--reading-size:\s*17px/);
    expect(css).toMatch(/--reading-lh:\s*1\.6/);
    expect(css).toMatch(/--reading-gutter:\s*20px/);
    expect(css).toMatch(/--ink:\s*color-mix\(in srgb, var\(--text-main\) 87%, var\(--bg-base\)\)/);
  });
});

describe('MC-5: читалка на телефоне', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });
  afterEach(() => { cleanup(); });

  it('тело использует токены, заголовок — serif 26', () => {
    render(
      <MobileNoteReader session={session} onClose={vi.fn()} onContinue={vi.fn()} />,
    );
    const body = screen.getByText(BODY);
    expect(body.className).toContain('var(--reading-size)');
    expect(body.className).toContain('var(--reading-lh)');
    expect(body.className).toContain('var(--ink)');
    expect(body.parentElement!.className, 'боковой отступ не из токена').toContain('var(--reading-gutter)');
    expect(screen.getByText(TITLE).className).toContain('text-[26px]');
  });
});

describe('MC-5: ответ ИИ', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('на телефоне — без колонки аватара и без левого бордера, 16/1.6', () => {
    const { container } = render(
      <AssistantTurn name={PERSONA} color="#A583E8" mono="Гп" isMobile>
        <p>{ANSWER}</p>
      </AssistantTurn>,
    );
    const text = screen.getByText(ANSWER).closest('[data-testid="assistant-text"]') as HTMLElement;
    expect(text).toBeTruthy();
    expect(text.className).toContain('var(--reading-size)');
    expect(text.style.borderLeft).toBe('');
    expect(container.textContent).toContain(PERSONA);
    expect(container.textContent, 'на телефоне осталась монограмма').not.toContain('Гп');
  });

  it('на десктопе бордер и монограмма остались', () => {
    const { container } = render(
      <AssistantTurn name={PERSONA} color="#A583E8" mono="Гп">
        <p>{DESKTOP_ANSWER}</p>
      </AssistantTurn>,
    );
    const text = screen.getByText(DESKTOP_ANSWER).closest('[data-testid="assistant-text"]') as HTMLElement;
    expect(text.className).toContain('text-[15px]');
    expect(text.style.borderLeft).not.toBe('');
    expect(container.textContent, 'монограмма пропала').toContain('Гп');
  });
});

// SA-17: в читалке нет даты (она была только в «Инфо»); у «Продолжить писать»
// значок «наружу»; пункты листа действий — карточки в рамках.
describe('SA-17: дата в читалке', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('под заголовком — строка даты 13 px', () => {
    render(<MobileNoteReader session={session} onClose={vi.fn()} onContinue={vi.fn()} />);
    const date = screen.getByTestId('reader-date');
    expect(date.textContent).toMatch(/14 октября/);
    expect(date.textContent).toMatch(/20:15/);
    expect(date.className).toContain('text-[13px]');
    expect(date.previousElementSibling?.textContent).toBe(TITLE);
  });
});
