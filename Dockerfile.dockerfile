# syntax=docker/dockerfile:1

FROM node:25-bookworm-slim@sha256:e49fd70491eb042270f974167c874d6245287263ffc16422fcf93b3c150409d8 AS node-runtime

FROM cloudflare/cloudflared:latest@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0 AS cloudflared

FROM docker:29.4.1-dind@sha256:c77e5d7912f9b137cc67051fdc2991d8f5ae22c55ddf532bb836dcb693a04940 AS docker-dind

FROM ghcr.io/astral-sh/uv:0.11.9@sha256:6b6fa841d71a48fbc9e2c55651c5ad570e01104d7a7d701f57b2b22c0f58e9b1 AS uv-bin

FROM golang:1.26.2-bookworm@sha256:47ce5636e9936b2c5cbf708925578ef386b4f8872aec74a67bd13a627d242b19 AS go-runtime

FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS app-builder
ENV PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /app

# Use the full upstream source tree as build context so Bun workspace
# resolution does not depend on partial manifest copies.
COPY . .
RUN bun install --ignore-scripts
RUN bun run build:web

FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS runtime
ENV PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /home/openchamber

COPY --from=toolchain package.json package-lock.json /opt/openchamber/toolchain/
COPY --from=toolchain go.mod go.sum tools.go /opt/openchamber/go-tools/
COPY --from=toolchain tools/release-tools.json /opt/openchamber/release-tools.json
COPY --from=toolchain scripts/install-release-tools.sh /usr/local/bin/install-release-tools
COPY --from=toolchain scripts/openchamber-dind-entrypoint.sh /usr/local/bin/openchamber-dind-entrypoint

# Copy Node/npm from pinned official Node image before apt to avoid Debian npm.
# The node-runtime stage is first so Docker Dependabot can track it.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node-runtime /usr/local/include/node /usr/local/include/node
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  bat \
  build-essential \
  ca-certificates \
  clangd \
  clang-format \
  cmake \
  curl \
  dnsutils \
  fd-find \
  file \
  fzf \
  git \
  git-lfs \
  gettext-base \
  iproute2 \
  iputils-ping \
  iptables \
  jq \
  kmod \
  less \
  lsof \
  nano \
  neovim \
  netcat-openbsd \
  openssh-client \
  pkg-config \
  procps \
  protobuf-compiler \
  python3 \
  python3-pip \
  python3-venv \
  ripgrep \
  rsync \
  rustc \
  cargo \
  shellcheck \
  sqlite3 \
  strace \
  sudo \
  tar \
  tmux \
  tree \
  universal-ctags \
  unzip \
  vim \
  wget \
  xz-utils \
  zip \
  psmisc \
  && ln -sf /usr/bin/batcat /usr/local/bin/bat \
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
  && ln -sf /usr/bin/python3 /usr/local/bin/python \
  && chmod +x /usr/local/bin/install-release-tools \
  && chmod +x /usr/local/bin/openchamber-dind-entrypoint \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Replace the base image's 'bun' user (UID 1000) with 'openchamber'
# so mounted volumes with 1000:1000 ownership work correctly.
RUN userdel bun \
  && groupadd -g 1000 openchamber \
  && groupadd docker \
  && useradd -u 1000 -g 1000 -m -s /bin/bash openchamber \
  && usermod -aG docker openchamber \
  && mkdir -p /etc/sudoers.d \
  && mkdir -p /opt/openchamber/npm-global \
  && printf 'openchamber ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/openchamber \
  && chmod 0440 /etc/sudoers.d/openchamber \
  && chown -R openchamber:openchamber /home/openchamber /opt/openchamber

COPY --from=uv-bin /uv /uvx /usr/local/bin/
COPY --from=go-runtime /usr/local/go /usr/local/go
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=docker-dind /usr/local/bin/ /usr/local/bin/
COPY --from=docker-dind /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
RUN printf '%s\n' \
  '#!/usr/bin/env sh' \
  'echo "[xdg-open] ignored in headless container: $*" >&2' \
  'exit 0' \
  > /usr/local/bin/xdg-open \
  && chmod +x /usr/local/bin/xdg-open
