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

import { Collapsible } from '@/components/Collapsible';
import { Select } from '@/components/Select';
import { fmtDateTime } from '@/lib/formatters';
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
  const [prefs, setPrefs] = usePrefs();

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
        title="Default landing page"
        summary={landingLabel}
      >
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.929rem', marginTop: 0 }}>
          Where the app takes you after you sign in. Changes apply on your
          next login.
        </p>
        <Select
          value={prefs.landingPage}
          onChange={(e) => setPrefs({ landingPage: e.target.value as LandingPage })}
          aria-label="Default landing page"
          style={{ maxWidth: 320 }}
        >
          {LANDING_PAGE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Collapsible>

      <Collapsible title="Language" summary={languageLabel}>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.929rem', marginTop: 0 }}>
          UI language preference. Translations apply in v8 — for now this
          only persists your choice.
        </p>
        <Select
          value={prefs.language}
          onChange={(e) => setPrefs({ language: e.target.value as Language })}
          aria-label="Language"
          style={{ maxWidth: 320 }}
        >
          {LANGUAGE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Collapsible>

      <Collapsible title="Date / time format" summary={formatLabel}>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.929rem', marginTop: 0 }}>
          How timestamps render across the panel — logs, devices, tokens.
          &quot;Sync with system&quot; follows your browser&apos;s locale.
        </p>
        <Select
          value={prefs.dateTimeFormat}
          onChange={(e) =>
            setPrefs({ dateTimeFormat: e.target.value as DateTimeFormat })
          }
          aria-label="Date/time format"
          style={{ maxWidth: 360 }}
        >
          {DATE_TIME_FORMAT_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} — {c.example}
            </option>
          ))}
        </Select>
        <div
          style={{
            marginTop: 12,
            fontSize: '0.857rem',
            color: 'var(--fg-muted)',
          }}
        >
          Live preview: <span className="rd-mono">{livePreview}</span>
        </div>
      </Collapsible>

      <Collapsible title="Timezone" summary={tzLabel}>
        <p style={{ color: 'var(--fg-muted)', fontSize: '0.929rem', marginTop: 0 }}>
          Timestamps are stored in UTC on the server; the UI converts to
          this timezone for display. &quot;Browser default&quot; follows
          your system.
        </p>
        <Select
          value={prefs.timezone}
          onChange={(e) => setPrefs({ timezone: e.target.value as Timezone })}
          aria-label="Timezone"
          style={{ maxWidth: 360 }}
        >
          {TIMEZONE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Collapsible>
    </>
  );
}
