
## Task 2 - Dockerfile core trim (2026-05-09)
- None. Dockerfile syntax check and targeted grep validation passed after removals.

## Task 3 - Managed npm installer/status (2026-05-09)
- npm reported existing dependency audit findings during validation: 2 moderate and 4 high vulnerabilities from current pinned managed npm dependency set. Not changed in this task.

## Task 4 - Managed Go installer/status (2026-05-09)
- `npm run managed:go:status` reports Go/gopls/shfmt as missing in this workspace because there is no managed Go toolchain installed here; this is the expected clear degradation path.
- The LSP diagnostic provider still reports a stale Biome parse error for `package.json` at EOF, but `node` JSON parsing and local `npm exec -- biome check package.json` both pass.

## Task 5 - Managed release-binary and rustup installers (2026-05-09)
- `npm run managed:release-binaries:status` reports `gh` missing in this workspace because the managed local-bin volume is not populated; this is the expected clear degradation path.
- `npm run managed:rustup:status` reports rustup/rustc/cargo missing in this workspace because no managed Rust toolchain is installed here; this is the expected clear degradation path.
- The LSP diagnostic provider still reports a stale Biome EOF parse error for `package.json`, but direct JSON parsing and `npm exec -- biome check ...` pass.

## Task 6 - Compose/env/path wiring (2026-05-09)
- No new implementation issues found. LSP diagnostics for changed files were clean.
- `sh scripts/validate-managed-tools.sh` still skips full Go dependency verification when Go is absent in this workspace; manifest structure validation passed.

## Task 7 - Unified managed-tools status (2026-05-09)
- `package.json` still shows stale Biome EOF parse diagnostic through LSP, but `node` JSON parsing succeeds and npm script wiring works.

## Task 8 - Final validation sweep (2026-05-09)

- No new issues. LSP diagnostics stayed clean on edited docs; `managed:status` still reports missing tools in this empty workspace, which is expected.
- Managed status still reports tools missing in this workspace because mounted tool volumes are empty; expected behavior, not failure.
- `npm run managed:init -- --dry-run --ref main` and `npm run managed:update -- --dry-run --ref main` only staged/fetched config, no installs, which is the right local validation path here.

## Task 9 - Baked-vs-mounted split blocker trim (2026-05-09)
- No new issues. One initial `rg` pattern was malformed; rerun with fixed character classes and confirmed removed tools no longer match apt list.

## Task 10 - managed-tools status runtime module-not-found (2026-05-09)
- `managed-tools status` threw module-not-found inside container because `scripts/managed-tools-status.mjs` was not copied to the image. The status command hardcoded `node scripts/managed-tools-status.mjs` which only worked from repo root.
- Fix: (1) Added `COPY scripts/managed-tools-status.mjs /usr/local/bin/managed-tools-status` to Dockerfile, (2) Added chmod +x for it, (3) Updated `scripts/managed-tools.mjs` to use `installerCommand("/usr/local/bin/managed-tools-status", "scripts/managed-tools-status.mjs", [configPath])` — prefers local dev file if present, falls back to installed binary in container.

## Task 11 - chmod regression for install-managed-* scripts (2026-05-09)
##
- Fixing Dockerfile chmod regression: adding back chmod +x entries for install-managed-npm-tools, install-managed-go-tools, install-managed-release-binaries, install-managed-rustup that were dropped during managed-tools-status copy addition.

