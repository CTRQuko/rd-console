/** Settings → Appearance tab.
 *
 *  Surfaces the six knobs covered by `prefsStore`:
 *    - theme (light/dark) — owned by themeStore, toggled here too
 *    - accent (6 presets)
 *    - density (compact/normal/comfortable)
 *    - radius (0 / 6 / 12)
 *    - font scale (0.85 – 1.20)
 *    - sidebar style (always-dark / follow-theme)
 *
 *  All mutations are client-side (localStorage + DOM data-attributes).
 *  Saved on change — there's no "Save" button because every control
 *  is a direct preference, not a pending edit, and the live preview
 *  gives the confirmation signal.
 */

import { Monitor, Users } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { StatCard } from '@/components/StatCard';
import {
  ACCENT_SWATCHES,
  usePrefs,
  type Density,
  type RadiusPreset,
  type SidebarStyle,
} from '@/store/prefsStore';
import { useTheme, type Theme } from '@/store/themeStore';

export function SettingsAppearanceTab() {
  const [prefs, setPrefs, reset] = usePrefs();
  const [theme, setTheme] = useTheme();

  return (
    <>
      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Theme</h2>
        <p className="rd-settings-section__sub">
          Switch between light and dark. The saved value follows this browser
          — your server's other admins have their own preference.
        </p>
        <div className="rd-settings-section__body">
          <SegmentedControl<Theme>
            value={theme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={setTheme}
            ariaLabel="Theme"
          />
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Accent colour</h2>
        <p className="rd-settings-section__sub">
          Applied to primary buttons, links, and focus rings across the app.
        </p>
        <div
          className="rd-settings-section__body"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}
          role="radiogroup"
          aria-label="Accent colour"
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
        <h2 className="rd-settings-section__title">Density</h2>
        <p className="rd-settings-section__sub">
          Controls row height and spacing. Useful if you run the panel on a
          laptop screen (Compact) or a tablet/touch device (Comfortable).
        </p>
        <div className="rd-settings-section__body">
          <SegmentedControl<Density>
            value={prefs.density}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'normal', label: 'Normal' },
              { value: 'comfortable', label: 'Comfortable' },
            ]}
            onChange={(v) => setPrefs({ density: v })}
            ariaLabel="Density"
          />
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Corner radius</h2>
        <p className="rd-settings-section__sub">
          Sharper corners (0) feel more "admin-tool"; rounded (12) feels
          closer to consumer apps. Pick what doesn&apos;t fight your eye.
        </p>
        <div className="rd-settings-section__body">
          <SegmentedControl<RadiusPreset>
            value={prefs.radius}
            options={[
              { value: '0', label: 'Square' },
              { value: '6', label: 'Soft (6px)' },
              { value: '12', label: 'Round (12px)' },
            ]}
            onChange={(v) => setPrefs({ radius: v })}
            ariaLabel="Corner radius"
          />
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Font size</h2>
        <p className="rd-settings-section__sub">
          Scale the entire UI. 100% is the default.
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
              aria-label="Font size"
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
              Reset
            </Button>
          </div>
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Sidebar</h2>
        <p className="rd-settings-section__sub">
          The sidebar is dark by default for contrast. Choose to let it
          follow the theme instead.
        </p>
        <div className="rd-settings-section__body">
          <SegmentedControl<SidebarStyle>
            value={prefs.sidebarStyle}
            options={[
              { value: 'always-dark', label: 'Always dark' },
              { value: 'follow-theme', label: 'Follow theme' },
            ]}
            onChange={(v) => setPrefs({ sidebarStyle: v })}
            ariaLabel="Sidebar style"
          />
        </div>
      </section>

      <section className="rd-settings-section">
        <h2 className="rd-settings-section__title">Preview</h2>
        <p className="rd-settings-section__sub">
          Reacts in real time as you change the settings above.
        </p>
        <div className="rd-settings-section__body" style={{ gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Badge variant="active" dot>Active</Badge>
            <Badge variant="info">Info</Badge>
            <Badge variant="warn">Warning</Badge>
            <Badge variant="disabled">Disabled</Badge>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            <StatCard icon={Monitor} iconTone="blue" label="Online devices" value="12" />
            <StatCard icon={Users} iconTone="violet" label="Sessions today" value="48" />
          </div>
        </div>
        <div className="rd-settings-section__foot">
          <Button variant="secondary" onClick={reset}>
            Reset to defaults
          </Button>
        </div>
      </section>
    </>
  );
}

/** Three-way-ish segmented control. Kept local — only appearance uses it.
 *  If another page picks this up, promote to `components/SegmentedControl`. */
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
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
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
              background: active ? 'hsl(var(--primary))' : 'transparent',
              color: active ? 'hsl(var(--primary-foreground))' : 'var(--fg-muted)',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 'calc(var(--radius) - 2px)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 120ms, color 120ms',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
