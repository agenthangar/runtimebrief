import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { configDir } from "../config.js";
import { ensurePrivateDirectory } from "../privateData.js";

export const T_COMMIT = "1643729085f647edc715353919e6b05baa61fce5";
export const T_ARCHIVE_SHA256 = "aa653e8b043964904fda5a7fd925fce789cd87c7053e005a7479a954cc9b5743";
export const tDependencyRoot = (root = configDir()) => path.join(root, "tools", "t", T_COMMIT);
const exec = promisify(execFile);

export function hasPinnedT(root = tDependencyRoot()): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "runtimebrief-install.json"), "utf8"));
    return manifest.commit === T_COMMIT && manifest.sha256 === T_ARCHIVE_SHA256
      && fs.lstatSync(path.join(root, "t.plugin.zsh")).isFile();
  } catch { return false; }
}

/** Install a verified, immutable upstream archive into RuntimeBrief's private tools directory. */
export async function installPinnedT(root = tDependencyRoot()): Promise<void> {
  if (hasPinnedT(root)) return;
  if (fs.existsSync(root)) throw new Error("The t dependency directory is incomplete. Move it aside before reinstalling.");
  ensurePrivateDirectory(path.dirname(root));
  const staging = fs.mkdtempSync(path.join(path.dirname(root), ".install-"));
  try {
    const response = await fetch(`https://codeload.github.com/agenthangar/t/tar.gz/${T_COMMIT}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) throw new Error("Could not download the pinned t dependency.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) throw new Error("Unexpected t archive size.");
      chunks.push(chunk);
    }
    const archive = Buffer.concat(chunks);
    if (createHash("sha256").update(archive).digest("hex") !== T_ARCHIVE_SHA256) {
      throw new Error("The t dependency checksum did not match. Nothing was installed.");
    }
    const file = path.join(staging, "t.tar.gz");
    const tree = path.join(staging, "tree");
    fs.writeFileSync(file, archive, { mode: 0o600 });
    ensurePrivateDirectory(tree);
    await exec("/usr/bin/tar", ["-xzf", file, "--strip-components=1", "-C", tree], { timeout: 10_000 });
    fs.writeFileSync(path.join(tree, "runtimebrief-install.json"), JSON.stringify({ commit: T_COMMIT, sha256: T_ARCHIVE_SHA256 }), { mode: 0o600 });
    if (!hasPinnedT(tree)) throw new Error("The t archive did not contain the expected shell entry point.");
    fs.renameSync(tree, root);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
