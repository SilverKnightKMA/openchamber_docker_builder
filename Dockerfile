# syntax=docker/dockerfile:1

FROM oven/bun:1.3.13 AS app-builder
WORKDIR /app

# Use the full upstream source tree as build context so Bun workspace
# resolution does not depend on partial manifest copies.
COPY . .
RUN bun install --ignore-scripts
RUN bun run build:web

FROM oven/bun:1.3.13 AS runtime
WORKDIR /home/openchamber

COPY --from=toolchain package.json package-lock.json /tmp/toolchain/

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  build-essential \
  ca-certificates \
  clangd \
  curl \
  dnsutils \
  fd-find \
  git \
  git-lfs \
  golang-go \
  iproute2 \
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
  python3 \
  python3-pip \
  python3-venv \
  ripgrep \
  rsync \
  rustc \
  cargo \
  shellcheck \
  strace \
  sudo \
  tar \
  tmux \
  unzip \
  vim \
  wget \
  zip \
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

COPY --from=cloudflare/cloudflared@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0 /usr/local/bin/cloudflared /usr/local/bin/cloudflared
RUN npm ci --omit=dev --ignore-scripts --prefix /tmp/toolchain \
  && npm install -g --ignore-scripts /tmp/toolchain \
  && rm -rf /tmp/toolchain /root/.npm

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
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/openchamber/npm-global/bin:/home/openchamber/.local/bin:/home/openchamber/.npm-global/bin:/home/openchamber/.bun/bin:/home/openchamber/.cargo/bin:/home/openchamber/.go/bin:/home/openchamber/.local/pip/bin

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
