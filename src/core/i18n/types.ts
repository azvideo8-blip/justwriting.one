export type Language = 'ru' | 'en';

export interface Translations {
  [key: string]: {
    ru: string;
    en: string;
  };
}
