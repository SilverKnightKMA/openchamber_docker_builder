# Managed Mounted Tools Refactor

## TL;DR
> **Summary**: Shrink the baked image to OpenChamber core runtime, opencode core, cloudflared, DinD, and bootstrap essentials; move all feasible developer/support tooling into pinned, user-mounted managed installs.
> **Deliverables**: refactored Dockerfile, managed-tools manifest + init/status scripts, compose/env/path updates, docs, verification evidence.
> **Effort**: Large
> **Parallel**: YES - 4 waves
> **Critical Path**: manifest design → bootstrap scripts → Dockerfile/core split → verification

## Context
### Original Request
Refactor the image so only the OpenChamber core runtime, opencode, cloudflared, DinD, and bootstrap essentials remain baked-in, while the rest of the toolchain is managed in mounted user volumes with pinned versions and upgrade rules.

### Interview Summary
- Cloudflared remains baked-in.
- DinD remains baked-in and is not user-mounted.
- `gh` moves to managed release-binary install in `~/.local/bin/gh`.
- Rust tooling is managed via `rustup` in mounted volume, pinned to a toolchain version.
- Go toolchain is a managed release tarball in mounted volume; Go tools (`gopls`, `shfmt`) are installed via a managed `go.mod`/`go.sum` with `-mod=readonly` and version-checked via `go version -m`.
- npm tools use `npm ci` + lockfile with pinned versions.
- Managed tools follow: missing => install, equal => skip, lower => upgrade, higher => warning + skip.
- User-mounted metadata is not trusted as source of truth.
- Existing mount conventions already exist for `.npm-global`, `.go`, `.cargo`, `.rustup`, `.local/bin`, `.local/pip`, `.bun`, and `.cloudflared`.
- Confirmed baked apt set includes bootstrap/system essentials, DinD/network essentials, `build-essential`, `python3-pip`, `python3-venv`, `nano`, and `git-lfs`; `gh` is removed from baked apt and installed as a managed mounted release binary; `neovim`, `vim`, and `tmux` are deleted from the image.

