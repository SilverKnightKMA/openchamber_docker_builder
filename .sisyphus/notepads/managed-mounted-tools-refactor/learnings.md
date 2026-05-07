
## Task 1 - Manifest Schema and Version Policy (2026-05-07)

### Key findings

1. **Single source-of-truth is a JSON manifest at `/opt/openchamber/managed-tools/manifest.json`** baked into the image, never user-mounted.

2. **Six ecosystems are modeled**: npm, goToolchain, goTools, rustToolchain, releaseBinaries, gh. Each ecosystem has its own version, source, installPath, comparePolicy, normalize array, installCmd, and versionSource fields.

3. **Normalization is per-ecosystem, not global**: `stripLeadingV` (npm, goTools, rust, release, gh), `stripLeadingGo` (goToolchain only), `replace-devel-with-0.0.0` (goTools only).

4. **goTools uses `semver-or-devel` compare policy**: handles both versioned modules and `(devel)` builds from `go version -m`.

5. **npm versionSource is `lockfile`** (not manifest directly) - version comes from `package-lock.json`'s `npmResolved` or `version` field. `installCmd` uses `npm ci --prefix` with `--ignore-scripts` for safety.

6. **goToolchain versionSource is `manifest`** - version pinned via SHA256-pinned tarball manifest at build time; install via `tar -C`.

7. **releaseBinaries reuse `tools/release-tools.json`** (unchanged location, keeps existing `requireUpstreamChecksum` policy).

8. **Source-of-truth policy is strict**: no user-mounted metadata trusted; bootstrap state (`~/.local/state/openchamber/bootstrap.lock`) is written after install, never used to determine versions.

9. **installPath follows existing compose conventions**: `~/.npm-global`, `~/.go`, `~/.go/bin`, `~/.rustup`, `~/.cargo`, `~/.local/bin`.

10. **Inherited from deterministic-managed-installs learnings**: `npm ci` does not support `--global` flag; use `--prefix` + configured `prefix` in `.npmrc` for global-style deterministic installs. `go version -m -json` gives structured output for Go binary version detection.


## Task 2 - Dockerfile baked core split (2026-05-07)

### Key findings

1. The baked apt layer now excludes `neovim`, `vim`, and `tmux`, matching the approved smaller core.
2. The separate baked `gh` apt layer was removed entirely so `gh` can be handled by the managed mounted-tool flow later.
3. `cloudflared`, DinD, OpenChamber runtime wiring, and bootstrap essentials remain untouched in the Dockerfile.


## Task 3 - npm-managed installer and status checks (2026-05-07)

### Key findings

1. `npm ci --prefix` installs a local project layout under the prefix (`node_modules` plus `.bin` links), which matches deterministic lockfile installs and avoids `npm install -g`.
2. Higher installed direct package versions must not be fed into the lockfile install plan as desired versions, because that would trust mounted state; the script instead installs from a scratch prefix backed by the baked lockfile and preserves higher direct packages by skipping their copy-back.
3. The status path can derive every desired npm package/version from baked `package.json` plus `package-lock.json`; mounted metadata is only inspected to compare currently installed package versions.
4. Manual QA used a small npm package fixture to cover missing install, equal skip, lower upgrade, and higher warn/no-downgrade without requiring a full container image build.


## Task 3 Verification Fix - local managed-tools npm source layout (2026-05-07)

### Key findings

1. Local verification should use the same root shape as runtime: `managed-tools/manifest.json` plus `managed-tools/npm/package.json` and `managed-tools/npm/package-lock.json`.
2. Dockerfile copy paths should mirror the local managed-tools tree instead of synthesizing a runtime-only tree from repo-root package files.
3. The status command now works directly with `--root "$PWD/managed-tools"`, preserving the baked lockfile source of truth while avoiding any mounted metadata authority.

## Task 4 - Managed Go toolchain and tools (2026-05-07)

### Key findings

1. `go version -m -json` should be executed with the managed Go binary when the host image no longer has baked `/usr/local/go`; otherwise status checks cannot inspect mounted binaries before PATH is updated.
2. `gopls` reports its module version through `Main.Version` with `Path` equal to `golang.org/x/tools/gopls`; `shfmt` reports binary path `mvdan.cc/sh/v3/cmd/shfmt` while the module version is under `Main.Path` `mvdan.cc/sh/v3`.
3. Installing Go tools from the managed module with `go install -mod=readonly golang.org/x/tools/gopls mvdan.cc/sh/v3/cmd/shfmt` works; `./...` is not suitable because the tool manifest package imports command packages under the `tools` build tag.
4. Local verification can bootstrap Go into a temp `--go-root` and tools into a separate temp `--go-bin`, then use the same script for missing, equal, lower, and higher status paths without trusting user-written metadata.


