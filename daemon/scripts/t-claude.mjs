// Launched inside t's pane by a private executable named `claude`.
// The initial prompt is one native argv argument, never terminal input or shell code.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const file = process.env.RB_T_CONFIG;
if (!file) throw new Error("Missing launch payload");
const directory = path.dirname(file);
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
const position = args.indexOf("--session-id");
const sessionId = args[position + 1];
if (position < 0 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sessionId ?? "")) {
  throw new Error("t did not assign a session identity");
}
// The exclusive marker fences every attempted dispatch, including spawn failures.
fs.writeFileSync(path.join(directory, "native.json"), JSON.stringify({ sessionId, cwd: fs.realpathSync(process.cwd()) }), { flag: "wx", mode: 0o600 });
fs.unlinkSync(file);
const child = spawn(payload.binary, [
  ...args, "--name", payload.name, "--permission-mode", payload.permissionMode,
  ...(payload.model === "default" ? [] : ["--model", payload.model]),
  ...(payload.reasoningEffort && payload.reasoningEffort !== "default" ? ["--effort", payload.reasoningEffort] : []),
  ...(payload.remoteControl ? ["--remote-control", payload.name] : ["--settings", '{"remoteControlAtStartup":false,"disableRemoteControl":true}']),
  "--", payload.prompt,
], { stdio: "inherit", env: { ...process.env, ...(payload.reasoningEffort && payload.reasoningEffort !== "default" ? { CLAUDE_CODE_EFFORT_LEVEL: payload.reasoningEffort } : {}) } });
function finished(code, spawnFailed = false) {
  fs.writeFileSync(path.join(directory, "exit.json"), JSON.stringify({ code, spawnFailed }), { mode: 0o600 });
  process.exit(code ?? 1);
}
child.once("error", () => finished(1, true));
child.once("exit", code => finished(code));
