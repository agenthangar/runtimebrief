#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  configDir,
  configPath,
  configSchema,
  generateToken,
  hashToken,
  loadConfig,
  saveConfig,
  type RuntimeBriefConfig,
} from "./config.js";
import { VERSION, startServer } from "./server.js";
import { defaultAdapters } from "./adapters/index.js";
import { createAnalystService } from "./analyst/index.js";
import { IosReleaseService } from "./iosRelease.js";
import { projectsForConfig } from "./projectRegistry.js";
import { DecisionStore } from "./decisions/store.js";
import { runRuntimeBriefMcpStdio } from "./mcp/server.js";

function usage(): never {
  console.log(`runtimebriefd ${VERSION} — RuntimeBrief daemon

Usage:
  runtimebriefd init                   Scaffold config and generate the auth token
  runtimebriefd start [--i-know-what-im-doing]
                                       Start the daemon
  runtimebriefd status                 Ping a running daemon
  runtimebriefd add-project <path> [--id <id>] [--name <name>]
                                       Register a project directory
  runtimebriefd add-project-root <path> Trust a directory and auto-discover its
                                       direct child Git repositories
  runtimebriefd install-service        Install a launchd service (macOS)
  runtimebriefd mcp                    Serve RuntimeBrief tools over MCP stdio

Config: ${configPath()}`);
  process.exit(1);
}

async function cmdInit(): Promise<void> {
  if (fs.existsSync(configPath())) {
    console.error(`Config already exists at ${configPath()}. Delete it to re-init.`);
    process.exit(1);
  }
  const token = generateToken();
  const config: RuntimeBriefConfig = configSchema.parse({
    auth: { token_hash: hashToken(token) },
  });
  saveConfig(config);
  console.log(`Wrote ${configPath()}`);
  console.log(`\nYour RuntimeBrief token (shown once — store it in the iOS app now):\n`);
  console.log(`  ${token}\n`);
  console.log(
    `Only a hash is stored on disk. Next: add a project or project root, then run runtimebriefd start.`,
  );
}

async function cmdStart(args: string[]): Promise<void> {
  const allowAll = args.includes("--i-know-what-im-doing");
  const config = loadConfig();
  const adapters = defaultAdapters();
  const iosReleases = new IosReleaseService();
  const analyst = createAnalystService(config, adapters, { iosReleases });
  const decisions = new DecisionStore();
  const app = await startServer(
    { config, adapters, analyst, iosReleases, decisions },
    { allowAllInterfaces: allowAll },
  );
  console.log(
    `runtimebriefd ${VERSION} listening on http://${config.server.host}:${config.server.port} ` +
      `(${projectsForConfig(config).length} projects)`,
  );
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function cmdMcp(): Promise<void> {
  const config = loadConfig();
  const adapters = defaultAdapters();
  const decisions = new DecisionStore();
  try {
    await runRuntimeBriefMcpStdio({ config, adapters, decisions });
  } finally {
    decisions.close();
  }
}

async function cmdStatus(): Promise<void> {
  const config = loadConfig();
  const url = `http://${config.server.host}:${config.server.port}/v1/health`;
  try {
    // Health requires auth and we only store the hash, so an unauthorized
    // response still proves the daemon is up.
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok || res.status === 401) {
      console.log(`runtimebriefd is running at ${url} (HTTP ${res.status})`);
    } else {
      console.log(`Unexpected response from ${url}: HTTP ${res.status}`);
      process.exit(1);
    }
  } catch {
    console.log(`runtimebriefd is not reachable at ${url}`);
    process.exit(1);
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "project";
}

async function cmdAddProjectRoot(args: string[]): Promise<void> {
  const rootPath = args[0];
  if (!rootPath) usage();
  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`Not a directory: ${resolved}`);
    process.exit(1);
  }
  const config = loadConfig();
  if (config.project_roots.some((root) => path.resolve(root) === resolved)) {
    console.error(`Project root already trusted: ${resolved}`);
    process.exit(1);
  }
  config.project_roots.push(resolved);
  saveConfig(config);
  const discovered = projectsForConfig(config).length - config.projects.length;
  console.log(`Trusted project root ${resolved} (${discovered} auto-discovered projects total)`);
}

async function cmdAddProject(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));
  const projectPath = positional[0];
  if (!projectPath) usage();
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`Not a directory: ${resolved}`);
    process.exit(1);
  }
  const getFlag = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const config = loadConfig();
  const id = getFlag("--id") ?? slugify(path.basename(resolved));
  const name = getFlag("--name") ?? path.basename(resolved);
  if (config.projects.some((p) => p.id === id)) {
    console.error(`A project with id "${id}" already exists. Use --id to pick another.`);
    process.exit(1);
  }
  if (config.projects.some((p) => p.path === resolved)) {
    console.error(`Path already registered: ${resolved}`);
    process.exit(1);
  }
  config.projects.push({ id, name, path: resolved, allowed_actions: [] });
  saveConfig(config);
  console.log(`Added project "${name}" (id: ${id}) at ${resolved}`);
}

async function cmdInstallService(): Promise<void> {
  if (process.platform !== "darwin") {
    console.error("install-service supports macOS (launchd) only.");
    process.exit(1);
  }
  loadConfig(); // fail early if not initialized
  const here = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.join(here, "..", "templates", "com.runtimebrief.daemon.plist");
  const template = fs.readFileSync(templatePath, "utf8");
  const nodeBin = process.execPath;
  const cliPath = fileURLToPath(import.meta.url);
  const logDir = path.join(configDir(), "logs");
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const plist = template
    .replaceAll("__NODE__", nodeBin)
    .replaceAll("__CLI__", cliPath)
    .replaceAll("__LOG_DIR__", logDir)
    .replaceAll("__HOME__", os.homedir());
  const dest = path.join(os.homedir(), "Library", "LaunchAgents", "com.runtimebrief.daemon.plist");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, plist, { mode: 0o644 });
  try {
    execFileSync("launchctl", ["unload", dest], { stdio: "ignore" });
  } catch {
    // not loaded yet — fine
  }
  execFileSync("launchctl", ["load", dest], { stdio: "inherit" });
  console.log(`Installed and loaded ${dest}`);
  console.log(`Logs: ${logDir}/runtimebriefd.{out,err}.log`);
  console.log(
    "Analyst: install Codex CLI separately and run `codex login` with ChatGPT. " +
      "RuntimeBrief does not copy Codex credentials into the LaunchAgent.",
  );
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "init":
      return cmdInit();
    case "start":
      return cmdStart(rest);
    case "status":
      return cmdStatus();
    case "add-project":
      return cmdAddProject(rest);
    case "add-project-root":
      return cmdAddProjectRoot(rest);
    case "install-service":
      return cmdInstallService();
    case "mcp":
      return cmdMcp();
    default:
      usage();
  }
}

// Run when invoked directly (not when imported by tests). realpath so the
// check also holds behind the bin symlink npm link/install creates.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
