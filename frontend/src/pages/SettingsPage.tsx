/** Settings — tabbed shell.
 *
 *  7 tabs: Server · Users · API tokens · Appearance · Language · Security
 *  · Advanced. The Users and API tokens tabs moved here in v6 P6-B —
 *  they used to have their own sidebar entries (/users, /account) but
 *  conceptually they are configuration surfaces, not day-to-day
 *  destinations. Old routes redirect to the matching tab.
 *
 *  The active tab is synced to `?tab=` so deep-links from docs or
 *  bookmarks land on the right pane. Invalid / missing values fall back
 *  to Server.
 */

import { Navigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Tabs } from '@/components/Tabs';
import { SettingsAppearanceTab } from './settings/SettingsAppearanceTab';
import { SettingsApiTokensTab } from './settings/SettingsApiTokensTab';
import { SettingsGeneralTab } from './settings/SettingsGeneralTab';
import { SettingsServerTab } from './settings/SettingsServerTab';
import { SettingsSecurityTab } from './settings/SettingsSecurityTab';
import { SettingsAdvancedTab } from './settings/SettingsAdvancedTab';
import { SettingsUsersTab } from './settings/SettingsUsersTab';

// v7: Language was removed as a standalone tab — its selector moved
// inside the new "General" tab. Bookmarks to `?tab=language` are
// redirected to `?tab=general` via isValidTab's fallback.
const VALID_TABS = [
  'server',
  'users',
  'api-tokens',
  'general',
  'appearance',
  'security',
  'advanced',
] as const;
type TabValue = (typeof VALID_TABS)[number];

function isValidTab(v: string | null): v is TabValue {
  return !!v && (VALID_TABS as readonly string[]).includes(v);
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  // Legacy `?tab=language` bookmarks end up on General, where the
  // selector now lives.
  const normalised = raw === 'language' ? 'general' : raw;
  const active: TabValue = isValidTab(normalised) ? normalised : 'server';

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
          <Tabs.Trigger value="users">Users</Tabs.Trigger>
          <Tabs.Trigger value="api-tokens">API tokens</Tabs.Trigger>
          <Tabs.Trigger value="general">General</Tabs.Trigger>
          <Tabs.Trigger value="appearance">Appearance</Tabs.Trigger>
          <Tabs.Trigger value="security">Security</Tabs.Trigger>
          <Tabs.Trigger value="advanced">Advanced</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Panel value="server">
          <SettingsServerTab />
        </Tabs.Panel>

        <Tabs.Panel value="users">
          <SettingsUsersTab />
        </Tabs.Panel>

        <Tabs.Panel value="api-tokens">
          <SettingsApiTokensTab />
        </Tabs.Panel>

        <Tabs.Panel value="general">
          <SettingsGeneralTab />
        </Tabs.Panel>

        <Tabs.Panel value="appearance">
          <SettingsAppearanceTab />
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

/** Shim for the legacy /users and /account routes. Redirects to the
 *  matching Settings tab. Keeps bookmarks and old emails working. */
export function RedirectToSettingsTab({ tab }: { tab: TabValue }) {
  return <Navigate to={`/settings?tab=${tab}`} replace />;
}
