

## Task 3 Verification Fix - local managed-tools npm source layout (2026-05-07)

### Issue

1. Verification with `--root "$PWD/managed-tools"` failed because the script expected `managed-tools/npm/package.json` and `managed-tools/npm/package-lock.json`, but only the Dockerfile copy path populated `/opt/openchamber/managed-tools/npm` at image build time.

### Fix

1. Added `managed-tools/npm/package.json` and `managed-tools/npm/package-lock.json` so the repo root and Docker runtime use the same managed-tools source layout.
2. Updated the Dockerfile to copy the npm source files from `managed-tools/npm/` instead of the repo root package files.

### Verification

1. `node -e "JSON.parse(require('fs').readFileSync('managed-tools/manifest.json','utf8')); console.log('manifest ok')"` passed.
2. `tmp=$(mktemp -d) && node scripts/managed-tools/npm-managed-tools.mjs status --root "$PWD/managed-tools" --prefix "$tmp" && rm -rf "$tmp"` passed and reported all pinned npm tools as missing for the empty temp prefix.
3. File-level diagnostics were clean for the Dockerfile, npm-managed script, managed manifest, and managed npm package/lock files.


## Task 5 Verification Fix - baked Rust apt packages (2026-05-07)

### Issue

1. Review found `rustc` and `cargo` still listed in the Dockerfile apt package block after adding rustup-managed installer support.
2. Keeping those packages baked conflicts with the managed-mounted-tools plan because Rust tooling must come from rustup into mounted `$HOME/.rustup` and `$HOME/.cargo`.

### Fix

1. Removed `rustc` and `cargo` from the Dockerfile apt install list.
2. Left the rustup-managed installer manifests/scripts and Dockerfile managed-tool wiring intact.

### Verification

1. `git diff --stat` was run after the fix.
2. File-level diagnostics were clean for `Dockerfile.dockerfile`, `scripts/managed-tools/release-binary-managed-tools.mjs`, and `scripts/managed-tools/rust-managed-tools.mjs`.
3. A direct read of the Dockerfile apt block showed `rustc` and `cargo` are no longer present.
4. `rg -n '^  (rustc|cargo|neovim|vim|tmux|gh) ' Dockerfile.dockerfile` returned no matches, confirming the removed apt tools are absent from the package list.

## Task 5 Verification Fix - parent QA follow-up (2026-05-07)

1. Parent verification re-read the Dockerfile apt block and confirmed `rustc`/`cargo` remain absent.
2. Parent verification ran release-binary and Rust status commands against temporary roots; both reported expected missing-state output without errors.

## Baked managed apt packages blocker (2026-05-07)

- Review found `clangd`, `clang-format`, `cmake`, and `protobuf-compiler` still baked in the Dockerfile apt block.
- Removed those packages from `Dockerfile.dockerfile` and verified the package lines were gone with `rg -n '^  (clangd|clang-format|cmake|protobuf-compiler) ' Dockerfile.dockerfile`.

## Baked managed apt packages blocker resolved (2026-05-07)

### Issue
1. `Dockerfile.dockerfile` still apt-installed managed-mounted tools (`bat`, `fd-find`, `fzf`, `ripgrep`, `shellcheck`, `tree`, `universal-ctags`, `strace`) even though the plan matrix assigns them to managed mounted installs.

### Fix
1. Removed those packages from the Dockerfile apt install list and removed the associated `bat`/`fd` symlink shims.

### Verification
1. `git diff --stat` was run after the change.
2. `rg -n '^  (bat|fd-find|fzf|ripgrep|shellcheck|tree|universal-ctags|strace) ' Dockerfile.dockerfile` returned no matches.
3. File-level diagnostics were clean for `Dockerfile.dockerfile`, `README.md`, and `docker-compose.example.yml`.
4. A direct read of the Dockerfile apt block confirmed the removed packages are absent.

## Baked root npm toolchain blocker resolved (2026-05-07)

### Issue
1. `Dockerfile.dockerfile` still copied root `package.json`/`package-lock.json` into `/opt/openchamber/toolchain`, ran `npm ci --omit=dev --prefix /opt/openchamber/toolchain`, and symlinked every root npm bin into `/usr/local/bin`.
2. That re-baked npm support/dev tools that the plan moved to managed mounted installs under `~/.npm-global`; only the core `opencode-ai` package should remain baked.

