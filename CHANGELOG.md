# Release notes

## Unreleased

- Order brief evidence by session time instead of adapter discovery order.
  Prioritize current changes and completed work over stopped-session notices,
  expire stopped/stale-active notices after 24 hours, and retain session
  history and unresolved input requests.
- Complete the Claude setup, upgrade, API, troubleshooting, and release docs;
  add shared Revyl instructions for repository agents.

## 1.0 (16) — 2026-09-07

- Enable native Claude tasks by default in all registered projects, including
  newly discovered repositories. Retain explicit per-project opt-out through
  `claude_launch_enabled: false`.
- Add Claude default, Fable, Opus, Sonnet, and Haiku model choices, plus Manual,
  Auto, Accept Edits, Plan, Bypass, and Pre-approved Only permission modes.
- Keep the Start button visible above the keyboard and show the original
  launch choices on each receipt. Model and permission choices participate in
  retry identity without replaying uncertain build-15 requests.
- Preserve same-conversation native Desktop handoff. Desktop can apply its own
  permission mode, so check it before sending a follow-up there.
- Verify project data as part of Test Connection, refresh the portfolio when
  the app becomes active, and display refresh errors alongside saved briefs.

Release source: [`d13a318`](https://github.com/agenthangar/runtimebrief/commit/d13a31808798e394dfd9326ffa713304c6c6a246).
Build 16 was verified `VALID` and `IN_BETA_TESTING` in the existing internal
TestFlight group. This did not replace the App Store review submission.

Validation: 291 daemon tests, 30 iOS unit tests, three local UI tests, cloud
iPhone demo checks, real Claude Auto/Bypass writes, and exact-session Desktop
handoff. The user confirmed the enabled task button on a paired physical
iPhone; full physical-phone task creation was not part of that confirmation.

Update the daemon before the iOS app. See the
[upgrade and API guide](docs/session-control.md#upgrade-from-build-15).
