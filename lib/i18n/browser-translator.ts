import type { CatalogData } from '@/lib/catalog/contracts';
import type { Locale } from './catalog';
import { catalogTexts } from './dynamic-catalog';

export type TranslationStatus = 'idle' | 'translating' | 'downloading' | 'needs-activation' | 'unsupported' | 'error' | 'ready';
export interface TranslationProgress { status: TranslationStatus; completed: number; total: number; download?: number }
type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
interface ProgressMonitor { addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void }
interface NativeTranslator { translate(text: string): Promise<string>; destroy(): void }
interface NativeDetector { detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>; destroy(): void }
export interface BrowserTranslationEnvironment {
  Translator?: {
    availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
    create(options: { sourceLanguage: string; targetLanguage: string; monitor?: (monitor: ProgressMonitor) => void }): Promise<NativeTranslator>;
  };
  LanguageDetector?: { availability(): Promise<Availability>; create(): Promise<NativeDetector> };
  navigator?: { userActivation?: { isActive: boolean } };
  localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
}
const CACHE_KEY = 'vinut.catalog-translations.v1';
const MAX_CACHE_ITEMS = 1000;
const MAX_CACHE_CHARS = 250_000;
const MAX_TRANSLATORS = 6;
const supportedSources = new Set(['ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'mr', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh', 'zh-Hant']);

