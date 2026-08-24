import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  configPath,
  configSchema,
  generateToken,
  hashToken,
  loadConfig,
  saveConfig,
  verifyToken,
} from "../src/config.js";
import { testConfig, tmpdir } from "./helpers.js";

describe("token generation and verification", () => {
  it("generates 32 bytes of entropy, base64url encoded", () => {
    const token = generateToken();
    expect(Buffer.from(token, "base64url").length).toBe(32);
    expect(token).not.toMatch(/[+/=]/);
  });

  it("round-trips through scrypt hash", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(hash).not.toContain(token);
    expect(verifyToken(token, hash)).toBe(true);
  });

  it("rejects wrong tokens and malformed hashes", () => {
    const hash = hashToken("right-token");
    expect(verifyToken("wrong-token", hash)).toBe(false);
    expect(verifyToken("right-token", "garbage")).toBe(false);
    expect(verifyToken("right-token", "scrypt:AAAA")).toBe(false);
    expect(verifyToken("right-token", "scrypt:!!!:!!!")).toBe(false);
  });

  it("hashes are salted (same token, different hash)", () => {
    expect(hashToken("t")).not.toBe(hashToken("t"));
  });
});

describe("config load/save", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir("config");
    process.env.RUNTIMEBRIEF_CONFIG_DIR = dir;
  });
  afterEach(() => {
    delete process.env.RUNTIMEBRIEF_CONFIG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("throws a helpful error when config is missing", () => {
    expect(() => loadConfig()).toThrow(/runtimebriefd init/);
  });

  it("saves with 0600 perms and loads back", () => {
    const config = testConfig({
      projects: [{ id: "demo", name: "Demo", path: "/tmp/demo" }],
    });
    saveConfig(config);
    const mode = fs.statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);
    const loaded = loadConfig();
    expect(loaded.server.host).toBe("127.0.0.1");
    expect(loaded.server.port).toBe(8484);
    expect(loaded.project_roots).toEqual([]);
    expect(loaded.projects[0]?.id).toBe("demo");
    expect(loaded.projects[0]?.allowed_actions).toEqual([]);
    expect(loaded.analyst.model).toBe("gpt-5.6-sol");
    expect(loaded.analyst.cache_ttl_minutes).toBe(10);
  });

  it("rehardens restored config directory and file permissions", () => {
    saveConfig(testConfig());
    fs.chmodSync(dir, 0o755);
    fs.chmodSync(configPath(), 0o644);
    loadConfig();
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600);
  });

  it("rejects a symlinked config file", () => {
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside.yaml`);
    fs.writeFileSync(outside, "auth:\n  token_hash: fixture\n");
    fs.symlinkSync(outside, configPath());
    try {
      expect(() => loadConfig()).toThrow(/not a regular file/);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("rejects invalid configs with path-level errors", () => {
    fs.writeFileSync(path.join(dir, "config.yaml"), "auth:\n  token_hash: 123\n");
    expect(() => loadConfig()).toThrow(/auth.token_hash/);
  });

  it("rejects duplicate project ids", () => {
    const config = testConfig({
      projects: [
        { id: "a", name: "A", path: "/tmp/a" },
        { id: "a", name: "A2", path: "/tmp/a2" },
      ],
    });
    saveConfig(config);
    expect(() => loadConfig()).toThrow(/duplicate project id/);
  });

  it("loads trusted project roots and rejects normalized duplicates", () => {
    const root = path.join(dir, "projects");
    fs.mkdirSync(root);
    saveConfig(testConfig({ project_roots: [root] }));
    expect(loadConfig().project_roots).toEqual([root]);

    saveConfig(testConfig({ project_roots: [root, path.join(root, ".")] }));
    expect(() => loadConfig()).toThrow(/duplicate project root/);
  });

  it("validates and preserves per-project action allowlists", () => {
    const config = testConfig({
      projects: [
        {
          id: "demo",
          name: "Demo",
          path: "/tmp/demo",
          allowed_actions: ["run-tests", "git-push"],
        },
      ],
    });
    saveConfig(config);
    expect(loadConfig().projects[0]?.allowed_actions).toEqual([
      "run-tests",
      "git-push",
    ]);
    expect(() =>
      configSchema.parse({
        auth: { token_hash: "scrypt:x:y" },
        projects: [
          {
            id: "demo",
            name: "Demo",
            path: "/tmp/demo",
            allowed_actions: ["Deploy Now"],
          },
        ],
      }),
    ).toThrow(/action kind/);
  });

  it("defaults host to loopback, never 0.0.0.0", () => {
    const parsed = configSchema.parse({ auth: { token_hash: "scrypt:x:y" } });
    expect(parsed.server.host).toBe("127.0.0.1");
  });
});
