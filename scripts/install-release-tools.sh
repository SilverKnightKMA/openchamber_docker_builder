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
  extract_dir="${tmp_dir}/${name}"

  curl -fsSL "${url}" -o "${download}"
  printf '%s  %s\n' "${sha256}" "${download}" | sha256sum -c -

  case "${asset}" in
    *.tar.gz)
      mkdir -p "${extract_dir}"
      tar -xzf "${download}" -C "${extract_dir}"
      binary_path="${extract_dir}/${name}"
      if [ ! -f "${binary_path}" ] || [ ! -x "${binary_path}" ]; then
        candidates_file="${tmp_dir}/${name}.candidates"
        find "${extract_dir}" -type f -name "${name}" -perm /111 > "${candidates_file}"
        candidate_count="$(wc -l < "${candidates_file}" | tr -d ' ')"
        if [ "${candidate_count}" -ne 1 ]; then
          printf 'expected exactly one executable %s binary inside %s, found %s\n' "${name}" "${asset}" "${candidate_count}" >&2
          exit 1
        fi
        binary_path="$(cat "${candidates_file}")"
      fi
      if [ -z "${binary_path}" ] || [ ! -f "${binary_path}" ] || [ ! -x "${binary_path}" ]; then
        printf 'failed to locate %s binary inside %s\n' "${name}" "${asset}" >&2
        exit 1
      fi
      install -m 0755 "${binary_path}" "${install_dir}/${name}"
      ;;
    *)
      install -m 0755 "${download}" "${install_dir}/${name}"
      ;;
  esac
done < "${tmp_dir}/tools.tsv"
