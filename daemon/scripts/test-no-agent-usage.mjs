// Loaded by npm test before Vitest or any of its workers. Mocks can replace
// these functions, but an accidental call to an installed agent fails closed.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { promisify } from 'node:util';

export function assertMockCommand(command, args = []) {
  const name = path.basename(String(command));
  const provider = /^(?:claude|codex|cursor-agent|agent|t)$/.test(name);
  // Temporary fake executables are permitted; installed clients are not.
  let actual = String(command);
  try { actual = fs.realpathSync(actual); } catch {}
  const temporaryRoots = [os.tmpdir(), '/tmp'].map(root => { try { return fs.realpathSync(root); } catch { return root; } });
  const fixture = path.isAbsolute(actual) && temporaryRoots.some(root => actual.startsWith(path.resolve(root) + path.sep));
  const nativeOwner = args.some(value => /(?:^|[/\\])native-session\.mjs$/.test(String(value)));
  if ((provider && !fixture) || nativeOwner) {
    throw Error('Model usage is disabled in ordinary tests. Inject a mock; use release-agent-smoke.mjs --live only for a release.');
  }
}

for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[method];
  childProcess[method] = function(command, args, ...rest) {
    assertMockCommand(command, Array.isArray(args) ? args : []);
    return original.call(this, command, args, ...rest);
  };
  if (original[promisify.custom]) childProcess[method][promisify.custom] = function(command, args, ...rest) {
    assertMockCommand(command, Array.isArray(args) ? args : []);
    return original[promisify.custom].call(this, command, args, ...rest);
  };
}
// Prevent shell wrappers from evading the same budget policy.
for (const method of ['exec', 'execSync']) {
  const original = childProcess[method];
  childProcess[method] = function(command, ...rest) {
    if (/(?:^|[\s;&|/])(?:claude|codex|cursor-agent|agent|t)(?:\s|$)/.test(String(command))) {
      throw Error('Agent shell commands are disabled in ordinary tests. Inject a mock.');
    }
    return original.call(this, command, ...rest);
  };
}
syncBuiltinESMExports();
const preload = `--import=${import.meta.url}`;
if (!process.env.NODE_OPTIONS?.includes(preload)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} ${preload}`.trim();