## Task 5 - Managed release-binary and rustup installers (2026-05-07)

### Key findings

1. `gh` is now modeled separately from the shared release-binary manifest so its source of truth remains `managed-tools/gh.json` and its install target is exactly `$HOME/.local/bin/gh`.
2. Managed release binaries can reuse the existing release-tool trust model: baked manifests require upstream checksums, disallow download-and-hash fallback, and verify SHA-256 before extraction/install.
3. GitHub release asset digest metadata works as the authoritative checksum source for LLVM/CMake/protobuf-style archives when project-specific checksum assets are unavailable.
4. Rustup-managed installs need both `CARGO_HOME` and `RUSTUP_HOME` in the child process environment; otherwise temp-root verification can install wrappers under one root while default toolchain metadata is written elsewhere.
5. Release-binary status parsing needs to accept semver-like two-component versions such as `libprotoc 33.1` and date-style versions such as `marksman 2026-02-08`.


## Task 5 Verification Fix - baked Rust apt packages (2026-05-07)

### Key findings

1. When adding rustup-managed installer support, the Dockerfile apt package block must also exclude `rustc` and `cargo`; otherwise Rust remains partly baked despite managed `$HOME/.rustup` and `$HOME/.cargo` flows.
2. The approved baked core package set remains compatible without Debian Rust packages because rustup bootstrap uses existing baked `curl`, `ca-certificates`, shell, and archive utilities.
3. For future task checks, search the apt package block specifically for managed-tool package names after adding installer wiring, not just the new script/manifests.


## Task 6 - Compose, PATH, and managed bootstrap wiring (2026-05-07)

### Key findings

1. The runtime bootstrap wrapper should initialize managed tools in a fixed order before launching OpenChamber: npm, release binaries, Rust, then Go. That keeps PATH discovery available for all later steps without depending on user metadata.
2. `MANAGED_TOOLS_BIN_DIR` needs to lead PATH ahead of the family-specific mounted bins so the shared shim directory wins first, followed by `~/.npm-global/bin`, `~/.go/bin`, `~/.cargo/bin`, `~/.bun/bin`, and `~/.local/pip/bin`.
3. Compose should surface the managed mount targets and bootstrap toggle explicitly, but the actual trust source remains the baked manifest and scripts.

## Task 7 - Status and compare diagnostics (2026-05-07)

### Key findings
1. Status output is now uniform across npm, Go, Rust, and release-binary managed tools: each family reports `desired`, `actual`, `path`, and `state` on a single line.
2. Empty temp-root status checks still report `missing` cleanly for every family without requiring any installs, which keeps the compare surface testable in isolation.
3. Go status continues to rely on `go version -m` for installed binaries, so module versions are derived from binary metadata rather than user-written state.


## Task 8 - Final validation sweep and documentation update (2026-05-07)

### Key findings

1. The final runtime model is a three-tier split: baked core, managed mounted tools, and custom mounted tools.
2. The managed bootstrap scripts compare against the baked manifest and intentionally treat higher user-mounted versions as warnings rather than downgrades.
3. `gh` is part of the managed mounted-tool flow, not the baked apt set, and its state is driven by `managed-tools/gh.json`.
4. The README now documents the supported upgrade path as rebuild/pull a newer image, then let startup bootstrap reconcile mounted managed volumes.


## Final Review (2026-05-07)

### Key findings
1. Bootstrap order is correct: the root entrypoint starts managed-tools reconciliation before handing off to the upstream OpenChamber entrypoint, so managed PATH state is established early.
2. PATH behavior is aligned across the image and init wrapper: baked `ENV PATH` includes persisted tool dirs, and the init script prepends managed bin locations for npm, Go, Rust, and user-local tooling before invoking installers.
3. Compose mounts match the documented three-tier model: persisted home volumes cover managed tools plus custom user tooling, while the README clearly distinguishes baked core, managed mounted tools, and custom mounted tools.
4. Read-only verification passed: `lsp_diagnostics` reported no issues on changed scripts, and `node --check` was clean for the four managed-tools JS entrypoints.

## Baked managed apt package cleanup (2026-05-07)

