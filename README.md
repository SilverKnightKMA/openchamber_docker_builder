# OpenChamber Docker builder

Builder-owned Docker packaging for upstream [`openchamber/openchamber`](https://github.com/openchamber/openchamber).

## What this repository provides

- A root `Dockerfile.dockerfile` intended to be used with the upstream repository as the Docker build context.
- A `docker-compose.example.yml` sample for persistent local/containerized usage.
- A GitHub Actions workflow that checks out both this builder repository and the upstream source before publishing images.

## Local build

This builder Dockerfile is named `Dockerfile.dockerfile` so Dockerfile LSP tools that only match by extension can attach without unsafe extensionless-file workarounds. It is designed to run from the upstream source tree while referencing the packaging files from this repository.

Example from a parent directory containing both repos:

```bash
docker build \
  -f open_chamber_docker/Dockerfile.dockerfile \
  --build-context toolchain=open_chamber_docker \
  -t openchamber:local \
  openchamber
```

Key behavior:

- Base image versions and pinned Docker image digests are updated by Dependabot where supported.
- Build uses the full upstream source tree as context to avoid Bun workspace/frozen-lockfile failures caused by partial manifest copying.
- The image runs `bun run build:web` during build.
- Runtime behavior preserves the upstream `scripts/docker-entrypoint.sh` entrypoint and web CLI layout.
- Core runtime tooling is baked into the image, while managed developer tools and custom user-installed tools are stored under persisted home directories.
- Optional `oh-my-opencode` runtime install is disabled by default; `OH_MY_OPENCODE=true` installs the standard package, `OH_MY_OPENCODE_SLIM=true` installs `oh-my-opencode-slim`, and setting both variables to `true` fails fast with a clear entrypoint error.
- Managed npm tool versions are declared in this repository's `package.json`/`package-lock.json`, allowing Dependabot to update the pinned mounted-tool set.
- `cloudflared` intentionally tracks `cloudflare/cloudflared:latest` through a pinned digest that is refreshed by Dependabot pull request rather than at container runtime.
- Corepack is not enabled by default. Project-local package-manager commands remain preferred inside workspaces.

## Docker Compose example

Copy `docker-compose.example.yml` and adjust the image/tag as needed:

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

The sample persists configuration, authentication, SSH state, cloudflared state, workspaces, editor state, and user-installed tools so the container can be recreated without losing developer environment setup.

### Optional Docker-in-Docker

The image includes Docker client/daemon binaries and Docker CLI plugins (`docker compose`, `docker buildx`) copied from the pinned `docker:dind` image. Docker-in-Docker is disabled by default. Enable it only for trusted deployments because it requires a privileged container.

To enable inner Docker in `docker-compose.yml`:

```yaml
services:
  openchamber:
    privileged: true
    security_opt:
      - no-new-privileges:false
    environment:
      ENABLE_DIND: "true"
    volumes:
      - ./data/docker:/var/lib/docker
      - ./data/containerd:/var/lib/containerd
      # Optional: avoid inner Docker bridge CIDR collisions with host or VPN networks.
      # - ./dockerd-daemon.example.json:/etc/docker/daemon.json:ro
```

`ENABLE_DIND=true` starts `dockerd` before the upstream OpenChamber entrypoint. If the variable is unset, the wrapper skips daemon startup and behaves like the normal image. Keep Docker state on dedicated mounts; `/var/lib/docker` can grow quickly. `DOCKER_TLS_CERTDIR` is intentionally empty because the daemon is only exposed through the local Unix socket inside the container. If startup is slow on constrained hosts, raise `DIND_STARTUP_TIMEOUT_SECONDS` from the default 60 seconds.

The optional daemon config is not required for normal operation. Mount it only if the default inner Docker bridge subnet (`172.17.0.0/16`) conflicts with your host, VPN, LAN, or external Docker network ranges; adjust `bip` and `default-address-pools` to non-conflicting private ranges before deployment. After deployment, verify Docker support with `docker info`, `docker compose version`, and `docker buildx version` inside the container.

Before exposing the service, review `SECURITY.md`. After starting the container, use this operational checklist:

- Ensure the persisted `./data` directory is writable by the container user (`UID 1000`): `sudo chown -R 1000:1000 ./data`.
- After initializing managed mounted tools if you need GitHub CLI, authenticate with `gh auth login`, then verify with `gh auth status`.
- Configure Git identity inside the container with `git config --global user.name` and `git config --global user.email`.
- Verify SSH access if using SSH Git remotes: `ssh -T git@github.com`.
- Confirm the UI responds on port `3000` before putting it behind external access.

Default image name:

```text
ghcr.io/silverknightkma/openchamber:latest
```

## Persisted directories

The compose sample mounts these important paths:

- OpenChamber and OpenCode config: `.config/openchamber`, `.config/opencode`
- OpenCode state: `.local/share/opencode`, `.local/state/opencode`
- Developer identity and auth: `.ssh`, `.config/git`, `.config/gh`, `.cloudflared`
- Workspaces: `workspaces`
- Persisted managed/custom tooling: `.local/bin`, `.npm-global`, `.local/go`, `.go`, `.cargo`, `.rustup`, `.local/pip`, `.bun`
- Neovim state: `.config/nvim`, `.local/share/nvim`, `.local/state/nvim`

The runtime image exposes `3000` and includes PATH entries for persisted tool locations:

- `~/.local/bin`
- `~/.npm-global/bin`
- `~/.local/go/bin`
- `~/.go/bin`
- `~/.cargo/bin`
- `~/.local/pip/bin`
- `~/.bun/bin`
- baked/core paths, including `/opt/openchamber/npm-global/bin` and `/usr/local/bin`

## Runtime contents

The image uses a three-tier tooling model:

- Baked core: upstream OpenChamber runtime artifacts, Bun runtime, Node/npm bootstrap, `opencode-ai`, `cloudflared`, Docker/DinD binaries and CLI plugins, Python, Git, build essentials, and approved system/network shell utilities.
- Managed mounted tools: repo-pinned developer tools installed into persisted mounts on demand, including npm language tooling, Go, Go tools, GitHub CLI, release binaries, LLVM/CMake/protobuf tools, and Rust/Rustup.
- Custom mounted tools: operator- or user-installed tools under the same persisted home tool directories, such as `npm install -g`, `go install`, `cargo install`, or `pip install --user` output.

Source images for Bun, `node`, `cloudflared`, and Docker-in-Docker are pinned by tag plus digest. Bun, `node`, and Docker-in-Docker use versioned tags; `cloudflared` intentionally uses `latest` plus a digest so updates are reviewed through Dependabot PRs. The `node-runtime` stage is intentionally placed first so Dependabot's Docker ecosystem scanner can detect and update it through the standard Docker version pinning workflow.

Go, Rust/Cargo, GitHub CLI, Neovim, tmux, and release-managed standalone binaries are not baked into the final image. Go is installed into the mounted `~/.local/go` path by the managed Go toolchain command when requested. `node` and `npm` are copied from the pinned official Node image instead of Debian packages, so Docker Dependabot can track and update them through the Docker image digest.

The Docker build copies the managed-tool manifests and scripts into `/opt/openchamber/managed-tools`, but it does not install the managed tool payloads during image build. The baked npm install is pruned to `opencode-ai` before `npm ci`, so npm LSP/dev tools from `package.json` are managed-mounted tools rather than baked global tools.

### Managed mounted tools

Managed tool versions and policies live in `managed-tools/manifest.json`, `managed-tools/policy.json`, `package.json`, `package-lock.json`, `go.mod`, `go.sum`, and `tools.go`. Release-binary installs verify an authoritative SHA-256 source, either an upstream-published checksum asset or GitHub release asset digest metadata. The installer uses actual package or binary version detection and checksum evidence; mounted metadata files are never trusted as the source of truth.

Run these commands inside the container to inspect or update managed mounted tools:

```bash
npm run --prefix /opt/openchamber/managed-tools managed-tools:status
npm run --prefix /opt/openchamber/managed-tools managed-tools:report
npm run --prefix /opt/openchamber/managed-tools managed-tools:compare
npm run --prefix /opt/openchamber/managed-tools managed-tools:init
```

There is no separate `update` command. Rerun `managed-tools:init` to install missing tools or upgrade lower installed versions to the pinned versions. The compare policy is: missing installs, equal skips, lower upgrades, higher warns and skips without downgrade, and unparseable warns and skips. For smaller updates, use the per-family scripts or pass a release-tool filter, such as:

```bash
npm run --prefix /opt/openchamber/managed-tools managed-tools:npm:init
npm run --prefix /opt/openchamber/managed-tools managed-tools:go:init
npm run --prefix /opt/openchamber/managed-tools managed-tools:mounted:init -- yq
```

Startup autoinstall is disabled by default. Set `OPENCHAMBER_MANAGED_TOOLS_AUTOINSTALL=true` only when the mounted tool directories are writable and the deployment can make trusted outbound requests during startup. With the flag enabled, the entrypoint runs `npm run --prefix /opt/openchamber/managed-tools managed-tools:init` before delegating to upstream OpenChamber.

`marksman` is a managed mounted release binary installed into `~/.local/bin` after managed mounted tools are initialized. OpenCode does not currently register Markdown LSP support from installed binaries alone. After deploying or recreating a persisted OpenCode config volume, ensure the mounted `~/.config/opencode/opencode.json` contains an explicit custom LSP entry:

```json
{
  "lsp": {
    "marksman": {
      "command": ["marksman", "server"],
      "extensions": [".md", ".markdown"]
    }
  }
}
```

`docker-langserver` is a managed mounted npm binary exposed from `~/.npm-global/bin` after managed npm tools are initialized. The builder Dockerfile is intentionally named `Dockerfile.dockerfile` so current oh-my-opencode LSP tools can match it via the `.dockerfile` extension. Keep the normal Dockerfile LSP entry in the mounted config and do not add an empty-string extension workaround; that can route every extensionless file to Dockerfile LSP.

```json
{
  "lsp": {
    "dockerfile": {
      "command": ["docker-langserver", "--stdio"],
      "extensions": [".dockerfile", "Dockerfile"]
    }
  }
}
```

Do not bake this file directly into `/home/openchamber/.config/opencode`; compose mounts that directory from `./data/config/opencode` and will hide image contents. Merge entries into the mounted config instead, preserving any user/provider settings.

Accepted-risk notes for bundled tool dependency advisories live in `SECURITY.md` rather than this operational README.

`tools.go` is a Go tool manifest guarded by `//go:build tools`. It intentionally imports command packages such as `golang.org/x/tools/gopls`, so normal `go list ./...` matches no packages and `go list -tags=tools` can report command-package import errors. Validate the manifest with `go list -tags=tools -e -json .` when Go is available, or through the managed Go status/init commands, not by treating `tools.go` as application code.

## Persisting auth and user-installed tools

Configuration and auth should live in mounted home subdirectories, not in the image:

- GitHub CLI auth: `/home/openchamber/.config/gh`
- Git config: `/home/openchamber/.config/git`
- SSH keys: `/home/openchamber/.ssh`
- OpenCode auth/session data: `/home/openchamber/.local/share/opencode`, `/home/openchamber/.local/state/opencode`, `/home/openchamber/.config/opencode`
- OpenChamber app data: `/home/openchamber/.config/openchamber`

User-installed tools survive recreation when installed to the configured persisted paths:

```bash
npm install -g <tool>                         # -> ~/.npm-global
pip install --user <tool>                     # -> ~/.local/pip
go install example.com/tool@<version>         # -> ~/.go/bin
cargo install <tool> --version <version>      # -> ~/.cargo/bin
```

The image installs baked core tools outside mounted paths so a fresh empty `~/.npm-global` volume does not hide required runtime tools like `opencode-ai`.

Managed mounted and custom tool directories appear before baked core paths in `PATH`: `~/.local/bin`, `~/.npm-global/bin`, `~/.local/go/bin`, `~/.go/bin`, `~/.cargo/bin`, `~/.local/pip/bin`, and `~/.bun/bin`, followed by `/opt/openchamber/npm-global/bin` and system paths such as `/usr/local/bin`. For project work, prefer project-local commands such as `bun run`, `npm exec`, `npx`, or `pnpm exec`; those commands can resolve workspace-local `node_modules/.bin` entries and avoid conflicts with managed or custom global tools such as `eslint`, `prettier`, `biome`, or `pnpm`.

Corepack is not enabled in this image. If a workspace requires Corepack-managed shims, enable them explicitly in the persisted user environment or the project workflow after confirming compatibility with that workspace's `packageManager` metadata.

By default, the entrypoint installs no optional `oh-my-opencode` package. When `OH_MY_OPENCODE=true`, it installs `oh-my-opencode` into `/opt/openchamber/npm-global` by default. When `OH_MY_OPENCODE_SLIM=true`, it installs `oh-my-opencode-slim` into that same internal prefix. This avoids corrupting or depending on the persisted `~/.npm-global` volume. Setting both variables to `true` fails fast with a clear error. Override `OMO_NPM_PREFIX` or `OMO_NPM_PACKAGE` if you need a custom install location or package spec.
