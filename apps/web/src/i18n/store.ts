import { create } from 'zustand';
import type { Lang, Translations } from './types';
import { ru } from './locales/ru';
import { kk } from './locales/kk';
import { en } from './locales/en';

const LOCALES: Record<Lang, Translations> = { ru, kk, en };

const TITLES: Record<Lang, string> = {
  ru: 'Цифровой двойник цеха — Allur',
  kk: 'Цехтың сандық егізі — Allur',
  en: 'Shop Digital Twin — Allur',
};

const STORAGE_KEY = 'allur-lang';

function getInitialLang(): Lang {
  if (typeof window === 'undefined') return 'ru';
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved && (saved === 'ru' || saved === 'kk' || saved === 'en')) {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return 'ru';
}

function applyHtmlAttributes(lang: Lang) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.title = TITLES[lang] || TITLES.ru;
  }
}

interface I18nState {
  lang: Lang;
  t: Translations;
  setLang: (lang: Lang) => void;
}

const initialLang = getInitialLang();
applyHtmlAttributes(initialLang);

export const useI18n = create<I18nState>((set) => ({
  lang: initialLang,
  t: LOCALES[initialLang],
  setLang: (lang: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    applyHtmlAttributes(lang);
    set({
      lang,
      t: LOCALES[lang],
    });
  },
}));

export function useTranslation() {
  const lang = useI18n((s) => s.lang);
  const t = useI18n((s) => s.t);
  const setLang = useI18n((s) => s.setLang);
  return { lang, t, setLang };
}

export function getI18n(): { lang: Lang; t: Translations } {
  const state = useI18n.getState();
  return { lang: state.lang, t: state.t };
}

export function setLanguage(lang: Lang): void {
  useI18n.getState().setLang(lang);
}