RUN npm ci --omit=dev --prefix /opt/openchamber/toolchain \
  && for bin in /opt/openchamber/toolchain/node_modules/.bin/*; do \
    ln -sf "${bin}" "/usr/local/bin/$(basename "${bin}")"; \
  done \
  && rm -rf /root/.npm
RUN install-release-tools /opt/openchamber/release-tools.json \
  && rm -f /usr/local/bin/install-release-tools
RUN cd /opt/openchamber/go-tools \
  && GOBIN=/usr/local/bin go install mvdan.cc/sh/v3/cmd/shfmt \
  && GOBIN=/usr/local/bin go install golang.org/x/tools/gopls \
  && rm -rf /root/.cache/go-build /root/go/pkg/mod/cache

COPY --from=app-builder /app/scripts/docker-entrypoint.sh /home/openchamber/openchamber-entrypoint.sh
RUN python3 - <<'PY'
from pathlib import Path

path = Path('/home/openchamber/openchamber-entrypoint.sh')
text = path.read_text()
old = '''    echo "[entrypoint] npm installing oh-my-opencode..."
    npm install -g oh-my-opencode

'''
new = '''    OMO_NPM_PREFIX="${OMO_NPM_PREFIX:-/opt/openchamber/npm-global}"
    OMO_NPM_PACKAGE="${OMO_NPM_PACKAGE:-oh-my-opencode}"
    export PATH="${OMO_NPM_PREFIX}/bin:${PATH}"

    if ! command -v oh-my-opencode >/dev/null 2>&1; then
      rm -rf "${OMO_NPM_PREFIX}/lib/node_modules/.oh-my-opencode-"*
      echo "[entrypoint] npm installing ${OMO_NPM_PACKAGE} into ${OMO_NPM_PREFIX}..."
      npm install -g --prefix "${OMO_NPM_PREFIX}" "${OMO_NPM_PACKAGE}"
    fi

'''
if old not in text:
    raise SystemExit('Expected oh-my-opencode runtime install block not found')
path.write_text(text.replace(old, new))
PY

COPY --from=app-builder /app/node_modules ./node_modules
COPY --from=app-builder /app/packages/web/node_modules ./packages/web/node_modules
COPY --from=app-builder /app/package.json ./package.json
COPY --from=app-builder /app/packages/web/package.json ./packages/web/package.json
COPY --from=app-builder /app/packages/web/bin ./packages/web/bin
COPY --from=app-builder /app/packages/web/server ./packages/web/server
COPY --from=app-builder /app/packages/web/dist ./packages/web/dist

USER openchamber

ENV HOME=/home/openchamber
ENV NODE_ENV=production
ENV DOCKER_TLS_CERTDIR=
ENV NPM_CONFIG_PREFIX=/home/openchamber/.npm-global
ENV BUN_INSTALL=/home/openchamber/.bun
ENV CARGO_HOME=/home/openchamber/.cargo
ENV GOPATH=/home/openchamber/.go
ENV PYTHONUSERBASE=/home/openchamber/.local/pip
ENV RUSTUP_HOME=/home/openchamber/.rustup
ENV XDG_CACHE_HOME=/home/openchamber/.cache
ENV XDG_CONFIG_HOME=/home/openchamber/.config
ENV XDG_DATA_HOME=/home/openchamber/.local/share
ENV XDG_STATE_HOME=/home/openchamber/.local/state
ENV PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/openchamber/npm-global/bin:/home/openchamber/.local/bin:/home/openchamber/.npm-global/bin:/home/openchamber/.bun/bin:/home/openchamber/.cargo/bin:/home/openchamber/.go/bin:/home/openchamber/.local/pip/bin

RUN mkdir -p \
  /home/openchamber/.bun \
  /home/openchamber/.cargo/bin \
  /home/openchamber/.config \
  /home/openchamber/.go/bin \
  /home/openchamber/.local/bin \
  /home/openchamber/.local/pip/bin \
  /home/openchamber/.local/share \
  /home/openchamber/.local/state \
  /home/openchamber/.npm-global \
  /home/openchamber/.ssh \
  /home/openchamber/workspaces \
  && npm config set prefix /home/openchamber/.npm-global

VOLUME ["/var/lib/docker", "/var/lib/containerd"]

EXPOSE 3000

USER root

ENTRYPOINT ["/usr/local/bin/openchamber-dind-entrypoint"]
