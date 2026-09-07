#!/usr/bin/env bash
set -euo pipefail

scan_root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
failures=0

debug() {
  if [[ "${RUNTIMEBRIEF_PRIVACY_DEBUG:-0}" == "1" ]]; then
    printf 'privacy verification stage: %s\n' "$1" >&2
  fi
}

fail() {
  printf 'privacy verification failed: %s\n' "$1" >&2
  failures=$((failures + 1))
}

if command -v gitleaks >/dev/null 2>&1; then
  debug "gitleaks"
  if git -C "$scan_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if ! gitleaks git "$scan_root" --log-opts=-1 --redact --no-banner \
      --exit-code 1 >/dev/null; then
      fail "gitleaks found credential-like content in the current commit"
    fi
    if ! {
      git -C "$scan_root" diff --no-ext-diff --binary HEAD
      git -C "$scan_root" ls-files --others --exclude-standard | while IFS= read -r changed_file; do
        [[ -f "$scan_root/$changed_file" ]] || continue
        printf '\nfile: %s\n' "$changed_file"
        sed -n '1,$p' "$scan_root/$changed_file"
      done
    } | gitleaks stdin --redact --no-banner --exit-code 1 >/dev/null; then
      fail "gitleaks found credential-like content in changed files"
    fi
  elif ! gitleaks dir "$scan_root" --redact --no-banner --exit-code 1 >/dev/null; then
    fail "gitleaks found credential-like content"
  fi
else
  fail "gitleaks is required"
fi

scan_private_term() {
  local label="$1"
  local term="$2"
  if [[ ${#term} -ge 4 ]] && rg -l -F --hidden \
    -g '!**/.git/**' -g '!**/.git' -g '!**/node_modules/**' -g '!**/dist/**' \
    -g '!**/*.xcodeproj/**' -g '!**/DerivedData/**' \
    -g '!scripts/verify-release-privacy.sh' \
    -- "$term" "$scan_root" >/dev/null 2>&1; then
    fail "$label appears in release content"
  fi
}

scan_private_account() {
  local term="${1:-}"
  local lower_term
  lower_term="$(printf '%s' "$term" | tr '[:upper:]' '[:lower:]')"
  case "$lower_term" in
    ""|root|admin|administrator|user|developer|dev|test|runner|github|actions)
      return
      ;;
  esac
  scan_private_term "local account name" "$term"
}

scan_private_term "local home path" "${HOME:-}"
debug "machine identifiers"
scan_private_account "${USER:-}"
scan_private_term "Git author name" "$(git config --global --get user.name 2>/dev/null || true)"
scan_private_term "Git author email" "$(git config --global --get user.email 2>/dev/null || true)"
scan_private_term "local hostname" "$(hostname 2>/dev/null || true)"
scan_private_term "local computer name" "$(scutil --get ComputerName 2>/dev/null || true)"
scan_private_term "local Bonjour hostname" "$(scutil --get LocalHostName 2>/dev/null || true)"

debug "generic paths"
if rg -l --hidden -g '!**/.git/**' -g '!**/.git' -g '!**/node_modules/**' \
  -g '!**/dist/**' -g '!**/*.xcodeproj/**' \
  -g '!scripts/verify-release-privacy.sh' \
  -g '!ios/RuntimeBriefTests/DemoDataTests.swift' \
  '/Users/(?!developer(?:/|\b)|example(?:/|\b)|dev(?:/|\b)|fixture(?:/|\b)|test(?:/|\b))' "$scan_root" \
  --pcre2 >/dev/null 2>&1; then
  fail "a non-fictional absolute macOS user path is present"
fi

if rg -l --hidden -g '!**/.git/**' -g '!**/.git' -g '!**/node_modules/**' \
  -g '!**/dist/**' -g '!**/*.xcodeproj/**' \
  -g '!scripts/verify-release-privacy.sh' \
  -g '!ios/RuntimeBriefTests/DemoDataTests.swift' \
  '/home/(?!developer(?:/|\b)|example(?:/|\b)|user(?:/|\b)|dev(?:/|\b)|fixture(?:/|\b)|test(?:/|\b))' "$scan_root" \
  --pcre2 >/dev/null 2>&1; then
  fail "a non-fictional absolute Linux user path is present"
fi

if rg -l --hidden -g '!**/.git/**' -g '!**/.git' -g '!**/node_modules/**' \
  -g '!**/dist/**' -g '!**/*.xcodeproj/**' \
  -g '!scripts/verify-release-privacy.sh' \
  -g '!ios/RuntimeBriefTests/DemoDataTests.swift' \
  -g '!ios/RuntimeBrief/Networking/ServerSettings.swift' \
  '(?<!example)(?<!tailnet)(?<!tail1234)\.ts\.net' "$scan_root" \
  --pcre2 >/dev/null 2>&1; then
  fail "a non-example tailnet hostname is present"
fi

debug "demo source"
if [[ -f "$scan_root/ios/RuntimeBrief/Demo/DemoData.swift" ]]; then
  if rg -n '/Users/|/home/|\.ts\.net|Bearer |com\.backbrief\.app|127\.0\.0\.1|192\.168\.' \
    "$scan_root/ios/RuntimeBrief/Demo/DemoData.swift" >/dev/null 2>&1; then
    fail "demo source contains a prohibited path, network, token, or production identifier"
  fi
fi

debug "result"
if (( failures > 0 )); then
  exit 1
fi

printf 'privacy verification passed for %s\n' "$scan_root"
