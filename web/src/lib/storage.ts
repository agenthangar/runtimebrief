/**
 * Thin wrapper over `localStorage` with an in-memory fallback for private
 * browsing modes that throw on access. Mirrors the role `UserDefaults` plays
 * on iOS; see `ServerSettings` for the token's storage caveat.
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  get(key: string) {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string) {
    this.map.set(key, value);
  }
  remove(key: string) {
    this.map.delete(key);
  }
  keys() {
    return [...this.map.keys()];
  }
}

class BrowserStore implements KeyValueStore {
  constructor(private readonly storage: Storage) {}
  get(key: string) {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string) {
    try {
      this.storage.setItem(key, value);
    } catch {
      /* quota or privacy mode: keep the in-memory state only */
    }
  }
  remove(key: string) {
    try {
      this.storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  keys() {
    try {
      const result: string[] = [];
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (key !== null) result.push(key);
      }
      return result;
    } catch {
      return [];
    }
  }
}

function detect(): KeyValueStore {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const probe = "runtimebrief.storage.probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return new BrowserStore(window.localStorage);
    }
  } catch {
    /* fall through */
  }
  return new MemoryStore();
}

export const defaults: KeyValueStore = detect();

export function makeMemoryStore(): KeyValueStore {
  return new MemoryStore();
}
