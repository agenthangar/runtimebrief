#!/usr/bin/env node
// Native CLI release smoke. Mocked by default; each explicit live release
// reserves one session per provider before invoking it, including failures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
// exec/print clients read piped stdin even when a prompt argument is supplied.
// Close it so they can begin, instead of waiting until the test timeout.
export function runCommand(binary, args, options) {
  const pending = exec(binary, args, options);
  pending.child.stdin.end();
  return pending;
}
export const releaseProjectName = 'RuntimeBrief release tests';
export const releaseModels = { codex: 'gpt-6-luna', claude: 'claude-haiku-4-5-20251001', cursor: 'composer-2.5' };
const marker = 'RUNTIMEBRIEF_RELEASE_OK';
const prompt = `Do not run tools, call other agents, read files, or change anything. Reply exactly ${marker}.`;

export function providerArgs(provider, sessionID, cwd) {
  if (provider === 'codex') return ['exec', '--ignore-user-config', '--model', releaseModels.codex, '-c', 'model_reasoning_effort="low"', '--sandbox', 'read-only', '--json', prompt];
  if (provider === 'claude') return ['--print', '--model', releaseModels.claude, '--permission-mode', 'plan', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--session-id', sessionID, '--name', releaseProjectName, '--output-format', 'json', prompt];
  if (provider === 'cursor') return ['--print', '--model', releaseModels.cursor, '--mode', 'ask', '--workspace', cwd, '--trust', '--output-format', 'json', prompt];
  throw Error('Unknown release provider');
}

export function parseProviderOutput(provider, output, fallback) {
  let records;
  try { records = [JSON.parse(output)]; }
  catch { records = output.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  const record = records.find(data => typeof (data.session_id ?? data.sessionId ?? data.thread_id) === 'string');
  const sessionId = record?.session_id ?? record?.sessionId ?? record?.thread_id ?? (provider === 'claude' ? fallback : null);
  const passed = records.some(data => data.is_error !== true && (
    typeof data.result === 'string' && data.result.trim() === marker ||
    data.type === 'item.completed' && data.item?.type === 'agent_message' && data.item.text?.trim() === marker
  ) && (provider !== 'claude' || Object.keys(data.modelUsage ?? {}).length > 0 && Object.keys(data.modelUsage).every(model => model.startsWith('claude-haiku-4-5'))));
  return { sessionId, passed: passed && !!sessionId };
}

export async function runReleaseSmoke({ live = false, release, stateRoot = path.join(os.homedir(), '.runtimebrief', 'release-tests'), run = runCommand } = {}) {
  if (!live) return { mode: 'mock', project: releaseProjectName, results: Object.entries(releaseModels).map(([provider, model]) => ({ provider, model, reasoning: provider === 'codex' ? 'low' : 'native', state: 'mocked' })) };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(release ?? '')) throw Error('Live checks require --release <build-number>.');
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const cwd = path.join(stateRoot, releaseProjectName);
  fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    await run('git', ['init', '-b', 'main', cwd]);
    fs.writeFileSync(path.join(cwd, 'README.md'), '# RuntimeBrief release tests\n\nDisposable native CLI release checks. No product data.\n', { mode: 0o600 });
    await run('git', ['-C', cwd, 'add', 'README.md']);
    // Uses the operator's configured Git identity; no fabricated identity.
    await run('git', ['-C', cwd, 'commit', '-m', 'Initialize RuntimeBrief release tests']);
  }
  const ledger = path.join(stateRoot, 'receipts', release);
  fs.mkdirSync(ledger, { recursive: true, mode: 0o700 });
  const results = [];
  for (const provider of ['codex', 'claude', 'cursor']) {
    const file = path.join(ledger, `${provider}.json`);
    const receipt = { release, provider, model: releaseModels[provider], reasoning: provider === 'codex' ? 'low' : 'native', project: releaseProjectName, sessionId: null, state: 'reserved' };
    try { fs.writeFileSync(file, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      results.push({ ...JSON.parse(fs.readFileSync(file, 'utf8')), reused: true });
      continue;
    }
    const id = randomUUID();
    if (provider === 'claude') receipt.sessionId = id;
    // Reserve before any command. A timeout, failed invocation, or concurrent
    // rerun must never authorize another session for this provider/build.
    fs.writeFileSync(file, JSON.stringify(receipt), { mode: 0o600 });
    try {
      const { stdout } = await run(provider === 'cursor' ? 'cursor-agent' : provider, providerArgs(provider, id, cwd), { cwd, timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
      fs.writeFileSync(path.join(ledger, `${provider}-output.jsonl`), stdout, { mode: 0o600 });
      const parsed = parseProviderOutput(provider, stdout, id);
      receipt.sessionId = parsed.sessionId;
      receipt.state = parsed.passed ? 'passed' : 'needs_inspection';
    } catch (error) {
      // Keep partial output private so an uncertain session can be inspected
      // and resumed by its native ID, without creating a replacement.
      const stdout = typeof error.stdout === 'string' ? error.stdout : '';
      receipt.sessionId = parseProviderOutput(provider, stdout, id).sessionId;
      fs.writeFileSync(path.join(ledger, `${provider}-output.jsonl`), stdout, { mode: 0o600 });
      fs.writeFileSync(path.join(ledger, `${provider}-error.txt`), typeof error.stderr === 'string' ? error.stderr : 'Invocation failed before a response was confirmed.', { mode: 0o600 });
      receipt.state = 'needs_inspection';
    }
    fs.writeFileSync(file, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    results.push(receipt);
  }
  return { mode: 'live', project: releaseProjectName, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(value => !['--live', '--mock', '--release'].includes(value) && value !== args[args.indexOf('--release') + 1])) throw Error('Usage: release-agent-smoke.mjs [--mock | --live --release <build-number>]');
  const result = await runReleaseSmoke({ live: args.includes('--live'), release: args[args.indexOf('--release') + 1] });
  console.log(JSON.stringify(result, null, 2));
  if (result.results.some(item => !['passed', 'mocked'].includes(item.state))) process.exitCode = 1;
}
