# Publishing a clean public repository

RuntimeBrief's public repository should begin with one reviewed root commit. Do
not publish the private development repository's Git history.

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
