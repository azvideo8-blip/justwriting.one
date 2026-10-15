// MQ-16: вход — один слоган и без фиолетового свечения у логотипа; /docs — пагинация на телефоне
// на всю ширину, подвал списком (колонка по 44 px), а не строка через «·».
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const login = readFileSync('src/features/auth/pages/LoginPage.tsx', 'utf8');
const css = readFileSync('public/docs/docs.css', 'utf8');
const pages = readdirSync('public/docs').filter(f => f.endsWith('.html'));

describe('MQ-16: вход', () => {
  it('нет второй подписи под формой и свечения у логотипа', () => {
    expect(login).not.toContain('auth_tagline');
    expect(login).not.toContain('rgba(165,131,232');
    expect(login).toContain("t('auth_subtitle')");
  });
});

describe('MQ-16: /docs', () => {
  it('девять страниц, подвал каждой — список ссылок без «·» в тексте', () => {
    expect(pages).toHaveLength(9);
    for (const f of pages) {
      const html = readFileSync(`public/docs/${f}`, 'utf8');
      const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
      expect(footer, f).toContain('class="footer-links"');
      expect(footer, f).not.toContain('·');
      expect(footer.match(/<li>/g), f).toHaveLength(4);
    }
  });

  it('на телефоне «Дальше» не сжимается, ссылки подвала — колонка по 44 px', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 860px)'), css.indexOf('@media print'));
    expect(narrow).toMatch(/\.pager \.next \{ margin-left: 0; \}/);
    expect(narrow).toMatch(/\.footer-links li \{[^}]*min-height: 44px/);
  });
});
