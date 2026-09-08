# RuntimeBrief iOS app

SwiftUI + App Intents client for [runtimebriefd](../daemon). No third-party
dependencies.

## Build

This directory ships as an [XcodeGen](https://github.com/yonaskolb/XcodeGen)
source tree (the `.xcodeproj` is generated, not checked in):

```sh
brew install xcodegen
cd ios
xcodegen generate
open RuntimeBrief.xcodeproj
```

Select the `RuntimeBrief` scheme, pick a simulator, build and run. A simulator
needs no Apple team or bundle-identifier change.
Requires Xcode 26+ (Swift 6, iOS 26 SDK). Run the unit tests with **⌘U**
(they use Swift Testing and a mocked transport — no daemon needed).

On an unconfigured install, **Explore Demo** opens a bundled, fully offline
portfolio made only from hand-authored fictional data. Demo mode never reads
the saved server URL or Keychain token, contacts a network service, or writes
into the live project cache. Use **Exit Demo** before connecting a Mac.

Maintainer TestFlight and App Store builds intentionally keep the existing
`com.backbrief.app` bundle identifier so updates continue through the
established App Store Connect record. The rename does not require maintainers
to create a second Apple app record.

External contributors cannot sign that production identifier. To run on your
own physical device, select your Apple development team and replace
`PRODUCT_BUNDLE_IDENTIFIER` in your local `project.yml` with a unique
reverse-DNS identifier you control (for example,
`com.example.runtimebrief.dev`), then run `xcodegen generate` again. Keep that
personal signing change local; do not commit it or change the production
`com.backbrief.app` identity in a contribution.

## Connect to your Mac

1. On the Mac: install Codex CLI separately and run `codex login` with ChatGPT
   if you want optional analyst answers. Then run `runtimebriefd init` (copy the
   token it prints once), add projects, and run `runtimebriefd install-service`.
   This starts the non-blocking launchd service on its default `127.0.0.1`
   bind. RuntimeBrief does not read or copy the Codex CLI's saved login.
2. Install Tailscale on the Mac and iPhone, connect both to the same tailnet,
   then publish the loopback daemon privately over HTTPS:

   ```sh
   tailscale serve --bg 8484
   tailscale serve status
   ```

   Do not use Tailscale Funnel or expose the daemon to the public internet.
3. In the app: Settings → enter the HTTPS URL printed by `tailscale serve`
   and paste the token → **Test Connection** → **Save**. The check loads daemon
   health and decodes the project list before reporting how many projects
   loaded; health alone is not a successful data connection. Older builds that add
   port 8484 to a URL without a port should append `:443`. The token is stored
   in the Keychain only.
4. The home screen immediately shows a zero-cost portfolio brief. Each claim
   includes the git commit, working-tree scan, or agent session that supports it.
   Tap an iOS project to also see its local Xcode version/build, latest
   TestFlight build, and newest App Store version/state. The analyst runs only
   after you tap **Generate analyst update** or ask a question.
5. Say: *"Hey Siri, what's the state of \<project\> in RuntimeBrief"*. Siri
   shortcut phrases register after the first app launch.

## Start a Claude task

Use iOS build 16 or newer and an updated daemon for the model and permission
selectors. Install and sign in to Claude Code and Claude Desktop on your Mac.
All registered projects allow tasks by default, including projects discovered
later under a trusted root.

1. Open a project and tap **New Claude task** in its **Claude Code** section.
2. Choose **Claude default**, **Fable**, **Opus**, **Sonnet**, or **Haiku**.
   Claude default uses the Mac's configured model; named choices use Claude's
   model aliases. Availability depends on the installed Claude version and
   account.
3. Choose **Manual** (the default), **Auto**, **Accept Edits**, **Plan**,
   **Bypass**, or **Pre-approved Only**. The explanation below the selector
   describes the mode. Bypass runs tools without permission prompts; select
   it only for trusted work. Auto also depends on the selected model/account.
4. Enter a task of 10–8,000 characters and tap **Start in Claude Code**.
   The button remains visible above the keyboard. The receipt shows status
   and the original model/permission choices under **Started with**.
5. Tap **Open in Claude Desktop** to move the saved conversation to the Mac
   app. This stops any current background response. Select the RuntimeBrief
   task in Desktop, check its permission mode, and send a follow-up to continue.
   Desktop may reset the permission mode during handoff.

Claude keeps working when the phone disconnects. If a request has an uncertain
result, refresh its receipt before starting another task. Retrying the same
task/settings uses its saved request ID; changing the task or settings is a
different request. RuntimeBrief does not control arbitrary pre-existing
Desktop sessions.

In offline demo mode, the same composer produces a fictional receipt and
never sends work to a Mac. See the [native session guide](../docs/session-control.md)
for the API and ownership rules.

## Connection and refresh troubleshooting

The portfolio refreshes when the app becomes active, when Settings closes,
and when you pull to refresh. A failed refresh keeps the saved brief on screen
with its saved time and the actual error. A project's activity timestamp is
the time of its evidence, so it can remain old even after a successful refresh.

| What you see | What to check |
| --- | --- |
| Connected, but project data could not load | The daemon answered health but its project request failed. Check the error, daemon logs, and registered folders. |
| Saved brief with a connection error | Keep the Mac awake, verify `runtimebriefd` is running, and check that both devices are on the same Tailscale network. Then pull to refresh. |
| Settings test succeeds but the saved connection is unchanged | Tap **Save** to apply the tested address and token. |
| Claude asks for per-project enabling | Update the daemon and restart its service, then tap the refresh icon in the project's Claude Code section. Build 15 can use the new default access without an iOS update. |
| Claude says launches were disabled | The project has an explicit opt-out. On the Mac, run `runtimebriefd enable-claude <project-id>` and `runtimebriefd install-service`. |
| No model or permission selectors | Update the iOS app to build 16 or newer, along with the daemon. |
| Claude cannot launch or hand off | Follow the capability message: check Claude installation, sign-in, and workspace trust on the Mac. CLI and Desktop sign-in must both work. |

Keep bearer tokens and private project data out of screenshots and bug reports.

## Layout

```
RuntimeBrief/
├── RuntimeBriefApp.swift     app entry
├── Models/                   wire types for the /v1 API
├── Networking/               RuntimeBriefClient (async/await + SSE), Keychain,
│                             ServerSettings, SSEParser
├── Views/                    Projects list, project detail, settings
└── Intents/                  ProjectEntity + fuzzy query, GetProjectStatus,
                              AskProject, ListProjects, AppShortcuts, snippets
RuntimeBriefTests/            Swift Testing suites with a mocked transport
```

## Asset provenance

The app icon's generation and licensing provenance is documented in
[ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).
