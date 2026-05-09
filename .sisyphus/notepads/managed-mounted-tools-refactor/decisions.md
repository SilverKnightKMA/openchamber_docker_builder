
## Task 1 - Managed-tools config (2026-05-09)

### Decision: Separate managed-go/go.mod from root go.mod
The root `go.mod`/`go.sum` is for builder toolchain (gopls, shfmt built into image). The managed-go directory holds the go.mod/go.sum that would be used when installing gopls/shfmt into a mounted volume via the managed toolchain. This keeps the two use cases separate.

### Decision: Schema version 1 with explicit group keys
Used explicit group names (npm, go, rustup, releaseBinaries) rather than a flat array. This makes validation tighter and the config self-documenting. Schema version allows future incompatible changes to be detected.

### Decision: go.sum regenerated from root go.sum
The managed-go/go.sum contains only the entries needed for gopls and shfmt dependencies, regenerated from the root go.sum to ensure consistency with the actual versions being pinned.

### Decision: gh SHA256 is a placeholder
The actual gh 2.68.0 release checksum will be resolved by the update workflow (scripts/update-release-tools.mjs equivalent for managed tools). The placeholder passes validation format requirements (64 hex chars, policy checks) but is not a real checksum.

### Decision: Real gh checksum replaces placeholder (2026-05-09)
- gh 2.68.0 linux_amd64.tar.gz checksum (`dcd944e...`) was fetched directly from the upstream GitHub release checksum file. Policy requires upstream checksum and forbids download-and-hash fallback, so this was the correct approach.
- Validation confirmed: placeholder was the only remaining issue blocking task-1 sign-off.

## Task 2 - Dockerfile core trim (2026-05-09)
- Baked image now treats `opencode-ai` as only npm runtime tool; support/editor/terminal utilities move out of image.
- DinD and `cloudflared` stay in-image unchanged to preserve runtime behavior.
- Rust and Go toolchains no longer belong in baked core; they belong in managed mounted installs per task-1 contract.

## Task 3 - Managed npm installer/status (2026-05-09)
- Used project-style `npm ci --prefix ~/.npm-global` rather than `npm install -g`, preserving lockfile fidelity while installing into persisted npm volume.
- Chose real installed package manifests as comparison source so stale/mutable mounted metadata cannot make status lie.
- `higher` and `unparseable` block install to avoid hidden downgrade or unsafe overwrite.

## Task 4 - Managed Go installer/status (2026-05-09)
- Kept Go installer separate from npm installer so toolchain bootstrap, tarball checksum validation, and `go version -m` parsing stay Go-specific.
- Used the manifest `installPath` under `HOME` by default, with environment overrides only for isolated QA and nonstandard deployments.
- Updated runtime PATH to prefer `/home/openchamber/.go/toolchain/bin` instead of `/usr/local/go/bin` because Go is now managed in the mounted `.go` volume.

## Task 5 - Managed release-binary and rustup installers (2026-05-09)
- Release binaries intentionally require both an upstream checksum file entry and a matching local archive SHA256; download-and-hash alone remains forbidden.
- Rustup installs the pinned numeric toolchain version when `version` is present, while retaining `toolchain: stable` as the user-facing channel label in status output. This preserves explicit compare rules and avoids trusting rustup mounted state alone.
- Added package scripts and Dockerfile script copies for the new managed families so later init/update wiring can invoke the same install/status surface as npm and Go.

## Task 6 - Compose/env/path wiring (2026-05-09)
- Chose to gate startup installs only on exact `OPENCHAMBER_MANAGED_TOOLS_AUTOINSTALL=true`; unset or any other value leaves startup unchanged aside from PATH export.
- Chose to run all managed installer families before DinD/OpenChamber when autoinstall is explicitly enabled, using `sudo -E -u openchamber` from root entrypoint so mounted homes receive user-owned files.
- Kept managed PATH ahead of system paths so moved tools like `gh`, Go, Rust, and npm-managed binaries resolve from mounted volumes first.

## Task 7 - Unified managed-tools status (2026-05-09)
- Unified status command reports actual mounted tool paths and manifest-backed desired versions without mutating state.
- Go tool status continues to use managed `go version -m` for Go-installed binaries.

## Task 8 - Final validation sweep (2026-05-09)

- Keep docs aligned with implemented split instead of restating prior task details. The final sweep only clarifies baked core vs managed mounted tools vs custom mounted tools.
- Evidence files are useful for audit trails, so validation stdout was captured under `.sisyphus/evidence/`.
- Decision: managed-tools wrapper fetches config via `git show` first, then raw GitHub fallback, then local repo files for validation-only environments.
- Decision: `main` is default ref for init/update and startup autoinstall path; `OPENCHAMBER_MANAGED_TOOLS_REF` and `--ref` override it.

## Task 9 - Baked-vs-mounted split blocker trim (2026-05-09)
- Kept bootstrap helpers for managed init/update/status baked into image, but removed managed family binaries from apt so user-mounted installs remain source of truth.
- Preserved core runtime, DinD, cloudflared, and OpenChamber bootstrap packages unchanged.
