/**
 * Wire types matching runtimebriefd's /v1 API. Field names and enum values
 * mirror `ios/RuntimeBrief/Models/Models.swift` so both clients decode the
 * same payloads. Dates arrive as ISO-8601 strings and are parsed by `parseDate`.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  lastActivityAt: Date | null;
  branch: string | null;
  dirty: boolean | null;
  brief: ProjectBrief | null;
}

export interface ProjectCard {
  id: string;
  name: string;
  path: string;
  lastActivityAt: Date | null;
  git: GitSummary | null;
  iosRelease: IOSReleaseSummary | null;
  sessions: SessionInfo[];
  brief: ProjectBrief | null;
}

export type ProjectBriefState = "active" | "attention" | "recent" | "quiet" | "unavailable";

export type BriefClaimCategory = "attention" | "progress" | "completed" | "context";

export type EvidenceKind =
  | "working-tree"
  | "commit"
  | "session"
  | "project-scan"
  | "xcode-project"
  | "testflight-build"
  | "app-store-version";

export interface IOSReleaseSummary {
  xcode: XcodeProjectSummary;
  appStoreConnect: AppStoreConnectSummary;
}

export interface XcodeProjectSummary {
  source: string;
  projectFile: string;
  scheme: string;
  bundleId: string;
  marketingVersion: string | null;
  buildNumber: string | null;
}

export type AppStoreConnectStatus = "available" | "not-configured" | "app-not-found" | "unavailable";

export interface AppStoreConnectSummary {
  status: AppStoreConnectStatus;
  checkedAt: Date | null;
  message: string | null;
  appId: string | null;
  latestTestFlightBuild: TestFlightBuildSummary | null;
  appStoreVersion: AppStoreVersionSummary | null;
}

export interface TestFlightBuildSummary {
  id: string;
  marketingVersion: string | null;
  buildNumber: string;
  uploadedAt: Date | null;
  expiresAt: Date | null;
  expired: boolean;
  processingState: string;
  audienceType: string | null;
}

export interface AppStoreVersionSummary {
  id: string;
  version: string;
  buildNumber: string | null;
  state: string;
  createdAt: Date | null;
}

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  label: string;
  detail: string;
  source: string | null;
  timestamp: Date | null;
}

export interface BriefClaim {
  id: string;
  category: BriefClaimCategory;
  text: string;
  evidence: EvidenceRef[];
}

export interface ProjectBrief {
  state: ProjectBriefState;
  headline: string;
  headlineEvidence: EvidenceRef[];
  updatedAt: Date | null;
  activeSessionCount: number;
  claims: BriefClaim[];
}

export interface GitSummary {
  branch: string;
  dirty: boolean;
  dirtyFileCount: number;
  commits: CommitInfo[];
  diffstatVsDefault: string | null;
  defaultBranch: string | null;
  todoCount: number;
  fixmeCount: number;
  lastCommitAt: Date | null;
}

export interface CommitInfo {
  hash: string;
  author: string;
  timestamp: Date;
  message: string;
}

export type AgentSessionState = "active" | "waiting" | "completed" | "interrupted" | "unknown";

export interface SessionInfo {
  source: string;
  id: string;
  startedAt: Date | null;
  endedAt: Date | null;
  summary: string | null;
  state: AgentSessionState | null;
  stateReason: string | null;
  gitBranch: string | null;
  model: string | null;
  filesTouched: string[] | null;
  toolUseCount: number | null;
  conclusion: string | null;
}

export interface AnalystAnswer {
  answer: string;
  costUsd: number;
  cached: boolean;
  truncated: boolean;
  evidence: EvidenceRef[] | null;
}

export interface VoiceStatus {
  answer: string | null;
  analyzedAt: Date | null;
  model: string | null;
  evidence: EvidenceRef[];
  refreshing: boolean;
  unavailable: boolean;
}

export interface HealthInfo {
  version: string;
  uptime: number;
}

/**
 * runtimebriefd emits ISO-8601 timestamps with fractional seconds. Accept the
 * plain form too, and reject anything else the same way the iOS decoder does.
 */
export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "string") throw new DecodingError(`Unparseable date: ${String(value)}`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new DecodingError(`Unparseable date: ${value}`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new DecodingError(`Unparseable date: ${value}`);
  return new Date(ms);
}

export class DecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodingError";
  }
}
