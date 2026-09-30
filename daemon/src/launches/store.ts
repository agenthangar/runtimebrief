import Database from "better-sqlite3";
import path from "node:path";
import { configDir } from "../config.js";
import { hardenPrivateDatabase, preparePrivateDatabase } from "../privateData.js";
import type { ClaudeLaunch } from "./types.js";
import { LaunchError } from "./types.js";

/** A receipt is committed before dispatch. An uncertain dispatch is never replayed. */
export class LaunchStore {
  private readonly db: Database.Database;

  constructor(file = path.join(configDir(), "launches.db")) {
    preparePrivateDatabase(file);
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS launches (
      id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL,
      fingerprint TEXT NOT NULL, project_id TEXT NOT NULL, receipt TEXT NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS terminal_inputs (
      session_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      state TEXT NOT NULL, PRIMARY KEY (session_id, request_id)
    )`);
    hardenPrivateDatabase(file);
  }

  byRequest(requestId: string, fingerprint: string): ClaudeLaunch | null {
    const row = this.db.prepare("SELECT fingerprint, receipt FROM launches WHERE request_id = ?")
      .get(requestId) as { fingerprint: string; receipt: string } | undefined;
    if (!row) return null;
    if (row.fingerprint !== fingerprint) {
      throw new LaunchError(409, "request_conflict", "This request ID was already used for a different task.");
    }
    return JSON.parse(row.receipt) as ClaudeLaunch;
  }

  insert(requestId: string, fingerprint: string, receipt: ClaudeLaunch): ClaudeLaunch {
    const result = this.db.prepare("INSERT INTO launches VALUES (?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING")
      .run(receipt.id, requestId, fingerprint, receipt.projectId, JSON.stringify(receipt));
    return result.changes ? receipt : this.byRequest(requestId, fingerprint)!;
  }

  get(id: string, projectId: string): ClaudeLaunch | null {
    const row = this.db.prepare("SELECT receipt FROM launches WHERE id = ? AND project_id = ?")
      .get(id, projectId) as { receipt: string } | undefined;
    return row ? JSON.parse(row.receipt) as ClaudeLaunch : null;
  }

  list(projectId: string): ClaudeLaunch[] {
    const rows = this.db.prepare("SELECT receipt FROM launches WHERE project_id = ? ORDER BY rowid DESC LIMIT 20")
      .all(projectId) as { receipt: string }[];
    return rows.map(row => JSON.parse(row.receipt) as ClaudeLaunch);
  }

  save(receipt: ClaudeLaunch): void {
    this.db.prepare("UPDATE launches SET receipt = ? WHERE id = ?")
      .run(JSON.stringify(receipt), receipt.id);
  }

  inputStatus(id: string, requestId: string, fingerprint: string): string | null {
    const row = this.db.prepare("SELECT fingerprint, state FROM terminal_inputs WHERE session_id = ? AND request_id = ?")
      .get(id, requestId) as { fingerprint: string; state: string } | undefined;
    if (!row) return null;
    if (row.fingerprint !== fingerprint) throw new LaunchError(409, "request_conflict", "This input request ID was used for different keys.");
    return row.state;
  }

  reserveInput(id: string, requestId: string, fingerprint: string): void {
    this.db.prepare("INSERT INTO terminal_inputs VALUES (?, ?, ?, 'unknown')").run(id, requestId, fingerprint);
  }

  finishInput(id: string, requestId: string): void {
    this.db.prepare("UPDATE terminal_inputs SET state = 'sent' WHERE session_id = ? AND request_id = ?").run(id, requestId);
  }

  close(): void { this.db.close(); }
}
