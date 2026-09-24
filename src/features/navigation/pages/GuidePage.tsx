import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { cn } from '../../../core/utils/utils';
import './guide.css';

// Разделы руководства — те же статические страницы из public/docs. Внутри
// приложения показываем только статью: без шапки «Открыть приложение», в
// шрифтах и цветах приложения, со ссылками-переходами внутри приложения.
export const GUIDE_PAGES = [
  { slug: 'index', title: 'Начало работы' },
  { slug: 'writing', title: 'Как писать' },
  { slug: 'notes', title: 'Заметки' },
  { slug: 'ai', title: 'ИИ-собеседник и разбор' },
  { slug: 'sync', title: 'Облако и устройства' },
  { slug: 'security', title: 'Пароли и шифрование' },
  { slug: 'backup', title: 'Резервные копии и импорт' },
  { slug: 'profile', title: 'Профиль и статистика' },
  { slug: 'faq', title: 'Вопросы и проблемы' },
] as const;

const guidePath = (slug: string) => (slug === 'index' ? '/guide' : `/guide/${slug}`);

/**
 * Статья статической страницы, подготовленная для показа внутри приложения:
 * ссылки между разделами ведут на /guide/…, картинки — на /docs/img/….
 * Разметка своя, с нашего же домена; скрипты и обработчики в ней не исполнятся —
 * innerHTML не запускает <script>, а CSP не пускает инлайн-обработчики.
 */
export function extractGuideArticle(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const article = doc.querySelector('article.doc');
  if (!article) return null;
  article.querySelectorAll('script').forEach(s => s.remove());
  article.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
  });
  article.querySelectorAll('a[href]').forEach(a => {
    const m = /^([a-z]+)\.html(#.*)?$/.exec(a.getAttribute('href') ?? '');
    if (m) a.setAttribute('href', guidePath(m[1]!) + (m[2] ?? ''));
  });
  article.querySelectorAll('img[src]').forEach(img => {
    const src = img.getAttribute('src') ?? '';
    if (!/^(\/|https?:)/.test(src)) img.setAttribute('src', `/docs/${src}`);
  });
  return article.innerHTML;
}

export function GuidePage() {
  const { page = 'index' } = useParams();
  const slug = GUIDE_PAGES.some(p => p.slug === page) ? page : 'index';
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<{ slug: string; html: string | null; failed: boolean }>({ slug: '', html: null, failed: false });

  useEffect(() => {
    let alive = true;
    fetch(`/docs/${slug}.html`)
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(text => { if (alive) setState({ slug, html: extractGuideArticle(text), failed: false }); })
      .catch(() => { if (alive) setState({ slug, html: null, failed: true }); });
    return () => { alive = false; };
  }, [slug]);

  const ready = state.slug === slug && state.html !== null;

  // Якорь из адреса — после того как статья легла в DOM.
  useEffect(() => {
    if (!ready) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [ready, slug, location.hash]);

  // Ссылки внутри статьи: свои разделы и страницы приложения — без перезагрузки.
  const onClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!href || a?.target === '_blank') return;
    if (href.startsWith('#')) {
      e.preventDefault();
      void navigate({ hash: href });
    } else if (href.startsWith('/') && !href.startsWith('/docs/')) {
      e.preventDefault();
      void navigate(href);
    }
  };

  const current = GUIDE_PAGES.find(p => p.slug === slug)!;

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <SeoHead
        path={guidePath(slug)}
        titleRu={`${current.title} — руководство justwriting`}
        titleEn={`${current.title} — justwriting guide`}
        descriptionRu="Руководство пользователя justwriting."
        descriptionEn="justwriting user guide (Russian)."
      />
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-surface-base/10 border border-border-subtle flex items-center justify-center text-text-main">
          <BookOpen size={20} />
        </div>
        <h1 className="text-xl font-bold text-text-main">Руководство пользователя</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="Разделы руководства" className="lg:sticky lg:top-6 lg:self-start">
          <ol className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
            {GUIDE_PAGES.map(p => (
              <li key={p.slug}>
                <Link
                  to={guidePath(p.slug)}
                  aria-current={p.slug === slug ? 'page' : undefined}
                  className={cn(
                    'block rounded-lg px-3 py-1.5 text-sm transition-colors',
                    p.slug === slug
                      ? 'bg-brand-soft/15 text-text-main font-medium'
                      : 'text-text-main/60 hover:text-text-main hover:bg-text-main/5',
                  )}
                >
                  {p.title}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 max-w-3xl">
          {state.slug === slug && state.failed ? (
            <p className="text-sm text-text-main/60">
              Не удалось загрузить раздел. Проверьте соединение и попробуйте ещё раз.
            </p>
          ) : ready ? (
            <article className="guide-doc" onClick={onClick} dangerouslySetInnerHTML={{ __html: state.html! }} />
          ) : (
            <p className="text-sm text-text-main/40">Загрузка…</p>
          )}
        </div>
      </div>
    </div>
  );
}
