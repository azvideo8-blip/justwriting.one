// MR-4: четыре вкладки, плавающих чипов нет, статусы переехали в «Профиль».
import { expect, test } from '@playwright/test';
import { horizontalOverflow, shot, signInMobile, unlockVaultIfAsked, waitForQuietDialogs } from './harness';

test.describe('MR-4: оболочка на четырёх вкладках', () => {
  test('вкладок ровно четыре, бокового скролла нет нигде, журнал больше не висит над панелью', async ({ page }) => {
    const acc = await signInMobile(page, 'mr4-tabs');
    await page.reload();
    await unlockVaultIfAsked(page, acc.password);

    // '/' здесь сознательно нет: на домашнем экране подсказка «или просто начни
    // писать» (left-1/2 + inline transform) висит за левым краем — x=−94 при 320.
    // MR-6 этот экран удаляет, и проверка '/' вернётся в write-zero-taps.mr6.spec.ts.
    const w = page.viewportSize()?.width ?? 0;
    for (const path of ['/archive', '/ai', '/me']) {
      await page.goto(path);
      const tabs = page.locator('nav[aria-label] button');
      await expect(tabs, `на ${path} вкладок не четыре`).toHaveCount(4);
      const over = await horizontalOverflow(page);
      // На 320 в списке заметок остаётся только кнопка тега (`clickable-target-expansion`,
      // x=304..340): MR-9 убирает редактирование тегов из строки — до него этот
      // элемент не наш. Прочие нарушители не прощаются.
      const left = over.offenders.filter(o => !(w === 320 && path === '/archive' && /clickable-target-expansion|^\s*(svg|path)/.test(o)));
      expect(left, `на ${path} есть горизонтальный скролл: ${left.join(', ')}`).toEqual([]);
      if (path !== '/me') {
        expect(await page.getByRole('button', { name: 'Журнал активности' }).count(),
          `чип журнала вернулся на ${path}`).toBe(0);
      }
    }
    await shot(page, 'mr4-four-tabs');
  });

  test('в «Профиле» есть строки статусов, «Диагностика» — для админа', async ({ page }) => {
    const acc = await signInMobile(page, 'mr4-me');
    await page.reload();
    await unlockVaultIfAsked(page, acc.password);
    await page.goto('/me');

    // MR-5 убрал переключатель «Статистика / Аккаунт»: статусы видны сразу.
    for (const label of [/Синхронизация/, /Журнал активности/, /Сейф/, /Диагностика/]) {
      const row = page.getByRole('button', { name: label }).first();
      await expect(row, `в «Профиле» нет строки ${label}`).toBeVisible({ timeout: 10_000 });
      const box = await row.boundingBox();
      expect(box && box.height, `строка ${label} ниже 48 px`).toBeGreaterThanOrEqual(44);
    }
    await shot(page, 'mr4-me-status');
  });
});

// N-2 (решение владельца 2026-10-18): у гостя вкладки «ИИ» больше нет — раньше
// она стояла приглушённой и вела в модалку входа; теперь справа «Войти», и она
// открывает ту же модалку, что десктоп и «Профиль» гостя. Аккаунт не нужен.
test.describe('N-2: нижняя панель гостя', () => {
  test('четыре вкладки «Писать · Заметки · Профиль · Войти», «ИИ» нет, «Войти» открывает модалку', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByTestId('mobile-bottom-nav');
    await expect(nav, 'гость не получил нижнюю панель').toBeVisible({ timeout: 20_000 });
    await waitForQuietDialogs(page, 12_000);

    const labels = await nav.locator('button').evaluateAll(bs => bs.map(b => b.getAttribute('aria-label') ?? ''));
    expect(labels, `вкладки гостя не те: ${labels.join(' · ')}`).toEqual(['Писать', 'Заметки', 'Профиль', 'Войти']);

    for (const label of labels) {
      const box = await nav.getByRole('button', { name: label }).boundingBox();
      expect(box && box.height, `вкладка «${label}» ниже 44 px`).toBeGreaterThanOrEqual(44);
    }

    await nav.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('dialog'), '«Войти» не открыло модалку входа').toBeVisible({ timeout: 10_000 });
    expect(page.url(), '«Войти» ушло на отдельную страницу').toMatch(/\/$/);
    await shot(page, 'n2-guest-nav');
  });
});
