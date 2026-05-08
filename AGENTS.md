# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-08 UTC
**Commit:** cf7d5dc
**Branch:** main

## OVERVIEW

Builder-owned Docker packaging for upstream `openchamber/openchamber`. This repo ships Dockerfile, managed-tool manifests, scripts, and workflows that publish `ghcr.io/silverknightkma/openchamber` images. App source still comes from upstream build context.

## STRUCTURE

```text
open_chamber_docker/
├── Dockerfile.dockerfile          # multi-stage image build; upstream app context + this repo as toolchain context
├── managed-tools/                 # manifest-driven tool roots copied into image under /opt/openchamber/managed-tools
│   ├── manifest.json              # ecosystem orchestration policy
│   ├── npm/, go/, rust/           # per-ecosystem managed tool state
│   ├── gh.json                    # gh CLI manifest
│   └── release-binaries.json      # newer release-binary manifest
├── scripts/
│   ├── *.sh, *.mjs                # runtime/bootstrap/release maintenance entrypoints
│   └── managed-tools/             # installer logic for npm, Go, Rust, release binaries
├── tools/release-tools.json       # legacy pinned release-binary manifest
├── package.json / go.mod          # root-level tool manifests used by CI and image build fingerprinting
├── docker-compose.example.yml      # runtime example with persisted state
└── .github/workflows/              # build, update, security, and auto-merge automation
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Image build flow | `Dockerfile.dockerfile` | Copies from `managed-tools/`, `tools/`, and `scripts/managed-tools/`; upstream app tree remains primary build context. |
| Managed tool policy | `managed-tools/manifest.json` | Orchestrates npm, Go toolchain, Go tools, Rust, release binaries, and `gh`. |
| Runtime tool bootstrap | `scripts/openchamber-managed-tools-init.sh`, `scripts/managed-tools/*.mjs` | Initializes managed tool dirs under persisted home paths. |
| Release binary maintenance | `scripts/update-release-tools.mjs`, `scripts/validate-release-tools.mjs`, `scripts/install-release-tools.sh` | Operate on `tools/release-tools.json`. |
| DinD wrapper | `scripts/openchamber-dind-entrypoint.sh`, `dockerd-daemon.example.json` | Opt-in only; wrapper preserves upstream entrypoint. |
| Local runtime | `README.md`, `docker-compose.example.yml` | Documents persisted auth, workspaces, editor state, and user tool dirs. |
| CI / publish | `.github/workflows/build-upstream-*.yml` | Tag math uses upstream SHA + builder fingerprint. |

## CODE MAP

| Symbol/Artifact | Type | Location | Role |
|-----------------|------|----------|------|
| `tools` package | Go build-tag package | `tools.go` | Pins CLI deps without runtime imports. |
| `validate:release-tools` | npm script | `package.json` | Validates legacy release manifest. |
| `release-tools.json.policy` | manifest policy | `tools/release-tools.json` | Requires authoritative checksum metadata; no download-and-hash fallback. |
| `manifest.json.policy.allowUserMetadata` | manifest policy | `managed-tools/manifest.json` | Disables user metadata in managed-tool comparisons. |
| `openchamber-managed-tools-init` | bootstrap wrapper | `scripts/openchamber-managed-tools-init.sh` | Sets managed-tool env and runs npm, release binaries, Rust, then Go. |
| `npm-managed-tools.mjs` | installer | `scripts/managed-tools/npm-managed-tools.mjs` | Reconciles npm-managed tools under `$HOME/.npm-global`. |
| `go-managed-tools.mjs` | installer | `scripts/managed-tools/go-managed-tools.mjs` | Reconciles Go toolchain/tools under `$HOME/.go`. |
| `release-binary-managed-tools.mjs` | installer | `scripts/managed-tools/release-binary-managed-tools.mjs` | Reconciles managed release binaries under `$HOME/.local/bin`. |

## CONVENTIONS

- Treat `managed-tools/` as image toolchain source of truth. Root `package.json`, `go.mod`, `tools.go`, and `tools/release-tools.json` exist for build, validation, and fingerprinting paths.
- Managed-tool bootstrap order matters: npm first, then release binaries, then Rust, then Go.
- `OPENCHAMBER_MANAGED_TOOLS_BOOTSTRAP=false` skips managed-tool reconciliation.
- `managed-tools/manifest.json` sets install root to `/opt/openchamber/managed-tools` and bootstrap trigger to `$HOME/.local/state/openchamber/bootstrap.lock`.
- Core tools live outside mounted user paths. User-installed tools belong in persisted home dirs (`~/.npm-global`, `~/.local/pip`, `~/.cargo`, `~/.go`, `~/.bun`).
- `toolchain` build context is named and must point at this repo. Local builds use `--build-context toolchain=open_chamber_docker`; CI maps same path to checked-out builder tree.
- Base images stay digest-pinned. `cloudflared` intentionally uses `latest@sha256:...`.
- Runtime user is `openchamber` with UID/GID `1000`; compose volume ownership assumes it.
- `oh-my-opencode` runtime install goes to `/opt/openchamber/npm-global` unless `OMO_NPM_PREFIX`/`OMO_NPM_PACKAGE` override it.
- `marksman` and `docker-langserver` are baked into image; OpenCode config must be merged at runtime if mounted config lacks them.

## ANTI-PATTERNS (THIS PROJECT)

- Do not treat repo as upstream app repo; app code comes from `openchamber/openchamber` during image build.
- Do not compute release hashes from unknown downloads. Use upstream checksum assets or GitHub digest metadata only.
- Do not write auth/config/secrets into image. Persist under mounted home subdirs instead.
- Do not bake `opencode.json` into `/home/openchamber/.config/opencode`; mounted config hides image contents.
- Do not enable Corepack globally without checking workspace `packageManager` compatibility.
- Do not enable Docker-in-Docker by default.
- Do not add systemd for DinD; wrapper starts only `dockerd`.
- Do not expect cross-ecosystem Dependabot grouping; grouping stays per ecosystem.
- Do not add child `AGENTS.md` files for `scripts/`, `managed-tools/`, or `.github/workflows/`; current repo stays root-governed.

## UNIQUE STYLES

- CI builds image tags as `main-u{upstream_sha}-b{builder_scope_sha}` or `{release_tag}-b{builder_scope_sha}`.
- Builder fingerprint only covers packaging files listed in workflows; upstream app changes do not affect builder suffix.
- Build workflows skip push when computed image tag already exists in GHCR.
- `update-release-tools.yml` writes branch `automated/update-release-tools` with title `chore: update release-managed tools` and labels `automated`, `dependencies`.
- `auto-merge-pr.yml` enables auto-merge for trusted Dependabot PRs once they carry `automated` and are not draft/WIP.

## COMMANDS

```bash
npm run validate:release-tools
node scripts/update-release-tools.mjs
sh scripts/install-release-tools.sh tools/release-tools.json
docker build -f open_chamber_docker/Dockerfile.dockerfile --build-context toolchain=open_chamber_docker -t openchamber:local openchamber
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

## TESTS / VALIDATION

- No dedicated unit/integration tests.
- No `*_test.go` files; Go module is tool manifest only.
- CI validation centers on manifest checks, checksum policy, Docker builds, Dependabot, and gitleaks.

## NOTES

- `scripts/managed-tools/` is densest subtree in repo. Keep it documented in root only unless it grows into separate domain.
- `managed-tools/` is distinct domain, but too small for child AGENTS.md.
- Root KB now covers current managed-tool split and runtime bootstrap rules.
