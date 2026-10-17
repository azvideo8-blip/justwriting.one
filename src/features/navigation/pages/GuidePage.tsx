import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { cn } from '../../../core/utils/utils';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import './guide.css';

// Разделы руководства — те же статические страницы из public/docs. Внутри
// приложения показываем только статью: без шапки «Открыть приложение», в
// шрифтах и цветах приложения, со ссылками-переходами внутри приложения.
export const GUIDE_PAGES = [
  { slug: 'index', titleKey: 'guide_nav_start' },
  { slug: 'writing', titleKey: 'guide_nav_writing' },
  { slug: 'notes', titleKey: 'guide_nav_notes' },
  { slug: 'ai', titleKey: 'guide_nav_ai' },
  { slug: 'sync', titleKey: 'guide_nav_sync' },
  { slug: 'security', titleKey: 'guide_nav_security' },
  { slug: 'backup', titleKey: 'guide_nav_backup' },
  { slug: 'profile', titleKey: 'guide_nav_profile' },
  { slug: 'faq', titleKey: 'guide_nav_faq' },
] as const;

// 0.10.0 (UG-3): в мобильном макете — телефонное руководство из public/docs/mobile.
// Разделов, которых там нет (облако, безопасность…), на телефоне открывает
// статическая страница по ссылке `../x.html` из самой статьи.
export const MOBILE_GUIDE_PAGES = [
  { slug: 'index', titleKey: 'guide_nav_start' },
  { slug: 'writing', titleKey: 'guide_nav_writing' },
  { slug: 'notes', titleKey: 'guide_nav_notes' },
  { slug: 'ai', titleKey: 'guide_nav_ai' },
  { slug: 'profile', titleKey: 'guide_nav_profile' },
] as const;

const guidePath = (slug: string) => (slug === 'index' ? '/guide' : `/guide/${slug}`);

/**
 * Статья статической страницы, подготовленная для показа внутри приложения:
 * ссылки между разделами ведут на /guide/…, картинки — на /docs/img/….
 * Разметка своя, с нашего же домена; скрипты и обработчики в ней не исполнятся —
 * innerHTML не запускает <script>, а CSP не пускает инлайн-обработчики.
 */
export function extractGuideArticle(html: string, base = '/docs/'): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const article = doc.querySelector('article.doc');
  if (!article) return null;
  article.querySelectorAll('script').forEach(s => s.remove());
  article.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
  });
  article.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') ?? '';
    const m = /^([a-z]+)\.html(#.*)?$/.exec(href);
    if (m) a.setAttribute('href', guidePath(m[1]!) + (m[2] ?? ''));
    // Телефонная страница ссылается на десктопный раздел — статическая страница.
    const up = /^\.\.\/([a-z]+\.html(#.*)?)$/.exec(href);
    if (up) a.setAttribute('href', `/docs/${up[1]!}`);
  });
  article.querySelectorAll('img[src]').forEach(img => {
    const src = img.getAttribute('src') ?? '';
    if (!/^(\/|https?:)/.test(src)) img.setAttribute('src', `${base}${src}`);
  });
  return article.innerHTML;
}

export function GuidePage() {
  const { t } = useLanguage();
  const { page = 'index' } = useParams();
  const mobile = useLayoutMode().layoutMode === 'mobile';
  const pages = mobile ? MOBILE_GUIDE_PAGES : GUIDE_PAGES;
  const base = mobile ? '/docs/mobile/' : '/docs/';
  const slug = pages.some(p => p.slug === page) ? page : 'index';
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<{ key: string; html: string | null; failed: boolean }>({ key: '', html: null, failed: false });
  const key = base + slug;

  useEffect(() => {
    let alive = true;
    fetch(`${base}${slug}.html`)
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(text => { if (alive) setState({ key: base + slug, html: extractGuideArticle(text, base), failed: false }); })
      .catch(() => { if (alive) setState({ key: base + slug, html: null, failed: true }); });
    return () => { alive = false; };
  }, [base, slug]);

  const ready = state.key === key && state.html !== null;

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

  const current = pages.find(p => p.slug === slug)!;
  const currentTitle = t(current.titleKey);

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <SeoHead
        path={guidePath(slug)}
        titleRu={`${currentTitle} — руководство justwriting`}
        titleEn={`${currentTitle} — justwriting guide`}
        descriptionRu="Руководство пользователя justwriting."
        descriptionEn="justwriting user guide (Russian)."
      />
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-surface-base/10 border border-border-subtle flex items-center justify-center text-text-main">
          <BookOpen size={20} />
        </div>
        <h1 className="text-xl font-bold text-text-main">{t('guide_title')}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label={t('guide_sections_nav')} className="lg:sticky lg:top-6 lg:self-start">
          <ol className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
            {pages.map(p => (
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
                  {t(p.titleKey)}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 max-w-3xl">
          {state.key === key && state.failed ? (
            <p className="text-sm text-text-main/60">
              {t('guide_load_error')}
            </p>
          ) : ready ? (
            <article className="guide-doc" onClick={onClick} dangerouslySetInnerHTML={{ __html: state.html! }} />
          ) : (
            <p className="text-sm text-text-main/40">{t('guide_loading')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
