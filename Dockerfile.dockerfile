# syntax=docker/dockerfile:1

FROM node:25-bookworm-slim@sha256:e49fd70491eb042270f974167c874d6245287263ffc16422fcf93b3c150409d8 AS node-runtime

FROM cloudflare/cloudflared:latest@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0 AS cloudflared

FROM docker:29.4.1-dind@sha256:c77e5d7912f9b137cc67051fdc2991d8f5ae22c55ddf532bb836dcb693a04940 AS docker-dind

FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS app-builder
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /app

# Use the full upstream source tree as build context so Bun workspace
# resolution does not depend on partial manifest copies.
COPY . .
RUN bun install --ignore-scripts
RUN bun run build:web

FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS runtime
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /home/openchamber

COPY --from=toolchain scripts/openchamber-dind-entrypoint.sh /usr/local/bin/openchamber-dind-entrypoint
COPY --from=toolchain scripts/managed-tools.mjs /usr/local/bin/managed-tools
COPY --from=toolchain scripts/managed-tools-status.mjs /usr/local/bin/managed-tools-status
COPY --from=toolchain scripts/install-managed-npm-tools.mjs /usr/local/bin/install-managed-npm-tools
COPY --from=toolchain scripts/install-managed-go-tools.mjs /usr/local/bin/install-managed-go-tools
COPY --from=toolchain scripts/install-managed-release-binaries.mjs /usr/local/bin/install-managed-release-binaries
COPY --from=toolchain scripts/install-managed-rustup.mjs /usr/local/bin/install-managed-rustup

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
  libicu76 \
  lsof \
  nano \
  netcat-openbsd \
  openssh-client \
  pkg-config \
  procps \
  python3 \
  python3-pip \
  python3-venv \
  ripgrep \
  rsync \
  shellcheck \
  sqlite3 \
  strace \
  sudo \
  tar \
  tree \
  universal-ctags \
  unzip \
  wget \
  xz-utils \
  zip \
  psmisc \
  && ln -sf /usr/bin/batcat /usr/local/bin/bat \
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
  && ln -sf /usr/bin/python3 /usr/local/bin/python \
  && chmod +x \
    /usr/local/bin/openchamber-dind-entrypoint \
    /usr/local/bin/managed-tools-status \
    /usr/local/bin/managed-tools \
    /usr/local/bin/install-managed-npm-tools \
    /usr/local/bin/install-managed-go-tools \
    /usr/local/bin/install-managed-release-binaries \
    /usr/local/bin/install-managed-rustup \
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

COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=docker-dind /usr/local/bin/ /usr/local/bin/
COPY --from=docker-dind /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
RUN printf '%s\n' \
  '#!/usr/bin/env sh' \
  'echo "[xdg-open] ignored in headless container: $*" >&2' \
  'exit 0' \
  > /usr/local/bin/xdg-open \
  && chmod +x /usr/local/bin/xdg-open
RUN npm install -g opencode-ai@1.14.39 \
  && rm -rf /root/.npm

COPY --from=app-builder /app/scripts/docker-entrypoint.sh /home/openchamber/openchamber-entrypoint.sh
RUN python3 - <<'PY'
from pathlib import Path

path = Path('/home/openchamber/openchamber-entrypoint.sh')
text = path.read_text()
old = '''    echo "[entrypoint] npm installing oh-my-opencode..."
    npm install -g oh-my-opencode

'''
new = '''    OMO_NPM_PREFIX="${OMO_NPM_PREFIX:-/opt/openchamber/npm-global}"
    export PATH="${OMO_NPM_PREFIX}/bin:${PATH}"

    if [ "${OH_MY_OPENCODE:-false}" = "true" ] && [ "${OH_MY_OPENCODE_SLIM:-false}" = "true" ]; then
      echo "[entrypoint] error: enable only one of OH_MY_OPENCODE=true or OH_MY_OPENCODE_SLIM=true" >&2
      exit 1
    fi

    OMO_NPM_PACKAGE=""
    OMO_NPM_COMMAND=""
    if [ "${OH_MY_OPENCODE:-false}" = "true" ]; then
      OMO_NPM_PACKAGE="${OMO_NPM_PACKAGE:-oh-my-opencode}"
      OMO_NPM_COMMAND="oh-my-opencode"
    elif [ "${OH_MY_OPENCODE_SLIM:-false}" = "true" ]; then
      OMO_NPM_PACKAGE="${OMO_NPM_PACKAGE:-oh-my-opencode-slim}"
      OMO_NPM_COMMAND="oh-my-opencode-slim"
    fi

    if [ -n "${OMO_NPM_PACKAGE}" ] && ! command -v "${OMO_NPM_COMMAND}" >/dev/null 2>&1; then
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
ENV PATH=/opt/openchamber/npm-global/bin:/home/openchamber/.local/bin:/home/openchamber/.npm-global/bin:/home/openchamber/.bun/bin:/home/openchamber/.cargo/bin:/home/openchamber/.go/toolchain/bin:/home/openchamber/.go/bin:/home/openchamber/.local/pip/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

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
