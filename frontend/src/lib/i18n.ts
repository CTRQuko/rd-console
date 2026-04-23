/** i18n bootstrap — react-i18next with inline resource bundle.
 *
 *  The locales ship in the JS bundle (not lazy-loaded) because:
 *    - Total payload is ~15KB uncompressed (5 languages × small dicts)
 *    - Single-request UX beats flashing "translating…" on tab switch
 *    - `i18next-http-backend` would add a dep + a network fetch per
 *      locale change. Not worth it at this size.
 *
 *  When the user flips Settings → General → Language, the
 *  `SettingsGeneralTab` calls `i18n.changeLanguage(code)` which triggers
 *  a re-render of every `useTranslation()` consumer. `prefsStore`
 *  persists the choice; on next app load, `detectInitialLanguage()`
 *  reads it back and we init i18next to that value.
 *
 *  Namespace split:
 *    - `common`   → strings used across many pages (buttons, toasts, labels)
 *    - `sidebar`  → sidebar nav labels
 *    - `settings` → every Settings tab + its sections
 *    - `pages`    → per-page titles + short subtitles
 *
 *  Missing-key policy: `fallbackLng: 'en'` + `returnNull: false` so a
 *  missing translation falls back to the English string. Never shows
 *  bare keys to the user.
 */

import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import common_en from '@/i18n/en/common.json';
import common_es from '@/i18n/es/common.json';
import common_fr from '@/i18n/fr/common.json';
import common_de from '@/i18n/de/common.json';
import common_pt from '@/i18n/pt/common.json';

import sidebar_en from '@/i18n/en/sidebar.json';
import sidebar_es from '@/i18n/es/sidebar.json';
import sidebar_fr from '@/i18n/fr/sidebar.json';
import sidebar_de from '@/i18n/de/sidebar.json';
import sidebar_pt from '@/i18n/pt/sidebar.json';

import settings_en from '@/i18n/en/settings.json';
import settings_es from '@/i18n/es/settings.json';
import settings_fr from '@/i18n/fr/settings.json';
import settings_de from '@/i18n/de/settings.json';
import settings_pt from '@/i18n/pt/settings.json';

import pages_en from '@/i18n/en/pages.json';
import pages_es from '@/i18n/es/pages.json';
import pages_fr from '@/i18n/fr/pages.json';
import pages_de from '@/i18n/de/pages.json';
import pages_pt from '@/i18n/pt/pages.json';

// Read the saved language from prefsStore's localStorage key so we
// don't depend on the store being initialised yet (avoid circular
// imports). If absent, `LanguageDetector` kicks in.
function savedLanguage(): string | undefined {
  try {
    const raw = localStorage.getItem('rd:prefs');
    if (!raw) return undefined;
    const p = JSON.parse(raw);
    if (typeof p.language === 'string') return p.language;
  } catch {
    /* ignore */
  }
  return undefined;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: common_en, sidebar: sidebar_en, settings: settings_en, pages: pages_en },
      es: { common: common_es, sidebar: sidebar_es, settings: settings_es, pages: pages_es },
      fr: { common: common_fr, sidebar: sidebar_fr, settings: settings_fr, pages: pages_fr },
      de: { common: common_de, sidebar: sidebar_de, settings: settings_de, pages: pages_de },
      pt: { common: common_pt, sidebar: sidebar_pt, settings: settings_pt, pages: pages_pt },
    },
    lng: savedLanguage(),
    fallbackLng: 'en',
    supportedLngs: ['es', 'en', 'fr', 'de', 'pt'],
    defaultNS: 'common',
    ns: ['common', 'sidebar', 'settings', 'pages'],
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'rd:i18n-lng',
      caches: [], // prefsStore owns the canonical persistence
    },
  });

export default i18n;
