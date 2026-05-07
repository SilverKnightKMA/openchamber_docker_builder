# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-06 UTC
**Commit:** 8d1670e
**Branch:** main

## OVERVIEW

Builder-owned Docker packaging for upstream `openchamber/openchamber`. This repo does not contain the app; it supplies `Dockerfile.dockerfile`, pinned toolchain manifests, GitHub Actions, and compose example used to publish `ghcr.io/silverknightkma/openchamber` images.

## STRUCTURE

```text
open_chamber_docker/
├── Dockerfile.dockerfile          # build from upstream app context + this repo as toolchain context
├── docker-compose.example.yml      # persistent runtime example for local/containerized use
├── dockerd-daemon.example.json      # optional DinD bridge/address-pool daemon config
├── package.json                    # pinned npm/LSP/agent tools baked into image
├── go.mod / tools.go               # Go tool manifest for gopls + shfmt; not application code
├── tools/release-tools.json        # verified standalone binary manifest
├── scripts/                        # release-tool update/validation/install scripts
└── .github/workflows/              # build, update, security scan, auto-merge automation
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Docker image contents | `Dockerfile.dockerfile` | Multi-stage; upstream source is primary build context. |
| Local run instructions | `README.md`, `docker-compose.example.yml` | Compose persists auth, workspaces, editor state, and user tool dirs. |
| Optional Docker-in-Docker | `Dockerfile.dockerfile`, `scripts/openchamber-dind-entrypoint.sh`, `dockerd-daemon.example.json` | V1-style opt-in DinD; no systemd. |
| NPM tools baked into image | `package.json`, `package-lock.json` | Dependencies only; no app package scripts except release-tool validation. |
| Go-based tools | `go.mod`, `go.sum`, `tools.go` | `//go:build tools`; used for `gopls` and `shfmt` installation. |
| Standalone binary tools | `tools/release-tools.json` | `yq`, `actionlint`, `marksman`, `hadolint`, `ruff`, `scc`; all SHA-256 pinned. |
| Release tool maintenance | `scripts/update-release-tools.mjs`, `scripts/validate-release-tools.mjs`, `scripts/install-release-tools.sh` | Update manifest, validate schema/checksums, install binaries. |
| Main image publishing | `.github/workflows/build-upstream-main.yml` | Checks out builder + upstream, tags `main-u{upstream}-b{builder}`, skips if tag already exists. |
| Release image publishing | `.github/workflows/build-upstream-release.yml` | Resolves latest upstream release through `gh api`; tags `{release}-b{builder}` plus `stable`. |
| Tool update PRs | `.github/workflows/update-release-tools.yml` | Weekly Node 24 job; creates `automated/update-release-tools` PRs. |
| Secret scanning | `.github/workflows/gitleaks.yml` | CI gitleaks action. |
| Upstream Dockerfile drift | `.github/workflows/notify-upstream-dockerfile.yml` | Opens notification issue when upstream Dockerfile changes. |
| Dependency grouping | `.github/dependabot.yml` | One PR per ecosystem (`github-actions`, `docker`, `npm`, `gomod`) via `groups`; no cross-ecosystem merge grouping. |

## CODE MAP

This is a packaging repo, not an application repo. LSP symbol density is intentionally low.

| Symbol/Artifact | Type | Location | Role |
|-----------------|------|----------|------|
| `tools` package | Go build-tag package | `tools.go` | Keeps Go CLI deps in `go.mod` without runtime imports. |
| `validate:release-tools` | npm script | `package.json` | Runs manifest validation. |
| `release-tools.json.policy` | manifest policy | `tools/release-tools.json` | Requires authoritative upstream checksums; disallows download-and-hash fallback. |
| `install-release-tools` | build-time shell script | `scripts/install-release-tools.sh` | Downloads/unpacks verified release binaries into image. |
| `openchamber-dind-entrypoint` | runtime wrapper | `scripts/openchamber-dind-entrypoint.sh` | Starts `dockerd` only when `ENABLE_DIND=true`, then delegates to upstream entrypoint. |
| `update-release-tools.mjs` | maintenance script | `scripts/update-release-tools.mjs` | Reads GitHub release metadata/checksum assets and updates pinned versions. |

## CONVENTIONS

- Docker builds normally run from a parent directory containing both upstream `openchamber/` and this repo:

  ```bash
  docker build \
    -f open_chamber_docker/Dockerfile.dockerfile \
    --build-context toolchain=open_chamber_docker \
    -t openchamber:local \
    openchamber
  ```

