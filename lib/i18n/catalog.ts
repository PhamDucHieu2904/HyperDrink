import { english, type MessageKey, type Messages } from './messages';
import french from './locales/fr.json';
import chinese from './locales/zh.json';
import spanish from './locales/es.json';
import arabic from './locales/ar.json';
import russian from './locales/ru.json';
import korean from './locales/ko.json';
import german from './locales/de.json';

export const DEFAULT_LOCALE = 'en' as const;
export const LANGUAGE_STORAGE_KEY = 'vinut.language';
export const languages = [
  { code: 'en', name: 'English', nativeName: 'English', direction: 'ltr', searchNames: 'tiếng Anh anglais inglés englisch الإنجليزية английский 영어 英语' },
  { code: 'fr', name: 'French', nativeName: 'Français', direction: 'ltr', searchNames: 'tiếng Pháp francais français francés französisch الفرنسية французский 프랑스어 法语' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', direction: 'ltr', searchNames: 'tiếng Trung tiếng Hoa mandarin 中文 汉语 汉語 简体 繁體 chinois chino chinesisch الصينية китайский 중국어' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', direction: 'ltr', searchNames: 'Tây Ban Nha espanol español espagnol spanisch الإسبانية испанский 스페인어 西班牙语' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl', searchNames: 'Ả Rập arab arabe العربية عربى arabisch арабский 아랍어 阿拉伯语' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', direction: 'ltr', searchNames: 'tiếng Nga russe ruso russisch الروسية русский 러시아어 俄语' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', direction: 'ltr', searchNames: 'tiếng Hàn coréen coreano koreanisch الكورية корейский 한국어 조선말 韩语' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', direction: 'ltr', searchNames: 'tiếng Đức allemand alemán german الألمانية немецкий 독일어 德语' },
] as const;
export type Locale = typeof languages[number]['code'];
export const dictionaries: Record<Locale, Messages> = { en: english, fr: french, zh: chinese, es: spanish, ar: arabic, ru: russian, ko: korean, de: german };

export function localeDirection(locale: Locale) {
  return languages.find(language => language.code === locale)?.direction ?? 'ltr';
}

export function resolveLocale(value: unknown): Locale {
  return languages.some(language => language.code === value) ? value as Locale : DEFAULT_LOCALE;
}

/** Accent-insensitive search accepts native names, English names and locale codes. */
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

export function findLanguages(query: string) {
  const codeMatch = languages.find(language => language.code === query.trim().toLowerCase());
  if (codeMatch) return [codeMatch];
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return languages.filter(language => {
    const searchable = normalizeSearch(`${language.code} ${language.name} ${language.nativeName} ${language.searchNames}`);
    return terms.every(term => searchable.includes(term));
  });
}

export type Translator = (key: MessageKey, values?: Record<string, string | number>) => string;
export function createTranslator(locale: Locale): Translator {
  return (key, values) => {
    const template = dictionaries[locale]?.[key] ?? english[key];
    return template.replace(/\{(\w+)\}/g, (token, name: string) => values?.[name] === undefined ? token : String(values[name]));
  };
}
