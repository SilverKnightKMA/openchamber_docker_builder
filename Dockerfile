# syntax=docker/dockerfile:1

FROM cloudflare/cloudflared:latest@sha256:64f4e9d6a867f71d89ae3318460bb3c604923b4af62b1bc9e2f74ee7486e3052 AS cloudflared

FROM ghcr.io/astral-sh/uv:0.11.8@sha256:3b7b60a81d3c57ef471703e5c83fd4aaa33abcd403596fb22ab07db85ae91347 AS uv-bin

FROM golang:1.25.9-bookworm@sha256:1a1408bf8d2d3077f9508880caf0e8bb0fde195fe3c890e7ea480dfb66dc7827 AS go-runtime

FROM oven/bun:1.3.13@sha256:bb35eafd10b2e969809384850ff0474ba36a491239d715864bc87787b4cdf0a4 AS app-builder
ENV PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /app

# Use the full upstream source tree as build context so Bun workspace
# resolution does not depend on partial manifest copies.
COPY . .
RUN bun install --ignore-scripts
RUN bun run build:web

FROM oven/bun:1.3.13@sha256:bb35eafd10b2e969809384850ff0474ba36a491239d715864bc87787b4cdf0a4 AS runtime
ENV PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /home/openchamber

COPY --from=toolchain package.json package-lock.json /opt/openchamber/toolchain/
COPY --from=toolchain go.mod go.sum tools.go /opt/openchamber/go-tools/
COPY --from=toolchain tools/release-tools.json /opt/openchamber/release-tools.json
COPY --from=toolchain scripts/install-release-tools.sh /usr/local/bin/install-release-tools

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
  jq \
  less \
  lsof \
  nano \
  neovim \
  netcat-openbsd \
  nodejs \
  npm \
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
  && useradd -u 1000 -g 1000 -m -s /bin/bash openchamber \
  && mkdir -p /etc/sudoers.d \
  && mkdir -p /opt/openchamber/npm-global \
  && printf 'openchamber ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/openchamber \
  && chmod 0440 /etc/sudoers.d/openchamber \
  && chown -R openchamber:openchamber /home/openchamber /opt/openchamber

COPY --from=uv-bin /uv /uvx /usr/local/bin/
COPY --from=go-runtime /usr/local/go /usr/local/go
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
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

EXPOSE 3000

ENTRYPOINT ["sh", "/home/openchamber/openchamber-entrypoint.sh"]
