import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const bundledCodex = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
export function resolveAgentBinary(provider: "codex" | "cursor"): string {
  const configured = process.env[provider === "codex" ? "RUNTIMEBRIEF_CODEX_BINARY" : "RUNTIMEBRIEF_CURSOR_BINARY"];
  if (configured) return configured;
  const candidates = provider === "codex"
    ? [configured, bundledCodex, "/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
    : [configured, path.join(os.homedir(), ".local/bin/cursor-agent"), "/opt/homebrew/bin/cursor-agent", "/usr/local/bin/cursor-agent"];
  return candidates.find((value): value is string => !!value && fs.existsSync(value)) ?? (provider === "codex" ? "/opt/homebrew/bin/codex" : path.join(os.homedir(), ".local/bin/cursor-agent"));
}
