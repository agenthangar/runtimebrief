# Demo video source

The Remotion project behind [the RuntimeBrief demo video](../media/demo/README.md)
and the App Store app preview. Two compositions:

- `Promo`: 1920×1152, 60 fps, about 75 seconds, for the website and README.
- `AppPreview`: 886×1920, 30 fps, 29.7 seconds, for the App Store (iPhone 6.9"/6.7").
  It uses only footage captured from the app: no Siri recreations and no device frame.

## Recapture the app footage

The footage is one screen recording of the app's offline demo on a Revyl cloud iPhone
(iPhone 17 Pro Max, iOS 27), using the `full-app-tests` or any simulator build:

```sh
revyl device start --platform ios --build-version-id <build> \
  --launch-env RUNTIMEBRIEF_E2E_CLEAR_STATE=1 --launch-env RUNTIMEBRIEF_E2E_DEMO=1 --json
```

Then drive the tour with `revyl device tap/swipe/type --session-id <id>` (coordinates are
iOS points): open Sample Tracker, expand Recent agent sessions, scroll, expand Recent
commits and iOS release, tap New task, pick Codex, type the task, start it, open the
conversation, and send a follow-up. Stop the session and download `video_url` from
`revyl device report --session-id <id> --json`.

`src/timeline.ts` (`SHOTS`, `TAPS`) and `src/AppPreview.tsx` hold recording timestamps in
seconds; a new recording needs new timestamps. Make a 60 fps proxy for the edit:

```sh
ffmpeg -i raw.mp4 -vf "fps=60,scale=900:1956:flags=lanczos" -c:v libx264 -crf 12 -g 15 -pix_fmt yuv420p public/phone.mp4
```

## Other assets in `public/`

- `appicon.png`: `ios/RuntimeBrief/Assets.xcassets/AppIcon.appiconset/AppIcon.png`.
- `claude-dark.svg`, `openai-dark.svg`, `cursor-dark.svg`, `agenthangar.svg`: from
  `assets/agent-logos/` and `assets/logo.svg` in
  [agenthangar.github.io](https://github.com/agenthangar/agenthangar.github.io). The
  agent logos belong to their companies; use them unchanged.
- Music, synthesized by `music.py` (original, no samples):

```sh
python3 music.py 74.67 6.4 69.47 public/music.wav 13.2 29.32 41.62 54.82
BARS=14 python3 music.py 29.7 0.0 28.4 public/preview-music.wav 2.6 5.53 10.37 15.93 23.13
```

## Render

```sh
npm ci
npm run render            # out/promo.mp4
npm run render:preview    # out/app-preview.mp4
```

Remotion's bundled headless Chrome hangs on macOS 27, so `remotion.config.ts` points at
the installed Google Chrome. For the web, re-encode the promo at CRF 24 with
`-movflags +faststart`. For the App Store, encode the preview as H.264 High,
level 4.0, 30 fps, about 11 Mbps, with 256 kbps stereo AAC.
