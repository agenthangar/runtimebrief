# RuntimeBrief App Store listing

This file is listing copy for iOS 1.0.1 build 17. Repository edits do
not update App Store Connect or replace a submitted build; use this copy only
with a compatible binary and verify its review/release state separately.
Do not paste live
daemon output, project names, repository data, hostnames, tokens, or logs into
App Store Connect.

## Product information

- Name: `RuntimeBrief`
- Subtitle: `Your coding agents, briefed`
- Primary category: Developer Tools
- Secondary category: Productivity
- Price: Free
- Availability: Preserve the configured storefronts; China mainland is excluded
- Privacy policy: <https://github.com/agenthangar/runtimebrief/blob/main/PRIVACY.md>
- Support: <https://github.com/agenthangar/runtimebrief/issues>
- Marketing: <https://github.com/agenthangar/runtimebrief>

## Description

RuntimeBrief turns activity from your local coding agents and repositories into
short, evidence-backed project updates.

Connect the app to the RuntimeBrief daemon running on your Mac to see what
changed, what is still in progress, and what needs your attention. Each claim
links back to its supporting commit, working-tree scan, or agent session.

Features:

- A concise portfolio brief across your registered projects
- Evidence-backed project status and recent agent activity
- Native Claude Code tasks in registered projects, with model and permission
  choices and takeover in Claude Desktop on your Mac
- Optional, on-demand analyst answers through your own Codex CLI login
- Local Xcode, TestFlight, and App Store release summaries
- Siri and Shortcuts access to project status
- Saved briefs when your Mac is temporarily unavailable
- A fully offline fictional demo requiring no account or server

RuntimeBrief has no hosted account, analytics SDK, advertising SDK, or public
cloud relay. Live project data stays under your control on your Mac and private
network. Optional analyst processing follows the data controls of the ChatGPT
workspace selected in Codex CLI. Native Claude tasks use your existing Claude
login and follow Claude's account policies and the selected tool permissions.

A Mac running runtimebriefd is required for live project data. The in-app demo
can be explored without installing or configuring anything. Native tasks also
require Claude Code and Claude Desktop installed and signed in on that Mac.

## What's new in 1.0.1

Start Claude Code tasks from any registered project on your Mac. Choose a
model and permission mode, then take over the same conversation in Claude
Desktop. Check the permission mode in Desktop before continuing.

Connection checks now verify project data, the app refreshes when reopened,
and saved briefs show refresh errors. Project briefs prioritize current work
and keep older stopped-session notices out of your way.

Update runtimebriefd on your Mac to use these improvements.

## Keywords

`coding agents,developer tools,git,projects,status,workflow,Siri,local`

## Review notes

Version 1.0.1 (build 17) adds native Claude task launch with model and
permission choices. China mainland remains excluded from availability.

RuntimeBrief is a companion to the user-operated runtimebriefd daemon. App
Review does not need network access, an account, credentials, another device,
or private infrastructure.

On first launch, tap **Explore Demo**. The demo is bundled in the app and works
fully offline. Every displayed project, path, commit, session, release record,
and analyst response is explicitly labeled fictional demo data. Reviewers can
inspect the portfolio, open Sample Tracker, expand its evidence and release
sections, generate a deterministic demo analyst update, and ask a demo
question. In Sample Tracker's Claude Code section, tap **New Claude task**,
choose a model and permission mode, enter a fictional task, and start it to
see a demo receipt. **Open in Claude Desktop** explains that no app is opened
in demo mode. No live service is contacted by any demo action.

For normal use, a user installs runtimebriefd on their own Mac and enters their
private HTTPS address and bearer token. RuntimeBrief operates no hosted relay
or account service.

The app does not use non-exempt encryption. It uses standard system TLS for
user-configured HTTPS connections.