### Metis Review (gaps addressed)
- Chose a single source-of-truth managed-tools manifest baked into the image under `/opt/openchamber/managed-tools/`.
- Applied defaults for managed-tools root, bootstrap trigger, and version normalization.
- Clarified `cloudflared` stays baked-in, not managed.
- Separated Go toolchain from Go tools.
- Required explicit install/status scripts plus a no-trust-user-metadata policy.
KQ|## Manifest Schema and Version Policy
QM|
ZR|The managed-tools manifest is the single source of truth for all mounted tool versions. It is baked into the image at `/opt/openchamber/managed-tools/manifest.json` and is never sourced from user-mounted volumes.
MV|
VS|### Manifest Layout
QB|
RZ|```
ZH|opt/openchamber/managed-tools/
YS|├── manifest.json          # single source-of-truth for all tool versions
RB|├── npm/                   # baked package.json + package-lock.json
KV|│   ├── package.json
YS|│   └── package-lock.json
KV|├── go/                  # baked go.mod + go.sum for Go tools
KV|│   ├── go.mod
YS|│   └── go.sum
KV|└── release-binaries/     # placeholder dir for future per-binary manifests (optional)
RZ|```
QM|
ZR|### manifest.json Schema
QB|
RZ|```json
VZ|{
ZH|  "version": 1,
VZ|  "root": "/opt/openchamber/managed-tools",
VZ|  "bootstrapTrigger": "$HOME/.local/state/openchamber/bootstrap.lock",
VZ|  "policy": {
ZH|    "allowUserMetadata": false
VZ|  },
VZ|  "ecosystems": {
ZH|    "npm": {
ZH|      "enabled": true,
ZH|      "version": "<lockfile-resolved version string>",
ZH|      "source": "package-lock.json npmResolved or version field",
ZH|      "installPath": "$HOME/.npm-global",
ZH|      "prefix": "$HOME/.npm-global",
ZH|      "comparePolicy": "semver",
ZH|      "normalize": ["stripLeadingV"],
ZH|      "installCmd": "npm ci --prefix $DESTINATION --ignore-scripts",
ZH|      "versionSource": "lockfile"
ZH|    },
ZH|    "goToolchain": {
ZH|      "enabled": true,
ZH|      "version": "<go version string, e.g. 1.22.4>",
ZH|      "source": "pinned tarball sha256 in go-toolchain-manifest.json",
ZH|      "installPath": "$HOME/.go",
ZH|      "comparePolicy": "semver",
ZH|      "normalize": ["stripLeadingGo"],
ZH|      "installCmd": "tar -C $DESTINATION -xzf <tarball>",
ZH|      "versionSource": "manifest"
ZH|    },
ZH|    "goTools": {
ZH|      "enabled": true,
ZH|      "version": "<module version or (devel) for unversioned>",
ZH|      "source": "go.mod require lines + go version -m output",
ZH|      "installPath": "$HOME/.go/bin",
ZH|      "GOBIN": "$HOME/.go/bin",
ZH|      "comparePolicy": "semver-or-devel",
ZH|      "normalize": ["stripLeadingV", "replace-devel-with-0.0.0"],
ZH|      "installCmd": "go install -mod=readonly ./...",
ZH|      "versionSource": "go-version-m"
ZH|    },
ZH|    "rustToolchain": {
ZH|      "enabled": true,
ZH|      "version": "<rustup toolchain name, e.g. 1.80.0>",
ZH|      "source": "rustup-toolchain-manifest.json",
ZH|      "installPath": "$HOME/.rustup",
ZH|      "toolchainsPath": "$HOME/.rustup/toolchains",
ZH|      "comparePolicy": "semver",
ZH|      "normalize": ["stripLeadingV"],
ZH|      "installCmd": "rustup install <version>",
ZH|      "versionSource": "manifest"
ZH|    },
ZH|    "releaseBinaries": {
ZH|      "enabled": true,
ZH|      "version": "<per-binary, follows release-tools.json style>",
ZH|      "source": "tools/release-tools.json (unchanged location, keeps existing policy)",
ZH|      "installPath": "$HOME/.local/bin",
ZH|      "comparePolicy": "semver",
ZH|      "normalize": ["stripLeadingV"],
ZH|      "installCmd": "download + sha256 verify + chmod + install",
ZH|      "versionSource": "manifest"
ZH|    },
ZH|    "gh": {
ZH|      "enabled": true,
ZH|      "version": "<gh CLI version, e.g. 2.61.0>",
ZH|      "source": "gh release tag in GitHub API",
ZH|      "installPath": "$HOME/.local/bin/gh",
ZH|      "comparePolicy": "semver",
ZH|      "normalize": ["stripLeadingV"],
ZH|      "installCmd": "download gh_<version>_linux_amd64.tar.gz + verify checksum + install",
ZH|      "versionSource": "manifest"
ZH|    }
VZ|  }
VZ|}
RZ|```
QM|
ZR|### Per-Ecosystem Field Definitions
QB|
RZ|| Field | npm | Go toolchain | Go tools | Rust | Release binaries | gh |
RZ||---|---|---|---|---|---|---|
RZ|| `version` | pinned package version | Go version string | module version | toolchain name | per-binary version | gh version |
RZ|| `source` | lockfile metadata | SHA256-pinned tarball | `go.mod` require line | rustup toolchain manifest | `release-tools.json` | GitHub release tag |
RZ|| `installPath` | `~/.npm-global` | `~/.go` | `~/.go/bin` | `~/.rustup` | `~/.local/bin` | `~/.local/bin/gh` |
RZ|| `comparePolicy` | `semver` | `semver` | `semver-or-devel` | `semver` | `semver` | `semver` |
RZ|| `normalize` | `stripLeadingV` | `stripLeadingGo` | `stripLeadingV`, `replace-devel` | `stripLeadingV` | `stripLeadingV` | `stripLeadingV` |
RZ|| `installCmd` | `npm ci --prefix` | `tar -xzf` | `go install -mod=readonly` | `rustup install` | download + checksum | download + checksum |
RZ|| `versionSource` | `lockfile` | `manifest` | `go version -m` | `manifest` | `manifest` | `manifest` |
QM|
ZR|### Version Normalization Rules
QB|
RZ|Before comparison, apply normalization per ecosystem:
QM|
RZ|| Normalizer | Effect | Example input | Normalized output |
RZ||---|---|---|---|
RZ|| `stripLeadingV` | Remove leading `v` | `v1.2.3` | `1.2.3` |
RZ|| `stripLeadingGo` | Remove leading `go` | `go1.22.4` | `1.22.4` |
RZ|| `replace-devel` | Replace `(devel)` with `0.0.0` | `(devel)` | `0.0.0` |
QM|
ZR|### Compare Policy (applies to all ecosystems)
QB|
RZ|| Installed state | Manifest state | Action |
RZ||---|---|---|
RZ|| missing | any | install pinned version |
RZ|| equal | equal (after normalization) | skip |
RZ|| lower | higher | upgrade to pinned version |
RZ|| higher | lower | warning + skip (never downgrade) |
RZ|| newer | older | warning + skip |
RZ|| unparseable | any | warning + skip unless installer supports checksum-only verification |
QM|
ZR|### Source of Truth Policy
QB|
RZ|- **Baked manifest only.** No user-mounted JSON, lockfile, or metadata is trusted as an authoritative version source.
RZ|- Installed tool versions are detected at runtime via tool-specific commands (`npm --version`, `go version`, `go version -m`, `rustup --version`, binary `--version`, `gh --version`).
RZ|- The baked manifest at `/opt/openchamber/managed-tools/manifest.json` is the only trusted authority.
RZ|- Bootstrap state is written to `~/.local/state/openchamber/bootstrap.lock` only after successful installation; it is not used to determine versions.
RZ|- No compare, normalization, or install decision may use user-mounted state files as input.
QM|
ZR|### Install Path Summary
QB|
RZ|| Tool / group | Install path | State path |
RZ||---|---|---|
RZ|| npm tools | `$HOME/.npm-global` | lockfile within mounted npm-global |
RZ|| Go toolchain | `$HOME/.go` | tarball in builder context at build time |
RZ|| Go tools (gopls, shfmt) | `$HOME/.go/bin` | `go.mod`/`go.sum` baked in image |
RZ|| Rust toolchain | `$HOME/.rustup`, `$HOME/.cargo` | rustup-managed in mounted volume |
RZ|| Release binaries (yq, ruff, etc.) | `$HOME/.local/bin` | per-binary checksum manifest |
RZ|| gh CLI | `$HOME/.local/bin/gh` | version + checksum manifest |
QM|
ZR|Task 1 is complete when the above schema and policy are added to this plan as a new section, and the task 1 TODO acceptance criteria map directly to this specification.
JQ|
### Core Objective
Reduce the baked image to only the core runtime and unavoidable system features, while preserving deterministic, version-pinned management for all moved tools in mounted volumes.

