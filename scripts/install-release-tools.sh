#!/usr/bin/env sh
set -eu

manifest="${1:-/opt/openchamber/release-tools.json}"
install_dir="${2:-/usr/local/bin}"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

python3 - "${manifest}" <<'PY' > "${tmp_dir}/tools.tsv"
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    manifest = json.load(f)

policy = manifest.get("policy", {})
if not policy.get("requireUpstreamChecksum"):
    raise SystemExit("release tool policy must require upstream checksums")
if policy.get("allowDownloadAndHash"):
    raise SystemExit("release tool policy must not allow download-and-hash fallback")

for tool in manifest["tools"]:
    print("\t".join([
        tool["name"],
        tool["repo"],
        tool["version"],
        tool["asset"],
        tool["sha256"],
    ]))
PY

while IFS="$(printf '\t')" read -r name repo version asset sha256; do
  url="https://github.com/${repo}/releases/download/${version}/${asset}"
  download="${tmp_dir}/${asset}"

  curl -fsSL "${url}" -o "${download}"
  printf '%s  %s\n' "${sha256}" "${download}" | sha256sum -c -

  case "${asset}" in
    *.tar.gz)
      extract_dir="${tmp_dir}/${name}"
      mkdir -p "${extract_dir}"
      tar -xzf "${download}" -C "${extract_dir}"
      install -m 0755 "${extract_dir}/${name}" "${install_dir}/${name}"
      ;;
    *)
      install -m 0755 "${download}" "${install_dir}/${name}"
      ;;
  esac
done < "${tmp_dir}/tools.tsv"
