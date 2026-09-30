// Payload checks only: this does not launch an agent or verify native connectivity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const dependency = createRequire(path.resolve(__dirname, '../../daemon/package.json'));
const Ajv = dependency('ajv/dist/2020').default;
const ajv = new Ajv({ strict: true, allErrors: true });
dependency('ajv-formats')(ajv);
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const schema = JSON.parse(read('contract.schema.json'));
const cases = JSON.parse(read('examples.json'));
ajv.addSchema(schema, 'contract');
const validate = ajv.getSchema('contract');
const names = new Set();
let count = 0;

for (const [group, expected] of [['valid', true], ['invalid', false]]) {
  for (const example of cases[group]) {
    assert(!names.has(example.name), `Duplicate example: ${example.name}`);
    names.add(example.name);
    assert.equal(validate(example.value), expected,
      `${example.name}: ${ajv.errorsText(validate.errors)}`);
    count++;
  }
}

const methods = schema.$defs.Request.properties.method.enum;
for (const method of methods) {
  assert(cases.valid.some(x => x.value.params && x.value.method === method),
    `Missing request example: ${method}`);
  assert(cases.valid.some(x => x.value.ok && x.value.method === method),
    `Missing success response example: ${method}`);
}

const session = cases.valid.find(x => x.name === 'Refreshed session').value.result;
const create = cases.valid.find(x => x.name === 'Create defaults to Remote Control on').value;
const provider = cases.valid.find(x => x.name === 'Implemented provider discovery').value.result.providers[0];
let boundaryChecks = 0;
function rejects(name, mutate, base = create) {
  const value = structuredClone(base);
  mutate(value);
  assert(!validate(value), `${name} accepted`);
  boundaryChecks++;
}
for (const [name, params] of Object.entries({
  'Relative project': {projectRoot: 'sample-app'},
  'NUL in path': {projectRoot: '/workspaces/sample\0'},
  'Invalid ID': {id: 'session-1'},
  'ID ending in newline': {id: `${create.params.id}\n`},
  'Unknown provider': {provider: 'custom-shell'},
  'Empty task': {prompt: ''},
  'Whitespace task': {prompt: ' \n\t'},
  'Terminal control in task': {prompt: 'Review\x1b[31m'},
  'Oversized task': {prompt: 'x'.repeat(32001)},
  'Arbitrary settings': {settings: {command: 'example'}},
  'Old continuation option': {continuation: 'native_if_configured'},
  'Implicit approvals': {autoApprove: true},
  'Deferred custom workspace': {workspace: {kind: 'worktree', base: 'main'}},
})) {
  rejects(name, value => Object.assign(value.params, params));
}
for (const method of ['operations.get', 'continuation.get', 'continuation.prepare', 'sessions.send']) {
  rejects(method, value => { value.method = method; });
}
rejects('Unsupported version', value => { value.version = 2; });
rejects('Unneeded call ID', value => { value.callId = 'call-1'; });
rejects('Recorded remote preference must be a boolean', value => {
  value.result.requestedRemoteControl = 'true';
}, {version: 1, method: 'sessions.get', ok: true, result: session});
for (const field of ['branch', 'baseCommit']) {
  rejects(`Worktree without ${field}`, value => { value.result.workspace[field] = null; },
    {version: 1, method: 'sessions.get', ok: true, result: session});
}

let omissionChecks = 0;
function requiredFields(value, fields, validator, label) {
  for (const field of fields) {
    const incomplete = structuredClone(value);
    delete incomplete[field];
    assert(!validator(incomplete), `Missing ${label}.${field} accepted`);
    omissionChecks++;
  }
}
for (const { value } of cases.valid) {
  requiredFields(value, Object.keys(value), validate, value.method ?? 'error');
}
for (const [definition, value] of Object.entries({
  Session: session, RemoteControl: session.remoteControl, Workspace: session.workspace,
  Terminal: session.terminal, Provider: provider, CreateParams: create.params,
})) {
  requiredFields(value, schema.$defs[definition].required,
    ajv.getSchema(`contract#/$defs/${definition}`), definition);
}

