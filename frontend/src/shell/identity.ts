// Topbar identity helpers — kept separate so any page that wants to
// render "AD admin Administrador" reuses the same logic.

export interface MeUser {
  id: number;
  username: string;
  email?: string | null;
  role: string;
}

export const ROLE_LABEL_ES: Record<string, string> = {
  admin: "Administrador",
  user: "Usuario",
};

// First letters of the displayable name (or email local part).
// "Alex Méndez" → "AM", "admin" → "AD". Always uppercase, max 2 chars.
export function meInitials(me: MeUser | null | undefined): string {
  const src = me?.email?.split("@")[0] || me?.username || "";
  const parts = String(src).replace(/[^A-Za-zÀ-ÿ0-9]+/g, " ").trim().split(/\s+/);
  const a = parts[0]?.[0] || "?";
  const b = parts[1]?.[0] || parts[0]?.[1] || "";
  return (a + b).toUpperCase().slice(0, 2) || "?";
}
