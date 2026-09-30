import { NATIVE_PERMISSION_MODES, type SessionProvider } from "./types.js";

/** Explicit UI selections map to native policy flags; Manual remains the default. */
export function nativeSessionArgs(provider: Exclude<SessionProvider, "claude">, model: string, mode: string): string[] {
  if (!(NATIVE_PERMISSION_MODES[provider] as readonly string[]).includes(mode)) throw Error("Unsupported native permission mode");
  const args = model === "default" ? [] : ["--model", model];
  if (provider === "cursor") {
    if (mode === "plan" || mode === "ask") args.push("--mode", mode);
    if (mode === "auto") args.push("--auto-review");
    if (mode === "bypassPermissions") args.push("--force", "--sandbox", "disabled");
  } else if (mode === "bypassPermissions") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (mode === "auto") {
    args.push("--approve-for-me");
  } else {
    args.push("--sandbox", mode === "plan" ? "read-only" : "workspace-write", "--ask-for-approval", mode === "dontAsk" ? "never" : "on-request");
  }
  return args;
}
