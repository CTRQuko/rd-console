/** Settings → Appearance tab (slim edition).
 *
 *  Three knobs — sidebar style removed in P6-A per operator request:
 *  the sidebar + topbar chrome is now always dark regardless of theme,
 *  light mode only affects the content area.
 *
 *    - theme (light/dark) — affects content only
 *    - accent colour (6 presets) — also lights the active sidebar item
 *    - font scale (0.85 – 1.20)
 *
 *  Mutations are client-side (localStorage + DOM data-attributes). No
 *  "Save" button — each control is a direct preference with a live
 *  preview as the confirmation signal.
 */

import { useTranslation } from 'react-i18next';
import { Monitor, Users } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { StatCard } from '@/components/StatCard';
import { ACCENT_SWATCHES, usePrefs } from '@/store/prefsStore';
import { useTheme, type Theme } from '@/store/themeStore';

export function SettingsAppearanceTab() {
  const { t } = useTranslation('settings');
  const [prefs, setPrefs, reset] = usePrefs();
  const [theme, setTheme] = useTheme();

  return (
    <>
      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">{t('appearance.theme')}</h2>
        <p className="rd-settings-section__sub">
          {t('appearance.themeDescription')}
        </p>
        <div className="rd-settings-section__body">
          <SegmentedControl<Theme>
            value={theme}
            options={[
              { value: 'light', label: t('appearance.themeLight') },
              { value: 'dark', label: t('appearance.themeDark') },
            ]}
            onChange={setTheme}
            ariaLabel={t('appearance.theme')}
          />
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">{t('appearance.accent')}</h2>
        <p className="rd-settings-section__sub">
          {t('appearance.accentDescription')}
        </p>
        <div
          className="rd-settings-section__body"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}
          role="radiogroup"
          aria-label={t('appearance.accent')}
        >
          {ACCENT_SWATCHES.map((sw) => {
            const active = prefs.accent === sw.value;
            return (
              <button
                key={sw.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={sw.label}
                onClick={() => setPrefs({ accent: sw.value })}
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: sw.hex,
                  border: active
                    ? '3px solid var(--fg)'
                    : '1px solid var(--border)',
                  cursor: 'pointer',
                  outline: 'none',
                  transition: 'transform 120ms',
                  transform: active ? 'scale(1.06)' : 'scale(1)',
                }}
              />
            );
          })}
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">{t('appearance.fontSize')}</h2>
        <p className="rd-settings-section__sub">
          {t('appearance.fontSizeDescription')}
        </p>
        <div className="rd-settings-section__body">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input
              type="range"
              min="85"
              max="120"
              step="5"
              value={Math.round(prefs.fontScale * 100)}
              onChange={(e) =>
                setPrefs({ fontScale: Number(e.target.value) / 100 })
              }
              aria-label={t('appearance.fontSize')}
              style={{ flex: 1, maxWidth: 280 }}
            />
            <span className="rd-mono" style={{ minWidth: 56, textAlign: 'right' }}>
              {Math.round(prefs.fontScale * 100)}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPrefs({ fontScale: 1 })}
              disabled={prefs.fontScale === 1}
            >
              {t('common:actions.reset')}
            </Button>
          </div>
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">{t('appearance.preview')}</h2>
        <p className="rd-settings-section__sub">
          {t('appearance.previewDescription')}
        </p>
        <div className="rd-settings-section__body" style={{ gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Badge variant="active" dot>{t('common:states.active')}</Badge>
            <Badge variant="info">Info</Badge>
            <Badge variant="warn">Warning</Badge>
            <Badge variant="disabled">{t('common:states.disabled')}</Badge>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            <StatCard
              icon={Monitor}
              iconTone="blue"
              label={t('appearance.previewStatOnline')}
              value="12"
            />
            <StatCard
              icon={Users}
              iconTone="violet"
              label={t('appearance.previewStatSessions')}
              value="48"
            />
          </div>
        </div>
        <div className="rd-settings-section__foot">
          <Button variant="secondary" onClick={reset}>
            {t('appearance.resetDefaults')}
          </Button>
        </div>
      </section>
    </>
  );
}

/** Three-way-ish segmented control. Kept local — only appearance uses it.
 *  Fix vs PR #30: inactive color was `var(--fg-muted)` which in light mode
 *  on a white card approaches invisible. Switched to `var(--fg)` with a
 *  reduced opacity so the label is readable in both themes, and the active
 *  state uses primary + plain white foreground (no shadcn HSL that was
 *  undefined in light). */
function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 2,
        gap: 2,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{
              background: active ? 'var(--primary)' : 'transparent',
              color: active ? '#ffffff' : 'var(--fg)',
              opacity: active ? 1 : 0.75,
              border: 'none',
              padding: '6px 14px',
              borderRadius: 'calc(var(--radius-md) - 2px)',
              fontSize: '0.929rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 120ms, color 120ms, opacity 120ms',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
