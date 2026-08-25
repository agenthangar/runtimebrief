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

const commandNames = [
  "init",
  "start",
  "status",
  "add-project",
  "add-project-root",
  "install-service",
  "mcp",
] as const;

type CommandName = (typeof commandNames)[number];

const commandHelp: Record<CommandName, string> = {
  init: `Usage:
  runtimebriefd init

Scaffold RuntimeBrief's local configuration and generate an authentication
token. The token is printed once; only its hash is stored on disk.`,
  start: `Usage:
  runtimebriefd start [--i-know-what-im-doing]

Start the RuntimeBrief daemon in the foreground.

Options:
  --i-know-what-im-doing  Allow a non-loopback server host from the config
  -h, --help              Show this help`,
  status: `Usage:
  runtimebriefd status

Check whether the configured RuntimeBrief daemon is reachable.`,
  "add-project": `Usage:
  runtimebriefd add-project <path> [--id <id>] [--name <name>]

Register one project directory.

Options:
  --id <id>      Stable project identifier (defaults to the directory name)
  --name <name>  Display name (defaults to the directory name)
  -h, --help     Show this help`,
  "add-project-root": `Usage:
  runtimebriefd add-project-root <path>

Trust a directory and auto-discover its direct child Git repositories.`,
  "install-service": `Usage:
  runtimebriefd install-service

Install and load RuntimeBrief as a per-user launchd service on macOS.`,
  mcp: `Usage:
  runtimebriefd mcp

Serve RuntimeBrief tools over MCP stdio.`,
};

function generalHelp(): string {
  return `runtimebriefd ${VERSION} — RuntimeBrief daemon

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

Options:
  -h, --help                           Show help
  --version                            Show the RuntimeBrief version

Run \`runtimebriefd help <command>\` for command-specific help.

Config: ${configPath()}`;
}

function isCommand(value: string): value is CommandName {
  return (commandNames as readonly string[]).includes(value);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error("Run `runtimebriefd --help` for usage.");
  process.exit(1);
}

function failWithGeneralHelp(): never {
  console.log(generalHelp());
  process.exit(1);
}

function rejectUnexpected(command: CommandName, args: string[]): void {
  if (args.length === 0) return;
  const arg = args[0]!;
  if (arg.startsWith("-")) {
    fail(`Unknown option for ${command}: ${arg}`);
  }
  fail(`Unexpected argument for ${command}: ${arg}`);
}

function parseStartArgs(args: string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === "--i-know-what-im-doing") return true;
  if (
    args[0] === "--i-know-what-im-doing" &&
    args[1] === "--i-know-what-im-doing"
  ) {
    fail("Option may only be specified once: --i-know-what-im-doing");
  }
  if (args[0] === "--i-know-what-im-doing") {
    const extra = args[1]!;
    if (extra.startsWith("-")) fail(`Unknown option for start: ${extra}`);
    fail(`Unexpected argument for start: ${extra}`);
  }
  rejectUnexpected("start", args);
  return false;
}

interface AddProjectArgs {
  projectPath: string;
  id?: string;
  name?: string;
}

function parseAddProjectArgs(args: string[]): AddProjectArgs {
  let projectPath: string | undefined;
  let id: string | undefined;
  let name: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--id" || arg === "--name") {
      const label = arg === "--id" ? "id" : "name";
      if ((label === "id" ? id : name) !== undefined) {
        fail(`Option may only be specified once: ${arg}`);
      }
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        fail(`Option ${arg} requires a value`);
      }
      if (label === "id") id = value;
      else name = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      fail(`Unknown option for add-project: ${arg}`);
    }
    if (projectPath !== undefined) {
      fail(`Unexpected argument for add-project: ${arg}`);
    }
    projectPath = arg;
  }

  if (!projectPath) {
    fail("Missing required <path> for add-project");
  }
  return {
    projectPath,
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
  };
}

function parseProjectRootArgs(args: string[]): string {
  if (args.length === 0) {
    fail("Missing required <path> for add-project-root");
  }
  if (args[0]!.startsWith("-")) {
    fail(`Unknown option for add-project-root: ${args[0]}`);
  }
  if (args.length > 1) {
    const extra = args[1]!;
    if (extra.startsWith("-")) {
      fail(`Unknown option for add-project-root: ${extra}`);
    }
    fail(`Unexpected argument for add-project-root: ${extra}`);
  }
  return args[0]!;
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
    `Only a hash is stored on disk. Next: add a project or project root, then run runtimebriefd install-service.`,
  );
}

async function cmdStart(allowAll: boolean): Promise<void> {
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
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "project";
}

async function cmdAddProjectRoot(rootPath: string): Promise<void> {
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

async function cmdAddProject(args: AddProjectArgs): Promise<void> {
  const projectPath = args.projectPath;
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`Not a directory: ${resolved}`);
    process.exit(1);
  }
  const config = loadConfig();
  const id = args.id ?? slugify(path.basename(resolved));
  const name = args.name ?? path.basename(resolved);
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
  if (!command) failWithGeneralHelp();

  if (command === "--help" || command === "-h") {
    if (rest.length > 0) fail(`Unexpected argument for ${command}: ${rest[0]}`);
    console.log(generalHelp());
    return;
  }
  if (command === "--version") {
    if (rest.length > 0) fail(`Unexpected argument for --version: ${rest[0]}`);
    console.log(VERSION);
    return;
  }
  if (command === "help") {
    if (rest.length === 0) {
      console.log(generalHelp());
      return;
    }
    const [helpCommand, ...extra] = rest;
    if (!helpCommand || !isCommand(helpCommand)) {
      fail(`Unknown command: ${helpCommand ?? ""}`);
    }
    if (extra.length > 0) fail(`Unexpected argument for help: ${extra[0]}`);
    console.log(commandHelp[helpCommand]);
    return;
  }
  if (!isCommand(command)) {
    if (command.startsWith("-")) fail(`Unknown option: ${command}`);
    fail(`Unknown command: ${command}`);
  }
  if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
    console.log(commandHelp[command]);
    return;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    fail(`The help option for ${command} must be used by itself`);
  }

  switch (command) {
    case "init":
      rejectUnexpected(command, rest);
      return cmdInit();
    case "start":
      return cmdStart(parseStartArgs(rest));
    case "status":
      rejectUnexpected(command, rest);
      return cmdStatus();
    case "add-project":
      return cmdAddProject(parseAddProjectArgs(rest));
    case "add-project-root":
      return cmdAddProjectRoot(parseProjectRootArgs(rest));
    case "install-service":
      rejectUnexpected(command, rest);
      return cmdInstallService();
    case "mcp":
      rejectUnexpected(command, rest);
      return cmdMcp();
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
