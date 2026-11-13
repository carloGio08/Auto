import { en, type Dictionary, type I18nKey } from '../i18n/en';
import { it } from '../i18n/it';
import type { LanguageSetting } from './settings';

export type { I18nKey };
export type LanguageId = 'en' | 'it';

/** Registered languages. To add one: create src/i18n/<id>.ts and list it here. */
export const LANGUAGES: Record<LanguageId, { name: string; dict: Dictionary }> = {
  en: { name: 'English', dict: en },
  it: { name: 'Italiano', dict: it },
};

export function detectLanguage(
  navigatorLanguages: readonly string[] = typeof navigator !== 'undefined'
    ? navigator.languages
    : [],
): LanguageId {
  for (const tag of navigatorLanguages) {
    const base = tag.toLowerCase().split('-')[0] as LanguageId;
    if (base in LANGUAGES) return base;
  }
  return 'en';
}

/** String lookup with `{param}` interpolation. Missing keys fall back to English. */
export class I18n {
  private lang: LanguageId = 'en';
  private readonly listeners = new Set<() => void>();

  constructor(setting: LanguageSetting = 'auto') {
    this.apply(setting);
  }

  get language(): LanguageId {
    return this.lang;
  }

  apply(setting: LanguageSetting): void {
    const next = setting === 'auto' ? detectLanguage() : setting;
    if (next === this.lang) return;
    this.lang = next;
    if (typeof document !== 'undefined') document.documentElement.lang = next;
    this.listeners.forEach((l) => l());
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  t = (key: I18nKey, params?: Record<string, string | number>): string => {
    let s: string = LANGUAGES[this.lang].dict[key] ?? en[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };

  /** Lookup for keys built at runtime (data-driven names). */
  tk = (key: string, params?: Record<string, string | number>): string => {
    if (key in en) return this.t(key as I18nKey, params);
    return key;
  };
}
