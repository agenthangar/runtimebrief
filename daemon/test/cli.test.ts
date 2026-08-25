import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { main } from "../src/cli.js";
import { configPath, loadConfig } from "../src/config.js";
import { startServer, VERSION } from "../src/server.js";
import { tmpdir } from "./helpers.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

vi.mock("../src/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server.js")>();
  return { ...actual, startServer: vi.fn() };
});

describe("cli", () => {
  let dir: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    dir = tmpdir("cli");
    process.env.RUNTIMEBRIEF_CONFIG_DIR = dir;
    logs = [];
    errors = [];
    vi.mocked(execFileSync).mockClear();
    vi.mocked(startServer).mockClear();
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

  it("prints general help through --help, -h, and help without creating config", async () => {
    for (const argv of [["--help"], ["-h"], ["help"]]) {
      logs = [];
      await main(argv);
      const output = logs.join("\n");
      expect(output).toContain(`runtimebriefd ${VERSION}`);
      expect(output).toContain("Usage:");
      expect(output).toContain("runtimebriefd help <command>");
    }

    expect(fs.existsSync(configPath())).toBe(false);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("prints useful, non-mutating help for every known command", async () => {
    const commands = [
      "init",
      "start",
      "status",
      "add-project",
      "add-project-root",
      "install-service",
      "mcp",
    ];

    for (const command of commands) {
      logs = [];
      await main([command, "--help"]);
      expect(logs.join("\n")).toContain(`runtimebriefd ${command}`);
    }

    expect(fs.existsSync(configPath())).toBe(false);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("prints command help through the help command", async () => {
    await main(["help", "add-project"]);
    expect(logs.join("\n")).toContain("runtimebriefd add-project <path>");
    expect(logs.join("\n")).toContain("--id <id>");
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("does not start the daemon when start --help is requested", async () => {
    await main(["start", "--help"]);
    expect(startServer).not.toHaveBeenCalled();
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("does not install or write anything when install-service --help is requested", async () => {
    const writeFile = vi.spyOn(fs, "writeFileSync");

    await main(["install-service", "--help"]);

    expect(execFileSync).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("prints the version without reading or creating config", async () => {
    await main(["--version"]);
    expect(logs).toEqual([VERSION]);
    expect(fs.existsSync(configPath())).toBe(false);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it.each([
    [["nonesuch"], /Unknown command: nonesuch/],
    [["--nonesuch"], /Unknown option: --nonesuch/],
    [["help", "nonesuch"], /Unknown command: nonesuch/],
    [["help", "start", "extra"], /Unexpected argument for help: extra/],
    [["--help", "extra"], /Unexpected argument for --help: extra/],
    [["--version", "extra"], /Unexpected argument for --version: extra/],
  ])("rejects invalid global input %#", async (argv, message) => {
    await expect(main(argv as string[])).rejects.toThrow("exit:1");
    expect(errors.join("\n")).toMatch(message as RegExp);
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it.each(["init", "status", "install-service", "mcp"])(
    "rejects unknown options for %s before invoking the command",
    async (command) => {
      await expect(main([command, "--bogus"])).rejects.toThrow("exit:1");
      expect(errors.join("\n")).toContain(`Unknown option for ${command}: --bogus`);
      expect(fs.existsSync(configPath())).toBe(false);
    },
  );

  it.each(["init", "status", "install-service", "mcp"])(
    "rejects extra arguments for %s before invoking the command",
    async (command) => {
      await expect(main([command, "extra"])).rejects.toThrow("exit:1");
      expect(errors.join("\n")).toContain(`Unexpected argument for ${command}: extra`);
      expect(fs.existsSync(configPath())).toBe(false);
    },
  );

  it("rejects invalid start arguments without starting the daemon", async () => {
    for (const args of [["--bogus"], ["extra"], ["--i-know-what-im-doing", "extra"]]) {
      errors = [];
      await expect(main(["start", ...args])).rejects.toThrow("exit:1");
      expect(errors.join("\n")).toMatch(/Unknown option|Unexpected argument/);
    }
    expect(startServer).not.toHaveBeenCalled();
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("rejects malformed add-project input before reading config", async () => {
    const invalidArgs = [
      [],
      ["--bogus"],
      ["sample", "extra"],
      ["sample", "--id"],
      ["sample", "--name"],
      ["sample", "--id", "one", "--id", "two"],
    ];

    for (const args of invalidArgs) {
      errors = [];
      await expect(main(["add-project", ...args])).rejects.toThrow("exit:1");
      expect(errors.join("\n")).toMatch(
        /Missing required|Unknown option|Unexpected argument|requires a value|only be specified once/,
      );
    }
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("rejects malformed add-project-root input before reading config", async () => {
    for (const args of [[], ["--bogus"], ["one", "two"]]) {
      errors = [];
      await expect(main(["add-project-root", ...args])).rejects.toThrow("exit:1");
      expect(errors.join("\n")).toMatch(/Missing required|Unknown option|Unexpected argument/);
    }
    expect(fs.existsSync(configPath())).toBe(false);
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
