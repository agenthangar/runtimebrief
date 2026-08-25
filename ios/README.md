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
   and paste the token → **Test Connection** → Save. Older builds that add
   port 8484 to a URL without a port should append `:443`. The token is stored
   in the Keychain only.
4. The home screen immediately shows a zero-cost portfolio brief. Each claim
   includes the git commit, working-tree scan, or agent session that supports it.
   Tap an iOS project to also see its local Xcode version/build, latest
   TestFlight build, and newest App Store version/state. The analyst runs only
   after you tap **Generate analyst update** or ask a question.
5. Say: *"Hey Siri, what's the state of \<project\> in RuntimeBrief"*. Siri
   shortcut phrases register after the first app launch.

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
