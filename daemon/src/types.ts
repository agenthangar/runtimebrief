/**
 * Shared types for runtimebriefd.
 */

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  /** Optional per-project transcript source overrides. Empty → auto-discovery. */
  transcript_sources?: TranscriptSourceConfig[] | undefined;
  /**
   * Action kinds this project permits agents to propose for a human decision.
   * Approval is only recorded by RuntimeBrief; execution remains out of scope.
   */
  allowed_actions?: string[] | undefined;
}

export interface TranscriptSourceConfig {
  type: string; // e.g. "claude-code"
  /** Adapter-specific root override (e.g. a non-default ~/.claude dir). */
  root?: string | undefined;
}

/** A single unit of observed activity in a project (commit, session, etc.). */
export interface ActivityEvent {
  /** Adapter that produced this event. */
  source: string;
  /** e.g. "commit", "session", "file-change" */
  kind: string;
  timestamp: Date;
  summary: string;
  detail?: Record<string, unknown>;
}

/** Reference to a session transcript on disk. */
export interface TranscriptRef {
  /** Adapter that produced this ref. */
  source: string;
  /** Stable identifier (e.g. Claude Code session id). */
  id: string;
  path: string;
  startedAt?: Date;
  endedAt?: Date;
  /** Short human summary if the adapter can produce one cheaply. */
  summary?: string;
  /** Native session title when it is distinct from the latest user request. */
  title?: string;
  /** Best-effort lifecycle state derived from the adapter's native events. */
  state?: SessionState;
  /** Human-readable reason for the lifecycle state. */
  stateReason?: string;
  /** Branch recorded by the agent runtime, when available. */
  gitBranch?: string;
  /** Model recorded by the agent runtime, when available. */
  model?: string;
  /** Non-sensitive files observed in tool calls or patch events. */
  filesTouched?: string[];
  /** Count of tool calls observed in the transcript. */
  toolUseCount?: number;
  /** Last agent-authored conclusion, truncated by API presenters as needed. */
  conclusion?: string;
}

export type SessionState =
  | "active"
  | "waiting"
  | "completed"
  | "interrupted"
  | "unknown";

export type EvidenceKind =
  | "working-tree"
  | "commit"
  | "session"
  | "project-scan"
  | "xcode-project"
  | "testflight-build"
  | "app-store-version";

/** A source record that lets the client verify one brief or analyst claim. */
export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  label: string;
  detail: string;
  source?: string;
  timestamp?: string;
}

export type BriefClaimCategory = "attention" | "progress" | "completed" | "context";

export interface BriefClaim {
  id: string;
  category: BriefClaimCategory;
  text: string;
  /** Every claim must carry at least one concrete source record. */
  evidence: EvidenceRef[];
}

export type ProjectBriefState = "active" | "attention" | "recent" | "quiet" | "unavailable";

/**
 * Deterministic, zero-model-cost project brief used by the portfolio screen.
 * The headline and every claim are backed by source evidence.
 */
export interface ProjectBrief {
  state: ProjectBriefState;
  headline: string;
  headlineEvidence: EvidenceRef[];
  updatedAt: string | null;
  activeSessionCount: number;
  claims: BriefClaim[];
}

/**
 * Every source of project activity implements this interface.
 * Adapters are strictly read-only: they observe, never mutate.
 */
export interface RuntimeAdapter {
  id: string;
  /** Does this adapter apply to the given project? */
  discover(project: ProjectConfig): Promise<boolean>;
  recentActivity(project: ProjectConfig, since: Date): Promise<ActivityEvent[]>;
  /** Return no refs when the adapter is excluded or does not apply. */
  transcriptPaths(project: ProjectConfig, limit: number): Promise<TranscriptRef[]>;
}

// ---------------------------------------------------------------------------
// Decision inbox seam. RuntimeBrief can record proposals and human decisions, but
// it deliberately does not execute an approved action.
// ---------------------------------------------------------------------------

/**
 * A proposed action requiring explicit user confirmation. Recording approval
 * does not execute it; an execution layer is intentionally absent.
 */
export interface Action {
  id: string;
  projectId: string;
  kind: string; // e.g. "run-tests", "deploy", "git-push" — allowlisted per project
  description: string;
  /** Opaque JSON metadata. RuntimeBrief records it but never interprets or executes it. */
  params: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

/** The user's recorded decision about a proposed Action. */
export interface Decision {
  actionId: string;
  approved: boolean;
  decidedAt: Date;
  /** Idempotency token so a replayed request can't double-execute. */
  nonce: string;
}

export type ActionDecisionStatus = "pending" | "approved" | "rejected" | "expired";

export interface ActionRecord {
  action: Action;
  status: ActionDecisionStatus;
  decision: Decision | null;
}
