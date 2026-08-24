import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "./helpers.js";

describe("installed CLI entrypoint", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes the built bin wrapper through an npm-style symlink", () => {
    const daemonRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const builtBin = path.join(daemonRoot, "dist", "bin.js");
    expect(fs.existsSync(builtBin), "pretest must build dist/bin.js").toBe(true);
    expect(fs.statSync(builtBin).mode & 0o111).not.toBe(0);

    const installRoot = tmpdir("installed-bin");
    roots.push(installRoot);
    const linkedBin = path.join(installRoot, "runtimebriefd");
    fs.symlinkSync(builtBin, linkedBin);
    // Execute the installed symlink as Node's script argument. This exercises
    // module resolution and the unconditional bin wrapper without depending
    // on platform-specific shebang handling in the test runner.
    const result = spawnSync(process.execPath, [linkedBin], {
      encoding: "utf8",
      env: {
        ...process.env,
        RUNTIMEBRIEF_CONFIG_DIR: path.join(installRoot, "config"),
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("runtimebriefd 0.1.0");
    expect(result.stdout).toContain("Usage:");
  });
});