### Tool Placement Matrix
> This matrix is the authoritative mapping for Atlas: if a tool is listed here, follow the stated placement and technical method exactly.

| Tool / group | Final placement | Technical method | Source of truth | Notes |
|---|---|---|---|---|
| OpenChamber runtime (`node_modules`, `packages/web/*`) | baked image | copy from `app-builder` stage | upstream app build | core runtime only |
| `bun` | baked image | base image runtime | pinned base image digest | required for app runtime |
| `node`, `npm` | baked image | copy from `node-runtime` stage | pinned base image digest | bootstrap dependency |
| `opencode-ai` | baked image | keep in runtime image | `package.json` + lockfile | core experience, not mounted |
| `cloudflared` | baked image | copy from pinned image stage | pinned image digest | explicitly kept baked-in |
| DinD (`docker`, `dockerd`, `containerd`, `runc`, plugins) | baked image | copy from pinned `docker:dind` stage | pinned image digest | never user-mounted |
| `bash`, `ca-certificates`, `curl`, `git`, `openssh-client`, `python3`, `python3-pip`, `python3-venv`, `tar`, `unzip`, `xz-utils`, `file`, `jq`, `less`, `procps`, `psmisc`, `iproute2`, `iptables`, `kmod`, `netcat-openbsd`, `lsof`, `rsync`, `sudo`, `dnsutils`, `iputils-ping`, `nano`, `git-lfs`, `build-essential` | baked image | apt install in bootstrap layer | apt package pinning from distro repos | approved bootstrap/system/debug set |
| `gh` | managed mounted tool | release binary to `~/.local/bin/gh` | version + checksum manifest | not baked |
| Go toolchain (`go`) | managed mounted tool | pinned release tarball to mounted path | SHA256-pinned tarball manifest | not baked |
| Go tools (`gopls`, `shfmt`) | managed mounted tools | `go install -mod=readonly` using mounted Go toolchain | baked `go.mod`/`go.sum` | version check via `go version -m` only |
| Rust toolchain (`rustc`, `cargo`) | managed mounted tool | `rustup` into mounted `~/.rustup` and `~/.cargo` | pinned toolchain manifest | not baked |
| `clangd`, `clang-format`, `cmake`, `protobuf-compiler` | managed mounted tools | release-binary/archive installs into `~/.local/bin` or tool-specific mounted dirs | version + checksum manifest | never apt in final plan |
| npm support tools (`pyright`, `eslint`, `prettier`, `pnpm`, `typescript`, `typescript-language-server`, `yaml-language-server`, `bash-language-server`, `dockerfile-language-server-nodejs`, `svelte-language-server`, `vscode-langservers-extracted`, `@biomejs/biome`, `@ast-grep/cli`) | managed mounted tools | `npm ci` + lockfile into `~/.npm-global` | `package.json` + lockfile | missing/equal/lower/higher policy applies |
| Release-binary support tools (`yq`, `actionlint`, `marksman`, `hadolint`, `ruff`, `scc`) | managed mounted tools | release archive/binary install into `~/.local/bin` | `tools/release-tools.json` | checksum mandatory |
| `bat`, `fd-find`, `fzf`, `ripgrep`, `shellcheck`, `tree`, `universal-ctags`, `strace` | managed mounted tools | release-binary/archive install into `~/.local/bin` | tool-specific pinned manifest | only if desired by the implementation wave |
| `neovim`, `vim`, `tmux` | deleted from image | none | none | no baked, no managed default |

