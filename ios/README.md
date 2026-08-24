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
   token it prints once), add projects, and run `runtimebriefd start`.
   RuntimeBrief does not read or copy the Codex CLI's saved login.
2. In the app: Settings → enter the daemon address (Tailscale IP or MagicDNS
   name, port 8484 by default) and paste the token → **Test Connection** →
   Save. The token is stored in the Keychain only.
3. The home screen immediately shows a zero-cost portfolio brief. Each claim
   includes the git commit, working-tree scan, or agent session that supports it.
   Tap an iOS project to also see its local Xcode version/build, latest
   TestFlight build, and newest App Store version/state. The analyst runs only
   after you tap **Generate analyst update** or ask a question.
4. Say: *"Hey Siri, what's the state of \<project\> in RuntimeBrief"*. Siri
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
