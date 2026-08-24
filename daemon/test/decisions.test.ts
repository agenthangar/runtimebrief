import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  ActionAlreadyResolvedError,
  ActionExpiredError,
  DecisionNonceConflictError,
  DecisionStore,
} from "../src/decisions/store.js";
import { tmpdir } from "./helpers.js";

describe("DecisionStore", () => {
  const dirs: string[] = [];
  let store: DecisionStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    const dir = tmpdir("decisions");
    dirs.push(dir);
    let now = new Date("2026-07-31T12:00:00.000Z");
    let sequence = 0;
    store = new DecisionStore(
      path.join(dir, "decisions.db"),
      () => now,
      () => `action-${++sequence}`,
    );
    return {
      store,
      setNow(value: string) {
        now = new Date(value);
      },
    };
  }

  it("persists, lists, and idempotently resolves an action", () => {
    const { store: decisions } = setup();
    const proposed = decisions.propose({
      projectId: "fixture",
      kind: "run-tests",
      description: "Re-run the release test suite",
      params: { suite: "release" },
      expiresAt: new Date("2026-07-31T13:00:00.000Z"),
    });

    expect(proposed).toMatchObject({
      status: "pending",
      action: { id: "action-1", projectId: "fixture", kind: "run-tests" },
      decision: null,
    });
    expect(decisions.listPending()).toHaveLength(1);

    const resolved = decisions.resolve("action-1", true, "decision-nonce-1");
    expect(resolved.status).toBe("approved");
    expect(resolved.decision).toMatchObject({
      approved: true,
      nonce: "decision-nonce-1",
    });
    expect(decisions.listPending()).toEqual([]);
    expect(decisions.resolve("action-1", true, "decision-nonce-1")).toEqual(resolved);
    expect(() => decisions.resolve("action-1", false, "different-nonce")).toThrow(
      ActionAlreadyResolvedError,
    );
  });

  it("hardens a restored data directory and live SQLite WAL/SHM files", () => {
    const { store: decisions } = setup();
    const dir = dirs[0]!;
    const dbPath = path.join(dir, "decisions.db");
    decisions.propose({
      projectId: "fixture",
      kind: "run-tests",
      description: "Keep SQLite sidecars live",
      params: {},
      expiresAt: new Date("2026-07-31T13:00:00.000Z"),
    });
    const databaseFiles = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    for (const file of databaseFiles) {
      expect(fs.existsSync(file), `${path.basename(file)} should exist while SQLite is open`).toBe(true);
    }
    fs.chmodSync(dir, 0o755);
    for (const file of databaseFiles) {
      fs.chmodSync(file, 0o644);
    }
    const secondConnection = new DecisionStore(dbPath);
    try {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      for (const file of databaseFiles) {
        expect(fs.existsSync(file), `${path.basename(file)} should remain live`).toBe(true);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
    } finally {
      secondConnection.close();
    }
  });

  it("expires stale actions and refuses to resolve them", () => {
    const { store: decisions, setNow } = setup();
    const dbPath = path.join(dirs[0]!, "decisions.db");
    decisions.propose({
      projectId: "fixture",
      kind: "deploy",
      description: "Deploy the release",
      params: {},
      expiresAt: new Date("2026-07-31T12:05:00.000Z"),
    });
    setNow("2026-07-31T12:06:00.000Z");

    expect(decisions.listPending()).toEqual([]);
    expect(decisions.get("action-1")?.status).toBe("expired");

    const readStatus = () => {
      const db = new Database(dbPath, { readonly: true });
      try {
        return (db.prepare("SELECT status FROM actions WHERE id = ?").get("action-1") as {
          status: string;
        }).status;
      } finally {
        db.close();
      }
    };
    expect(readStatus()).toBe("pending");
    expect(() => decisions.resolve("action-1", true, "expired-nonce")).toThrow(
      ActionExpiredError,
    );
    expect(readStatus()).toBe("expired");
  });

  it("prevents one idempotency key from resolving two actions", () => {
    const { store: decisions } = setup();
    for (const description of ["First", "Second"]) {
      decisions.propose({
        projectId: "fixture",
        kind: "run-tests",
        description,
        params: {},
        expiresAt: new Date("2026-07-31T13:00:00.000Z"),
      });
    }
    decisions.resolve("action-1", false, "shared-decision-nonce");
    expect(() =>
      decisions.resolve("action-2", true, "shared-decision-nonce"),
    ).toThrow(DecisionNonceConflictError);
    expect(decisions.get("action-2")?.status).toBe("pending");
  });

  it("survives process-style close and reopen", () => {
    const { store: decisions } = setup();
    const dbPath = path.join(dirs[0]!, "decisions.db");
    decisions.propose({
      projectId: "fixture",
      kind: "run-tests",
      description: "Persist me",
      params: { attempt: 2 },
      expiresAt: new Date("2026-07-31T13:00:00.000Z"),
    });
    decisions.close();
    store = new DecisionStore(dbPath, () => new Date("2026-07-31T12:01:00.000Z"));
    expect(store.listPending()[0]).toMatchObject({
      action: { projectId: "fixture", params: { attempt: 2 } },
      status: "pending",
    });
  });
});
