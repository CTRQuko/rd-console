// Minimal client-side auth helpers. The token is stored at login time
// (pages/Login.tsx) under localStorage("cm-auth") as {token, savedAt}.
//
// Pure helpers — no React. Used both by the shell auth gate and by
// fetcher modules that attach the JWT to outbound requests.

export interface AuthEnvelope {
  token: string;
  savedAt: number;
}

export function readAuthToken(): string | null {
  try {
    const raw = localStorage.getItem("cm-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthEnvelope>;
    return parsed?.token ?? null;
  } catch {
    return null;
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem("cm-auth");
  } catch {
    // Storage disabled (private mode, quota exceeded). Nothing to do.
  }
}
