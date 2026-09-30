import { NATIVE_PERMISSION_MODES, type SessionProvider } from "./types.js";

/** Explicit UI selections map to native policy flags; Manual remains the default. */
export function nativeSessionArgs(provider: Exclude<SessionProvider, "claude">, model: string, mode: string, reasoningEffort = "default"): string[] {
  if (!(NATIVE_PERMISSION_MODES[provider] as readonly string[]).includes(mode)) throw Error("Unsupported native permission mode");
  if (provider === "cursor" && reasoningEffort !== "default") model = model.replace(/-(none|minimal|low|medium|high|xhigh|max)(-fast)?$/, `-${reasoningEffort}$2`);
  const args = model === "default" ? [] : ["--model", model];
  if (provider === "codex" && reasoningEffort !== "default") args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
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
