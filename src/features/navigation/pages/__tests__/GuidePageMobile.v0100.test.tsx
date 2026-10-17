import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../../../../shared/i18n';

// 0.10.0 (UG-3): в мобильном макете руководство внутри приложения — телефонное,
// из public/docs/mobile. Ссылки на десктопные разделы (`../security.html`)
// открывают статическую страницу, картинки берутся из /docs/mobile/img.
// Мутация: всегда грузить /docs/<slug>.html → красный.
const layout = vi.hoisted(() => ({ mode: 'mobile' as 'mobile' | 'desktop' }));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: layout.mode, setLayoutMode: vi.fn(), mobilePreferred: layout.mode === 'mobile' }),
}));

const { GuidePage, extractGuideArticle } = await import('../GuidePage');

const article = `<html><body><article class="doc"><h1>Doc</h1>
  <a href="notes.html#list">notes</a> <a href="../security.html#vault">vault</a>
  <figure class="shot"><img src="img/m-write.jpg" alt=""></figure></article></body></html>`;

function renderAt(path: string) {
  return render(
    <LanguageProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/guide/:page" element={<GuidePage />} />
      </Routes>
    </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('0.10.0: телефонное руководство в мобильном макете', () => {
  const fetchMock = vi.fn(async () => new Response(article, { status: 200 }));
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('мобильный макет грузит /docs/mobile и показывает телефонные разделы', async () => {
    layout.mode = 'mobile';
    renderAt('/guide/notes');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/docs/mobile/notes.html'));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('десктопный раздел, которого нет на телефоне, ведёт на начало телефонного', async () => {
    layout.mode = 'mobile';
    renderAt('/guide/backup');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/docs/mobile/index.html'));
  });

  it('десктоп по-прежнему грузит /docs', async () => {
    layout.mode = 'desktop';
    renderAt('/guide/notes');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/docs/notes.html'));
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
  });

  it('ссылки и картинки телефонной статьи', () => {
    const html = extractGuideArticle(article, '/docs/mobile/')!;
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    expect([...doc.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['/guide/notes#list', '/docs/security.html#vault']);
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('/docs/mobile/img/m-write.jpg');
  });
});
