# Agent Instructions

<!-- revyl:agents:start -->
## Revyl — run this app on a cloud device

Use the Revyl CLI to build, run, and verify app changes on a cloud device.
Revyl viewer URLs are live device streams — share them with the user as soon
as you have one.

On a local machine the CLI opens the live viewer in the user's browser
automatically when the session is ready (check "opened_browser" in the
handshake; --no-open disables it). ALWAYS also post viewer_url as a clickable
markdown link — that is the fallback on cloud VMs — and never try to open a
browser yourself.

One-time setup (ephemeral shells may lack the CLI):

```bash
if ! command -v revyl >/dev/null 2>&1; then
  REVYL_NO_MODIFY_PATH=1 sh -c 'curl -fsSL https://raw.githubusercontent.com/RevylAI/revyl-cli/main/scripts/install.sh | sh'
  export PATH="$HOME/.revyl/bin:$PATH"
fi
revyl auth status || revyl auth persist-cloud-env
```

persist-cloud-env copies a REVYL_API_KEY already in the environment into the
credential store, so the key never reaches argv. If it reports no key, run
"revyl auth login" and post the approval URL it prints as a clickable markdown
link — the user can approve from any browser.

Dev loop (run from the app directory containing .revyl/config.yaml):

```bash
# Start in the background. Returns JSON as soon as the simulator is watchable;
# the build keeps running behind it. Share viewer_url with the user right away.
revyl dev --remote --detach --json

# Watch the build until the app is installed and launched.
revyl dev status            # state: building -> idle; last_rebuild.status: running -> success
revyl dev logs --build --follow

# After each code change:
revyl dev rebuild --wait --json
```

Verify like a user (separate short-lived commands; never in the loop terminal):

```bash
revyl device screenshot --out screen.png
revyl device validation -s 0 "<expected user-visible outcome>" --json
revyl device report --session-id <session-id> --json
```

Auth: when .revyl/config.yaml has a session.auth_bypass section, Revyl applies
its configured launch variables at boot and its configured deep link after
launch. To re-fire that deep link without reminting, run:

```bash
revyl dev auth refresh
```

If the token itself expired, run `revyl dev stop` then
`revyl dev` so session.before_script runs again when configured and
updated launch environment is applied.

Stop with `revyl dev stop` when done. Never paste launch-var values or
tokens into code, logs, screenshots, or PRs — reference key names only.
<!-- revyl:agents:end -->
