import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { main } from "../src/cli.js";
import { configPath, loadConfig } from "../src/config.js";
import { tmpdir } from "./helpers.js";

describe("cli", () => {
  let dir: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    dir = tmpdir("cli");
    process.env.RUNTIMEBRIEF_CONFIG_DIR = dir;
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
  });

  afterEach(() => {
    delete process.env.RUNTIMEBRIEF_CONFIG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("init scaffolds config, prints token once, stores only the hash", async () => {
    await main(["init"]);
    expect(fs.existsSync(configPath())).toBe(true);
    const output = logs.join("\n");
    const match = output.match(/^ {2}([A-Za-z0-9_-]{40,})$/m);
    expect(match, "token should be printed").toBeTruthy();
    const token = match![1]!;
    const raw = fs.readFileSync(configPath(), "utf8");
    expect(raw).not.toContain(token);
    expect(raw).toContain("token_hash: scrypt:");
    const config = loadConfig();
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.analyst.model).toBe("gpt-5.6-luna");
  });

  it("init refuses to overwrite an existing config", async () => {
    await main(["init"]);
    await expect(main(["init"])).rejects.toThrow("exit:1");
    expect(errors.join("\n")).toMatch(/already exists/);
  });

  it("add-project registers a directory and rejects duplicates", async () => {
    await main(["init"]);
    const projectDir = path.join(dir, "myapp");
    fs.mkdirSync(projectDir);
    await main(["add-project", projectDir]);
    const config = loadConfig();
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0]).toMatchObject({
      id: "myapp",
      name: "myapp",
      path: projectDir,
      allowed_actions: [],
    });

    await expect(main(["add-project", projectDir])).rejects.toThrow("exit:1");
    expect(errors.join("\n")).toMatch(/already exists|already registered/);
  });

  it("add-project honors --id and --name", async () => {
    await main(["init"]);
    const projectDir = path.join(dir, "some-dir");
    fs.mkdirSync(projectDir);
    await main(["add-project", projectDir, "--id", "meal", "--name", "Sample Tracker App"]);
    const config = loadConfig();
    expect(config.projects[0]).toMatchObject({ id: "meal", name: "Sample Tracker App" });
  });

  it("add-project-root trusts a directory and rejects duplicates", async () => {
    await main(["init"]);
    const root = path.join(dir, "projects");
    fs.mkdirSync(root);
    await main(["add-project-root", root]);
    expect(loadConfig().project_roots).toEqual([root]);
    expect(logs.join("\n")).toContain("Trusted project root");

    await expect(main(["add-project-root", root])).rejects.toThrow("exit:1");
    expect(errors.join("\n")).toContain("already trusted");
  });

  it("add-project rejects nonexistent paths", async () => {
    await main(["init"]);
    await expect(main(["add-project", path.join(dir, "nope")])).rejects.toThrow("exit:1");
  });

  it("add-project-root rejects nonexistent paths", async () => {
    await main(["init"]);
    await expect(main(["add-project-root", path.join(dir, "nope")])).rejects.toThrow("exit:1");
  });

});
