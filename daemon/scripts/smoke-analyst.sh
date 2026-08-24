#!/usr/bin/env bash
# Manual live-run smoke test for the analyst. Requires:
#   - a running runtimebriefd (runtimebriefd start) with at least one project
#   - Codex CLI installed and signed in to ChatGPT with `codex login`
#   - RUNTIMEBRIEF_TOKEN set to the token printed by `runtimebriefd init`
#
# Usage: scripts/smoke-analyst.sh [project-id] [host:port]
set -euo pipefail

PROJECT="${1:-}"
HOSTPORT="${2:-127.0.0.1:8484}"
BASE="http://${HOSTPORT}/v1"

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not installed or is not on PATH." >&2
  exit 1
fi

if ! CODEX_LOGIN_STATUS="$(codex login status 2>&1)"; then
  echo "Codex CLI is not signed in. Run 'codex login' with ChatGPT first." >&2
  exit 1
fi
if ! grep -qi "ChatGPT" <<<"${CODEX_LOGIN_STATUS}"; then
  echo "Codex CLI is not signed in with ChatGPT. Run 'codex login' first." >&2
  exit 1
fi

if [[ -z "${RUNTIMEBRIEF_TOKEN:-}" ]]; then
  echo "Set RUNTIMEBRIEF_TOKEN to your daemon token first." >&2
  exit 1
fi

# Feed the bearer header through curl's stdin config so the token is neither a
# curl argument nor inherited in curl's environment/process listing.
curl_auth() {
  env -u RUNTIMEBRIEF_TOKEN curl --config - "$@" <<< \
    "header = \"Authorization: Bearer ${RUNTIMEBRIEF_TOKEN}\""
}

echo "==> health"
curl_auth -fsS "${BASE}/health"
echo

echo "==> projects"
curl_auth -fsS "${BASE}/projects"
echo

if [[ -z "$PROJECT" ]]; then
  PROJECT=$(curl_auth -fsS "${BASE}/projects" | node -e \
    "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d)[0];if(!p)process.exit(1);console.log(p.id)})")
  echo "==> using first project: ${PROJECT}"
fi

echo "==> status (JSON)"
curl_auth -fsS "${BASE}/projects/${PROJECT}/status"
echo

echo "==> ask (SSE stream)"
curl_auth -fsSN -H "Accept: text/event-stream" -H "Content-Type: application/json" \
  -d '{"question":"What was the last thing an agent worked on here, and did it finish?"}' \
  "${BASE}/projects/${PROJECT}/ask"
echo
echo "==> smoke test complete"