### Fix
1. Removed the root package copy to `/opt/openchamber/toolchain` and the full npm bin symlink loop.
2. Replaced it with an opencode-only baked npm install into `/opt/openchamber/npm-global` and a single `/usr/local/bin/opencode` symlink.
3. Updated README wording so root package files are no longer described as baked npm tool declarations and managed npm tools remain tied to `managed-tools/npm/`.

### Verification
1. `git diff --stat` was run after the change.
2. `rg -n '/opt/openchamber/toolchain|npm ci --omit=dev --prefix /opt/openchamber/toolchain|node_modules/.bin|for bin in' Dockerfile.dockerfile` returned no matches.
3. JSON parse validation passed for root package files, managed npm package files, and `managed-tools/manifest.json`.
4. `npm run validate:release-tools` passed.
5. File-level diagnostics were clean for `Dockerfile.dockerfile` and `README.md`.

## README outdated baked-root-npm wording (2026-05-07)

### Issue
README line 184 referenced `/opt/openchamber/npm-global/bin` and listed fallback global tools like `eslint`, `prettier`, `biome`, `pnpm` as baked-in PATH entries. After the baked root npm toolchain removal, those tools are no longer baked; managed npm tools install to the mounted prefix during bootstrap instead.

### Fix
Updated the wording to say managed npm tools may appear in persisted PATH after bootstrap, and project-local commands remain preferred. Removed the stale `/opt/openchamber/npm-global/bin` reference and the specific fallback tool list.

### Verification
lsp_diagnostics clean on README.md after edit.
- The runtime entrypoint calls `/usr/local/bin/openchamber-managed-tools-init` only in the non-root branch; the root branch skips it, so managed tools will not bootstrap before `exec sudo -E -u openchamber ...`.
- `Dockerfile.dockerfile` copies a managed-tools init wrapper and script bundle, but the bootstrap order around `USER root`/`USER openchamber` makes the managed-tool setup dependent on which branch enters the entrypoint first.
- `README.md` describes managed mounted tools and PATH ordering, but the compose example comments and runtime details should be checked together for exact mount naming and expectations.
- Found stale build-time release-tool installation in Dockerfile.dockerfile during scope verification; removed install-release-tools copy/chmod and the RUN install step so release binaries remain managed in mounted volumes only.

## Final Scope Fidelity Check - release-tools build-time removal (2026-05-07)

- Read-only verdict: reject.
- Release-managed binaries are no longer installed at build time by the Dockerfile; manifests and scripts are copied under /opt/openchamber/managed-tools and runtime init targets mounted paths such as $HOME/.local/bin.
- OpenCode core remains baked via npm install --prefix /opt/openchamber/npm-global opencode-ai@1.14.39 and /usr/local/bin/opencode symlink.
- Scope gap: managed-tools/npm/package.json and package-lock.json still include opencode-ai, so managed npm bootstrap would install a mounted opencode copy in /home/openchamber/.npm-global/bin ahead of the baked /opt/openchamber/npm-global/bin path.


## Managed release-tools manifest path blocker (2026-05-07)

### Issue

1. `scripts/openchamber-managed-tools-init.sh` still defaulted `MANAGED_RELEASE_TOOLS_MANIFEST` to `/opt/openchamber/release-tools.json` after the Dockerfile stopped copying the manifest there.
2. The Dockerfile now provides the manifest at `/opt/openchamber/managed-tools/release-tools.json`, so the release-binary managed bootstrap would look at a missing path by default.

### Fix

1. Updated the init default to `/opt/openchamber/managed-tools/release-tools.json` without reintroducing the old copy location or build-time release-tool installation.
2. Confirmed `scripts/openchamber-dind-entrypoint.sh` already runs `/usr/local/bin/openchamber-managed-tools-init` before the upstream entrypoint in both root and non-root paths.


## Managed release-binary direct default blocker (2026-05-07)

### Issue

1. `scripts/managed-tools/release-binary-managed-tools.mjs` still defaulted `DEFAULT_RELEASE_TOOLS` to `/opt/openchamber/release-tools.json` after the Dockerfile stopped placing the manifest there.