- For this plan, the apt block is a fast regression check: `clangd`, `clang-format`, `cmake`, and `protobuf-compiler` must stay out of the baked image once managed-mounted installs exist.
- A direct line-pattern `rg` check is the quickest confirmation after editing the Dockerfile apt list.

## Task - Baked managed apt package cleanup (2026-05-07)

### Key findings
1. The Dockerfile apt block must be checked against the plan matrix directly; the presence of helper symlinks such as `bat` and `fd` is a strong clue that a baked managed-tool package is still present.
2. Read-only `rg` against the exact package-list lines is a reliable final confirmation after edits because diagnostics do not catch policy mismatches.

## Task - Baked npm toolchain cleanup (2026-05-07)

### Key findings
1. The plan allows baked `opencode-ai` as core experience but moves npm support/dev tools to the mounted `managed-tools/npm` lockfile flow.
2. Any Dockerfile pattern that installs the root package lockfile and symlinks all `node_modules/.bin` entries into `/usr/local/bin` violates the managed-mounted split, even if the managed npm installer also exists.
3. README references to baked npm tools should point instead to opencode-only baked npm usage and managed npm package files for support tools.
- `openchamber-managed-tools-init` must run before switching to the `openchamber` user so the mounted paths exist and the user-owned installs can proceed without permission drift.
- PATH precedence now places `/home/openchamber/.local/bin` before `/home/openchamber/.npm-global/bin`, so globally installed npm tools should not be assumed to shadow release binaries in mounted bins.
- Dockerfile now keeps only the managed release-tools manifest copy at /opt/openchamber/managed-tools/release-tools.json; the build no longer bakes /opt/openchamber/release-tools.json or installs release tools into /usr/local/bin.


## Managed release-tools bootstrap path (2026-05-07)

1. The managed release binary manifest path must follow `MANAGED_TOOLS_ROOT`: the Dockerfile copies `tools/release-tools.json` to `/opt/openchamber/managed-tools/release-tools.json`.
2. `openchamber-dind-entrypoint.sh` is the correct bootstrap hook for mounted managed tools because it calls `openchamber-managed-tools-init` before delegating to the upstream entrypoint for both root and non-root execution.


## Release-binary managed script defaults (2026-05-07)

1. Both the wrapper environment default and the direct `release-binary-managed-tools.mjs` fallback must point at `/opt/openchamber/managed-tools/release-tools.json`.
2. `release-binary-managed-tools.mjs status` requires a full managed-tools root containing `manifest.json`, `release-tools.json`, `release-binaries.json`, and `gh.json`; a release-tools-only temp root is insufficient.
- Managed npm bundle should exclude baked core runtime packages; use the status command output to confirm only mounted support/dev tools are listed.


- Review pass on 2026-05-07: changed scripts and Dockerfile had clean `lsp_diagnostics`, `node --check`, and `npm run validate:release-tools`; no remaining code-quality blockers were found in the managed-tools refactor.

## Final QA Fix - sourcing bootstrap env (2026-05-07)

1. Bootstrap scripts that export runtime environment must be sourced by the final exec shell; executing them as subprocesses only performs installs and discards PATH/env changes.
2. For the root entrypoint path, source init and exec upstream inside the same `sudo -E -u openchamber sh -c` process so the user-switch boundary does not discard managed-tool PATH updates.

## 2026-05-07 Go path split fix
- Fixed the final scope blocker by splitting managed Go persistence: GOROOT now defaults to ~/.go/toolchain, GOPATH to ~/.go/path, and GOBIN to ~/.go/path/bin.
- Dockerfile, compose, managed-tools init, and go-managed-tools now keep the Go toolchain root separate from the Go workspace/bin while staying under the same persisted ~/.go mount.
- Verification: lsp diagnostics passed for the four changed files, sh -n passed for openchamber-managed-tools-init.sh, node --check passed for go-managed-tools.mjs, rg confirmed old GOROOT/GOPATH=.go patterns are absent, and go-managed status reports toolchain under .go/toolchain with tools under .go/path/bin.

## 2026-05-07 final scope fidelity rerun
- Result: APPROVE.
- Confirmed Go persistent wiring split: GOROOT uses ~/.go/toolchain, GOPATH uses ~/.go/path, and GOBIN uses ~/.go/path/bin. Old direct GOROOT/GOPATH/GOBIN ~/.go patterns are absent from runtime wiring.
- Verification: lsp diagnostics passed for Dockerfile, managed init, go-managed script, compose, and manifest; shell and managed-script syntax checks passed; release-tool manifest validation passed; managed status commands report expected missing/equal-style states without source-of-truth or path errors.
