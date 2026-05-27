import { Helmet } from 'react-helmet-async';
import { useLanguage } from '../i18n';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://justwriting.one';
const OG_IMAGE = `${SITE_URL}/og-image.svg`;

interface SeoHeadProps {
  path: string;
  titleRu: string;
  titleEn: string;
  descriptionRu: string;
  descriptionEn: string;
}

export function SeoHead({ path, titleRu, titleEn, descriptionRu, descriptionEn }: SeoHeadProps) {
  const { language } = useLanguage();
  const isRu = language === 'ru';
  const title = isRu ? titleRu : titleEn;
  const description = isRu ? descriptionRu : descriptionEn;
  const ruUrl = `${SITE_URL}${path}`;
  const enUrl = path === '/' ? `${SITE_URL}/?lang=en` : `${SITE_URL}${path}?lang=en`;
  const canonicalUrl = isRu ? ruUrl : enUrl;

  return (
    <Helmet>
      <html lang={isRu ? 'ru' : 'en'} />
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      <link rel="alternate" hrefLang="ru" href={ruUrl} />
      <link rel="alternate" hrefLang="en" href={enUrl} />

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:locale" content={isRu ? 'ru_RU' : 'en_US'} />

      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={OG_IMAGE} />
    </Helmet>
  );
}
