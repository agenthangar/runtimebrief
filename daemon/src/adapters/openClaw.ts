import type {
  ActivityEvent,
  ProjectConfig,
  RuntimeAdapter,
  TranscriptRef,
} from "../types.js";

/**
 * Stub: OpenClaw multi-agent harness sessions.
 *
 * TODO(v0.2): implement discovery of OpenClaw run logs and map runs to
 * projects. Until then this adapter never matches, so it is safe to keep
 * registered.
 */
export class OpenClawAdapter implements RuntimeAdapter {
  readonly id = "openclaw";

  async discover(_project: ProjectConfig): Promise<boolean> {
    return false;
  }

  async recentActivity(_project: ProjectConfig, _since: Date): Promise<ActivityEvent[]> {
    return [];
  }

  async transcriptPaths(_project: ProjectConfig, _limit: number): Promise<TranscriptRef[]> {
    return [];
  }
}