/** Uses the official on-device API; no remote endpoint or API credentials. */
export class BrowserCatalogTranslator {
  private cache = new Map<string, string>();
  private pairs = new Map<string, Promise<NativeTranslator | null>>();
  private listeners = new Set<(progress: TranslationProgress) => void>();
  private activations = new Set<() => void>();
  private detector: Promise<NativeDetector | null> | null = null;
  private detectorReady: NativeDetector | null = null;
  private detectorDownloading = false;
  private currentLocale: Locale = 'en';
  private generation = 0;
  private progress: TranslationProgress = { status: 'idle', completed: 0, total: 0 };
  constructor(private environment: () => BrowserTranslationEnvironment) {}
  private debug(message: string) { if (process.env.NODE_ENV === 'development') console.debug(`[catalog translation] ${message}`); }
  subscribe(listener: (progress: TranslationProgress) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onActivation(listener: () => void) { this.activations.add(listener); return () => { this.activations.delete(listener); }; }
  private report(progress: TranslationProgress, locale: Locale) {
    if (locale !== this.currentLocale) return;
    this.progress = progress;
    for (const listener of this.listeners) listener(progress);
  }
  get status() { return this.progress.status; }
  private readCache() {
    if (this.cache.size) return;
    try {
      const value = this.environment().localStorage?.getItem(CACHE_KEY);
      if (!value || value.length > MAX_CACHE_CHARS) return;
      const entries: unknown = JSON.parse(value);
      if (!Array.isArray(entries)) return;
      for (const entry of entries.slice(-MAX_CACHE_ITEMS)) {
        if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[0].length <= 6000 && entry[1].length <= 12000 && entry[1].trim()) this.cache.set(entry[0], entry[1]);
      }
    } catch { /* Private browsing and damaged caches do not prevent translation. */ }
  }
  private saveCache() {
    while (this.cache.size > MAX_CACHE_ITEMS) this.cache.delete(this.cache.keys().next().value!);
    try {
      let entries = [...this.cache.entries()];
      while (entries.length && JSON.stringify(entries).length > MAX_CACHE_CHARS) entries = entries.slice(Math.max(1, Math.floor(entries.length / 10)));
      this.environment().localStorage?.setItem(CACHE_KEY, JSON.stringify(entries));
    } catch { /* Translation continues if storage is full or disabled. */ }
  }
  private async getDetector(activated: boolean): Promise<NativeDetector | null> {
    const factory = this.environment().LanguageDetector;
    if (!factory) return null;
    if (this.detectorReady) return this.detectorReady;
    // Detection is optional. A background detector download must not block ready translators.
    if (this.detectorDownloading && !activated) return null;
    if (!this.detector) this.detectorDownloading = activated;
    if (!this.detector) this.detector = (async () => {
      try {
        const availability = await factory.availability();
        this.debug(`language detector: ${availability}`);
        if (availability === 'unavailable' || (availability !== 'available' && !activated)) return null;
        const detector = await factory.create();
        this.detectorReady = detector;
        this.debug('language detector ready');
        return detector;
      } catch { return null; }
      finally { this.detectorDownloading = false; }
    })();
    const detector = await this.detector;
    if (!detector) this.detector = null;
    return detector;
  }
  private async pair(source: string, target: Locale, activated: boolean): Promise<NativeTranslator | null> {
    if (source === target) return null;
    const factory = this.environment().Translator;
    if (!factory) { this.report({ status: 'unsupported', completed: 0, total: 0 }, target); return null; }
    const key = `${source}:${target}`;
    if (!this.pairs.has(key)) {
      const pending = (async () => {
        try {
          const availability = await factory.availability({ sourceLanguage: source, targetLanguage: target });
          this.debug(`${key}: ${availability}`);
          if (availability === 'unavailable') { this.report({ status: 'unsupported', completed: 0, total: 0 }, target); return null; }
          if (availability !== 'available' && !activated) { this.report({ status: 'needs-activation', completed: 0, total: 0 }, target); return null; }
          if (availability !== 'available') this.report({ status: 'downloading', completed: 0, total: 0 }, target);
          const translator = await factory.create({ sourceLanguage: source, targetLanguage: target, monitor: monitor => monitor.addEventListener('downloadprogress', event => this.report({ status: 'downloading', completed: 0, total: 0, download: Math.max(0, Math.min(1, event.loaded)) }, target)) });
          this.debug(`${key}: ready`);
          return translator;
        } catch (cause) { this.debug(`${key}: ${cause instanceof Error ? cause.name : 'error'}`); this.report({ status: cause instanceof Error && cause.name === 'NotAllowedError' ? 'needs-activation' : 'error', completed: 0, total: 0 }, target); return null; }
      })();
      this.pairs.set(key, pending);
      while (this.pairs.size > MAX_TRANSLATORS) {
        const oldest = this.pairs.keys().next().value!;
        const retired = this.pairs.get(oldest)!;
        this.pairs.delete(oldest);
        void retired.then(instance => instance?.destroy()).catch(() => {});
      }
    }
    const instance = await this.pairs.get(key)!;
    if (!instance) this.pairs.delete(key); // A failed download can be retried on the next click.
    return instance;
  }
  async activate(locale: Locale) {
    this.currentLocale = locale;
    const generation = ++this.generation;
    const activated = this.environment().navigator?.userActivation?.isActive === true;
    if (!activated || !this.environment().Translator) return;
    // English names and Vietnamese descriptions are the existing catalog's source languages.
    void this.getDetector(true);
    await Promise.allSettled(['en', 'vi'].filter(source => source !== locale).map(source => this.pair(source, locale, true)));
    if (generation === this.generation) for (const listener of this.activations) listener();
  }
  private async sourceLanguage(text: string, detector: NativeDetector | null): Promise<string> {
    if (detector && text.length >= 12) {
      try { const result = (await detector.detect(text))[0]; if (result?.confidence >= .5 && supportedSources.has(result.detectedLanguage)) return result.detectedLanguage; } catch { /* Fall back to script/language hints. */ }
    }
    if (/[đĐưƯơƠăĂạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉĩọỏốồổỗộớờởỡợụủũứừửữựỳỷỹỵ]/u.test(text)) return 'vi';
    if (/\p{Script=Arabic}/u.test(text)) return 'ar';
    if (/\p{Script=Cyrillic}/u.test(text)) return 'ru';
    if (/\p{Script=Hangul}/u.test(text)) return 'ko';
    if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return 'ja';
    if (/\p{Script=Han}/u.test(text)) return 'zh';
    return 'en';
  }
  cached(data: CatalogData, target: Locale): Map<string, string> {
    this.readCache();
    const result = new Map<string, string>();
    for (const text of catalogTexts(data)) { const cached = this.cache.get(`${target}:${text}`); if (cached) result.set(text, cached); }
    return result;
  }
  async translate(data: CatalogData, target: Locale, signal: AbortSignal, onUpdate: (translations: Map<string, string>) => void) {
    this.currentLocale = target;
    const texts = catalogTexts(data);
    const translations = this.cached(data, target);
    onUpdate(new Map(translations));
    if (translations.size === texts.length) { this.report({ status: 'ready', completed: translations.size, total: texts.length }, target); return; }
    if (!this.environment().Translator) { this.report({ status: 'unsupported', completed: translations.size, total: texts.length }, target); return; }
    const detector = await this.getDetector(false);
    const attemptedPairs = new Map<string, NativeTranslator | null>();
    let unavailable = false;
    for (const text of texts) {
      if (signal.aborted) return;
      if (translations.has(text)) continue;
      const source = await this.sourceLanguage(text, detector);
      if (signal.aborted) return;
      if (source === target) { translations.set(text, text); continue; }
      if (!attemptedPairs.has(source)) attemptedPairs.set(source, await this.pair(source, target, this.environment().navigator?.userActivation?.isActive === true));
      const translator = attemptedPairs.get(source);
      if (signal.aborted) return;
      if (!translator) { unavailable = true; continue; }
      this.report({ status: 'translating', completed: translations.size, total: texts.length }, target);
      try {
        const translated = (await translator.translate(text)).trim();
        if (translated) { this.cache.set(`${target}:${text}`, translated); translations.set(text, translated); }
        else unavailable = true;
      } catch { unavailable = true; this.report({ status: 'error', completed: translations.size, total: texts.length }, target); }
      if (signal.aborted) { this.saveCache(); return; }
      if (translations.size % 8 === 0) onUpdate(new Map(translations));
    }
    this.saveCache();
    if (!signal.aborted) {
      onUpdate(new Map(translations));
      this.report({ status: unavailable ? (this.progress.status === 'translating' ? 'error' : this.progress.status) : 'ready', completed: translations.size, total: texts.length }, target);
    }
  }
}
