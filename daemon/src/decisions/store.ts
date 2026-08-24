import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { configDir } from "../config.js";
import {
  hardenPrivateDatabase,
  preparePrivateDatabase,
} from "../privateData.js";
import type { Action, ActionDecisionStatus, ActionRecord, Decision } from "../types.js";

interface ActionRow {
  id: string;
  projectId: string;
  kind: string;
  description: string;
  paramsJson: string;
  createdAt: number;
  expiresAt: number;
  status: ActionDecisionStatus;
  approved: number | null;
  decidedAt: number | null;
  decisionNonce: string | null;
}

export interface ProposeActionInput {
  projectId: string;
  kind: string;
  description: string;
  params: Record<string, unknown>;
  expiresAt: Date;
}

export class ActionNotFoundError extends Error {}
export class ActionExpiredError extends Error {}
export class ActionAlreadyResolvedError extends Error {}
export class DecisionNonceConflictError extends Error {}

function parseParams(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // A corrupt params payload should not make the whole decision inbox fail.
  }
  return {};
}

function rowToRecord(row: ActionRow, observedAt: Date): ActionRecord {
  const action: Action = {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    description: row.description,
    params: parseParams(row.paramsJson),
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
  };
  let decision: Decision | null = null;
  if (
    row.approved !== null &&
    row.decidedAt !== null &&
    row.decisionNonce !== null
  ) {
    decision = {
      actionId: row.id,
      approved: row.approved === 1,
      decidedAt: new Date(row.decidedAt),
      nonce: row.decisionNonce,
    };
  }
  const status =
    row.status === "pending" && row.expiresAt <= observedAt.getTime()
      ? "expired"
      : row.status;
  return { action, status, decision };
}

/**
 * Durable decision inbox. It records proposals and human decisions only.
 * Nothing in this store executes an action or touches a project working tree.
 */
export class DecisionStore {
  private readonly db: Database.Database;

  constructor(
    dbPath?: string,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {
    const file = dbPath ?? path.join(configDir(), "decisions.db");
    preparePrivateDatabase(file);
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        description TEXT NOT NULL,
        params_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
        approved INTEGER,
        decided_at INTEGER,
        decision_nonce TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS actions_pending
        ON actions(status, expires_at, created_at);
      CREATE INDEX IF NOT EXISTS actions_project
        ON actions(project_id, status, created_at);
    `);
    hardenPrivateDatabase(file);
  }

  private expireOld(): void {
    this.db
      .prepare(
        `UPDATE actions
         SET status = 'expired'
         WHERE status = 'pending' AND expires_at <= ?`,
      )
      .run(this.now().getTime());
  }

  propose(input: ProposeActionInput): ActionRecord {
    const now = this.now();
    if (input.expiresAt.getTime() <= now.getTime()) {
      throw new ActionExpiredError("The proposed action must expire in the future.");
    }
    const action: Action = {
      id: this.idFactory(),
      projectId: input.projectId,
      kind: input.kind,
      description: input.description,
      params: input.params,
      createdAt: now,
      expiresAt: input.expiresAt,
    };
    this.db
      .prepare(
        `INSERT INTO actions
          (id, project_id, kind, description, params_json, created_at, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(
        action.id,
        action.projectId,
        action.kind,
        action.description,
        JSON.stringify(action.params),
        action.createdAt.getTime(),
        action.expiresAt.getTime(),
      );
    return { action, status: "pending", decision: null };
  }

  get(actionId: string): ActionRecord | null {
    const observedAt = this.now();
    const row = this.db
      .prepare(
        `SELECT id, project_id AS projectId, kind, description,
                params_json AS paramsJson, created_at AS createdAt,
                expires_at AS expiresAt, status, approved,
                decided_at AS decidedAt, decision_nonce AS decisionNonce
         FROM actions WHERE id = ?`,
      )
      .get(actionId) as ActionRow | undefined;
    return row ? rowToRecord(row, observedAt) : null;
  }

  listPending(options: { projectId?: string; limit?: number } = {}): ActionRecord[] {
    const observedAt = this.now();
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const rows = (
      options.projectId
        ? this.db
            .prepare(
              `SELECT id, project_id AS projectId, kind, description,
                      params_json AS paramsJson, created_at AS createdAt,
                      expires_at AS expiresAt, status, approved,
                      decided_at AS decidedAt, decision_nonce AS decisionNonce
               FROM actions
               WHERE status = 'pending' AND expires_at > ? AND project_id = ?
               ORDER BY expires_at ASC, created_at ASC
               LIMIT ?`,
            )
            .all(observedAt.getTime(), options.projectId, limit)
        : this.db
            .prepare(
              `SELECT id, project_id AS projectId, kind, description,
                      params_json AS paramsJson, created_at AS createdAt,
                      expires_at AS expiresAt, status, approved,
                      decided_at AS decidedAt, decision_nonce AS decisionNonce
               FROM actions
               WHERE status = 'pending' AND expires_at > ?
               ORDER BY expires_at ASC, created_at ASC
               LIMIT ?`,
            )
            .all(observedAt.getTime(), limit)
    ) as ActionRow[];
    return rows.map((row) => rowToRecord(row, observedAt));
  }

  resolve(actionId: string, approved: boolean, nonce: string): ActionRecord {
    // Resolution is a write operation, so it is also the safe point to
    // persist effective expiry without making read tools mutate the database.
    this.expireOld();
    const resolveTransaction = this.db.transaction(() => {
      const existing = this.get(actionId);
      if (!existing) throw new ActionNotFoundError(`Unknown action: ${actionId}`);
      if (existing.status === "expired") {
        throw new ActionExpiredError(`Action ${actionId} has expired.`);
      }
      if (existing.status !== "pending") {
        if (
          existing.decision?.nonce === nonce &&
          existing.decision.approved === approved
        ) {
          return existing;
        }
        throw new ActionAlreadyResolvedError(
          `Action ${actionId} is already ${existing.status}.`,
        );
      }

      try {
        this.db
          .prepare(
            `UPDATE actions
             SET status = ?, approved = ?, decided_at = ?, decision_nonce = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(
            approved ? "approved" : "rejected",
            approved ? 1 : 0,
            this.now().getTime(),
            nonce,
            actionId,
          );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.toLowerCase().includes("decision_nonce")
        ) {
          throw new DecisionNonceConflictError(
            "That idempotency key was already used for another decision.",
          );
        }
        throw error;
      }
      return this.get(actionId)!;
    });
    return resolveTransaction();
  }

  close(): void {
    this.db.close();
  }
}
