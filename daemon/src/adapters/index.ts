import type { RuntimeAdapter } from "../types.js";
import { FilesystemGitAdapter } from "./filesystemGit.js";
import { ClaudeCodeSessionsAdapter } from "./claudeCodeSessions.js";
import { OpenClawAdapter } from "./openClaw.js";
import { CodexSessionsAdapter } from "./codexSessions.js";
import { CursorSessionsAdapter } from "./cursorSessions.js";

export function defaultAdapters(): RuntimeAdapter[] {
  return [
    new FilesystemGitAdapter(),
    new ClaudeCodeSessionsAdapter(),
    new CodexSessionsAdapter(),
    new CursorSessionsAdapter(),
    // Stub — never matches yet; see the TODO in the file.
    new OpenClawAdapter(),
  ];
}
