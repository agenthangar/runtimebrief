# RuntimeBrief iOS app

SwiftUI + App Intents client for [runtimebriefd](../daemon). Claude setup terminals use the pinned SwiftTerm package.

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
Requires Xcode 27+ (Swift 6, iOS 27 SDK); the app still runs on iOS 26.
Run the unit and UI tests with **⌘U**. Unit tests use Swift Testing and a
mocked transport; bundled demo and settings UI tests need no daemon.

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
4. The home screen immediately shows a zero-cost portfolio brief. Claims use Git and session records internally; the overview shows readable
   updates without technical source cards.
   Tap an iOS project to also see its local Xcode version/build, latest
   TestFlight build, and newest App Store version/state. Project detail starts
   with Analyst update expanded, followed by project work/status, Ask, recent
   sessions, Coding agents, and commits. iOS release details follow on iOS projects.
   Analysis shows readable descriptions without raw citation IDs, commit hashes,
   or an Evidence section. Analyst update displays the same saved analysis as
   Siri, including its analysis timestamp. The
   daemon refreshes missing or old analysis in the background; **Check for updates**
   reads that shared result. Asking a question remains an explicit analyst query.
5. Say: *"Hey Siri, RuntimeBrief analysis for \<project\>"*. App
   Shortcuts register after the first launch; a successful refresh supplies
   project names for personalized phrases.

## Siri and Search

| Action | Example phrase | Shortcuts output |
| --- | --- | --- |
| Project status | Show Runtime Brief status; or What's the status of Sample Tracker in RuntimeBrief? | Brief text |
| Project analysis | RuntimeBrief analysis for Sample Tracker; or RuntimeBrief project analysis, then name the project | Cached analysis text |
| Needs attention | What needs attention in RuntimeBrief? | Project entities |
| List projects | List my RuntimeBrief projects | Project entities |
| Open project | Open Sample Tracker in RuntimeBrief | Opens project detail |
| Ask the analyst | Ask RuntimeBrief a question about Sample Tracker | Answer text |
| Start coding session | Start a Codex session in RuntimeBrief | Session receipt ID |

**Start Coding Session** supports Claude Code, Codex, and Cursor through the
same native adapters and `/sessions` API as the app. Siri asks for the project,
agent, and task, then confirms the destination and settings before writing.
The device must be locally authenticated. Advanced Shortcuts parameters offer
the Mac's current model choices, reasoning, permissions (Manual by default),
and Remote Control (on by default). Unsupported or unavailable choices stop
before a launch. The action validates the live project rather than trusting
an offline snapshot. Changing the connection during confirmation stops it.

The spoken result distinguishes starting, working, needs-input, ready-to-review,
failed, and uncertain receipts from Remote Control readiness. A lost response
or uncertain receipt retains the same durable request ID across retries,
including retries from the app. After a confirmed receipt, repeating the task
creates a new session. Demo launches remain fictional and never contact a Mac.

Status without a project reads brief headlines for up to four configured
projects immediately; a named status or analysis request reads the project's
latest completed evidence-backed analysis. The analysis refreshes on the Mac
in the background so Siri can answer without waiting for a model run.
The project must appear in RuntimeBrief before Siri can resolve its name.
Status, attention, and list actions read `/v1/projects` with a five-second
network timeout. They never start an analyst. Spotlight maintenance runs
separately so a slow index cannot delay the answer. Status includes the evidence
timestamp; attention distinguishes missing briefs from available briefs with
no attention items. A connection failure can use the saved portfolio with an
explicit saved-data warning and timestamp. Authentication and configuration
failures stop the action instead of returning cached data.

Answers include a Siri card and reusable Shortcuts values. Asking a question
remains an explicit analyst action. Existing custom actions work on iOS 26;
iOS 27 also exposes the system opening schema. Project rows and detail views
provide entity context for requests about visible content.

Shortcut vocabulary refreshes at launch and after a successful project refresh.
The English `AppShortcuts.xcstrings` catalog contains the spoken phrases.
The visible and spoken name are both RuntimeBrief to match Siri's observed
one-word transcription. "Runtime Brief" remains an alternative app name.
The short, parameter-free "Get me status from RuntimeBrief" and
"Show Runtime Brief status" phrases avoid needing Siri to choose an entity.
Status also supports "Can you tell me the status of the Sample Tracker app
from RuntimeBrief." Background entity
suggestions return no names on connection/setup errors so a vocabulary failure
does not abort registration of every shortcut. Explicit reads still report
connection errors and authenticate normally.

For a hands-free project report, say "RuntimeBrief analysis for Sample
Tracker." "RuntimeBrief project analysis" asks which project, so the reply
can be a second spoken turn. Phrases such as "Get me the analysis of the
project Sample Tracker from RuntimeBrief" are also registered. Include
RuntimeBrief in the request so Siri can route it to this app; a request with
only the project name can fall back to a web search.

**Settings → Siri & Search → Make Projects Discoverable** controls Spotlight
indexing, on-screen entity annotations, and opening
donations. This setting applies immediately, independently of saving a Mac
connection. The index includes names, branches, brief headlines, states, and
evidence times. Turning discovery off, entering demo mode, changing the Mac
connection, or removing projects reconciles the index. Demo data is never
indexed or donated. Explicit shortcuts and their project choosers remain
available when discovery is disabled, including in the fictional demo.

Generate the project before testing:

```sh
xcodegen generate --spec ios/project.yml
xcodebuild test -project ios/RuntimeBrief.xcodeproj -scheme RuntimeBrief \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=27.0'
xcodebuild test -project ios/RuntimeBrief.xcodeproj -scheme RuntimeBriefSiri \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=27.0'
```

