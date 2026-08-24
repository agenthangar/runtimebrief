import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import path from "node:path";
import { configDir } from "../config.js";
import {
  hardenPrivateDatabase,
  preparePrivateDatabase,
} from "../privateData.js";
import type { EvidenceRef } from "../types.js";

export interface CachedAnswer {
  answer: string;
  createdAt: number; // epoch ms
  evidence: EvidenceRef[];
}

export interface AnswerCacheIdentity {
  backend: string;
  model: string;
  promptVersion: string;
  evidenceHash: string;
}

/**
 * Response cache keyed by project, normalized question, backend, model,
 * prompt version, and the exact filtered evidence packet, TTL-bounded.
 * SQLite so answers survive daemon restarts; the generic status question is
 * the default entry that keeps Siri snappy.
 */
export class AnswerCache {
  private readonly db: Database.Database;

  constructor(dbPath?: string) {
    const file = dbPath ?? path.join(configDir(), "cache.db");
    preparePrivateDatabase(file);
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS answers (
        project_id TEXT NOT NULL,
        question_hash TEXT NOT NULL,
        answer TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, question_hash)
      )
    `);
    let columns = this.db.pragma("table_info(answers)") as { name: string }[];
    if (!columns.some((column) => column.name === "evidence_json")) {
      this.db.exec("ALTER TABLE answers ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]'");
      columns = this.db.pragma("table_info(answers)") as { name: string }[];
    }
    if (columns.some((column) => column.name === "cost_usd")) {
      // Earlier releases stored a provider dollar estimate. Codex CLI uses the
      // signed-in ChatGPT plan and does not report one, so migrate that column
      // away while retaining any still-useful answer rows.
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE answers_without_cost (
            project_id TEXT NOT NULL,
            question_hash TEXT NOT NULL,
            answer TEXT NOT NULL,
            evidence_json TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL,
            PRIMARY KEY (project_id, question_hash)
          );
          INSERT INTO answers_without_cost
            (project_id, question_hash, answer, evidence_json, created_at)
          SELECT project_id, question_hash, answer, evidence_json, created_at
          FROM answers;
          DROP TABLE answers;
          ALTER TABLE answers_without_cost RENAME TO answers;
        `);
      })();
    }
    hardenPrivateDatabase(file); // answers can quote transcript content
  }

  static evidenceHash(evidencePacket: string): string {
    return createHash("sha256").update(evidencePacket).digest("hex");
  }

  static questionHash(question: string, identity: AnswerCacheIdentity): string {
    const normalized = question.toLowerCase().replace(/\s+/g, " ").trim();
    return createHash("sha256")
      .update(
        JSON.stringify([
          normalized,
          identity.backend,
          identity.model,
          identity.promptVersion,
          identity.evidenceHash,
        ]),
      )
      .digest("hex");
  }

  get(
    projectId: string,
    question: string,
    identity: AnswerCacheIdentity,
    ttlMinutes: number,
  ): CachedAnswer | null {
    if (ttlMinutes <= 0) return null;
    const row = this.db
      .prepare(
        "SELECT answer, evidence_json as evidenceJson, created_at as createdAt FROM answers WHERE project_id = ? AND question_hash = ?",
      )
      .get(projectId, AnswerCache.questionHash(question, identity)) as
      | (Omit<CachedAnswer, "evidence"> & { evidenceJson: string })
      | undefined;
    if (!row) return null;
    if (Date.now() - row.createdAt > ttlMinutes * 60_000) return null;
    let evidence: EvidenceRef[] = [];
    try {
      const parsed = JSON.parse(row.evidenceJson) as unknown;
      if (Array.isArray(parsed)) evidence = parsed as EvidenceRef[];
    } catch {
      // A malformed legacy cache row should not make the daemon unavailable.
    }
    return {
      answer: row.answer,
      createdAt: row.createdAt,
      evidence,
    };
  }

  set(
    projectId: string,
    question: string,
    identity: AnswerCacheIdentity,
    answer: string,
    evidence: EvidenceRef[] = [],
  ): void {
    this.db
      .prepare(
        `INSERT INTO answers (project_id, question_hash, answer, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project_id, question_hash) DO UPDATE
         SET answer = excluded.answer, evidence_json = excluded.evidence_json,
             created_at = excluded.created_at`,
      )
      .run(
        projectId,
        AnswerCache.questionHash(question, identity),
        answer,
        JSON.stringify(evidence),
        Date.now(),
      );
  }

  close(): void {
    this.db.close();
  }
}
