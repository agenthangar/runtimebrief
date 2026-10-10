import { randomUUID } from "node:crypto";
import type { EvidenceRef } from "../types.js";

export interface AskOutcome {
  answer: string;
  evidence: EvidenceRef[];
  cached: boolean;
}

export type AskJobState =
  | { status: "running" }
  | { status: "answered"; outcome: AskOutcome }
  | { status: "failed" };

export interface AskJob {
  readonly id: string;
  readonly key: string;
  state: AskJobState;
  finishedAt: number | null;
  readonly settled: Promise<void>;
}

export interface AskJobsOptions {
  /** How long a finished answer is reused for the same question. */
  retainMs?: number;
  maxJobs?: number;
  /** Each running job is a model process; refuse more than this at once. */
  maxRunning?: number;
  now?: () => number;
}

/**
 * Spoken questions must answer within Siri's patience, but a model run can
 * take longer. A job keeps running after the caller stops waiting, so asking
 * the same question again returns its answer without another model run.
 */
export class AskJobs {
  private readonly jobs = new Map<string, AskJob>();
  private readonly shutdown = new AbortController();
  private readonly retainMs: number;
  private readonly maxJobs: number;
  private readonly maxRunning: number;
  private readonly now: () => number;

  constructor(options: AskJobsOptions = {}) {
    this.retainMs = options.retainMs ?? 10 * 60_000;
    this.maxJobs = options.maxJobs ?? 50;
    this.maxRunning = options.maxRunning ?? 3;
    this.now = options.now ?? Date.now;
  }

  /** Joins a running or recently answered job for `key`, or starts one.
   * Returns null when too many other questions are already running. */
  run(key: string, work: (signal: AbortSignal) => Promise<AskOutcome>): AskJob | null {
    this.prune();
    const existing = this.jobs.get(key);
    if (existing && existing.state.status !== "failed") return existing;
    const running = [...this.jobs.values()].filter((job) => job.state.status === "running");
    if (running.length >= this.maxRunning) return null;

    let job: AskJob;
    const settled = Promise.resolve()
      .then(() => work(this.shutdown.signal))
      .then(
        (outcome) => {
          job.state = { status: "answered", outcome };
        },
        () => {
          job.state = { status: "failed" };
        },
      )
      .finally(() => {
        job.finishedAt = this.now();
      });
    job = { id: randomUUID(), key, state: { status: "running" }, finishedAt: null, settled };
    this.jobs.set(key, job);
    return job;
  }

  /** Waits up to `ms` for the job; returns its state at that point. */
  async wait(job: AskJob, ms: number): Promise<AskJobState> {
    if (job.state.status !== "running" || ms <= 0) return job.state;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      job.settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
    return job.state;
  }

  close(): void {
    this.shutdown.abort();
    this.jobs.clear();
  }

  private prune(): void {
    const now = this.now();
    for (const [key, job] of this.jobs) {
      if (job.finishedAt !== null && now - job.finishedAt > this.retainMs) this.jobs.delete(key);
    }
    if (this.jobs.size < this.maxJobs) return;
    const finished = [...this.jobs.values()]
      .filter((job) => job.finishedAt !== null)
      .sort((a, b) => a.finishedAt! - b.finishedAt!);
    for (const job of finished) {
      if (this.jobs.size < this.maxJobs) break;
      this.jobs.delete(job.key);
    }
  }
}
