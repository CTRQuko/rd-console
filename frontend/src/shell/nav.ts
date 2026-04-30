// Sidebar/breadcrumb catalogue. Single source of truth for the
// "Operación" + "Sistema" groups; other modules import NAV / findActive
// / makeCrumbs to keep the topbar breadcrumbs in sync with the sidebar.

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  path: string;
  badge?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    group: "Operación",
    items: [
      { id: "dashboard",   label: "Panel",        icon: "dashboard",   path: "/dashboard" },
      { id: "devices",     label: "Dispositivos", icon: "devices",     path: "/devices" },
      { id: "users",       label: "Usuarios",     icon: "users",       path: "/users" },
      { id: "addressbook", label: "Agenda",       icon: "addressbook", path: "/addressbook" },
      { id: "tokens",      label: "Invitaciones", icon: "tokens",      path: "/tokens" },
      { id: "logs",        label: "Auditoría",    icon: "logs",        path: "/logs" },
    ],
  },
  {
    group: "Sistema",
    items: [
      { id: "settings", label: "Ajustes", icon: "settings", path: "/settings/general" },
    ],
  },
];

export function findActive(route: string): NavItem & { group: string } {
  const flat = NAV.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })));
  const sorted = [...flat].sort((a, b) => b.path.length - a.path.length);
  return (
    sorted.find((it) => route === it.path || route.startsWith(it.path + "/")) || flat[0]
  );
}

const TITLES: Record<string, string> = {
  dashboard: "Panel",
  devices: "Dispositivos",
  users: "Usuarios",
  addressbook: "Agenda",
  tokens: "Invitaciones",
  logs: "Auditoría",
  settings: "Ajustes",
  general: "General",
  servidor: "Servidor",
  seguridad: "Seguridad",
  usuarios: "Usuarios",
  updates: "Actualizaciones",
  login: "Iniciar sesión",
};

export function makeCrumbs(route: string): string[] {
  const segs = route.replace(/^\//, "").split("/").filter(Boolean);
  return segs.map((s) => TITLES[s] || s.charAt(0).toUpperCase() + s.slice(1));
}