### Canonical Compare Rules
- missing => install pinned version
- equal => skip
- lower => upgrade to pinned version
- higher => warning and skip
- unparseable => warning and skip unless a tool-specific installer explicitly supports checksum-only verification

### Canonical Install Paths
- baked runtime: `/usr/local/bin`, `/usr/local/go`, `/home/openchamber/...`
- npm managed: `/home/openchamber/.npm-global`
- Go toolchain: mounted Go root under `.local` or `.go` according to the managed manifest, with `GOBIN=/home/openchamber/.go/bin` for Go tools
- Rust: `/home/openchamber/.rustup` and `/home/openchamber/.cargo`
- release binaries and CLIs: `/home/openchamber/.local/bin`

### Deliverables
- Refactored `Dockerfile.dockerfile` with a smaller baked core.
- Baked managed-tools manifest under `/opt/openchamber/managed-tools/`.
- Init/status scripts that manage mounted tools with compare rules.
- Updated compose/env/path/docs for mounted tool management.
- Verification showing missing/equal/lower/higher behavior for representative tool types.

### Definition of Done (verifiable conditions with commands)
- [ ] `docker build -f open_chamber_docker/Dockerfile.dockerfile --build-context toolchain=open_chamber_docker -t openchamber:managed-refactor openchamber` succeeds from a valid upstream + builder workspace.
- [ ] `docker history openchamber:managed-refactor` shows no baked `neovim`, `vim`, or `tmux` layers and no baked `gh`/Go toolchain/tooling layers beyond the agreed bootstrap set.
- [ ] Init/status scripts install a missing tool, skip an equal version, upgrade a lower version, and warn+skip a higher version for at least one npm, one Go, and one release-binary example.
- [ ] Managed tools are installed into mounted paths only: `~/.local/bin`, `~/.npm-global`, `~/.go`, `~/.cargo`, `~/.rustup`, `~/.local/pip`.
- [ ] Go tool version detection uses `go version -m` and does not rely on user-written metadata.
- [ ] `gh` is present only as a mounted managed tool, not baked into the image.
- [ ] Cloudflared and DinD still work from the baked image.

### Must Have
- Single baked managed-tools manifest and installer/status scripts.
- Clear separation between baked system/bootstrap tools, managed mounted tools, and deleted tools.
- No trust in user-mounted metadata as source of truth.
- Explicit handling for npm, Go toolchain/tools, release binaries, Rust, and `gh`.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No new plan split.
- No removal of OpenChamber core runtime, opencode core, cloudflared, or DinD.
- No user-mounted DinD daemon/runtime.
- No trust of mutable mounted metadata as authoritative version state.
- No reintroduction of `neovim`, `vim`, or `tmux` into the image.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + scripted verification, using the repo's existing Docker build and image inspection commands.
- QA policy: every task includes agent-executed install/compare scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: manifest design, path conventions, task inventory, installer/status contract
Wave 2: Dockerfile core split and baked-tool removals
Wave 3: managed installers for npm, Go, Rust, release binaries, gh
Wave 4: compose/docs/verification and final audit

