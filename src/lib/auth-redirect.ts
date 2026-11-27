/**
 * Validates a post-login redirect path so it can only target safe same-origin routes.
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }
  if (trimmed === "/login" || trimmed.startsWith("/login?") || trimmed.startsWith("/auth/")) {
    return "/";
  }
  return trimmed;
}
