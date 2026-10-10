import { defaults as defaultStore, type KeyValueStore } from "../lib/storage";
import { RuntimeBriefError } from "./errors";

/**
 * Server URL and token for the daemon connection.
 *
 * Intentional platform difference: iOS keeps the token in the Keychain. A
 * browser has no Keychain, so the token lives in this origin's local storage
 * alongside the URL. Settings copy explains this to the user.
 */
export interface ServerSettings {
  baseURL: string | null;
  token: string | null;
}

// These persisted identifiers intentionally match the iOS keys so the two
// clients describe the same connection the same way.
export const TOKEN_ACCOUNT = "backbrief-daemon-token";
const URL_KEY = "backbrief.serverURL";

/** The origin that served this page, which is also where the daemon lives. */
export function pageOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const { protocol, origin } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return null;
  return origin;
}

export const ServerSettingsStore = {
  load(store: KeyValueStore = defaultStore): ServerSettings {
    const stored = store.get(URL_KEY);
    const token = store.get(TOKEN_ACCOUNT);
    return {
      // The daemon serves this app from its own origin, so that is the
      // default address until the user saves a different one.
      baseURL: stored ?? pageOrigin(),
      token,
    };
  },

  save(urlString: string, token: string, store: KeyValueStore = defaultStore): void {
    const url = normalizeURL(urlString.trim());
    if (!url) throw RuntimeBriefError.invalidServerURL();
    const trimmedToken = token.trim();
    if (trimmedToken.length === 0) {
      store.remove(TOKEN_ACCOUNT);
    } else {
      store.set(TOKEN_ACCOUNT, trimmedToken);
    }
    store.set(URL_KEY, url);
  },

  reset(store: KeyValueStore = defaultStore): void {
    store.remove(URL_KEY);
    store.remove(TOKEN_ACCOUNT);
  },

  isConfigured(settings: ServerSettings): boolean {
    return settings.baseURL !== null && !!settings.token && settings.token.length > 0;
  },

  /**
   * URL the user saved. Does not fall back to the page origin. iOS draft
   * identity uses the persisted address or "unconfigured".
   */
  persistedURL(store: KeyValueStore = defaultStore): string | null {
    return store.get(URL_KEY);
  },

  /** Same retry-identity scope as iOS ClaudeTaskComposer.submit(). */
  draftScope(isDemo: boolean, store: KeyValueStore = defaultStore): string {
    if (isDemo) return "demo";
    return store.get(URL_KEY) ?? "unconfigured";
  },

  normalizeURL,
};

/**
 * Bare Tailscale DNS names use Serve's HTTPS/443 endpoint. Other bare hosts
 * retain the local-development HTTP/8484 default. Output keeps the explicit
 * port so it reads the same as the iOS app's normalized address.
 */
export function normalizeURL(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const hasExplicitScheme = trimmed.includes("://");
  const withScheme = hasExplicitScheme ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  let scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  const host = parsed.hostname;
  if (!host) return null;
  if (!hasExplicitScheme && host.toLowerCase().replace(/^\.+|\.+$/g, "").endsWith(".ts.net")) {
    scheme = "https";
  }
  const port = parsed.port.length > 0 ? parsed.port : scheme === "https" ? "443" : "8484";
  return `${scheme}://${host}:${port}`;
}
