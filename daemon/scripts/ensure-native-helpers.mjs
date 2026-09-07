import { chmodSync, existsSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// node-pty 1.1.0's macOS prebuild includes a helper without its executable bit.
// Fix the installed package at install/build time, never while serving a request.
if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("node-pty/package.json"));
  for (const relative of [`prebuilds/darwin-${process.arch}/spawn-helper`, "build/Release/spawn-helper"]) {
    const file = path.join(root, relative);
    if (!existsSync(file)) continue;
    if (!lstatSync(file).isFile()) throw new Error("Unexpected native helper target");
    chmodSync(file, 0o755);
  }
}