The regular scheme covers offline fallback, authentication failures, stale
refresh rejection, actual intent results, real Spotlight indexing/removal,
discovery write ordering, and UI preference persistence. The iOS 27-only Siri
scheme uses `AppIntentsTesting` across processes to query entities, run actions,
inspect returned values, open a project, and inspect on-screen annotations,
including opting out while keeping explicit project selection usable.
CodeQL uses its supported Xcode 26.6 / Swift 6.3 toolchain, including all session
creation code. The iOS 27 SDK opening schema, on-screen annotations, and reindexing hooks compile with
Swift 6.4 and are covered by the Xcode 27 build and system integration tests.
If the runtime rejects this framework with security error 803, those tests
explicitly skip; other errors fail. HTTP fixture tests require `RUNTIMEBRIEF_E2E_MOCK=1` and their E2E connection settings.

Session tests exercise the real client encoding and `/sessions` endpoint for
all three providers, confirmation cancellation, invalid settings, removed
projects, authorization/setup failures, uncertain retries, and demo isolation.
Cloud Shortcuts checks cover the actual parameter chooser and confirmation UI.
Ordinary tests use demo data, mock transports, or an isolated HTTP mock fixture.
They never launch installed coding agents. The old live XCTest launch flags have
been removed so a full test run or retry cannot spend model quota.

Live native CLI smoke checks are separate and limited to one session per tool
per release; see [testing.md](../docs/testing.md).
Before release, test spoken requests and the Siri card on a physical iOS 27
device with Siri configured, including ambiguous names, an offline Mac, and
discovery opt-out. A simulator test does not verify speech recognition or
Apple Intelligence routing.

To test Siri's matching of recognized text (rather than calling an intent by
name), enable the separate opt-in test on a Siri-enabled device:

```sh
xcodebuild test -project ios/RuntimeBrief.xcodeproj -scheme RuntimeBriefSiri \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=27.0' \
  -only-testing:RuntimeBriefSiriTests/SiriVoiceRoutingUITests \
  RUNTIMEBRIEF_E2E_SIRI_ROUTING=1
```

This test checks the parameter-free chooser, named status and analysis requests,
and conversational requests through `XCUISiriService`. A failed routing test must remain a
failure even when direct App Intents or Shortcuts checks pass. App Shortcuts
Preview can check the phrase template using the `Project` entity placeholder;
it does not load the connected daemon's project names or verify speech.

## Start a coding task

Use an updated daemon with the native provider adapters. Install and sign in to
the coding agents you want to use on your Mac.
All registered projects allow tasks by default, including projects discovered
later under a trusted root.

1. Open a project and tap **New task** in its **Coding agents** section.
2. Choose Claude Code, Codex, or Cursor, then a model offered by its native
   harness. Native default uses the Mac's configured model and reasoning.
3. Choose permissions and, where supported, reasoning. Manual is the default;
   the explanation describes the selected mode. Remote Control starts on.
4. Enter a task of 10–8,000 characters and tap **Start in** the selected agent.
   The button remains visible above the keyboard. The receipt shows status
   and the original model/permission choices under **Started with**.
5. Use **Continue in Claude** when its verified Remote Control link is ready.
   Codex and Cursor use **Open conversation** for messages, follow-ups, approval
   choices, and questions. **Finish Claude setup** appears for a verified native
   trust/setup prompt. Desktop sidebar visibility is not implied by an identity.

Provider health loads in the background on app opening and is shared across
projects. Saved cards appear immediately; task lists are prefetched with bounded
concurrency. Models and workspace defaults load for the selected composer.

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
the time of recorded work, not the last scan or analysis refresh. Projects are
sorted by this activity time, so old projects remain below recently used ones.

| What you see | What to check |
| --- | --- |
| Connected, but project data could not load | The daemon answered health but its project request failed. Check the error, daemon logs, and registered folders. |
| Saved brief with a connection error | Keep the Mac awake, verify `runtimebriefd` is running, and check that both devices are on the same Tailscale network. Then pull to refresh. |
| Settings test succeeds but the saved connection is unchanged | Tap **Save** to apply the tested address and token. |
| Claude asks for per-project enabling | Update the daemon and restart its service, then tap the refresh icon in the project's Claude Code section. Build 15 can use the new default access without an iOS update. |
| Claude says launches were disabled | The project has an explicit opt-out. On the Mac, run `runtimebriefd enable-claude <project-id>` and `runtimebriefd install-service`. |
| No model or permission selectors | Update the iOS app to build 16 or newer, along with the daemon. |
| Claude cannot launch or continue | Follow the capability message: check Claude installation, sign-in, and workspace trust on the Mac. Claude Code sign-in must work. |

Keep bearer tokens and private project data out of screenshots and bug reports.

## Layout

```
RuntimeBrief/
├── RuntimeBriefApp.swift     app entry
├── Models/                   wire types for the /v1 API
├── Networking/               RuntimeBriefClient (async/await + SSE), Keychain,
│                             ServerSettings, SSEParser
├── Views/                    Projects list, project detail, settings
└── Intents/                  ProjectEntity + search discovery, navigation,
                              brief actions, AppShortcuts, snippets
RuntimeBriefTests/            Swift Testing suites with a mocked transport
RuntimeBriefUITests/          Demo and settings UI tests; optional live tests
RuntimeBriefSiriTests/        iOS 27 system App Intents integration tests
```

## Asset provenance

The app icon's generation and licensing provenance is documented in
[ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).


Coding agents share the native task composer and durable retry IDs. Claude setup
uses the SwiftTerm 1.5.1 renderer (MIT) with explicit input controls; Codex and
Cursor use structured native conversations. Demo conversations are fictional,
in memory, and never contact a Mac. See the native session guide for ownership,
project scope, stopped-session behavior, and delivery guarantees.
