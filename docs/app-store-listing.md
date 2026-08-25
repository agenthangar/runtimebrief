# RuntimeBrief App Store listing

This file is the reviewed source for the public listing. Do not paste live
daemon output, project names, repository data, hostnames, tokens, or logs into
App Store Connect.

## Product information

- Name: `RuntimeBrief`
- Subtitle: `Your coding agents, briefed`
- Primary category: Developer Tools
- Secondary category: Productivity
- Price: Free
- Availability: All eligible storefronts
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
- Optional, on-demand analyst answers through your own Codex CLI login
- Local Xcode, TestFlight, and App Store release summaries
- Siri and Shortcuts access to project status
- Saved briefs when your Mac is temporarily unavailable
- A fully offline fictional demo requiring no account or server

RuntimeBrief has no hosted account, analytics SDK, advertising SDK, or public
cloud relay. Live project data stays under your control on your Mac and private
network. Optional analyst processing follows the data controls of the ChatGPT
workspace selected in Codex CLI.

A Mac running runtimebriefd is required for live project data. The in-app demo
can be explored without installing or configuring anything.

## Keywords

`coding agents,developer tools,git,projects,status,workflow,Siri,local`

## Review notes

RuntimeBrief is a companion to the user-operated runtimebriefd daemon. App
Review does not need network access, an account, credentials, another device,
or private infrastructure.

On first launch, tap **Explore Demo**. The demo is bundled in the app and works
fully offline. Every displayed project, path, commit, session, release record,
and analyst response is explicitly labeled fictional demo data. Reviewers can
inspect the portfolio, open Sample Tracker, expand its evidence and release
sections, generate a deterministic demo analyst update, and ask a demo
question. No live service is contacted by any demo action.

For normal use, a user installs runtimebriefd on their own Mac and enters their
private HTTPS address and bearer token. RuntimeBrief operates no hosted relay
or account service.

The app does not use non-exempt encryption. It uses standard system TLS for
user-configured HTTPS connections.