## Task 12 - managed-tools status ENOENT for missing local tools/managed-tools.json (2026-05-09)
- Running `managed-tools status` from `/home/openchamber` (no local repo) threw ENOENT because the status command passed the default `tools/managed-tools.json` relative path to `managed-tools-status`, which tried to `readFile()` it directly without fetching/staging first.
- Root cause: the status command path used `configPath` (defaulting to `"tools/managed-tools.json"`) directly, unlike init/update/fetch which call `loadManagedConfig` and `stageManagedConfig` first.
- Fix: created `runStatus()` that (1) calls `loadManagedConfig(effectiveRef)` to fetch the config (from local file, git, or raw URL), (2) calls `stageManagedConfig()` to stage all config files to a temp dir, (3) writes the loaded `managedConfig` as `tools/managed-tools.json` in the staged dir (since it's not in `configFiles`), (4) invokes `managed-tools-status` with the staged config path. Uses `stdio: ["pipe", "inherit", "pipe"]` to pass stdout through directly, avoiding double-pipe buffering that suppressed output in the original implementation.
- Local dev (from repo root with local `tools/managed-tools.json`): works, status shows tool inventory.
- Container run from `/home/openchamber` without repo: `loadManagedConfig` falls back to git fetch from `origin/main` then raw GitHub URL; raw URL fetch fails with 404 for this private-ish repo, so this scenario requires either a public repo or additional fallback (e.g., a baked-in default config or a different fetch mechanism).
QW|## Task 13 - managed-tools config repo-first default (2026-05-09)
HS|- Added `--local-config` flag to `scripts/managed-tools.mjs`. Removed implicit local-first behavior in `loadManagedConfig` (line 52) and `resolveSourceFile` (line 75).
ZV|- `loadManagedConfig`: now fetches from git (`origin/<ref>`) then raw GitHub URL by default; local file only read when `useLocalConfig && existsSync(configPath)`.
NM|- `resolveSourceFile`: local file fallback removed unless `useLocalConfig && existsSync(sourcePath)`; throws fetch error instead.
HB|- Usage updated to `[init|update|fetch|status] [--local-config] [--ref ref] [--dry-run]` — positional config path removed since local-only use is now opt-in.

## Task 14 - Hardcoded managed-tools raw URL fix (2026-05-09)
- Fixed `defaultFetchUrl` in `scripts/managed-tools.mjs` line 21: changed `SilverKnightKMA/open_chamber_docker` to `SilverKnightKMA/openchamber_docker_builder` to match actual git remote.
- Verification: grep confirms correct URL; dry-run `npm run managed:status -- --dry-run --ref main` successfully fetched config from raw GitHub.

## Task 15 - managed-tools installer path resolution with staged cwd (2026-05-09)
- Full install test failed with `Cannot find module '/tmp/managed-tools-*/scripts/install-managed-npm-tools.mjs'` because `installerCommand()` returned relative path `scripts/install-managed-npm-tools.mjs` which is not found when `runInstallers()` executes with `cwd: configRoot` (a temp staged dir).
- Fix: added `resolve` to `node:path` imports and modified `installerCommand()` to return `resolve(scriptPath)` instead of raw `scriptPath` when the local file exists. The installed binary fallback behavior is unchanged.
- Verification: dry-run `node scripts/managed-tools.mjs init --local-config --dry-run` staged configs correctly; local installer scripts confirmed present at `scripts/install-managed-*.mjs`.

## Task 11 - Go toolchain checksum mismatch fix (2026-05-09)
- Full install test failed at Go 1.26.2 checksum: expected old value `47ce5636e9936b2c5cbf708925578ef386b4f8872aec74a67bd13a627d242b19`, got official `990e6b4bbba816dc3ee129eaeaf4b42f17c2800b88a2166c265ac1a200262282`.
- Source of truth: official go.dev release JSON metadata confirms `990e6b4...` for `go1.26.2.linux-amd64.tar.gz`.
- Fixed: replaced checksum in `tools/managed-go-toolchain.json`. No version change.

## Task 11 - --local-config resolveSourceFile local-first (2026-05-09)
- Fixed `resolveSourceFile()` to check local first when `useLocalConfig` is set. Previously checked git, then raw, then local fallback - which meant stale origin/main checksums were used even with `--local-config`. Now follows same pattern as `loadManagedConfig()` which already honored local root manifest first.

## Task 16 - Managed Go go.sum completeness for -mod=readonly (2026-05-09)
- `go install -mod=readonly golang.org/x/tools/gopls@v0.21.1` failed missing h1 hash entries in `go.sum`.
- Root cause: `golang.org/x/telemetry` had only `go.mod` hash entry for `v0.0.0-20260109210033-bd525da824e2` but no h1 zip hash. gopls transitively depends on telemetry which requires newer versions of sync, mod, and sys at build time.
- Fix: Added 8 new go.sum entries from Go checksum database (sum.golang.org): telemetry `v0.0.0-20251111182119-bc8e575c7b54` h1+go.mod, mod v0.35.0 h1+go.mod, sync v0.20.0 h1+go.mod, sys v0.43.0 h1+go.mod.
- Also removed stray blank line at line 47 in go.sum.
- Verification: all 82 entries in go.sum now have exactly 3 fields; no go.mod-only entries remain for active versions.

## Task 17 - Go module/cache path isolation in managedEnv (2026-05-09)
## 
## - Full managed install in temp HOME got past Go checksum validation but failed during `go install -mod=readonly` with error paths referencing `/home/openchamber/.go/pkg/mod/...` — Go module cache was not isolated to temp HOME.
## - Root cause: `managedEnv()` set GOBIN and GOROOT but not GOPATH or GOMODCACHE, so Go defaulted its module cache to `$HOME/.go/pkg/mod` (real user home) instead of the managed temp HOME path.
## - Fix: Added GOPATH=`join(userHome, ".go")` and GOMODCACHE=`join(userHome, ".go", "pkg", "mod")` to `managedEnv()` so all Go cache/toolchain state stays under managed `.go` in the isolated temp HOME during install.
## - Verification: `node --check scripts/install-managed-go-tools.mjs` passed; LSP diagnostics clean; no reads from `/home/openchamber/.go/pkg/mod` during temp HOME tests.
