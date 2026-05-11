#!/usr/bin/env sh
set -eu

prepend_path_dir() {
  clean_path=""
  old_ifs="${IFS}"
  IFS=:
  for path_entry in ${PATH:-}; do
    [ "${path_entry}" = "$1" ] && continue
    clean_path="${clean_path:+${clean_path}:}${path_entry}"
  done
  IFS="${old_ifs}"
  PATH="$1${clean_path:+:${clean_path}}"
}

for managed_path_dir in \
  /bin \
  /sbin \
  /usr/bin \
  /usr/sbin \
  /usr/local/bin \
  /usr/local/sbin \
  /opt/openchamber/npm-global/bin \
  /home/openchamber/.bun/bin \
  /home/openchamber/.local/pip/bin \
  /home/openchamber/.cargo/bin \
  /home/openchamber/.go/bin \
  /home/openchamber/.local/go/bin \
  /home/openchamber/.npm-global/bin \
  /home/openchamber/.local/bin
do
  prepend_path_dir "${managed_path_dir}"
done
export PATH

if [ "${ENABLE_DIND:-false}" = "true" ]; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "[dind] ENABLE_DIND=true requires root entrypoint" >&2
    exit 1
  fi

  mkdir -p /var/lib/docker /var/lib/containerd /run /var/run
  chown -R root:root /var/lib/docker /var/lib/containerd

  export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"

  if ! docker info >/dev/null 2>&1; then
    echo "[dind] starting dockerd..."
    # docker:dind normally runs dockerd-entrypoint.sh with CMD ["dockerd"].
    # Pass dockerd explicitly so the entrypoint performs daemon setup instead
    # of treating an empty argument list as a generic command.
    # shellcheck disable=SC2086
    dockerd-entrypoint.sh dockerd ${DOCKERD_ARGS:-} &

    tries=0
    until docker info >/dev/null 2>&1; do
      tries=$((tries + 1))
      if [ "${tries}" -ge "${DIND_STARTUP_TIMEOUT_SECONDS:-60}" ]; then
        echo "[dind] dockerd did not become ready after ${tries}s" >&2
        exit 1
      fi
      sleep 1
    done
    echo "[dind] dockerd is ready"
  else
    echo "[dind] docker daemon already reachable"
  fi
fi

run_managed_tools_autoinstall() {
  if [ "${OPENCHAMBER_MANAGED_TOOLS_AUTOINSTALL:-false}" != "true" ]; then
    return 0
  fi

  echo "[managed-tools] installing missing or outdated managed mounted tools..."
  if [ "$(id -u)" -eq 0 ]; then
    sudo -E -u openchamber env PATH="${PATH}" npm run --prefix /opt/openchamber/managed-tools managed-tools:init
  else
    npm run --prefix /opt/openchamber/managed-tools managed-tools:init
  fi
}

run_managed_tools_autoinstall

if [ "$(id -u)" -eq 0 ]; then
  exec sudo -E -u openchamber env PATH="${PATH}" sh /home/openchamber/openchamber-entrypoint.sh
fi

exec sh /home/openchamber/openchamber-entrypoint.sh
