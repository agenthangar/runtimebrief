import { defaults as defaultStore, type KeyValueStore } from "../lib/storage";
import { reviveProjectSummaries } from "../models/decoders";
import type { ProjectSummary } from "../models/types";
import { RuntimeBriefDataSourceFactory, RuntimeBriefModeStore, type RuntimeBriefDataSource } from "./dataSource";
import { DemoData } from "../demo/demoData";
import { RuntimeBriefError } from "./errors";

interface PersistedSnapshot {
  projects: unknown;
  fetchedAt: string;
}

export interface BriefSnapshot {
  projects: ProjectSummary[];
  fetchedAt: Date | null;
  isSaved: boolean;
  isDemo: boolean;
}

export class CancellationError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancellationError";
  }
}

/** Cached project list shared by the portfolio and detail screens. */
export class ProjectsStore {
  static shared = new ProjectsStore();

  // Preserve the project cache when an existing Backbrief install updates.
  private static readonly snapshotKey = "backbrief.projects.snapshot.v1";
  private cached: ProjectSummary[] = [];
  private fetchedAt: Date | null = null;
  private readonly ttlMs = 60_000;
  private revision = 0;

  constructor(
    private readonly store: KeyValueStore = defaultStore,
    private readonly isDemo: () => boolean = () => RuntimeBriefModeStore.isDemoEnabled,
  ) {
    const raw = store.get(ProjectsStore.snapshotKey);
    if (raw) {
      try {
        const snapshot = JSON.parse(raw) as PersistedSnapshot;
        this.cached = reviveProjectSummaries(snapshot.projects);
        const fetched = new Date(snapshot.fetchedAt);
        this.fetchedAt = Number.isNaN(fetched.getTime()) ? null : fetched;
      } catch {
        this.cached = [];
        this.fetchedAt = null;
      }
    }
  }

  static resetForTesting(store: KeyValueStore = defaultStore): void {
    store.remove(ProjectsStore.snapshotKey);
    ProjectsStore.shared = new ProjectsStore(store);
  }

  /** Quick reads use deterministic briefs and never start an analyst. */
  async briefSnapshot(dataSource?: RuntimeBriefDataSource): Promise<BriefSnapshot> {
    if (this.isDemo()) {
      const source = dataSource ?? RuntimeBriefDataSourceFactory.make(true);
      return { projects: await source.projects(), fetchedAt: null, isSaved: false, isDemo: true };
    }
    try {
      const projects = await this.refresh(dataSource ?? RuntimeBriefDataSourceFactory.make(false, 5));
      return { projects, fetchedAt: this.fetchedAt, isSaved: false, isDemo: false };
    } catch (error) {
      // Configuration/auth failures must not reveal a previous connection's data.
      if (!RuntimeBriefError.is(error, "network") && !RuntimeBriefError.is(error, "timeout")) throw error;
      if (this.cached.length === 0) throw error;
      return { projects: this.cached, fetchedAt: this.fetchedAt, isSaved: true, isDemo: false };
    }
  }

  async projects(dataSource?: RuntimeBriefDataSource): Promise<ProjectSummary[]> {
    if (this.isDemo()) {
      return (dataSource ?? RuntimeBriefDataSourceFactory.make(true)).projects();
    }
    if (this.fetchedAt && Date.now() - this.fetchedAt.getTime() < this.ttlMs && this.cached.length > 0) {
      return this.cached;
    }
    try {
      return await this.refresh(dataSource ?? RuntimeBriefDataSourceFactory.make(false, 5));
    } catch (error) {
      if (!RuntimeBriefError.is(error, "network") && !RuntimeBriefError.is(error, "timeout")) throw error;
      if (this.cached.length > 0) return this.cached;
      throw error;
    }
  }

  async refresh(dataSource?: RuntimeBriefDataSource): Promise<ProjectSummary[]> {
    const isDemo = this.isDemo();
    const startingRevision = this.revision;
    const fresh = await (dataSource ?? RuntimeBriefDataSourceFactory.make(isDemo)).projects();
    if (startingRevision !== this.revision || isDemo !== this.isDemo()) throw new CancellationError();
    if (isDemo) return fresh;
    this.cached = fresh;
    this.fetchedAt = new Date();
    this.persist();
    return fresh;
  }

  cachedSnapshot(): { projects: ProjectSummary[]; fetchedAt: Date | null } {
    if (this.isDemo()) return { projects: DemoData.projects, fetchedAt: null };
    return { projects: this.cached, fetchedAt: this.fetchedAt };
  }

  invalidate(): void {
    this.revision += 1;
    this.fetchedAt = null;
  }

  clear(): void {
    this.revision += 1;
    this.cached = [];
    this.fetchedAt = null;
    this.store.remove(ProjectsStore.snapshotKey);
  }

  private persist(): void {
    if (!this.fetchedAt) return;
    const snapshot: PersistedSnapshot = { projects: this.cached, fetchedAt: this.fetchedAt.toISOString() };
    this.store.set(ProjectsStore.snapshotKey, JSON.stringify(snapshot));
  }
}
