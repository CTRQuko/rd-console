/** Settings → General tab.
 *
 *  Four user-level preferences organised as collapsible sections:
 *    - Default landing page    (where login takes you)
 *    - Language                (persisted pref; real i18n lands in v8)
 *    - Date/time format        (system / iso / eu / us / relative)
 *    - Timezone                (browser / UTC / curated IANA list)
 *
 *  Each control persists immediately via prefsStore — no Save button,
 *  consistent with Appearance. The Collapsible sections default to open
 *  so the admin sees everything on first visit; collapsing sticks as
 *  native <details> remembers its state within the page lifetime.
 */

import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/Collapsible';
import { Select } from '@/components/Select';
import { fmtDateTime } from '@/lib/formatters';
import i18n from '@/lib/i18n';
import {
  DATE_TIME_FORMAT_CHOICES,
  LANDING_PAGE_CHOICES,
  LANGUAGE_CHOICES,
  TIMEZONE_CHOICES,
  usePrefs,
  type DateTimeFormat,
  type LandingPage,
  type Language,
  type Timezone,
} from '@/store/prefsStore';

const NOW_ISO = new Date().toISOString();

export function SettingsGeneralTab() {
  const { t } = useTranslation('settings');
  const [prefs, setPrefs] = usePrefs();

  // Keep i18next in sync with the Language preference. Switching via the
  // Select below immediately repaints the UI; the pref persistence (in
  // prefsStore's useEffect) handles the round-trip across reloads.
  const onLanguageChange = (next: Language) => {
    setPrefs({ language: next });
    i18n.changeLanguage(next);
  };

  // Labels used as the current-value hint on the collapsed header.
  const landingLabel = LANDING_PAGE_CHOICES.find((c) => c.value === prefs.landingPage)?.label ?? prefs.landingPage;
  const languageLabel = LANGUAGE_CHOICES.find((c) => c.value === prefs.language)?.label ?? prefs.language;
  const formatLabel = DATE_TIME_FORMAT_CHOICES.find((c) => c.value === prefs.dateTimeFormat)?.label ?? prefs.dateTimeFormat;
  const tzLabel = TIMEZONE_CHOICES.find((c) => c.value === prefs.timezone)?.label ?? prefs.timezone;

  // Live preview of the current time using the selected format + timezone.
  // Updates on every re-render (which happens on each control change) so
  // the admin sees the effect before committing mentally.
  const livePreview = fmtDateTime(NOW_ISO, {
    format: prefs.dateTimeFormat,
    timezone: prefs.timezone,
  });

  return (
    <>
      <Collapsible
        title={t('general.landing.title')}
        summary={landingLabel}
      >
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.929rem', marginTop: 0 }}>
          {t('general.landing.description')}
        </p>
        <Select
          value={prefs.landingPage}
          onChange={(e) => setPrefs({ landingPage: e.target.value as LandingPage })}
          aria-label={t('general.landing.title')}
          style={{ maxWidth: 320 }}
        >
          {LANDING_PAGE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Collapsible>

      <Collapsible title={t('general.language.title')} summary={languageLabel}>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.929rem', marginTop: 0 }}>
          {t('general.language.description')}
        </p>
        <Select
          value={prefs.language}
          onChange={(e) => onLanguageChange(e.target.value as Language)}
          aria-label={t('general.language.title')}
          style={{ maxWidth: 320 }}
        >
          {LANGUAGE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Collapsible>

      <Collapsible
        title={t('general.dateTime.title')}
        summary={`${formatLabel} · ${tzLabel}`}
      >
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.929rem', marginTop: 0 }}>
          {t('general.dateTime.description')}
        </p>

        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
          <div>
            <label
              className="rd-form__label"
              htmlFor="dt-format"
              style={{ display: 'block', marginBottom: 6 }}
            >
              {t('general.dateTime.format')}
            </label>
            <Select
              id="dt-format"
              value={prefs.dateTimeFormat}
              onChange={(e) =>
                setPrefs({ dateTimeFormat: e.target.value as DateTimeFormat })
              }
              aria-label="Date/time format"
            >
              {DATE_TIME_FORMAT_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label} — {c.example}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label
              className="rd-form__label"
              htmlFor="dt-tz"
              style={{ display: 'block', marginBottom: 6 }}
            >
              {t('general.dateTime.timezone')}
            </label>
            <Select
              id="dt-tz"
              value={prefs.timezone}
              onChange={(e) => setPrefs({ timezone: e.target.value as Timezone })}
              aria-label="Timezone"
            >
              {TIMEZONE_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: '0.857rem',
            color: 'var(--fg-muted)',
          }}
        >
          {t('general.dateTime.livePreview')}: <span className="rd-mono">{livePreview}</span>
        </div>
      </Collapsible>
    </>
  );
}