### Dependency Matrix (full, all tasks)
- Task 1 feeds Tasks 2-5.
- Tasks 2-5 can run in parallel once the manifest/schema and path contracts exist.
- Task 6 depends on Dockerfile decisions from Tasks 2-3.
- Task 7 depends on install scripts from Tasks 3-5.
- Task 8 depends on all previous tasks for validation and docs.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 2 tasks → quick/unspecified-high
- Wave 2 → 2 tasks → quick/unspecified-high
- Wave 3 → 3 tasks → deep/unspecified-high
- Wave 4 → 2 tasks → writing/unspecified-high

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Define managed-tools manifest and version policy

MR|  **What to do**: The complete schema and policy are defined in the **Manifest Schema and Version Policy** section above. Task 1 is complete when that section exists with all per-ecosystem fields, compare rules, normalization rules, and source-of-truth policy fully specified.
  **Must NOT do**: Do not trust user-mounted metadata as authoritative state; do not mix baked tool versions into mounted state files.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: mostly schema/design and small config changes.
  - Skills: `[]` - no special skill needed.
  - Omitted: `librarian` - repo-local conventions are already known.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Tasks 2-8 | Blocked By: none

KX|  **References**:
JX|  - Pattern: `.sisyphus/plans/managed-mounted-tools-refactor.md` - **Manifest Schema and Version Policy section** (lines ~33-181) defines the complete contract.
WB|  - Pattern: `docker-compose.example.yml:23-42` - existing mount paths.
TJ|  - Pattern: `Dockerfile.dockerfile:197-223` - existing PATH/mount behavior.
ZH|  - Pattern: `tools/release-tools.json` - release-binary manifest style.

JK|  **Acceptance Criteria**:
YW|  - [ ] Manifest format is defined for npm, Go toolchain, Go tools, release binaries, Rust, and `gh` (see Per-Ecosystem Field Definitions table).
TN|  - [ ] Version comparison rules are explicit for equal/lower/higher/missing (see Compare Policy table).
XW|  - [ ] Paths for installed tools and state are defined (see Install Path Summary table).
BV|  - [ ] Normalization rules are explicit per ecosystem (see Version Normalization Rules table).
BX|  - [ ] Source-of-truth policy explicitly forbids trusting user-mounted metadata.

  **QA Scenarios**:
  ```
  Scenario: Manifest validates
    Tool: Bash
    Steps: Inspect the baked manifest file and confirm each tool family has required fields.
    Expected: Every family has version, source type, install path, and comparison policy.
    Evidence: .sisyphus/evidence/task-1-manifest-validate.txt

  Scenario: Compare rule documented
    Tool: Bash
    Steps: Read the policy section and verify missing/equal/lower/higher behaviors are explicitly defined.
    Expected: No ambiguous behavior remains.
    Evidence: .sisyphus/evidence/task-1-compare-policy.txt
  ```

  **Commit**: NO | Files: `.sisyphus/plans/managed-mounted-tools-refactor.md`

- [x] 2. Refactor Dockerfile to a smaller baked core

  **What to do**: Remove baked dev/support tools that are moving to mounted management, keep core OpenChamber runtime, opencode, cloudflared, DinD, bootstrap essentials, `build-essential`, `python3-pip`, `python3-venv`, `nano`, `git-lfs`, and the agreed system/network tools; delete `neovim`, `vim`, and `tmux` from the image.
  **Must NOT do**: Do not remove DinD, cloudflared, or the OpenChamber runtime; do not move core bootstrap dependencies out of the image.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Dockerfile refactor with broad impact.
  - Skills: `[]` - no special skill needed.
  - Omitted: `build` - no source-code changes beyond packaging.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Tasks 3-8 | Blocked By: Task 1

  **References**:
  - Pattern: `/tmp/openchamber-upstream/Dockerfile` - upstream minimal runtime baseline.
  - Pattern: `Dockerfile.dockerfile:41-98` - current apt bootstrap block.
  - Pattern: `Dockerfile.dockerfile:120-142` - current copied tool layers.
  - Pattern: `Dockerfile.dockerfile:184-223` - current runtime copy and mount setup.

  **Acceptance Criteria**:
  - [ ] `neovim`, `vim`, and `tmux` are removed from the final image.
  - [ ] Cloudflared and DinD remain baked into the image.
  - [ ] `gh` is no longer baked into the image.
  - [ ] The baked apt set matches the approved bootstrap/core list only.

  **QA Scenarios**:
  ```
  Scenario: Final image no longer contains deleted tools
    Tool: Bash
    Steps: Build the image and run `docker run --rm IMAGE command -v neovim vim tmux` or equivalent checks.
    Expected: None of the deleted tools are present.
    Evidence: .sisyphus/evidence/task-2-deleted-tools-check.txt

  Scenario: Core runtime preserved
    Tool: Bash
    Steps: Build the image and verify `openchamber`, `opencode`, `cloudflared`, and DinD commands still exist.
    Expected: Core runtime and DinD commands are present and usable.
    Evidence: .sisyphus/evidence/task-2-core-runtime-check.txt
  ```

  **Commit**: NO | Files: `Dockerfile.dockerfile`