- The full upstream source tree must remain the Docker context. Do not replace with partial manifest copies; Bun workspace/frozen-lockfile resolution depends on the full upstream context.
- `toolchain` is the named build context for this repo. Local examples map it to `open_chamber_docker`; CI maps it to the checked-out `builder` directory. `Dockerfile.dockerfile` copies package manifests, Go tool manifests, release-tool manifest, and install script from it.
- Base images are pinned by digest. `cloudflared` intentionally uses `latest@sha256:...`; Dependabot refreshes the digest by PR.
- Dependabot groups every ecosystem into a single PR (`all-github-actions`, `all-docker-images`, `all-npm-dependencies`, `all-go-dependencies`) to minimize build churn.
- Runtime user is `openchamber` with UID/GID `1000`; compose volume ownership assumes this.
- Docker-in-Docker is opt-in via `ENABLE_DIND=true`; compose must also enable `privileged: true` and persist `/var/lib/docker` plus `/var/lib/containerd` if inner Docker state should survive recreation.
- `dockerd-daemon.example.json` is optional. Use it only to avoid inner Docker bridge/address-pool conflicts with host, VPN, LAN, or external Docker networks; defaults work without it.
- DinD uses a V1-style wrapper and `docker:dind` binaries/plugins, not systemd. Preserve upstream `/home/openchamber/openchamber-entrypoint.sh`; add wrapper behavior outside it. Docker CLI plugins are copied from `/usr/local/libexec/docker/cli-plugins` in the pinned `docker:dind` stage.
- Core tools are installed outside mounted user paths. User-installed tools belong in persisted home dirs (`~/.npm-global`, `~/.local/pip`, `~/.cargo`, `~/.go`, `~/.bun`).
- Corepack is not enabled by default. Prefer project-local commands (`bun run`, `npm exec`, `npx`, `pnpm exec`) inside workspaces.
- `oh-my-opencode` runtime install goes to `/opt/openchamber/npm-global` unless `OMO_NPM_PREFIX`/`OMO_NPM_PACKAGE` override it; do not depend on persisted `~/.npm-global` for core runtime behavior.
- `marksman` is baked into `/usr/local/bin`, but Markdown LSP is not auto-registered by OpenCode. Post-deploy, merge `lsp.marksman.command=["marksman","server"]` and `extensions=[".md",".markdown"]` into the mounted `~/.config/opencode/opencode.json` if the persisted config volume is new or missing it.
- `docker-langserver` is baked into `/usr/local/bin`. The builder Dockerfile is named `Dockerfile.dockerfile` so current oh-my-opencode LSP tools match it via `.dockerfile`. Keep standard runtime config `lsp.dockerfile.command=["docker-langserver","--stdio"]` with `extensions=[".dockerfile","Dockerfile"]`; do not add `""`.
- `tools.go` is a `//go:build tools` manifest that imports command packages only to pin Go CLI versions. Use `go list -tags=tools -e -json .` or Dockerfile `go install` steps for validation; do not treat `go list ./...` or gopls broken-import diagnostics as app failures.
- Release-managed binaries require an upstream checksum source or GitHub release asset digest metadata. `allowDownloadAndHash` stays false.
- Auto-merge PRs use labels `automated` and not `wip`; release-tool update commit/title is `chore: update release-managed tools`.

## ANTI-PATTERNS (THIS PROJECT)

- Do not treat this as the upstream application repo; app code comes from `openchamber/openchamber` during image build.
- Do not install Go from Debian `golang-go`; `Dockerfile.dockerfile` copies pinned official Go so runtime matches `go.mod` tool expectations.
- Do not compute release binary hashes by downloading unknown artifacts and trusting the result. Consume upstream checksum assets or GitHub digest metadata only.
- Do not write auth/config/secrets into the image. Persist under mounted home subdirectories (`.config/gh`, `.config/git`, `.ssh`, `.config/opencode`, etc.).
- Do not bake `opencode.json` into `/home/openchamber/.config/opencode`; compose mounts that directory and will hide image contents. Merge runtime defaults into the mounted config only with backup/idempotent logic.
- Do not enable Corepack globally without checking workspace `packageManager` compatibility.
- Do not remove the dummy `xdg-open`; headless container workflows expect it to safely no-op.
- Do not enable Docker-in-Docker by default. It changes the container security boundary and requires trusted users/workspaces.
- Do not add systemd unless there is a concrete need for multiple managed services; current DinD support intentionally starts only `dockerd`.
- Keep production security guidance in `SECURITY.md`; README should stay focused on operation and link to security policy instead of duplicating it.
- Do not add subdirectory AGENTS.md files unless a directory grows substantially; current repo is shallow enough for root coverage.
- Do not expect cross-ecosystem Dependabot grouping; the built-in grouping boundary is per ecosystem only.

