import { spawn } from "node:child_process";
import readline from "node:readline";
import { MODEL_ID, type AgentModel } from "./types.js";

/** Initialize native SDK discovery without sending a prompt or starting a model turn. */
export function discoverClaudeModels(binary: string, cwd?: string): Promise<AgentModel[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"], { ...(cwd ? { cwd } : {}), stdio: ["pipe", "pipe", "ignore"] });
    const lines = readline.createInterface({ input: child.stdout });
    let settled = false;
    const finish = (models?: AgentModel[]) => {
      if (settled) return; settled = true;
      clearTimeout(timer); lines.close(); child.stdin.destroy(); child.kill();
      if (models?.length) resolve(models); else reject(Error("Native model catalog unavailable"));
    };
    const timer = setTimeout(() => finish(), 10000);
    child.on("error", () => finish()); child.on("exit", () => finish()); child.stdin.on("error", () => finish());
    lines.on("line", line => {
      try {
        const result = JSON.parse(line);
        if (result.type !== "control_response" || result.response?.request_id !== "runtimebrief-models") return;
        const models = result.response.response?.models as { value: string; displayName: string; supportedEffortLevels?: string[] }[] | undefined;
        finish(models?.filter(value => value.value !== "default" && MODEL_ID.test(value.value)).map(value => ({ id: value.value, label: value.displayName, reasoningEfforts: value.supportedEffortLevels ?? [] })));
      } catch { /* Ignore native notifications; never expose account metadata. */ }
    });
    child.stdin.write(JSON.stringify({ type: "control_request", request_id: "runtimebrief-models", request: { subtype: "initialize" } }) + "\n");
  });
}