### Fix

1. Updated the script default to `/opt/openchamber/managed-tools/release-tools.json` so direct script invocation matches the Dockerfile-managed manifest location.
2. Left `scripts/install-release-tools.sh` unchanged as a standalone maintenance helper, per verification guidance.
- Final verification flagged `opencode-ai` in `managed-tools/npm`; resolved by removing it from the managed npm manifest and lockfile so opencode remains baked-core only.

## Final QA Check - managed npm bundle split (2026-05-07)

### Verification
- `managed-tools/npm/package-lock.json` has no `opencode-ai` entries, so the mounted npm bundle no longer shadows the baked core `opencode` install.
- `Dockerfile.dockerfile` still wires `openchamber-managed-tools-init` into the entrypoint path, and the runtime PATH keeps `/opt/openchamber/npm-global/bin` for the baked core binary.
- `docker-compose.example.yml` and `README.md` both document the managed mount set (`.npm-global`, `.bun`, `.local/bin`, `.local/pip`, `.cargo`, `.rustup`, `.go`) consistently.

## Final QA - managed mounted tools bootstrap path (2026-05-07)

### Blocking issue
1. `scripts/openchamber-managed-tools-init.sh` only exports the managed-tool PATH inside the bootstrap process, so the updated PATH does not persist into the final long-running shell launched by `scripts/openchamber-dind-entrypoint.sh` / upstream entrypoint. The managed binaries in `~/.local/bin`, `~/.npm-global/bin`, `~/.go/bin`, `~/.cargo/bin`, `~/.bun/bin`, and `~/.local/pip/bin` will not stay on PATH for the user session unless the upstream entrypoint also re-applies that PATH change.

### Evidence
1. Running `OPENCHAMBER_MANAGED_TOOLS_BOOTSTRAP=false sh scripts/openchamber-managed-tools-init.sh` in a temp HOME printed the managed PATH inside the init script, but the parent shell PATH remained unchanged.
2. `docker-compose.example.yml` mounts the managed tool directories correctly, so the mount layout is not the blocker; the bootstrap PATH propagation is.

## Final QA Fix - managed PATH persistence (2026-05-07)

### Resolution
1. `scripts/openchamber-managed-tools-init.sh` is now safe to source: disabled bootstrap returns when sourced and exits when executed directly.
2. `scripts/openchamber-dind-entrypoint.sh` now sources the init script in the same shell that execs the upstream entrypoint, including the root path via `sudo -E -u openchamber sh -c '. init && exec entrypoint'`.

### Verification
1. `sh -n scripts/openchamber-managed-tools-init.sh && sh -n scripts/openchamber-dind-entrypoint.sh` passed.
2. LSP diagnostics were clean for both modified shell files.
3. A temp-HOME sourced-init QA confirmed the managed PATH prefixes remain present before the final exec point.

## Final QA Rerun - PATH wiring fix verified (2026-05-07)

1. Re-ran shell syntax checks for `scripts/openchamber-managed-tools-init.sh` and `scripts/openchamber-dind-entrypoint.sh`; both passed.
2. LSP diagnostics were clean for the modified shell files.
3. Temp-HOME sourced-init QA confirmed the managed PATH prefixes persist in the same shell after sourcing the bootstrap script.

## 2026-05-07 final scope fidelity check
- Result: REJECT.
- Blocking: Dockerfile and managed Go wiring still set GOROOT and GOPATH to the same persisted .go directory, so extracting the Go tarball into .go makes GOROOT look like .go/bin/go while GOPATH-derived tool installs and caches also target the toolchain root. This violates the plan boundary separating managed Go toolchain from Go tools under mounted volumes and risks corrupting/removing installed tools when the toolchain is upgraded.
- Blocking: The plan file has implementation edits in the worktree; plan files are read-only under the Sisyphus protocol, so final scope fidelity cannot approve while the plan itself is modified.

## 2026-05-07 Go path split blocker resolution
- Resolved: previous REJECT blocker where GOROOT and GOPATH both pointed at ~/.go. They now point at ~/.go/toolchain and ~/.go/path respectively, with GOBIN at ~/.go/path/bin.
