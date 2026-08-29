const LIVE_API_BASE_URL = "https://dastak-rider.replit.app";

function normalizeApiBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

/**
 * The native app must never use EXPO_PUBLIC_DOMAIN as its API host.
 *
 * Replit uses that variable for the temporary Expo bundle host, which can be a
 * *.replit.dev workspace URL that disappears when the workspace closes.
 * Standalone builds use the explicit API URL and fall back to the permanent
 * published API if the build environment did not inject one.
 */
export const API_BASE_URL =
  normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_URL) ??
  LIVE_API_BASE_URL;

export const API_WEBSOCKET_URL = `${API_BASE_URL.replace(
  /^http/i,
  "ws",
)}/api/ws/live`;