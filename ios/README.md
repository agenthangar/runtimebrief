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

Select the `RuntimeBrief` scheme, pick your iPhone, build and run.
For a physical device or archive, select your own development team in Xcode;
team identifiers are intentionally not stored in the repository.
Requires Xcode 26+ (Swift 6, iOS 26 SDK). Run the unit tests with **⌘U**
(they use Swift Testing and a mocked transport — no daemon needed).

RuntimeBrief intentionally keeps the existing `com.backbrief.app` bundle
identifier so updates continue through the established App Store Connect and
TestFlight record. The product name, targets, daemon, and plugin use the
RuntimeBrief name; do not create a second Apple app record for this rename.

## Connect to your Mac

1. On the Mac: install Codex CLI separately and run `codex login` with ChatGPT
   if you want optional analyst answers. Then run `runtimebriefd init` (copy the
   token it prints once), add projects, and keep the daemon on its default
   `127.0.0.1` bind. RuntimeBrief does not read or copy the Codex CLI's saved
   login.
2. Install Tailscale on the Mac and iPhone, connect both to the same tailnet,
   then publish the loopback daemon privately over HTTPS:

   ```sh
   runtimebriefd install-service
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
