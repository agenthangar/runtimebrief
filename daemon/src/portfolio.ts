import { FilesystemGitAdapter, type GitSummary } from "./adapters/filesystemGit.js";
import { buildProjectBrief } from "./brief.js";
import type { IosReleaseProvider, IosReleaseSummary } from "./iosRelease.js";
import type {
  EvidenceRef,
  ProjectBrief,
  ProjectConfig,
  RuntimeAdapter,
  TranscriptRef,
} from "./types.js";

const RECENT_SESSIONS_PER_SOURCE_LIMIT = 10;

export type ProjectProvider = () => ProjectConfig[];

export interface ProjectListEntry {
  id: string;
  name: string;
  lastActivityAt: string | null;
  branch: string | null;
  dirty: boolean | null;
  brief: ProjectBrief;
}

export interface ProjectSessionSummary {
  source: string;
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  state: string;
  stateReason: string;
  gitBranch: string | null;
  model: string | null;
  filesTouched: string[];
  toolUseCount: number;
  conclusion: string | null;
}

export interface ProjectCard extends ProjectListEntry {
  path: string;
  git: GitSummary | null;
  iosRelease: IosReleaseSummary | null;
  sessions: ProjectSessionSummary[];
}

export interface AttentionItem {
  id: string;
  projectId: string;
  projectName: string;
  summary: string;
  projectState: ProjectBrief["state"];
  lastActivityAt: string | null;
  evidence: EvidenceRef[];
}

export interface ProjectEvidence {
  projectId: string;
  projectName: string;
  observedAt: string;
  evidence: EvidenceRef[];
  unknownEvidenceIds: string[];
}

function lastActivityAt(git: GitSummary | null, sessions: TranscriptRef[]): string | null {
  const candidates: number[] = [];
  if (git?.lastCommitAt) candidates.push(Date.parse(git.lastCommitAt));
  for (const session of sessions) {
    const timestamp = session.endedAt ?? session.startedAt;
    if (timestamp) candidates.push(timestamp.getTime());
  }
  const max = Math.max(...candidates);
  return Number.isFinite(max) && candidates.length > 0 ? new Date(max).toISOString() : null;
}

function sessionSummary(session: TranscriptRef): ProjectSessionSummary {
  return {
    source: session.source,
    id: session.id,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    summary: session.summary ?? null,
    state: session.state ?? "unknown",
    stateReason: session.stateReason ?? "No lifecycle event was found.",
    gitBranch: session.gitBranch ?? null,
    model: session.model ?? null,
    filesTouched: session.filesTouched ?? [],
    toolUseCount: session.toolUseCount ?? 0,
    conclusion: session.conclusion ?? null,
  };
}

export class PortfolioService {
  constructor(
    private readonly projects: ProjectProvider,
    private readonly adapters: RuntimeAdapter[],
    private readonly now: () => Date = () => new Date(),
    private readonly iosReleases?: IosReleaseProvider,
  ) {}

  findProject(id: string): ProjectConfig | null {
    return this.projects().find((project) => project.id === id) ?? null;
  }

  private async gitSummary(project: ProjectConfig): Promise<GitSummary | null> {
    const adapter = this.adapters.find(
      (candidate): candidate is FilesystemGitAdapter => candidate instanceof FilesystemGitAdapter,
    );
    if (!adapter || !(await adapter.discover(project))) return null;
    return adapter.summary(project);
  }

  private async recentSessions(project: ProjectConfig): Promise<TranscriptRef[]> {
    const all = (
      await Promise.all(
        this.adapters.map(async (adapter): Promise<TranscriptRef[]> => {
          try {
            return adapter.transcriptPaths(project, RECENT_SESSIONS_PER_SOURCE_LIMIT);
          } catch {
            // A broken adapter must not take down the project card or portfolio.
            return [];
          }
        }),
      )
    ).flat();
    return all.sort(
      (a, b) =>
        ((b.endedAt ?? b.startedAt)?.getTime() ?? 0) -
        ((a.endedAt ?? a.startedAt)?.getTime() ?? 0),
    );
  }

