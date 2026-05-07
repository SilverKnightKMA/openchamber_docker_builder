#!/usr/bin/env sh
set -eu

_sourced=0
if [ "${0##*/}" != "openchamber-managed-tools-init" ]; then
  _sourced=1
fi

export HOME="${HOME:-/home/openchamber}"
export MANAGED_TOOLS_ROOT="${MANAGED_TOOLS_ROOT:-/opt/openchamber/managed-tools}"
export MANAGED_RELEASE_TOOLS_MANIFEST="${MANAGED_RELEASE_TOOLS_MANIFEST:-/opt/openchamber/managed-tools/release-tools.json}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-${HOME}/.npm-global}"
export BUN_INSTALL="${BUN_INSTALL:-${HOME}/.bun}"
export CARGO_HOME="${CARGO_HOME:-${HOME}/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-${HOME}/.rustup}"
export GOPATH="${GOPATH:-${HOME}/.go/path}"
export GOROOT="${GOROOT:-${HOME}/.go/toolchain}"
export GOBIN="${GOBIN:-${GOPATH}/bin}"
export PYTHONUSERBASE="${PYTHONUSERBASE:-${HOME}/.local/pip}"
export MANAGED_TOOLS_BIN_DIR="${MANAGED_TOOLS_BIN_DIR:-${HOME}/.local/bin}"

mkdir -p \
  "${MANAGED_TOOLS_BIN_DIR}" \
  "${NPM_CONFIG_PREFIX}/bin" \
  "${BUN_INSTALL}/bin" \
  "${CARGO_HOME}/bin" \
  "${GOBIN}" \
  "${GOROOT}/bin" \
  "${PYTHONUSERBASE}/bin" \
  "${HOME}/.local/state/openchamber"

export PATH="${MANAGED_TOOLS_BIN_DIR}:${NPM_CONFIG_PREFIX}/bin:${GOBIN}:${GOROOT}/bin:${CARGO_HOME}/bin:${BUN_INSTALL}/bin:${PYTHONUSERBASE}/bin:${PATH}"

if [ "${OPENCHAMBER_MANAGED_TOOLS_BOOTSTRAP:-true}" != "true" ]; then
  echo "[managed-tools] bootstrap disabled"
  if [ "$_sourced" -eq 1 ]; then
    return 0
  fi
  exit 0
fi

echo "[managed-tools] initializing npm tools..."
openchamber-managed-npm init

echo "[managed-tools] initializing release binaries..."
openchamber-managed-release-binaries init

echo "[managed-tools] initializing Rust toolchain..."
openchamber-managed-rust init

echo "[managed-tools] initializing Go toolchain and tools..."
openchamber-managed-go init
