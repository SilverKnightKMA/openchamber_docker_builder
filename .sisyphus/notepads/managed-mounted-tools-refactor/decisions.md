
## Task 1 - Manifest Schema and Version Policy (2026-05-07)

### Decisions made

1. **manifest.json is the single root config** - The `ecosystems` object in `manifest.json` names each ecosystem (npm, goToolchain, goTools, rustToolchain, releaseBinaries, gh). Ecosystem-specific sub-manifests (go-toolchain-manifest.json, rustup-toolchain-manifest.json) are referenced by the root manifest's `source` field but are not the root of trust.

2. **releaseBinaries ecosystem reuses tools/release-tools.json** rather than duplicating it into the managed-tools directory. This preserves the existing Dependabot-managed file and its `requireUpstreamChecksum` policy without change.

3. **goTools comparePolicy is `semver-or-devel`** - Normalize `(devel)` to `0.0.0` so a `(devel)` installed version is treated as lower than any released version, triggering an upgrade to the pinned module version.

4. **goToolchain normalize uses `stripLeadingGo`** - Installed Go reports `go1.22.4`, manifest stores `1.22.4`; normalization strips the `go` prefix before comparison.

5. **Bootstrap state is write-only** - `bootstrap.lock` is written after successful install for idempotency/continuation but is never read to determine what to install; the baked manifest is always authoritative.

6. **npm installCmd uses `--ignore-scripts`** - Prevents arbitrary package lifecycle scripts from running during `npm ci` into the mounted prefix, aligning with the no-trust-user-metadata policy.


## Task 2 - Dockerfile baked core split (2026-05-07)

- Kept the runtime image shape stable apart from the approved core-tool removals.
- Removed the dedicated `gh` apt install layer instead of replacing it with another baked source, preserving the manifest policy direction that `gh` belongs to managed installs.
- Left cloudflared, DinD, and the OpenChamber entrypoint/bootstrap layers intact to avoid changing runtime behavior beyond the requested baked-core reduction.


## Task 3 - npm-managed installer and status checks (2026-05-07)

### Decisions made

1. Added `openchamber-managed-npm` as the npm-only init/status entry point, backed by `/opt/openchamber/managed-tools/bin/npm-managed-tools.mjs`, so later tool families can add their own managed-tool scripts without changing npm behavior.
2. Kept `/opt/openchamber/managed-tools/manifest.json` minimal for this task with only the npm ecosystem active, while preserving the policy fields needed to reject user-mounted metadata as authority.
3. Used scratch-prefix `npm ci --omit=dev --ignore-scripts` from the baked lockfile, then copied lockfile-resolved packages into `~/.npm-global`; this preserves deterministic installs and lets higher direct packages warn and remain untouched.

## Task 4 - Managed Go toolchain and tools (2026-05-07)

### Decisions

1. Pinned the managed Go toolchain to `go1.26.2` with the upstream `linux-amd64` tarball URL and SHA256 from Go release metadata, matching the existing Dockerfile Go version while moving it out of the baked image.
2. Added a dedicated `go-managed-tools.mjs` script instead of mixing Go logic into the npm script, keeping ecosystem policies isolated while following the same manifest-driven status/init shape.
3. Kept the manifest/`go.mod`/`go.sum` as the only version authorities; mounted paths are inspected only through actual binaries (`go version` and `go version -m -json`).
4. The init path installs only missing/lower Go tools and leaves higher installed tool binaries untouched, preserving the established higher-version warning-and-skip policy.


## Task 5 - Managed release-binary and rustup installers (2026-05-07)

1. Added one managed installer script for release binaries and one for Rust rather than extending npm/Go scripts, preserving the established one-ecosystem-per-script pattern.
2. Kept `tools/release-tools.json` as the baked source for existing standalone binaries and added `managed-tools/release-binaries.json` only for moved apt-style binary/archive tools (`clangd`, `clang-format`, `cmake`, `protoc`).
3. Pinned rustup itself in `managed-tools/rust/toolchain.json` and install Rust through verified `rustup-init` plus `rustup toolchain install`, so Rust state lives in mounted `$HOME/.rustup` and `$HOME/.cargo`.
4. Wired Dockerfile copies and command symlinks only for the new managed-tool scripts/manifests; broader runtime apt removal/bootstrap orchestration remains outside task 5 scope.


## Task 6 - Compose, PATH, and managed bootstrap wiring (2026-05-07)

### Decisions made

1. Added a dedicated `/usr/local/bin/openchamber-managed-tools-init` wrapper so the entrypoint can bootstrap managed mounts without embedding long install logic inside the DinD script.
2. Kept the bootstrap order deterministic as npm -> release binaries -> Rust -> Go, which matches the dependency order implied by the managed tool families and avoids relying on mounted metadata.
3. Exposed the managed install roots in `docker-compose.example.yml` so operators can see the expected mounted paths and optionally disable bootstrap with `OPENCHAMBER_MANAGED_TOOLS_BOOTSTRAP=false`.

## Task 7 - Status/reporting diagnostics alignment (2026-05-07)

### Decision
1. Standardized the status line format across all managed tool families so later validation can compare behavior consistently, while preserving family-specific warning messages for higher-than-pinned installs.
2. Kept compare decisions based on manifest/lockfile/module metadata and installed artifacts only, with no trust in mounted user metadata.


## Task 8 - Documentation and validation decisions (2026-05-07)

1. Kept the docs narrowly focused on the approved final split instead of introducing broader operator guidance.
2. Documented the managed-tool upgrade path as image refresh plus bootstrap reconciliation, which matches the runtime scripts and avoids implying manual edits are supported.
3. Called out `gh` explicitly as managed-mounted because the final manifest and runtime wiring already install it into persisted user space.
- Treat this QA pass as read-only verification only; do not alter the plan file or working tree.
- Verified Dockerfile runtime stage only bakes core runtime, opencode, cloudflared, docker-dind, uv, and bootstrap wiring; managed release tools are represented by manifests and init scripts under /opt/openchamber/managed-tools.
