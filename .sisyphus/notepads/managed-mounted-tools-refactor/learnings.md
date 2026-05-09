
## Task 1 - Managed-tools config (2026-05-09)

### Files created
- `tools/managed-tools.json` - root manifest with schemaVersion, policy, groups (npm/go/rustup/releaseBinaries), and sources section
- `tools/managed-npm-package.json` - pinned npm deps (15 packages, matching existing package.json)
- `tools/managed-go-toolchain.json` - Go 1.26.2 release tarball with checksum
- `tools/managed-go/go.mod` - separate go.mod for managed gopls+shfmt
- `tools/managed-go/go.sum` - regenerated from root go.sum (74 entries)
- `tools/managed-rustup.json` - rustup toolchain profile config
- `tools/managed-release-binaries.json` - gh release binary with checksum policy (aligned with release-tools.json pattern)
- `scripts/validate-managed-tools.sh` - validation script checking all manifests

### Policy alignment
- `requireUpstreamChecksum: true`, `allowDownloadAndHash: false` enforced for all groups
- Compare rules: missing=install, equal=skip, lower=upgrade, higher=warn_skip, unparseable=warn_skip
- Schema version 1 for forward compatibility

### Key pattern: config is repo-hosted, not baked
- `tools/managed-tools.json` sources section defines fetch URL pattern from GitHub raw content
- Image should NOT contain baked managed-tools config - only scripts that fetch and consume it
- Init/update scripts (later tasks) will fetch from `origin/main` by default

### Validation coverage
- `npm run validate:release-tools` - still works, checks existing release-tools.json
- `sh scripts/validate-managed-tools.sh` - new, checks all managed-tool manifests

### SHA256 note
- gh entry uses a placeholder SHA256 (`aaa...`) since actual release checksums need upstream resolution at update time
- This is consistent with how other release tools in this repo handle checksums - they're verified at install time against fetched upstream metadata

### gh checksum resolved (2026-05-09)
- The gh 2.68.0 linux_amd64.tar.gz SHA256 is `dcd944ecd9905b62fbaf3fe3703af7d6f9a33bc8c36d8603af55cab0d3f67879` (from upstream `gh_2.68.0_checksums.txt` at github.com).
- Replaced placeholder `aaa...` with real upstream checksum.
- Validation script now passes cleanly.

## Task 2 - Dockerfile core trim (2026-05-09)
- Removed baked `gh`, `neovim`, `vim`, `tmux`, `uv`, Go toolchain, release-tool install flow, and baked Rust toolchain from `Dockerfile.dockerfile`.
- Preserved OpenChamber runtime, `cloudflared`, DinD, `build-essential`, `python3-pip`, `python3-venv`, `nano`, `git-lfs`, and core bootstrap helpers.
- Kept `opencode-ai` baked as core runtime support, installed via `npm install -g opencode-ai@1.14.39`.

## Task 3 - Managed npm installer/status (2026-05-09)
- Added `scripts/install-managed-npm-tools.mjs` with `status` and `install` modes for npm-managed tools only.
- Script reads pinned desired versions from `tools/managed-npm-package.json` and installs with `npm ci --omit=dev --prefix ~/.npm-global` using `tools/managed-npm-package-lock.json`.
- Status compares installed `node_modules/*/package.json` versions directly, not mounted metadata: missing=install, equal=skip, lower=upgrade, higher=warn_skip, unparseable=warn_skip.
- Installer mirrors `node_modules/.bin` entries into `~/.npm-global/bin` so existing PATH wiring exposes managed npm tools.

## Task 4 - Managed Go installer/status (2026-05-09)
- Added `scripts/install-managed-go-tools.mjs` with `status` and `install` modes for Go only.
- Status reads real installed state from the mounted Go binary and `go version -m` output for `gopls`/`shfmt`; it does not read or trust user-written metadata.
- Installer downloads the pinned Go tarball, verifies SHA256 before extraction, then installs tools from `tools/managed-go/go.mod` with `go install -mod=readonly`.

## Task 5 - Managed release-binary and rustup installers (2026-05-09)
- Added release-binary installer/status flow that reads actual `~/.local/bin/<tool> --version`, verifies upstream checksum asset content before install, and then verifies the downloaded archive SHA256 before copying the binary.
- Added rustup installer/status flow that reads actual `~/.cargo/bin/rustup`, `rustc`, and `cargo` outputs from `CARGO_HOME`/`RUSTUP_HOME`; mounted metadata is not used as version authority.
- `tools/managed-rustup.json` now pins the current stable Rust release version (`1.95.0`) so compare behavior can report equal/lower/higher explicitly instead of treating the moving `stable` channel as sufficient.

## Task 6 - Compose/env/path wiring (2026-05-09)
- Runtime PATH now starts with managed mounted tool dirs before system paths: `/opt/openchamber/npm-global/bin`, `~/.local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, `~/.cargo/bin`, `~/.go/toolchain/bin`, `~/.go/bin`, and `~/.local/pip/bin`.
- `scripts/openchamber-dind-entrypoint.sh` exports the same managed PATH before optional DinD and OpenChamber startup so mounted tools are discoverable even when environment PATH differs.
- Compose keeps existing mounts and documents managed install targets plus the disabled-by-default `OPENCHAMBER_MANAGED_TOOLS_AUTOINSTALL` flag.

## Task 7 - Unified managed-tools status (2026-05-09)
- Added `scripts/managed-tools-status.mjs` as unified reporter for npm, Go, release binaries, and rustup.
- Output columns include `family`, `type`, `name`, `desired`, `actual`, `path`, `state`, `action`, and `source`.
- Status command is read-only and uses actual installed paths plus manifest-backed desired versions; mounted metadata is not trusted.

## Task 8 - Final validation sweep (2026-05-09)

- README now states three-tier model explicitly: baked core, managed mounted tools, custom mounted tools.
- `npm run managed:status` reports expected missing state in empty workspace; managed mounts stay opt-in and do not auto-populate.
- Evidence files captured for managed-tools validation, release-tool validation, and unified status output under `.sisyphus/evidence/`.
- Added `npm run managed:init` / `managed:update` entrypoints that fetch repo-hosted managed config from `origin/main` by default, accept `--ref <ref>`, and stage config before invoking family installers.
- Kept startup autoinstall opt-in only via `OPENCHAMBER_MANAGED_TOOLS_AUTOINSTALL=true`; entrypoint now routes through shared managed-tools workflow instead of calling installers directly.

## Task 9 - Baked-vs-mounted split blocker trim (2026-05-09)
- Removed `clangd`, `clang-format`, `cmake`, and `protobuf-compiler` from `Dockerfile.dockerfile` apt list so managed tool families stay out of baked image.
- Managed init/update workflow remains documented in README and compose comments; `managed-tools` scripts stay baked as bootstrap helpers.
- Validation commands passed after trim: `npm run validate:release-tools`, `sh scripts/validate-managed-tools.sh`, and targeted `rg` checks.