- [x] 3. Implement managed npm installer and status checks

  **What to do**: Add an init/status script path for npm-managed tools that uses `npm ci` plus lockfile/pinned versions for the selected tool set, installs into `~/.npm-global`, and performs compare logic without trusting mounted metadata.
  **Must NOT do**: Do not use `npm install -g` without lockfile support for the managed npm bundle; do not write authoritative version state into mounted metadata alone.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: multiple tool families and compare logic.
  - Skills: `[]` - no special skill needed.
  - Omitted: `librarian` - repo-local npm conventions already identified.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Task 7-8 | Blocked By: Tasks 1-2

  **References**:
  - Pattern: `package.json:9-25` - npm-managed tool list and pinned versions.
  - Pattern: `docker-compose.example.yml:32-34` - mounted npm prefix path.
  - Pattern: `Dockerfile.dockerfile:197-221` - PATH/prefix setup.

  **Acceptance Criteria**:
  - [ ] Missing npm-managed tool installs into `~/.npm-global`.
  - [ ] Equal version is skipped.
  - [ ] Lower version is upgraded to the pinned version.
  - [ ] Higher version logs a warning and is not downgraded.

  **QA Scenarios**:
  ```
  Scenario: npm-managed tool installs when missing
    Tool: Bash
    Steps: Clear the managed npm prefix for one tool, run the init script, then verify the binary appears under `~/.npm-global/bin`.
    Expected: The pinned version installs successfully.
    Evidence: .sisyphus/evidence/task-3-npm-install.txt

  Scenario: npm-managed tool upgrade/skip behavior
    Tool: Bash
    Steps: Seed a lower and a higher version of the same tool, run the init script twice, and inspect the log output.
    Expected: Lower version upgrades; higher version warns and is skipped.
    Evidence: .sisyphus/evidence/task-3-npm-compare.txt
  ```

  **Commit**: NO | Files: `Dockerfile.dockerfile`, new managed-tools files

- [x] 4. Implement managed Go toolchain and Go tool installation

  **What to do**: Add support for downloading a pinned Go toolchain tarball into a mounted volume, verifying SHA256, extracting it, and then installing `gopls` and `shfmt` via a baked `go.mod`/`go.sum` with `-mod=readonly`. Use `go version -m` for version detection.
  **Must NOT do**: Do not trust mounted metadata as source of truth; do not use Go tool version records written only by the user.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Go toolchain bootstrap and binary metadata parsing are nuanced.
  - Skills: `[]` - no special skill needed.
  - Omitted: `librarian` - local conventions already established.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Task 7-8 | Blocked By: Tasks 1-2

  **References**:
  - Pattern: `go.mod:1-7` - pinned Go tool dependencies.
  - Pattern: `tools.go:1-7` - tool manifest intent.
  - Pattern: `docker-compose.example.yml:36-38` - mounted Go path.
  - Pattern: `Dockerfile.dockerfile:122,139-142` - current Go copy/install behavior.

  **Acceptance Criteria**:
  - [ ] Pinned Go toolchain installs into a mounted volume from a SHA256-verified tarball.
  - [ ] `gopls` and `shfmt` install via `go install -mod=readonly`.
  - [ ] Version detection uses `go version -m` and compares against desired module versions.
  - [ ] Missing/equal/lower/higher rules work for Go tools.

  **QA Scenarios**:
  ```
  Scenario: Go toolchain bootstrap
    Tool: Bash
    Steps: Remove the mounted Go toolchain, run the init script, and verify Go appears in the mounted path.
    Expected: The pinned toolchain downloads, verifies, extracts, and becomes usable.
    Evidence: .sisyphus/evidence/task-4-go-bootstrap.txt

  Scenario: Go tool comparison via binary metadata
    Tool: Bash
    Steps: Install an older `gopls`, run the status/init flow, and inspect `go version -m` output handling.
    Expected: Lower version upgrades; higher version warns and skips.
    Evidence: .sisyphus/evidence/task-4-go-compare.txt
  ```

  **Commit**: NO | Files: new managed-tools files, Dockerfile/compose docs as needed

