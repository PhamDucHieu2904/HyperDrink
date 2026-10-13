import type { Locale } from './catalog';

const titles: Record<Locale, readonly [string, string]> = {
  en: ['Every flavor.', 'One collection.'],
  fr: ['Toutes les saveurs.', 'Une collection.'],
  zh: ['每一种风味。', '同一个系列。'],
  es: ['Todos los sabores.', 'Una colección.'],
  ar: ['كل النكهات.', 'مجموعة واحدة.'],
  ru: ['Все вкусы.', 'Одна коллекция.'],
  ko: ['모든 맛을', '한곳에서.'],
  de: ['Alle Sorten.', 'Eine Kollektion.'],
};
export const catalogLandingTitle = (locale: Locale) => titles[locale];