// Enumerate combinations to catch contradictions hidden by individually valid enums.
const validateSession = ajv.getSchema('contract#/$defs/Session');
let combinations = 0;
for (const launchState of schema.$defs.Session.properties.launchState.enum) {
  for (const activity of schema.$defs.Session.properties.activity.enum) {
    for (const identity of [false, true]) {
      for (const workspace of [false, true]) {
        for (const observed of [false, true]) {
          const value = structuredClone(session);
          Object.assign(value, { launchState, activity,
            nativeConversationId: identity ? session.nativeConversationId : null,
            workspace: workspace ? session.workspace : null,
            observedAt: observed ? session.observedAt : null,
            remoteControl: { state: 'unknown', url: null, checkedAt: null, message: null },
          });
          const expected = (launchState !== 'started' || identity && workspace && observed)
            && (activity === 'unknown' || workspace && observed);
          assert.equal(validateSession(value), expected,
            `Launch/activity combination: ${JSON.stringify({launchState, activity, identity, workspace, observed})}`);
          combinations++;
        }
      }
    }
  }
}
const validateRemote = ajv.getSchema('contract#/$defs/RemoteControl');
for (const state of schema.$defs.RemoteControl.properties.state.enum) {
  for (const url of [null, 'https://example.com/session/1', 'javascript:alert(1)']) {
    for (const checkedAt of [null, session.observedAt]) {
      const expected = state === 'ready'
        ? url?.startsWith('https://') === true && checkedAt !== null : url === null;
      assert.equal(validateRemote({state, url, checkedAt, message: null}), expected,
        `Remote combination: ${JSON.stringify({state, url, checkedAt})}`);
      combinations++;
    }
  }
}

// Check remote readiness against the whole session, including uncertain delivery.
// Remote reachability and observed activity are independent of initial-prompt acceptance.
for (const launchState of schema.$defs.Session.properties.launchState.enum) {
  for (const activity of schema.$defs.Session.properties.activity.enum) {
    for (const state of schema.$defs.RemoteControl.properties.state.enum) {
      for (const identity of [false, true]) {
        const value = structuredClone(session);
        Object.assign(value, {launchState, activity,
          nativeConversationId: identity ? session.nativeConversationId : null,
          remoteControl: {state, url: state === 'ready' ? session.remoteControl.url : null,
            checkedAt: session.observedAt, message: null},
        });
        const expected = (launchState !== 'started' || identity) && (state !== 'ready' || identity);
        assert.equal(validateSession(value), expected,
          `Joint state combination: ${JSON.stringify({launchState, activity, state, identity})}`);
        combinations++;
      }
    }
  }
}

// A launch preference remains readable after the user changes native settings.
const changedRemotePreference = structuredClone(session);
changedRemotePreference.requestedRemoteControl = false;
assert(validateSession(changedRemotePreference), 'Native state must not overwrite the saved launch preference');

assert.equal(schema.$defs.CreateParams.properties.remoteControl.default, true);
assert(!schema.$defs.CreateParams.required.includes('remoteControl'));
assert(validate(create));
assert(!Object.hasOwn(create.params, 'remoteControl'), 'Schema validation must not silently mutate inputs');
for (const remoteControl of [true, false]) {
  const explicit = structuredClone(create);
  Object.assign(explicit.params, {remoteControl, settings: {}});
  assert(validate(explicit), 'Explicit remote preference and empty settings must be accepted');
}

const markdown = read('README.md');
for (const match of markdown.matchAll(/```json\n([\s\S]*?)\n```/g)) {
  assert(validate(JSON.parse(match[1])), 'README example fails schema validation');
}
for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
  if (!match[1].startsWith('https:')) {
    assert(fs.existsSync(path.resolve(__dirname, match[1])), `Broken link: ${match[1]}`);
  }
}
for (const name of ['README.md', 'contract.schema.json', 'examples.json', 'validate.cjs']) {
  assert(!read(name).split('\n').some(line => /[ \t]+$/.test(line)), `Whitespace: ${name}`);
}
console.log(`${count} examples, ${boundaryChecks} boundary checks, ${omissionChecks} required-field checks, and ${combinations} state combinations passed; README JSON/links valid.`);
