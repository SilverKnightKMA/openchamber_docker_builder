# OpenChamber Docker builder

Builder-owned Docker packaging for upstream [`openchamber/openchamber`](https://github.com/openchamber/openchamber).

## What this repository provides

- A root `Dockerfile` intended to be used with the upstream repository as the Docker build context.
- A `docker-compose.example.yml` sample for persistent local/containerized usage.
- A GitHub Actions workflow that checks out both this builder repository and the upstream source before publishing images.

## Local build

This Dockerfile is designed to run from the upstream source tree while referencing the packaging files from this repository.

Example from a parent directory containing both repos:

```bash
docker build \
  -f open_chamber_docker/Dockerfile \
  --build-context toolchain=open_chamber_docker \
  -t openchamber:local \
  openchamber
```

Key behavior:

- Base image is pinned to `oven/bun:1.3.5`.
- Build uses the full upstream source tree as context to avoid Bun workspace/frozen-lockfile failures caused by partial manifest copying.
- The image runs `bun run build:web` during build.
- Runtime behavior preserves the upstream `scripts/docker-entrypoint.sh` entrypoint and web CLI layout.
- Core remote editor / AI-agent tools are baked into the image, while user-installed tools are stored under persisted home directories.
- Baked npm tools are declared in this repository's `package.json`/`package-lock.json`, allowing Dependabot to update them.

## Docker Compose example

Copy `docker-compose.example.yml` and adjust the image/tag as needed:

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

The sample persists configuration, authentication, SSH state, cloudflared state, workspaces, editor state, and user-installed tools so the container can be recreated without losing developer environment setup.

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
- Persisted user tooling: `.npm-global`, `.bun`, `.local/bin`, `.local/pip`, `.cargo`, `.rustup`, `.go`
- Neovim state: `.config/nvim`, `.local/share/nvim`, `.local/state/nvim`

The runtime image exposes `3000` and includes PATH entries for persisted tool locations:

- `~/.local/bin`
- `~/.npm-global/bin`
- `~/.bun/bin`
- `~/.cargo/bin`
- `~/.go/bin`
- `~/.local/pip/bin`

## Runtime contents

The image includes upstream runtime artifacts plus common editor/remote-agent dependencies such as Git, Node/NPM, Python tooling, Go, Rust/Cargo, build tools, LSP helpers, shell utilities, `opencode-ai`, and pinned `cloudflared`.

The image bakes in stable tools such as `opencode-ai`, `pyright`, `typescript-language-server`, `vscode-langservers-extracted`, `yaml-language-server`, `dockerfile-language-server-nodejs`, `bash-language-server`, `clangd`, `shellcheck`, `ripgrep`, `fd`, `neovim`, and `tmux`.

`bash-language-server` is pinned and Dependabot-managed through `package.json`. Its current dependency tree includes a known high-severity `minimatch` ReDoS advisory through `editorconfig`; this is accepted for the remote-editor use case because the impact is limited to potential LSP CPU denial-of-service when opening untrusted shell workspaces, not direct OpenChamber/OpenCode credential exposure or remote code execution.

## Persisting auth and user-installed tools

Configuration and auth should live in mounted home subdirectories, not in the image:

- GitHub CLI auth: `/home/openchamber/.config/gh`
- Git config: `/home/openchamber/.config/git`
- SSH keys: `/home/openchamber/.ssh`
- OpenCode auth/session data: `/home/openchamber/.local/share/opencode`, `/home/openchamber/.local/state/opencode`, `/home/openchamber/.config/opencode`
- OpenChamber app data: `/home/openchamber/.config/openchamber`

User-installed tools survive recreation when installed to the configured persisted paths:

```bash
npm install -g <tool>                       # -> ~/.npm-global
pip install --user <tool>                   # -> ~/.local/pip
go install example.com/tool@latest          # -> ~/.go/bin
cargo install <tool>                        # -> ~/.cargo/bin
```

The image installs core tools globally outside mounted paths so a fresh empty `~/.npm-global` volume does not hide required runtime tools like `opencode-ai`.
