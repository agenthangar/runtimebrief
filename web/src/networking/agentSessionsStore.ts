import { defaults as defaultStore, type KeyValueStore } from "../lib/storage";
import {
  decodeClaudeLaunchList,
  type AgentCapability,
  type ClaudeLaunch,
  type ClaudeLaunchList,
} from "../models/claudeLaunch";
import type { ProjectSummary } from "../models/types";
import { RuntimeBriefDataSourceFactory, RuntimeBriefModeStore, type RuntimeBriefDataSource } from "./dataSource";
import { RuntimeBriefError } from "./errors";
import { ServerSettingsStore } from "./serverSettings";

const DISABLED_MESSAGE = "Starting tasks is disabled for this project.";

/**
 * Non-cryptographic 53-bit hash (cyrb53). The connection scope only needs a
 * stable, synchronous cache key; the token itself is already stored locally.
 */
export function cyrb53(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export interface AgentSessionsState {
  providers: AgentCapability[];
  lists: Record<string, ClaudeLaunchList>;
  savedProjects: Set<string>;
  errors: Record<string, string>;
}

export interface AgentSessionsStoreOptions {
  identity?: () => string;
  source?: (timeout: number) => RuntimeBriefDataSource;
  cache?: KeyValueStore | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Shared account health and project snapshots, scoped to the connected Mac and demo mode. */
export class AgentSessionsStore {
  static shared = new AgentSessionsStore();

  providers: AgentCapability[] = [];
  lists: Record<string, ClaudeLaunchList> = {};
  savedProjects = new Set<string>();
  errors: Record<string, string> = {};

  private readonly identityOverride: (() => string) | null;
  private readonly sourceFactory: (timeout: number) => RuntimeBriefDataSource;
  private readonly cache: KeyValueStore | null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private scope = "";
  private warmingScope: string | null = null;
  private pending = new Set<string>();
  private healthAt: number | null = null;
  private refreshedAt: Record<string, number> = {};
  private retryAfter: Record<string, number> = {};
  private readonly listeners = new Set<() => void>();
  private snapshot: AgentSessionsState | null = null;

  constructor(options: AgentSessionsStoreOptions = {}) {
    this.identityOverride = options.identity ?? null;
    this.sourceFactory = options.source ?? ((timeout) => RuntimeBriefDataSourceFactory.current(timeout));
    this.cache = options.cache === undefined ? defaultStore : options.cache;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  static resetForTesting(): void {
    AgentSessionsStore.shared = new AgentSessionsStore();
  }

  // MARK: Observation (useSyncExternalStore)

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AgentSessionsState => {
    this.snapshot ??= {
      providers: this.providers,
      lists: this.lists,
      savedProjects: this.savedProjects,
      errors: this.errors,
    };
    return this.snapshot;
  };

  private emit(): void {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }

  // MARK: Scope

  private cacheKey(): string | null {
    if (this.scope === "demo" || this.scope === "unconfigured") return null;
    return `runtimebrief.agent-sessions.${this.scope}`;
  }

  private synchronizeScope(): void {
    const settings = ServerSettingsStore.load();
    const identity =
      this.identityOverride?.() ??
      (RuntimeBriefModeStore.isDemoEnabled
        ? "demo"
        : ServerSettingsStore.isConfigured(settings)
          ? `${settings.baseURL}|${settings.token}`
          : "unconfigured");
    const current = identity === "demo" || identity === "unconfigured" ? identity : cyrb53(identity);
    if (current === this.scope) return;
    this.scope = current;
    this.providers = [];
    this.lists = {};
    this.errors = {};
    this.healthAt = null;
    this.pending = new Set();
    this.savedProjects = new Set();
    this.refreshedAt = {};
    this.retryAfter = {};
    const key = this.cacheKey();
    if (key && this.cache) {
      const raw = this.cache.get(key);
      if (raw) {
        try {
          const saved = JSON.parse(raw) as Record<string, unknown>;
          const lists: Record<string, ClaudeLaunchList> = {};
          for (const [projectID, value] of Object.entries(saved)) lists[projectID] = decodeClaudeLaunchList(value);
          this.lists = lists;
          this.savedProjects = new Set(Object.keys(lists));
        } catch {
          /* ignore an unreadable cache */
        }
      }
    }
    this.emit();
  }

  connectionScope(): string {
    this.synchronizeScope();
    return this.scope;
  }

  cached(projectID: string): ClaudeLaunchList | null {
    this.synchronizeScope();
    return this.lists[projectID] ?? null;
  }

  // MARK: Loading

  async warm(force = false): Promise<void> {
    this.synchronizeScope();
    const stale = this.healthAt === null || this.now() - this.healthAt > 60_000;
    if (this.warmingScope === this.scope || this.scope === "unconfigured" || !(force || stale)) return;
    const expected = this.scope;
    this.warmingScope = expected;
    try {
      const source = this.sourceFactory(6);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        let result;
        try {
          result = await source.agentProviders();
        } catch {
          return;
        }
        if (expected !== this.scope) return;
        this.providers = result.providers;
        this.emit();
        if (!this.providers.some((provider) => provider.checking === true)) {
          this.healthAt = this.now();
          return;
        }
        await this.sleep(1000);
      }
    } finally {
      if (this.warmingScope === expected) this.warmingScope = null;
    }
  }

  async refresh(projectID: string, background = false): Promise<void> {
    this.synchronizeScope();
    if (this.pending.has(projectID)) return;
    const retry = this.retryAfter[projectID];
    if (retry !== undefined && retry > this.now()) return;
    const refreshed = this.refreshedAt[projectID];
    if (background && refreshed !== undefined && this.now() - refreshed < 60_000) return;
    const expected = this.scope;
    this.pending.add(projectID);
    try {
      const result = await this.sourceFactory(6).sessions(projectID);
      if (expected !== this.scope) return;
      this.lists = { ...this.lists, [projectID]: result };
      this.savedProjects = new Set([...this.savedProjects].filter((id) => id !== projectID));
      const { [projectID]: _removed, ...errors } = this.errors;
      this.errors = errors;
      this.refreshedAt[projectID] = this.now();
      delete this.retryAfter[projectID];
      if (result.providers && !result.providers.some((provider) => provider.message === DISABLED_MESSAGE)) {
        this.providers = result.providers;
      }
      this.persist();
      this.emit();
    } catch (error) {
      if (expected !== this.scope) return;
      this.errors = { ...this.errors, [projectID]: error instanceof Error ? error.message : String(error) };
      if (RuntimeBriefError.is(error, "rateLimited")) this.retryAfter[projectID] = this.now() + 60_000;
      this.emit();
    } finally {
      if (expected === this.scope) this.pending.delete(projectID);
    }
  }

  async prefetch(projects: ProjectSummary[]): Promise<void> {
    this.synchronizeScope();
    const expected = this.scope;
    // Bound background requests so a large portfolio cannot flood the Mac.
    for (let offset = 0; offset < projects.length; offset += 4) {
      if (expected !== this.scope) return;
      const batch = projects.slice(offset, Math.min(offset + 4, projects.length));
      await Promise.all(batch.map((project) => this.refresh(project.id, true)));
    }
  }

  remember(launch: ClaudeLaunch, expectedScope: string): void {
    this.synchronizeScope();
    if (expectedScope !== this.scope) return;
    const existing = this.lists[launch.projectId];
    const capability = existing?.capability ?? { available: true, message: "Ready" };
    this.lists = {
      ...this.lists,
      [launch.projectId]: {
        capability,
        launches: [launch, ...(existing?.launches.filter((entry) => entry.id !== launch.id) ?? [])],
        providers: this.providers,
      },
    };
    this.emit();
  }

  private persist(): void {
    const key = this.cacheKey();
    if (!key || !this.cache) return;
    this.cache.set(key, JSON.stringify(this.lists));
  }
}
