/** Settings → Appearance tab (slim edition).
 *
 *  Four knobs — deliberately reduced from the original six shipped in
 *  PR #30. Density and corner-radius were never actually wired (the
 *  flat `rd-*` components ignore their vars), so they're gone.
 *
 *    - theme (light/dark)
 *    - accent colour (6 presets)
 *    - font scale (0.85 – 1.20)
 *    - sidebar style (always-dark / follow-theme)
 *
 *  Mutations are client-side (localStorage + DOM data-attributes). No
 *  "Save" button — each control is a direct preference with a live
 *  preview as the confirmation signal.
 */

import { Monitor, Users } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { StatCard } from '@/components/StatCard';
import {
  ACCENT_SWATCHES,
  usePrefs,
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
