# Publishing a clean public repository

RuntimeBrief's public repository should begin with one reviewed root commit. Do
not publish the private development repository's Git history.

The initial-publication procedure below is a one-time migration. For updates
to the existing repository, follow [ongoing releases](#ongoing-releases);
do not replace its history or create another root commit.

## Ongoing releases

1. Review the complete intended diff and preserve unrelated work. Update the
   main, daemon, and iOS READMEs, the API guide, and `CHANGELOG.md` when their
   behavior changes. Update `SECURITY.md` and `PRIVACY.md` for changes to launch
   access, permissions, or data handling.
2. Run the relevant automated tests and inspect changed user flows. Native
   Claude changes need an actual task and same-conversation Desktop handoff;
   a CLI banner or an offline demo receipt does not prove either. Record cloud,
   simulator, native Mac, and physical-phone coverage separately.
3. Run `scripts/verify-release-privacy.sh` before committing and against the
   intended commit before pushing. Keep local configuration, credentials,
   transcripts, screenshots, logs, and generated build output outside Git.
4. Push the reviewed commits to `main` and verify its daemon and iOS CI checks.
   Check security-analysis results separately; do not describe a pending scan
   as passed.
5. Deploy the daemon from the reviewed source, rebuild its dependencies for
   the installed Node runtime, and reload the launchd service. Keep its
   executable and dependencies in a stable location independent of ongoing
   checkout edits. Confirm the configured project capabilities and the paired
   phone's behavior without replacing its token or exposing a public relay.
6. For an iOS update, choose an unused build number in `ios/project.yml`,
   regenerate the Xcode project, test, archive, and upload that same build.
   Verify App Store Connect processing (`VALID`) and availability in the
   intended TestFlight group (`IN_BETA_TESTING`). Upload success alone is not
   beta availability.
7. App Review submission and public release are separate from TestFlight.
   Use [listing copy](app-store-listing.md) compatible with the selected binary;
   repository documentation changes do not publish metadata or alter an
   existing submission.

For the build-16 Claude update, deploy the daemon before distributing the iOS
selectors. The updated server accepts build-15 requests, while an older server
rejects the new model and permission fields. See the
[upgrade guide](session-control.md#upgrade-from-build-15).

## Prepare the source snapshot

1. Finish and review a private source commit.
2. Export that exact commit with `git archive`. Do not copy the working
   directory with Finder, `cp`, or `rsync`: those approaches can include
   `.git`, ignored configuration, generated Xcode projects, build output,
   databases, logs, or credentials.
3. Extract the archive into a new empty directory and run the daemon and iOS
   checks from that extracted source.
4. Scan the extracted directory for secrets and personal artifacts. At minimum,
   run gitleaks plus targeted searches for real names, email addresses, absolute
   home paths, hostnames, signing-team IDs, tokens, private keys, and real
   project fixtures.

## Create the root commit

1. Create a brand-new, empty GitHub repository. Do not use GitHub's fork,
   import, or template flows, and do not initialize it with a README, license,
   or `.gitignore`.
2. Initialize Git in the extracted source directory.
3. Configure an approved GitHub-verified publication identity. Do not invent a
   noreply address or reuse the private repository's personal author metadata.
4. Create one root commit, add the empty remote, and push only `main`. Never use
   `git push --mirror`.
5. Verify from a fresh clone that `git rev-list --count --all` returns `1`, only
   the intended branch exists, CI is green, and the source contains no ignored
   or generated artifacts.

## Recreate repository controls

After the first CI run, enable private vulnerability reporting, secret scanning
and push protection, Dependabot security updates, and branch protection for the
daemon and iOS checks. Recreate only the intended collaborators and settings;
pull requests, branches, Actions data, secrets, releases, and other private
repository state should not be migrated.
