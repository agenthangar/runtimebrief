# Testing without model usage

Ordinary daemon, web, and iOS tests use mocks. Run `npm test` in `daemon`; its
Node preload rejects installed Claude, Codex, Cursor, and native-worker
subprocesses. Run `npm test` in `web` for unit and component tests, and
`npm run test:e2e` for the Playwright Chromium demo flow. Those suites never
start a daemon or coding agent. iOS demo and transport tests create fictional
receipts only. The retired live XCTest launch flags no longer create sessions.
HTTP fixture tests require `RUNTIMEBRIEF_E2E_MOCK=1` and must point at an
isolated mock server.

## Native release checks

The default release check is also mocked:

```sh
cd daemon
npm run test:release
```

Only during a release, explicitly opt into one real session per provider:

```sh
npm run test:release -- --live --release 30
```

All providers use the same persistent Git workspace named **RuntimeBrief release
tests** under the private RuntimeBrief release-test directory, so native clients
group successive releases in one project instead of UUID workspace folders.
The runner uses Codex `gpt-6-luna` with **low** reasoning, Claude Haiku
`claude-haiku-4-5-20251001`, and
Cursor `composer-2.5`. Haiku and Composer have no separate effort selector in
the installed model catalog. Haiku is pinned by its full model ID because the
short alias was observed to resolve to Sonnet. A Claude response whose reported
model usage differs fails the check. No expensive fallback model is selected.

Each provider's budget is reserved atomically before invocation. A failed,
timed-out, or concurrent check still consumes that provider's one-session
reservation for the build. Rerunning the command returns saved receipts and
does not launch another model turn. Inspect the private output and resume the
recorded native session if needed; do not delete receipts or invent a different
release identifier to bypass the limit. The smoke prompt asks for a short
sentinel without tools or file changes. Sign-in and native permission checks
remain in force. Cursor trusts only the disposable workspace created by this
runner; it does not enable force mode or trust product repositories.

Do not register this fixture as a production project: background analyst
refreshes would spend quota separately. Unit, transport, demo UI, and Revyl
tests cover product behavior with mocks; this small opt-in smoke covers native
CLI authentication and the pinned model's response. Physical Siri speech and
Apple Intelligence routing still require a configured device.
