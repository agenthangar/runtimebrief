// Native interactive CLI in an owned PTY. Remote input can never reach t's shell.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";
import pty from "node-pty";
import { nativeSessionArgs } from "../dist/launches/nativeOptions.js";
import { parseTerminalInput } from "../dist/launches/terminalInput.js";

process.umask(0o077);
const file = process.env.RB_T_CONFIG;
const directory = path.dirname(file);
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
const cwd = fs.realpathSync(process.cwd());
const socket = `/tmp/rb-terminal-${path.basename(directory)}.sock`;
// Exclusive dispatch marker: no retry can launch a second process.
fs.writeFileSync(path.join(directory, "runner.json"), JSON.stringify({ cwd, pane: process.env.TMUX_PANE, token: payload.token, socket }), { flag: "wx", mode: 0o600 });
fs.unlinkSync(file);
let child, active = false, listening = false, writing = false;
const server = net.createServer({ allowHalfOpen: true }, connection => {
  let buffer = "", handled = false, ownsWrite = false;
  connection.setTimeout(3000, () => connection.destroy());
  connection.on("data", async bytes => {
    if (handled) return;
    buffer += bytes;
    if (buffer.length > 40_000) return connection.destroy();
    if (!buffer.endsWith("\n")) return;
    handled = true;
    try {
      const request = JSON.parse(buffer);
      if (request.token !== payload.token || !active) return connection.end('{"live":false}\n');
      if (request.data !== undefined) {
        if (writing) return connection.end('{"live":true,"accepted":false}\n');
        writing = ownsWrite = true;
        const input = parseTerminalInput(request.data);
        if (!input) return connection.destroy();
        if ("text" in input) {
          // TUIs treat text plus Enter in one write as a paste, not submission.
          // This intentional input goes only to the owned native CLI, never a shell.
          child.write("\u001b[200~" + input.text + "\u001b[201~");
          if (input.submit) {
            await new Promise(resolve => setTimeout(resolve, 150));
            if (!active) return connection.end('{"live":false}\n');
            child.write("\r");
          }
        } else child.write(input.key);
      }
      connection.end(JSON.stringify({ live: true, accepted: request.data !== undefined, pid: child.pid }) + "\n");
    } catch { connection.destroy(); } finally { if (ownsWrite) writing = false; }
  });
});
function finish(code, spawnFailed = false) {
  active = false;
  fs.writeFileSync(path.join(directory, "exit.json"), JSON.stringify({ code, spawnFailed }), { mode: 0o600 });
  server.close();
  if (listening) try { fs.unlinkSync(socket); } catch {}
  process.exit(code ?? 1);
}
const env = { ...process.env, TERM: "xterm-256color" };
for (const key of ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "CODEX_HOME"]) {
  const original = payload.nativeDirectories?.[key];
  if (original) env[key] = original; else delete env[key];
  delete env[`RB_T_NATIVE_${key}`];
}
delete env.RB_T_CONFIG;
try {
  const args = nativeSessionArgs(payload.provider, payload.model, payload.permissionMode, payload.reasoningEffort);
  if (payload.provider === "cursor") {
    // Cursor assigns the ID itself. Starting that empty chat is not a history replay.
    const sessionId = execFileSync(payload.binary, ["create-chat"], { cwd, env, timeout: 30000, encoding: "utf8" }).trim();
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sessionId)) throw Error("No native ID");
    fs.writeFileSync(path.join(directory, "native.json"), JSON.stringify({ sessionId, cwd }), { flag: "wx", mode: 0o600 });
    args.push("--resume", sessionId);
  }
  args.push("--", payload.prompt);
  child = pty.spawn(payload.binary, args, { cwd, env, cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 });
  active = true;
  child.onData(data => process.stdout.write(data));
  child.onExit(({ exitCode }) => finish(exitCode));
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on("data", bytes => { if (active) child.write(bytes.toString()); });
  process.on("SIGWINCH", () => child.resize(process.stdout.columns || 80, process.stdout.rows || 24));
  process.on("SIGTERM", () => child.kill());
  server.on("error", () => { child.kill(); finish(1, true); });
  server.listen(socket, () => { listening = true; fs.chmodSync(socket, 0o600); });
} catch { finish(1, true); }