- [x] 5. Implement managed release-binary and rustup installers

  **What to do**: Add managed install logic for release-binary/archive tools (`gh`, `clangd`, `clang-format`, `cmake`, `protobuf-compiler`, `yq`, `actionlint`, `marksman`, `hadolint`, `ruff`, `scc`) and Rust toolchain via `rustup`, with pinned versions and compare rules.
  **Must NOT do**: Do not use apt for these managed tools; do not trust mounted metadata alone.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: multiple installers and source types.
  - Skills: `[]` - no special skill needed.
  - Omitted: `librarian` - source patterns already known.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Task 7-8 | Blocked By: Tasks 1-2

  **References**:
  - Pattern: `tools/release-tools.json:1-62` - existing release-binary manifest and SHA256 policy.
  - Pattern: `docker-compose.example.yml:34-42` - mounted binary/tool paths.
  - Pattern: `Dockerfile.dockerfile:121-125,137-142` - current copied and installed tool layers.

  **Acceptance Criteria**:
  - [ ] `gh` installs as a managed release binary into `~/.local/bin/gh`.
  - [ ] LLVM/CMake/protobuf tools install into mounted paths via pinned release artifacts.
  - [ ] Rust toolchain installs via `rustup` into mounted `~/.rustup` and `~/.cargo`.
  - [ ] Missing/equal/lower/higher rules work for release-binary and Rust-managed tools.

  **QA Scenarios**:
  ```
  Scenario: release-binary install and checksum verify
    Tool: Bash
    Steps: Remove a managed binary, run the init script, and confirm the SHA256-verified download installs to `~/.local/bin`.
    Expected: The pinned version installs only after checksum verification.
    Evidence: .sisyphus/evidence/task-5-release-binary-install.txt

  Scenario: rustup toolchain compare behavior
    Tool: Bash
    Steps: Seed an older and a newer Rust toolchain in the mounted rust paths and run the init script.
    Expected: Older toolchain upgrades; newer toolchain warns and is skipped.
    Evidence: .sisyphus/evidence/task-5-rustup-compare.txt
  ```

  **Commit**: NO | Files: new managed-tools files, Dockerfile/compose docs as needed

- [x] 6. Update compose/env/path wiring for managed mounted tools

  **What to do**: Update `docker-compose.example.yml`, entrypoint defaults, and PATH/setup behavior so mounted managed tools are discovered from the correct directories and initialized in the right order.
  **Must NOT do**: Do not break the existing mount conventions; do not require user-written metadata to determine trust.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: wiring and runtime behavior.
  - Skills: `[]` - no special skill needed.
  - Omitted: `build` - packaging/runtime only.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: Task 8 | Blocked By: Tasks 2-5

  **References**:
  - Pattern: `docker-compose.example.yml:23-49` - current mounts and env vars.
  - Pattern: `Dockerfile.dockerfile:197-223` - PATH/mount defaults.
  - Pattern: `scripts/docker-entrypoint.sh` in upstream repo - entrypoint behavior baseline.

  **Acceptance Criteria**:
  - [ ] PATH includes the managed mounted tool dirs in the right order.
  - [ ] The entrypoint can initialize managed tools before launching OpenChamber.
  - [ ] Compose docs reflect the managed mounts and expected install paths.

  **QA Scenarios**:
  ```
  Scenario: PATH discovers mounted tools
    Tool: Bash
    Steps: Start a container with empty mounts, run the path/init flow, and inspect `which` for managed tools after bootstrap.
    Expected: Tools are resolved from the mounted locations.
    Evidence: .sisyphus/evidence/task-6-path-discovery.txt

  Scenario: clean volume bootstrap
    Tool: Bash
    Steps: Start with empty mounted tool volumes and verify the entrypoint installs or reports the expected managed tools.
    Expected: Bootstrap succeeds without depending on hidden state.
    Evidence: .sisyphus/evidence/task-6-clean-bootstrap.txt
  ```

  **Commit**: NO | Files: compose/docs/runtime wiring files