  private async observe(project: ProjectConfig, observedAt: Date): Promise<{
    git: GitSummary | null;
    sessions: TranscriptRef[];
    entry: ProjectListEntry;
  }> {
    let git: GitSummary | null = null;
    let sessions: TranscriptRef[] = [];
    try {
      [git, sessions] = await Promise.all([
        this.gitSummary(project),
        this.recentSessions(project),
      ]);
    } catch {
      // A missing or unreadable project is still represented as unavailable.
    }
    return {
      git,
      sessions,
      entry: {
        id: project.id,
        name: project.name,
        lastActivityAt: lastActivityAt(git, sessions),
        branch: git?.branch ?? null,
        dirty: git?.dirty ?? null,
        brief: buildProjectBrief(project.name, git, sessions, observedAt),
      },
    };
  }

  async listProjects(): Promise<ProjectListEntry[]> {
    const observedAt = this.now();
    const projects = this.projects();
    const entries = await Promise.all(
      projects.map(async (project) => (await this.observe(project, observedAt)).entry),
    );
    return entries.sort((a, b) => {
      const aTime = a.lastActivityAt ? Date.parse(a.lastActivityAt) : Number.NEGATIVE_INFINITY;
      const bTime = b.lastActivityAt ? Date.parse(b.lastActivityAt) : Number.NEGATIVE_INFINITY;
      return bTime - aTime || a.name.localeCompare(b.name);
    });
  }

  async getProject(id: string): Promise<ProjectCard | null> {
    const project = this.findProject(id);
    if (!project) return null;
    const [{ git, sessions, entry }, iosRelease] = await Promise.all([
      this.observe(project, this.now()),
      this.iosReleases?.summary(project).catch(() => null) ?? Promise.resolve(null),
    ]);
    return {
      ...entry,
      path: project.path,
      git,
      iosRelease,
      sessions: sessions.map(sessionSummary),
    };
  }

  async listAttention(projectId?: string): Promise<AttentionItem[] | null> {
    const projects = this.projects();
    const selected = projectId
      ? projects.filter((project) => project.id === projectId)
      : projects;
    if (projectId && selected.length === 0) return null;
    const observedAt = this.now();
    const items = await Promise.all(
      selected.map(async (project) => {
        const sessions = await this.recentSessions(project);
        const brief = buildProjectBrief(project.name, null, sessions, observedAt);
        return brief.claims
          .filter((claim) => claim.category === "attention")
          .map((claim) => ({
            id: `${project.id}:${claim.id}`,
            projectId: project.id,
            projectName: project.name,
            summary: claim.text,
            projectState: brief.state,
            lastActivityAt: lastActivityAt(null, sessions),
            evidence: claim.evidence,
          }));
      }),
    );
    return items
      .flat()
      .sort((a, b) => {
        const aTime = a.lastActivityAt ? Date.parse(a.lastActivityAt) : Number.NEGATIVE_INFINITY;
        const bTime = b.lastActivityAt ? Date.parse(b.lastActivityAt) : Number.NEGATIVE_INFINITY;
        return bTime - aTime || a.projectName.localeCompare(b.projectName);
      });
  }

  async getProjectEvidence(
    projectId: string,
    evidenceIds?: string[],
  ): Promise<ProjectEvidence | null> {
    const card = await this.getProject(projectId);
    if (!card) return null;
    const byId = new Map<string, EvidenceRef>();
    for (const evidence of card.brief.headlineEvidence) byId.set(evidence.id, evidence);
    for (const claim of card.brief.claims) {
      for (const evidence of claim.evidence) byId.set(evidence.id, evidence);
    }
    const requested = evidenceIds ? [...new Set(evidenceIds)] : [...byId.keys()];
    return {
      projectId: card.id,
      projectName: card.name,
      observedAt: this.now().toISOString(),
      evidence: requested.flatMap((id) => {
        const evidence = byId.get(id);
        return evidence ? [evidence] : [];
      }),
      unknownEvidenceIds: requested.filter((id) => !byId.has(id)),
    };
  }
}