## UNIQUE STYLES

- CI computes a builder-scope fingerprint from packaging files and embeds short SHA in image tags: `main-u{upstream_sha}-b{builder_scope_sha}` or `{release_tag}-b{builder_scope_sha}`.
- Builder-scope fingerprinting only covers the packaging files listed in the workflows; upstream app changes do not affect the builder suffix.
- Build workflows skip Docker build/push when the computed image tag already exists in GHCR.
- `update-release-tools.yml` writes branch `automated/update-release-tools` with title `chore: update release-managed tools` and labels `automated`, `dependencies`.
- `auto-merge-pr.yml` enables auto-merge for trusted Dependabot PRs once they carry the `automated` label and are not draft/WIP.
- `.github/workflows/notify-upstream-dockerfile.yml` watches upstream Dockerfile blob SHA and opens notification issues; it does not sync upstream Dockerfile content.
- SECURITY.md documents accepted LSP dependency advisories; keep security rationale there instead of duplicating it in README.
- `tools.go` exists only to keep CLI tool dependencies (`gopls`, `shfmt`) pinned through Go modules.

## COMMANDS

```bash
# Validate release-tool manifest
npm run validate:release-tools

# Update release-managed tools from GitHub metadata/checksum assets
node scripts/update-release-tools.mjs

# Install verified release binaries to default /usr/local/bin-compatible path
sh scripts/install-release-tools.sh tools/release-tools.json

# Local image build from a parent directory containing upstream openchamber/ and this repo
docker build -f open_chamber_docker/Dockerfile.dockerfile --build-context toolchain=open_chamber_docker -t openchamber:local openchamber

# Example local runtime
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

## TESTS / VALIDATION

- No dedicated unit/integration tests found.
- No `*_test.go` files; Go module is a tool manifest only.
- No `npm test`; only `validate:release-tools` exists.
- CI validation is primarily manifest validation, checksum policy enforcement, Docker build workflows, Dependabot, and gitleaks.

## NOTES

- Runtime Markdown LSP was enabled in the current mounted config by adding `lsp.marksman` to `/home/openchamber/.config/opencode/opencode.json`; backup created as `opencode.json.backup-markdown-lsp-20260428T092205Z`.
- Runtime Dockerfile LSP standard config was added to `/home/openchamber/.config/opencode/opencode.json`; the rejected empty-extension workaround was removed. Backups created as `opencode.json.backup-dockerfile-lsp-20260428T104040Z`, `opencode.json.backup-dockerfile-lsp-empty-ext-20260428T104115Z`, and `opencode.json.backup-remove-dockerfile-empty-ext-20260428T104400Z`.
- Optional DinD support was derived from `coder-main.zip`: V1 direct `dockerd-entrypoint.sh` pattern was chosen over V2 systemd to preserve OpenChamber's upstream entrypoint model.
- Latest `/init-deep` discovery found this repo remains shallow: 17 non-ignored project files by `rg --files`, one root `AGENTS.md`, and no `CLAUDE.md`.
- OpenCode CLI `opencode run` can throw `Session not found` in this environment when it inherits the current OpenCode process/session env (`OPENCODE=1`, `OPENCODE_PROCESS_ROLE=main`, `OPENCODE_RUN_ID`, `OPENCODE_PID`, `OPENCODE_SERVER_PASSWORD`). Benchmark the `openai-krouter/cx/gpt-5.5` model with `env -u OPENCODE -u OPENCODE_RUN_ID -u OPENCODE_PID -u OPENCODE_PROCESS_ROLE -u OPENCODE_SERVER_PASSWORD opencode run --pure ...`, which has returned a real `KROUTER_OK` response.
- Scoring kept hierarchy root-only. `scripts/` has 4 files (~310 lines) and `.github/workflows/` has 6 workflows (~500 lines); both are covered by root guidance and fall below the child `AGENTS.md` threshold.
- Direct discovery used `rg`, LSP document symbols for `scripts/*.mjs`, AST-grep over maintenance scripts, and 5 explore agents for structure, conventions, anti-patterns, CI, and tests; one entry-point probe failed on tool policy and was replaced by direct search.
