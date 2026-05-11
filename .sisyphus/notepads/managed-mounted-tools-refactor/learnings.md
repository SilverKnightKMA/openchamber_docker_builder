## Task 1: Managed-Tools Config (2026-05-11)

### What was done
Created repo-hosted managed-tools config under `managed-tools/`:
- `manifest.json`: 9 tool families, 30 tools total covering npm, Go toolchain, Go tools, gh, release binaries, LLVM tools, CMake, protobuf, rustup
- `policy.json`: compare rules, checksum policies, version normalization, detection strategy

### Key design decisions
1. Split Go toolchain (tarball) from Go tools (go install) as separate families since they have different install methods and source types
2. Separated clangd/clang-format into llvm_tools family since clang-format uses LLVM's sha256+.sig, while clangd has no checksum
3. protobuf-compiler uses allowGithubDigest because upstream has no checksums (issue #16165 not_planned)
4. policy.json is a sibling to manifest.json rather than embedded, allowing scripts to consume only what they need

### Evidence files created
- `.sisyphus/evidence/task-1-manifest-validate.txt`: family table, field coverage, checksum policy mapping
- `.sisyphus/evidence/task-1-compare-policy.txt`: compare rule table, checksum policy table, normalization, detection

### Notes
- Config is NOT baked; scripts fetch it from Git
- Detection must use actual binary output, not metadata files
- Checksum policy prefers upstream; GitHub digest is explicit fallback where no upstream checksum exists

## Task 5: Managed Release-Binary and Rustup Installers (2026-05-11)

### What was done
Added `scripts/managed-mounted-tools.mjs` plus `package.json` entrypoints for managed release-binary/archive and rustup compare/status/init flows.

### Key design decisions
1. Shared compare logic handles missing/equal/lower/higher across release families and rustup using `policy.json` rules.
2. Release installs verify upstream checksum assets or GitHub digest fallback before copying one required binary into mounted `~/.local/bin` or override.
3. Rust status detects actual `rustc --version` from mounted `CARGO_HOME`/`RUSTUP_HOME`; install uses `rustup toolchain install stable` with mounted homes.

### Notes
- Managed release coverage includes `gh`, `clangd`, `clang-format`, `cmake`, `protobuf-compiler`, `yq`, `actionlint`, `marksman`, `hadolint`, `ruff`, and `scc`.
- Missing install dirs are treated as empty state, not errors.

## Task 6: Compose and Runtime PATH Wiring (2026-05-11)

### What was done
Added managed mounted tool PATH ordering, compose mount documentation, a mounted Go toolchain mount, and an explicit startup autoinstall gate wired to one aggregate managed-tools npm command.

### Key design decisions
1. Runtime PATH now prioritizes mounted managed tools in this order: `~/.local/bin`, `~/.npm-global/bin`, `~/.local/go/bin`, `~/.go/bin`, `~/.cargo/bin`, `~/.local/pip/bin`, `~/.bun/bin`, then baked paths including `/usr/local/bin`.
2. The entrypoint still defaults to no managed-tool network/install work and calls `npm run --prefix /opt/openchamber/managed-tools managed-tools:init` only when `OPENCHAMBER_MANAGED_TOOLS_AUTOINSTALL=true`.
3. The image now carries the managed-tool scripts/config under `/opt/openchamber/managed-tools` so the entrypoint can run one aggregate command without depending on workspace source files.

### Evidence files created
- `.sisyphus/evidence/task-6-path-discovery.txt`: PATH order, compose mount config, and temp-root command discovery.
- `.sisyphus/evidence/task-6-clean-bootstrap.txt`: syntax checks, empty-root aggregate compare, default no-autoinstall harness, explicit autoinstall harness, and tmux shell QA.

## Task 2: Smaller Baked Core (2026-05-11)

### What was done
Refactored `Dockerfile.dockerfile` so the final image keeps only the approved baked core: OpenChamber runtime artifacts, Bun runtime, Node/npm bootstrap, opencode core, cloudflared, Docker/DinD binaries/plugins, and the approved apt bootstrap/system/network package set.

### Key design decisions
1. Kept `package.json`/`package-lock.json` as the source for baked `opencode-ai`, but pruned the copied package metadata inside the Docker build before `npm ci` so npm-managed LSP/dev packages are no longer installed into `/usr/local/bin`.
2. Removed the Go and uv stages/copies entirely because Go tools/toolchain are now managed-mounted and uv is not listed in the Task 2 baked-core allowlist.
3. Preserved existing mounted-tool path environment variables and directories for later tasks; this task only stopped baking moved tools.

### Evidence files created
- `.sisyphus/evidence/task-2-deleted-tools-check.txt`: static absence checks for deleted/moved tools, apt allowlist comparison, opencode-only npm install check, Dockerfile check output.
- `.sisyphus/evidence/task-2-core-runtime-check.txt`: static checks showing core runtime, opencode, cloudflared, DinD copies, approved apt list, and Dockerfile check output remain intact.
- npm managed-tools path works as repo-hosted bundle manifest plus package-lock, then `npm ci` into mounted prefix and binary symlinks under prefix bin.
- compare logic must read live installed versions from `npm list --depth=0 --json` and never trust mounted state files.
- `npm ci --prefix` still needs explicit bin exposure for prefix bin consumers; symlink bins from installed package metadata after install.
- `npm list --depth=0 --json --prefix <path>` is not safe on absent prefix; wrapper should probe prefix existence first.

## Task 4: Managed Go Bootstrap (2026-05-11)

### What was done
Added `scripts/managed-go-tools.mjs` plus package scripts for `managed-tools:go:init`, `managed-tools:go:status`, and `managed-tools:go:compare`.

### Key design decisions
1. Used `MANAGED_GO_ROOT` and `GOBIN` overrides for isolated smoke tests while defaulting to manifest paths `~/.local/go` and `~/.go/bin`.
2. Fetched `https://go.dev/dl/?mode=json&include=all` and used Go metadata `sha256` as authoritative checksum before extracting toolchain.
3. Parsed Go tool versions only from `go version -m <binary>`; command packages can map to parent module metadata, needed for `mvdan.cc/sh/v3/cmd/shfmt`.

### Evidence files created
- `.sisyphus/evidence/task-4-go-bootstrap.txt`: metadata checksum lookup, temp-root toolchain install, final compare.
- `.sisyphus/evidence/task-4-go-compare.txt`: real binary metadata reads and missing/equal/lower/higher compare fixtures.

## Task 6 Revalidation (2026-05-11)

- Runtime PATH wiring is centralized in both the Dockerfile ENV and entrypoint normalization; the entrypoint prepends from baked/core paths through mounted paths so the resulting order is .local/bin, .npm-global/bin, .local/go/bin, .go/bin, .cargo/bin, .local/pip/bin, .bun/bin, then baked/core paths.
- The aggregate npm script managed-tools:init remains the single startup command for explicit managed-tool bootstrap and chains npm, Go, and mounted release/Rust installers.
- Compose preserves the existing persisted mount style and includes the managed roots needed by PATH: .npm-global, .bun, .local/bin, .local/go, .local/pip, .cargo, .rustup, and .go.

## Task 7 Evidence Repair (2026-05-11)

- Recreated `.sisyphus/evidence/task-7-status-report.txt` from a real `npm run --silent managed-tools:report` temp-root fixture covering npm, Go, release families, and Rust.
- Recreated `.sisyphus/evidence/task-7-newer-warning.txt` from a real `npm run --silent managed-tools:compare` newer fixture plus filtered `init yq` no-downgrade proof.
- The report evidence explicitly shows `managed-tools:report` and rows with `desired`, `actual`, `path`, `state`, and `action` fields; the warning evidence shows `state=higher action=warn_and_skip` and a retained `yq version v9.9.9` after init.


## Task 8 Final Validation Sweep (2026-05-11)

### What was done
Updated final documentation and created Task 8 evidence files for build/static inspection, live-container blocker, real mounted yq install/update, and docs/behavior alignment.

### Key design decisions
1. README now describes the supported three-tier model: baked core, managed mounted tools, and custom mounted tools.
2. Managed-tool update language points users to rerun `managed-tools:init`; there is intentionally no separate update command.
3. SECURITY stays policy-focused and only adds trust guidance for opt-in startup autoinstall.

### Evidence files created
- `.sisyphus/evidence/task-8-build-inspect.txt`: local static checks, script/compose validations, and explicit upstream-context blocker for full image build/history inspection.
- `.sisyphus/evidence/task-8-live-container.txt`: explicit live-container blocker and exact build/run/probe commands to run once upstream context exists.
- `.sisyphus/evidence/task-8-real-mounted-update.txt`: fresh filtered `yq` install into a temp mounted bin dir with version and SHA-256 evidence.
- `.sisyphus/evidence/task-8-docs-check.txt`: docs-to-runtime comparison and stale-claim search results.