- [x] 7. Add status/reporting and explicit compare diagnostics

  **What to do**: Implement a status command/script that reports desired vs actual versions for every managed tool family using the agreed compare sources (`npm lockfile`, `go version -m`, `rustup`, release binary version/checksum, and command version fallback where appropriate).
  **Must NOT do**: Do not trust mounted metadata as the only source of truth; do not silently downgrade newer mounted tools.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-ecosystem reporting.
  - Skills: `[]` - no special skill needed.
  - Omitted: `build` - no direct product feature work.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: Task 8 | Blocked By: Tasks 1-6

  **References**:
  - Pattern: `tools/release-tools.json` - release version source.
  - Pattern: `go.mod`, `tools.go` - Go source-of-truth.
  - Pattern: `package.json` - npm source-of-truth.

  **Acceptance Criteria**:
  - [ ] Status output shows desired, actual, path, and state for each managed tool family.
  - [ ] Diagnostics clearly distinguish missing/equal/lower/higher/newer.
  - [ ] Go status uses `go version -m`.

  **QA Scenarios**:
  ```
  Scenario: status command summarizes all tool families
    Tool: Bash
    Steps: Run the status command in a container with mixed installed/missing tools.
    Expected: Each family is reported with explicit state.
    Evidence: .sisyphus/evidence/task-7-status-report.txt

  Scenario: higher-version warning is visible
    Tool: Bash
    Steps: Seed a newer user-mounted tool than the pinned desired version and run status.
    Expected: Warning is shown and downgrade is not attempted.
    Evidence: .sisyphus/evidence/task-7-newer-warning.txt
  ```

  **Commit**: NO | Files: new managed-tools scripts

- [x] 8. Final validation sweep and documentation update

  **What to do**: Run build/image inspection/compare checks, verify the baked-vs-mounted split, and update docs with the final supported tool categories and upgrade rules.
  **Must NOT do**: Do not reintroduce deleted tools or silently modify the approved baked set.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: final cross-cutting verification.
  - Skills: `[]` - no special skill needed.
  - Omitted: `build` - validation-only.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: none | Blocked By: Tasks 1-7

  **References**:
  - Pattern: `Dockerfile.dockerfile`
  - Pattern: `docker-compose.example.yml`
  - Pattern: `.sisyphus/plans/managed-mounted-tools-refactor.md`

  **Acceptance Criteria**:
  - [ ] Build succeeds.
  - [ ] Layer/history inspection confirms the intended baked core only.
  - [ ] Docs explain the final three-tier model: baked core, managed mounted tools, custom mounted tools.

  **QA Scenarios**:
  ```
  Scenario: full build and inspect
    Tool: Bash
    Steps: Build the image, inspect its history, and verify the intended tool split.
    Expected: The final image matches the approved split.
    Evidence: .sisyphus/evidence/task-8-build-inspect.txt

  Scenario: docs match behavior
    Tool: Bash
    Steps: Read the updated docs and compare them against the actual install/status behavior in the image.
    Expected: Documentation matches runtime behavior.
    Evidence: .sisyphus/evidence/task-8-docs-check.txt
  ```

  **Commit**: NO | Files: docs, manifest, scripts, Dockerfile, compose

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- No commit unless the user explicitly asks for one later.
- Keep changes in a single PR-sized refactor series if implementation proceeds.
- Avoid partial commits for manifest/script/Dockerfile changes unless needed for rollback clarity.

## Success Criteria
- The baked image contains only the approved core runtime, cloudflared, DinD, and bootstrap essentials.
- All moved tools are installable and upgradable in mounted volumes with deterministic pinned versions.
- Missing/equal/lower/higher behavior is enforced consistently across npm, Go, Rust, and release-binary tools.
- Go tool version checks use `go version -m`; user-mounted metadata is not trusted.
- Deleted tools are absent from the final image.
- The repo documents the final baked vs managed split clearly.
