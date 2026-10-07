# Platforms

RuntimeBrief is a local-first Mac daemon plus the clients that can reach it.
This map is the inventory for cross-platform changes.

| Surface | Status | Notes |
| --- | --- | --- |
| macOS daemon (`runtimebriefd`) | Released, required | Loopback HTTP, optional Tailscale Serve, bearer token. Serves `/v1` and, when built, the web app. |
| iOS app | Released | SwiftUI client. Token in the Keychain. Siri, Spotlight, and App Intents live here only. |
| Web app | In this repository | React client in `web/`. Same portfolio, detail, Settings, composer, conversation, terminal, and offline demo as iOS. Served from the daemon origin. Token in this origin's local storage. |
| Android | None | Do not invent an Android client. |
| MCP / Codex plugin | Released | Local stdio tools. Not a UI client. |

## Shared behavior

Deterministic portfolio briefs, project cards, analyst answers (citation IDs
stripped in the UI), the offline demo, native coding-agent launch, and
conversation continuation are the same product on iOS and web. Demo mode
never reads live settings, stored credentials, or the network.

Both clients authenticate with the same daemon bearer token over the same
private URL. Ordinary tests use mocks and must not start Claude, Codex,
Cursor, or the analyst.

## Intentional differences

- **Siri and system search** are iOS-only. The web Settings sheet has no
  "Make Projects Discoverable" control.
- **Token storage:** iOS uses the Keychain; the browser uses origin-scoped
  local storage. Settings copy on web says so.
- **Routing:** iOS uses NavigationPath; web uses `#/` and `#/projects/<id>`
  so the daemon can keep an explicit static-file public surface.
- **Terminal:** SwiftTerm on iOS, xterm.js on web.
- **Serving:** iOS is a native install. The web build is optional static
  files (`server.web_app`, default `true` when `web/dist` exists).

When a product change lands, update every active client above unless a
change is explicitly limited to one platform. Preserve the differences in
this list.
