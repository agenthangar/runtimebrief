# RuntimeBrief web app

Browser client for [runtimebriefd](../daemon). It is the same portfolio brief,
project detail, Settings, task composer, conversation, and terminal surfaces
as the [iOS app](../ios/README.md), including the fully offline demo.

The daemon serves the production build from its own origin, so a phone or
desktop browser can open the same Tailscale Serve URL used by the iOS app.
The page talks to `/v1` on that origin. There is no RuntimeBrief account,
hosted relay, or analytics SDK.

## Run it

You need Node 22 or newer. From this directory:

```sh
npm ci
npm run dev          # Vite on :5173, proxies /v1 to 127.0.0.1:8484
npm run build        # typecheck + Vite production bundle in dist/
npm run preview      # serve dist/ locally
npm test             # Vitest unit and component tests
npm run test:e2e     # Playwright Chromium demo flow
```

`RUNTIMEBRIEF_DEV_PROXY` overrides the Vite `/v1` proxy target. Ordinary tests
use mocks and never start Claude, Codex, Cursor, or the analyst.

To have `runtimebriefd` serve the app, build `dist/` and start the daemon.
`server.web_app` defaults to `true` and looks for the sibling `web/dist`
directory. Set it to a path to serve another build, or `false` to keep the
daemon API-only. The startup log says whether the web app is being served.

On an unconfigured install, **Explore Demo** opens the same hand-authored
fictional portfolio as iOS. Demo mode never reads the saved URL or token,
contacts a network, or writes the live project cache. Use **Exit Demo**
before connecting a Mac.

## Connect a live daemon

1. Build this package, then start or reload `runtimebriefd`.
2. Open the private HTTPS URL printed by `tailscale serve --bg 8484`, or
   `http://127.0.0.1:8484` on the Mac itself.
3. Paste the daemon token from `runtimebriefd init` in Settings and use
   **Test Connection**. The check confirms daemon health and usable project
   data; tap **Save** after it succeeds.

The token is stored only in this origin's local storage. That is an
intentional platform difference: iOS keeps the same token in the Keychain.
Settings copy states this. Hash routes (`#/` and `#/projects/<id>`) keep the
daemon's public surface to the static files that exist at boot. Unknown paths
still answer 401.

## Intentional differences from iOS

- No Siri, Spotlight, or App Intents. Project discovery stays on iOS.
- The daemon token lives in origin-scoped local storage, not the Keychain.
- Settings pre-fills the origin that served the page. Task-retry identity
  still uses the saved URL or `unconfigured` until you tap Save.
- The terminal uses xterm.js instead of SwiftTerm.
- Navigation is hash-based so the daemon does not grow a catch-all SPA route.

## Security

Static files that exist in `dist/` at daemon startup are the only public
routes. `/v1` and unknown paths still require the bearer token and stay
rate-limited. The HTML shell sends a strict CSP (`connect-src 'self'`).
Do not expose the daemon with Tailscale Funnel or bind it to a public
address. See [SECURITY.md](../SECURITY.md) and [PRIVACY.md](../PRIVACY.md).
