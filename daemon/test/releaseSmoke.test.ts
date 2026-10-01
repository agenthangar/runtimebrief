import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from './helpers.js';
// The runner is intentionally plain Node code so release usage cannot depend
// on Vitest configuration or enable live turns during an ordinary suite.
// @ts-expect-error JavaScript release helper
import { runReleaseSmoke, runCommand, providerArgs, parseProviderOutput, releaseProjectName } from '../scripts/release-agent-smoke.mjs';
// @ts-expect-error JavaScript test preload
import { assertMockCommand } from '../scripts/test-no-agent-usage.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = tmpdir('release-budget'); roots.push(root);
  fs.mkdirSync(path.join(root, releaseProjectName, '.git'), { recursive: true });
  return root;
}

describe('release agent quota policy', () => {
  it('closes client stdin before waiting for a response', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write("MOCK_STDIN_CLOSED"))'], { timeout: 2000 });
    expect(result.stdout).toBe('MOCK_STDIN_CLOSED');
  });
  it('uses mocks by default and performs no commands or writes', async () => {
    const root = fixture(), run = vi.fn();
    const result = await runReleaseSmoke({ stateRoot: root, run });
    expect(result.mode).toBe('mock');
    expect(run).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'receipts'))).toBe(false);
  });
  it('reserves one session per provider and reuses receipts on retries', async () => {
    const root = fixture();
    const run = vi.fn(async () => ({ stdout: JSON.stringify({ session_id: 'fixture-session', result: 'RUNTIMEBRIEF_RELEASE_OK', modelUsage: { 'claude-haiku-4-5-20251001': {} } }) }));
    const first = await runReleaseSmoke({ live: true, release: '30', stateRoot: root, run });
    const second = await runReleaseSmoke({ live: true, release: '30', stateRoot: root, run });
    expect(run).toHaveBeenCalledTimes(3);
    expect(first.results.every((item: any) => item.state === 'passed')).toBe(true);
    expect(second.results.every((item: any) => item.reused && item.sessionId === 'fixture-session')).toBe(true);
    for (const call of run.mock.calls as any[]) expect(path.basename(call[2].cwd)).toBe('RuntimeBrief release tests');
    expect(run.mock.calls.map((call: any) => call[0])).toEqual(['codex', 'claude', 'cursor-agent']);
    expect(first.results.map((item: any) => item.model)).toEqual(['gpt-6-luna', 'claude-haiku-4-5-20251001', 'composer-2.5']);
  });
  it('consumes the reservation after an uncertain failure and concurrent retry', async () => {
    const root = fixture();
    const run = vi.fn(async () => { throw Error('Uncertain timeout'); });
    const results = await Promise.all([1, 2].map(() => runReleaseSmoke({ live: true, release: '30', stateRoot: root, run })));
    expect(run).toHaveBeenCalledTimes(3);
    expect(results.flatMap(result => result.results).every((item: any) => ['reserved', 'needs_inspection'].includes(item.state))).toBe(true);
    await runReleaseSmoke({ live: true, release: '30', stateRoot: root, run });
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('pins inexpensive models without fallback or bypass settings', () => {
    const codex = providerArgs('codex', 'fixture', '/fixture');
    expect(codex).toContain('model_reasoning_effort="low"');
    expect(providerArgs('claude', 'fixture', '/fixture')).toContain('claude-haiku-4-5-20251001');
    expect(providerArgs('cursor', 'fixture', '/fixture')).toContain('composer-2.5');
    for (const provider of ['codex', 'claude', 'cursor']) {
      expect(providerArgs(provider, 'fixture', '/fixture')).not.toContain('--force');
      expect(providerArgs(provider, 'fixture', '/fixture')).not.toContain('--dangerously-skip-permissions');
    }
  });
  it('requires an actual completed answer and accepts JSON or JSONL receipts', () => {
    expect(parseProviderOutput('cursor', JSON.stringify({ session_id: 'fixture', result: 'RUNTIMEBRIEF_RELEASE_OK' }, null, 2), null)).toEqual({ sessionId: 'fixture', passed: true });
    expect(parseProviderOutput('codex', '{"type":"thread.started","thread_id":"fixture"}\n{"type":"item.completed","item":{"type":"agent_message","text":"RUNTIMEBRIEF_RELEASE_OK"}}', null)).toEqual({ sessionId: 'fixture', passed: true });
    expect(parseProviderOutput('codex', '{"thread_id":"fixture","prompt":"RUNTIMEBRIEF_RELEASE_OK"}', null).passed).toBe(false);
    expect(parseProviderOutput('claude', '{"session_id":"fixture","result":"RUNTIMEBRIEF_RELEASE_OK","is_error":true}', null).passed).toBe(false);
    expect(parseProviderOutput('claude', '{"session_id":"fixture","result":"RUNTIMEBRIEF_RELEASE_OK","modelUsage":{"claude-sonnet-5-5":{}}}', null).passed).toBe(false);
    expect(parseProviderOutput('claude', '{"session_id":"fixture","result":"RUNTIMEBRIEF_RELEASE_OK","modelUsage":{"claude-haiku-4-5-20251001":{}}}', null).passed).toBe(true);
  });
  it('blocks installed agent and native worker subprocesses in ordinary tests', () => {
    for (const binary of ['codex', 'claude', 'cursor-agent', '/usr/local/bin/codex']) expect(() => assertMockCommand(binary)).toThrow('Model usage is disabled');
    expect(() => assertMockCommand(process.execPath, ['/fixture/native-session.mjs'])).toThrow();
    expect(() => assertMockCommand('git')).not.toThrow();
  });
});
