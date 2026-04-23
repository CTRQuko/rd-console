/** Settings — tabbed shell.
 *
 *  Reorganised from a vertical stack into 5 tabs: Server, Appearance,
 *  Language, Security, Advanced. Only Server / Security / Advanced are
 *  wired in this PR — Appearance and Language ship as placeholders and
 *  get wired in subsequent PRs (B2, B3).
 *
 *  The active tab is synced to `?tab=` so deep-links from docs or
 *  bookmarks land on the right pane. Invalid / missing values fall back
 *  to Server.
 */

import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Tabs } from '@/components/Tabs';
import { SettingsAppearanceTab } from './settings/SettingsAppearanceTab';
import { SettingsServerTab } from './settings/SettingsServerTab';
import { SettingsSecurityTab } from './settings/SettingsSecurityTab';
import { SettingsAdvancedTab } from './settings/SettingsAdvancedTab';

const VALID_TABS = ['server', 'appearance', 'language', 'security', 'advanced'] as const;
type TabValue = (typeof VALID_TABS)[number];

function isValidTab(v: string | null): v is TabValue {
  return !!v && (VALID_TABS as readonly string[]).includes(v);
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const active: TabValue = isValidTab(raw) ? raw : 'server';

  const setTab = (next: string) => {
    // `replace: true` — each tab switch is not a history entry; the Back
    // button should take you to wherever you came from, not between tabs.
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      n.set('tab', next);
      return n;
    }, { replace: true });
  };

  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={active} onChange={setTab}>
        <Tabs.List ariaLabel="Settings sections">
          <Tabs.Trigger value="server">Server</Tabs.Trigger>
          <Tabs.Trigger value="appearance">Appearance</Tabs.Trigger>
          <Tabs.Trigger value="language">Language</Tabs.Trigger>
          <Tabs.Trigger value="security">Security</Tabs.Trigger>
          <Tabs.Trigger value="advanced">Advanced</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Panel value="server">
          <SettingsServerTab />
        </Tabs.Panel>

        <Tabs.Panel value="appearance">
          <SettingsAppearanceTab />
        </Tabs.Panel>

        <Tabs.Panel value="language">
          <ComingSoon pr="B3" label="Language" />
        </Tabs.Panel>

        <Tabs.Panel value="security">
          <SettingsSecurityTab />
        </Tabs.Panel>

        <Tabs.Panel value="advanced">
          <SettingsAdvancedTab />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

/** Placeholder for tabs shipped in later v5 PRs. Marks intent without
 *  blocking the shell behind them — operators can bookmark `?tab=language`
 *  today and see it wired in tomorrow. */
function ComingSoon({ pr, label }: { pr: string; label: string }) {
  return (
    <section className="rd-settings-section">
      <h2 className="rd-settings-section__title">{label}</h2>
      <p className="rd-settings-section__sub">
        Coming in v5 {pr}.
      </p>
    </section>
  );
}
