// One detached owner per receipt. Native protocols and identities remain provider-owned.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import readline from 'node:readline';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import * as pty from 'node-pty';
import { NativeCodexSession } from '../dist/launches/nativeCodex.js';

const directory = process.argv[2];
const payloadFile = path.join(directory, 'payload.json');
const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
fs.writeFileSync(path.join(directory, 'claimed'), '', { flag: 'wx', mode: 0o600 });
fs.unlinkSync(payloadFile);
const state = { cwd: payload.cwd, provider: payload.provider, sessionId: null, state: 'starting', message: 'Starting the native agent…', accepted: false, messages: [], requests: [], remoteURL: null, updatedAt: new Date().toISOString() };
const stateFile = path.join(directory, 'state.json');
const owner = { token: payload.token, socket: `/tmp/rb-native-${payload.id}.sock`, pid: process.pid, cwd: payload.cwd };
let child, codex, terminal, server, busy = false, sequence = 0, screen = '', ending = false;
const pending = new Map(), nativeRequests = new Map();
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
function save() {
  state.updatedAt = new Date().toISOString();
  state.messages = state.messages.slice(-200);
  let size = state.messages.reduce((total, value) => total + value.text.length, 0);
  while (size > 128000 && state.messages.length > 1) size -= state.messages.shift().text.length;
  fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(stateFile + '.tmp', stateFile);
}
function add(role, text, id = randomUUID(), append = false) {
  const previous = state.messages.find(value => value.id === id);
  if (previous && append) previous.text = (previous.text + text).slice(-24000);
  else if (!previous) state.messages.push({ id, role, text: String(text).slice(-24000) });
  save();
}
function failed(message) { state.state = 'failed'; state.message = message; save(); }
function finish(code) {
  if (ending) return; ending = true;
  for (const value of pending.values()) { clearTimeout(value.timer); value.reject(Error('Native process ended')); }
  pending.clear(); nativeRequests.clear(); state.requests = [];
  if (state.state !== 'failed') {
    state.state = code === 0 || code === null ? 'stopped' : 'failed';
    state.message = state.accepted ? 'The agent stopped. Its conversation is saved on your Mac.' : 'The agent stopped before accepting the task. Check its setup on your Mac.';
  }
  save(); server?.close();
  try { fs.unlinkSync(owner.socket); } catch {}
  process.exit(code === 0 ? 0 : 1);
}
function send(value) { if (codex) codex.send(value); else child.stdin.write(JSON.stringify(value) + '\n'); }
function request(method, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = timeout ? setTimeout(() => { pending.delete(id); reject(Error('Native request timed out')); }, timeout) : null;
    pending.set(id, { resolve, reject, timer }); send({ jsonrpc: '2.0', id, method, params });
  });
}
function nativeDecision(msg) {
  const p = msg.params ?? {}; const id = String(msg.id);
  let options = [], questions = [], title = 'Agent needs your input', body = '';
  if (payload.provider === 'cursor' && msg.method === 'session/request_permission') {
    title = p.toolCall?.title ?? 'Approve this action?'; body = JSON.stringify(p.toolCall?.rawInput ?? p.toolCall?.content ?? '');
    options = (p.options ?? []).map(o => ({ id: o.optionId, label: o.name }));
  } else if (msg.method === 'item/permissions/requestApproval') {
    title = 'Allow additional access?'; body = `${p.reason ?? ''}\n${JSON.stringify(p.permissions ?? {}, null, 2)}`;
    options = [{ id: 'grant', label: 'Allow for this turn' }, { id: 'deny', label: 'Reject' }];
  } else if (msg.method === 'item/commandExecution/requestApproval' || msg.method === 'item/fileChange/requestApproval') {
    title = msg.method.includes('fileChange') ? 'Approve file changes?' : 'Approve this command?';
    body = p.command ?? p.reason ?? JSON.stringify(p.changes ?? {});
    const offered = p.availableDecisions ?? ['accept', 'decline'];
    options = offered.filter(o => typeof o === 'string').map(o => ({ id: o, label: o === 'accept' ? 'Allow once' : o === 'acceptForSession' ? 'Allow for this session' : o === 'decline' ? 'Reject' : o }));
  } else if (msg.method === 'item/tool/requestUserInput') {
    questions = (p.questions ?? []).map(q => ({ id: q.id, prompt: q.question, options: (q.options ?? []).map(o => ({ id: o.label, label: o.label })) }));
  } else if (msg.method === 'cursor/ask_question') {
    title = p.title ?? title; questions = p.questions ?? [];
  } else if (msg.method === 'cursor/create_plan') {
    title = p.name ?? 'Approve this plan?'; body = p.plan ?? p.overview ?? '';
    options = [{ id: 'accepted', label: 'Accept plan' }, { id: 'rejected', label: 'Reject plan' }];
  } else {
    // Unsupported requests fail explicitly instead of silently approving a tool.
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Unsupported client request' } }); return;
  }
  if (busy) state.accepted = true;
  nativeRequests.set(id, msg);
  state.requests.push({ id, title, body: String(body).slice(0,16000), options, questions });
  state.state = 'needs_input'; state.message = questions.length ? 'The agent has a question.' : 'The agent needs your approval.'; save();
}
function event(msg) {
  if (msg.method && msg.id !== undefined) { nativeDecision(msg); return; }
  if (msg.id !== undefined) {
    const waiter = pending.get(msg.id); if (!waiter) return;
    clearTimeout(waiter.timer); pending.delete(msg.id);
    if (msg.error) waiter.reject(Error('Native request failed')); else waiter.resolve(msg.result);
    return;
  }
  const p = msg.params ?? {};
  if (payload.provider === 'codex') {
    if (p.threadId && state.sessionId && p.threadId !== state.sessionId) return;
    if (msg.method === 'turn/started') { busy = true; state.accepted = true; state.state = 'running'; state.message = 'Codex is working.'; save(); }
    if (msg.method === 'item/agentMessage/delta') add('assistant', p.delta ?? '', p.itemId, true);
    if (msg.method === 'item/started' && p.item?.type === 'commandExecution') add('tool', p.item.command ?? 'Running a command', p.item.id);
    if (msg.method === 'item/completed' && p.item?.type === 'agentMessage' && !state.messages.some(m => m.id === p.item.id)) add('assistant', p.item.text ?? '', p.item.id);
    if (msg.method === 'turn/completed') {
      busy = false; state.requests = []; nativeRequests.clear(); state.state = p.turn?.status === 'failed' ? 'failed' : p.turn?.status === 'interrupted' ? 'stopped' : 'completed';
      state.message = state.state === 'completed' ? 'Ready to review. Continue in Codex or here.' : 'This turn stopped. Review the conversation before continuing.'; save();
    }
    if (msg.method === 'serverRequest/resolved') { nativeRequests.delete(String(p.requestId)); state.requests = state.requests.filter(r => r.id !== String(p.requestId)); save(); }
  } else if (msg.method === 'session/update' && p.sessionId === state.sessionId) {
    const u = p.update ?? {};
    if (busy) { state.accepted = true; save(); }
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') add('assistant', u.content.text, `cursor-turn-${sequence}`, true);
    if (u.sessionUpdate === 'tool_call') add('tool', u.title ?? 'Using a tool', u.toolCallId);
  }
}
async function turn(text) {
  if (busy || !state.sessionId || state.requests.length) throw Error('The agent is busy or waiting for input');
  busy = true; state.state = 'running'; state.message = 'The agent is working.'; add('user', text);
  try {
    if (payload.provider === 'codex') {
      await codex.turn(text, payload.effort);
      state.accepted = true; save();
    } else {
      // ACP prompt responses arrive when the turn finishes; keep reading permission requests.
      const response = await request('session/prompt', { sessionId: state.sessionId, prompt: [{ type: 'text', text }] }, 0);
      busy = false; state.accepted = true; state.state = response.stopReason === 'cancelled' ? 'stopped' : 'completed';
      state.message = state.state === 'completed' ? 'Ready to review. Continue this conversation here.' : 'This turn stopped.'; save();
    }
  } catch {
    busy = false; failed(payload.provider === 'codex' ? 'Codex could not accept this turn. If this task is open in Codex, continue it there or close it before replying here.' : 'The native agent could not complete this turn. Check its sign-in and project setup on your Mac.');
    if (payload.provider === 'codex') throw Error('Codex did not confirm the turn');
  }
}
function approve(body) {
  const msg = nativeRequests.get(body.approvalId); if (!msg) throw Error('This request is no longer pending');
  const visible = state.requests.find(r => r.id === body.approvalId);
  if (visible.options.length && !visible.options.some(o => o.id === body.optionId)) throw Error('Invalid decision');
  let result;
  if (msg.method === 'session/request_permission') result = { outcome: { outcome: 'selected', optionId: body.optionId } };
  else if (msg.method === 'item/permissions/requestApproval') result = { permissions: body.optionId === 'grant' ? msg.params.permissions : {}, scope: 'turn' };
  else if (msg.method.endsWith('/requestApproval')) result = { decision: body.optionId };
  else if (msg.method === 'cursor/create_plan') result = { outcome: { outcome: body.optionId } };
  else {
    const answers = body.answers ?? {};
    if (visible.questions.some(q => !Array.isArray(answers[q.id]) || !answers[q.id].length)) throw Error('Answer every question');
    result = msg.method === 'cursor/ask_question' ? { outcome: { outcome: 'answered', answers: visible.questions.map(q => ({ questionId: q.id, selectedOptionIds: answers[q.id] })) } } : { answers: Object.fromEntries(visible.questions.map(q => [q.id, { answers: answers[q.id] }])) };
  }
  send({ jsonrpc: '2.0', id: msg.id, result }); nativeRequests.delete(body.approvalId);
  state.requests = state.requests.filter(r => r.id !== body.approvalId);
  state.state = state.requests.length ? 'needs_input' : 'running'; state.message = 'The agent received your response.'; save();
}
async function control(body) {
  if (body.token !== payload.token) throw Error('Invalid owner');
  if (body.op === 'status') return { live: !ending };
  if (body.op === 'screen') return { screen, cols: 90, rows: 30, writable: !!terminal && !ending, message: state.message };
  if (body.op === 'keys' && terminal) { terminal.write(body.data); return { accepted: true }; }
  if (body.op !== 'reply' || payload.remoteControl === false || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.requestId ?? '')) throw Error('Unsupported action');
  // Reserve on disk before native dispatch. Unknown acknowledgment is never replayed.
  const journal = path.join(directory, `reply-${body.requestId}.json`);
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ text: body.text, approvalId: body.approvalId, optionId: body.optionId, answers: body.answers }))).digest('hex');
  if (fs.existsSync(journal)) {
    const previous = JSON.parse(fs.readFileSync(journal,'utf8')); if (previous.fingerprint !== fingerprint) throw Error('Request identity conflict');
    return { accepted: previous.accepted, unknown: !previous.accepted };
  }
  if (body.text && (busy || state.requests.length || !state.sessionId)) throw Error('Agent is not ready for a follow-up');
  if (body.approvalId) {
    const visible = state.requests.find(r => r.id === body.approvalId);
    if (!visible || !nativeRequests.has(body.approvalId) || (visible.options.length && !visible.options.some(o => o.id === body.optionId)) || visible.questions.some(q => !Array.isArray(body.answers?.[q.id]) || !body.answers[q.id].length)) throw Error('Request is no longer pending or answer is invalid');
  }
  fs.writeFileSync(journal, JSON.stringify({ fingerprint, accepted: false }), { flag: 'wx', mode: 0o600 });
  if (body.approvalId) approve(body);
  else if (typeof body.text === 'string' && body.text.trim()) {
    if (payload.provider === 'codex') await turn(body.text);
    else void turn(body.text);
  }
  else throw Error('Missing response');
  fs.writeFileSync(journal, JSON.stringify({ fingerprint, accepted: true }), { mode: 0o600 });
  return { accepted: true };
}
try {
  save();
  // HEAD is local and deterministic: no network fetch and no shared-checkout edits.
  execFileSync('/usr/bin/git', ['-C', payload.projectRoot, 'worktree', 'add', '-b', `runtimebrief/${payload.id}`, payload.cwd, 'HEAD'], { timeout: 30000, stdio: 'ignore' });
  owner.cwd = state.cwd = fs.realpathSync(payload.cwd);
  fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  server = net.createServer({ allowHalfOpen: true }, connection => {
    let input = ''; connection.setTimeout(5000, () => connection.destroy());
    connection.on('data', data => { input += data; if (input.length > 40000) connection.destroy(); });
    connection.on('end', async () => { try { connection.end(JSON.stringify(await control(JSON.parse(input))) + '\n'); } catch { connection.end(JSON.stringify({ error: true }) + '\n'); } });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(owner.socket, resolve); }); fs.chmodSync(owner.socket, 0o600);
  if (payload.provider === 'claude') {
    state.sessionId = randomUUID(); save();
    terminal = pty.spawn(payload.binary, ['--session-id', state.sessionId, '--name', payload.name, '--permission-mode', payload.mode, ...(payload.model !== 'default' ? ['--model',payload.model] : []), ...(payload.effort !== 'default' ? ['--effort',payload.effort] : []), ...(payload.remoteControl ? ['--remote-control',payload.name] : ['--settings','{"remoteControlAtStartup":false,"disableRemoteControl":true}']), '--',payload.prompt], { cwd: state.cwd, env: { ...process.env, TERM: 'xterm-256color' }, cols: 90, rows: 30, name: 'xterm-256color' });
    terminal.onData(data => { screen = (screen + data).slice(-64000); fs.writeFileSync(path.join(directory,'screen.txt'), screen,{mode:0o600}); });
    terminal.onExit(({exitCode}) => finish(exitCode));
    state.message = 'Claude is starting. Waiting for its native conversation.'; save();
  } else if (payload.provider === 'codex') {
    codex = new NativeCodexSession({ ...payload, cwd: state.cwd }, event, () => { failed('Codex disconnected. Its conversation is saved on your Mac.'); finish(1); });
    const identity = await codex.start();
    state.sessionId = identity.sessionId; state.nativeProjectId = identity.projectId;
    save(); void turn(payload.prompt).catch(() => {});
  } else {
    const args = [...(payload.model !== 'default' ? ['--model',payload.model] : []), ...(payload.mode === 'bypassPermissions' ? ['--yolo','--sandbox','disabled'] : payload.mode === 'auto' ? ['--auto-review'] : []), 'acp'];
    child = spawn(payload.binary, args, { cwd: state.cwd, stdio: ['pipe','pipe','pipe'], env: { ...process.env, NO_COLOR: '1' } });
    child.on('error', () => { failed('The native agent could not start. Check its installation on your Mac.'); finish(1); });
    child.on('exit', finish); child.stdin.on('error', () => finish(1));
    child.stderr.on('data', () => {}); // Vendor diagnostics may contain secrets; never expose them through API errors.
    readline.createInterface({ input: child.stdout }).on('line', line => { try { event(JSON.parse(line)); } catch {} });
    await request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'runtimebrief', version: '1.0.0' } });
    await request('authenticate', { methodId: 'cursor_login' });
    const response = await request('session/new', { cwd: state.cwd, mcpServers: [] }); state.sessionId = response.sessionId;
    const mode = payload.mode === 'plan' || payload.mode === 'ask' ? payload.mode : 'agent';
    if (response.modes?.availableModes?.some(m => m.id === mode)) await request('session/set_mode', { sessionId: state.sessionId, modeId: mode });
    else if (mode !== 'agent') throw Error('Requested mode unavailable');
    save(); void turn(payload.prompt);
  }
} catch {
  failed('The native session could not start. Check agent sign-in, workspace trust, and Git setup on your Mac.');
  try { codex?.stop(); child?.kill(); terminal?.kill(); } catch {} finish(1);
}
process.on('SIGTERM', () => { try { codex?.stop(); child?.kill(); terminal?.kill(); } catch {} finish(null); });
