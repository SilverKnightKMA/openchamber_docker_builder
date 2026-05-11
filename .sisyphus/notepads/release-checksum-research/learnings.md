
# Release/Checksum Sources Research (2026-05-11)

## Summary of Findings

| Tool | Repo | Checksum Asset | Format | Digest API | Notes |
|------|------|----------------|--------|------------|-------|
| **gh** | cli/cli | `gh_{ver}_checksums.txt` | sha256sum txt | YES (2025-06-03+) | GitHub auto-computes SHA256 for all assets; also a text file. Per-release checksums. |
| **yq** | mikefarah/yq | `checksums` (no ext) | yq-checksums | YES (2025-06-03+) | Per-release checksums file, lines of `<hash> <path>` |
| **actionlint** | rhysd/actionlint | `actionlint_{ver}_checksums.txt` | sha256sum txt | YES | Also supports `gh attestation verify` (SLSA attestations from v1.7.11+) |
| **marksman** | artempyanykh/marksman | **NONE** | — | Only (GitHub digest) | No published checksum file. Only GitHub's automatic asset digest (June 2025+). Uses `github-asset-digest` format. |
| **hadolint** | hadolint/hadolint | `{asset}.sha256` (separate per file) | sha256sum | YES (2025-06-03+) | Per-asset SHA256 files, e.g. `hadolint-linux-x86_64.sha256`. Not a combined checksums file. |
| **ruff** | astral-sh/ruff | `{asset}.sha256` (per file) + `sha256.sum` | sha256sum | YES (2025-06-03+) | Per-asset SHA256 files, plus a combined `sha256.sum`. Also supports `gh attestation verify` (Artifact Attestations). |
| **scc** | boyter/scc | `checksums.txt` | sha256sum txt | YES (2025-06-03+) | Combined checksums file per release. |
| **clangd** | clangd/clangd | **NONE** | — | YES (2025-06-03+) | Standalone clangd releases only have GitHub's automatic asset digest. No published checksum file. |
| **clang-format** | llvm/llvm-project | `.sig` (PGP) + `.jsonl` (SHA256) | PGP + jsonl | YES | LLVM uses GPG signatures and jsonl digest files. Not a simple sha256sum txt. |
| **CMake** | Kitware/CMake | `cmake-{ver}-SHA-256.txt` + `.asc` | sha256sum + PGP | YES (2025-06-03+) | Kitware signs with GPG, and there is also a dedicated SHA256 file on cmake.org. GitHub releases also have it. |
| **protoc** | protocolbuffers/protobuf | **NONE** (as of v34.1) | — | N/A | Issue #16165 requesting checksums was closed not_planned. PR #26021 to add checksums.txt was opened but NOT merged as of research date. No published checksums. |

## Detailed Notes

### GitHub Automatic Asset Digests (June 2025+)
As of 2025-06-03, GitHub automatically computes and exposes SHA256 digests for all release assets. These are available via:
- GitHub Releases UI
- Releases REST API (`/repos/{owner}/{repo}/releases/assets/{asset_id}`)
- GraphQL API
- `gh release view --json assets`

This means EVERY GitHub-hosted release now has *some* form of digest, even if the project doesn't publish a checksums file. The `github-asset-digest` format in the current manifest is the right approach for marksman and clangd.

### gh (GitHub CLI)
- **Repo**: https://github.com/cli/cli
- **Checksum asset**: `gh_{version}_checksums.txt` (e.g., `gh_2.92.0_checksums.txt`)
- **Format**: Standard sha256sum: `<hash>  <file>`
- **Digest API**: Yes
- **Caveat**: The checksums file is published by the project itself (not GitHub auto-computed). GitHub's automatic digest is also available.

### yq
- **Repo**: https://github.com/mikefarah/yq
- **Checksum asset**: `checksums` (no extension)
- **Format**: Lines of `<sha256>  <asset-name>` (standard sha256sum compatible)
- **Digest API**: Yes
- **Note**: Release v4.53.2 (latest at research time) is marked `immutable: true` in API.

### actionlint
- **Repo**: https://github.com/rhysd/actionlint
- **Checksum asset**: `actionlint_{version}_checksums.txt`
- **Format**: Standard sha256sum
- **Digest API**: Yes
- **Extra**: From v1.7.11+, also supports SLSA-style attestations via `gh attestation verify`

### marksman
- **Repo**: https://github.com/artempyanykh/marksman
- **Checksum asset**: **NONE** — no published checksum file
- **Digest API**: Yes (GitHub's automatic asset digest only)
- **Current approach** (`github-asset-digest`): Correct. No alternative.

### hadolint
- **Repo**: https://github.com/hadolint/hadolint
- **Checksum asset**: Per-asset `.sha256` files, e.g. `hadolint-linux-x86_64.sha256`
- **Format**: Single line `hash  filename` per asset (sha256sum compatible)
- **Digest API**: Yes
- **Caveat**: Not a combined checksums file; each binary has its own `.sha256` sidecar.

### ruff
- **Repo**: https://github.com/astral-sh/ruff
- **Checksum asset**: Per-asset `.sha256` files + combined `sha256.sum`
- **Format**: Standard sha256sum
- **Digest API**: Yes
- **Extra**: Also supports GitHub Artifact Attestations (`gh attestation verify`)

### scc
- **Repo**: https://github.com/boyter/scc
- **Checksum asset**: `checksums.txt`
- **Format**: Standard sha256sum
- **Digest API**: Yes

### clangd
- **Repo**: https://github.com/clangd/clangd
- **Checksum asset**: **NONE** for standalone clangd releases (only zip files, no checksums)
- **Digest API**: Yes (GitHub's automatic asset digest only)
- **Note**: The llvm/llvm-project releases use `.sig` (PGP) and `.jsonl` files, but the standalone clangd releases do not.
- **Current approach** (`github-asset-digest`): Correct for clangd.

### clang-format (from LLVM)
- **Repo**: https://github.com/llvm/llvm-project (tag `llvmorg-{version}`)
- **Checksum asset**: `.sig` (PGP signature) and `.jsonl` (JSON Lines with SHA256)
- **Format**: GPG-signed; `.jsonl` contains lines like `{"algorithm":"SHA256","digest":"..."}` for each asset
- **Digest API**: Yes
- **Caveat**: Not a simple sha256sum text file. Requires PGP key management or JSON parsing. The LLVM website recommends `gpg --verify` with keys from https://llvm.org/release-keys.asc
- **cmake.org also publishes**: `cmake-{ver}-SHA-256.txt` and `.asc` on the official website separately from GitHub releases.

### CMake
- **Repo**: https://github.com/Kitware/CMake
- **Checksum asset on GitHub**: `cmake-{ver}-SHA-256.txt` + `cmake-{ver}-SHA-256.txt.asc`
- **Format**: Standard sha256sum (each line: `<hash>  <file>`)
- **Also**: cmake.org files at https://cmake.org/files/v{MAJOR}.{MINOR}/cmake-{version}-SHA-256.txt
- **Digest API**: Yes
- **PGP**: `.asc` file for GPG signature verification

### protoc
- **Repo**: https://github.com/protocolbuffers/protobuf
- **Checksum asset**: **NONE** — no published checksums as of v34.1
- **Digest API**: N/A — GitHub's automatic digest is not documented for this project's releases in the UI
- **History**: Issue #16165 (checksums requested) closed not_planned. PR #26021 (auto-generate checksums.txt) was opened but NOT merged at research time.
- **Bazel Central Registry workaround**: The protobuf source IS checksummed in BCR using the `integrity` field (base64-encoded SHA256), but protoc binaries are NOT.
- **Current manifest approach for protoc**: Would need to use `allowDownloadAndHash: false` and either find an alternative source or compute trusted hashes through an external mechanism. protoc is NOT currently in release-tools.json.

## Conclusions

### Suitable for `requireUpstreamChecksum: true` (authoritative checksum asset):
- **gh**: `gh_{ver}_checksums.txt` — standard sha256sum txt
- **yq**: `checksums` — standard sha256sum txt  
- **actionlint**: `actionlint_{ver}_checksums.txt` — standard sha256sum txt
- **hadolint**: Per-asset `.sha256` — standard sha256sum txt
- **ruff**: Per-asset `.sha256` + `sha256.sum` — standard sha256sum txt
- **scc**: `checksums.txt` — standard sha256sum txt
- **CMake**: `cmake-{ver}-SHA-256.txt` — standard sha256sum txt + GPG

### Must use `github-asset-digest` (GitHub auto-computed SHA256, no published checksums file):
- **marksman**: No checksums file — GitHub digest only
- **clangd**: No checksums file — GitHub digest only

### GPG/PGP-signed only (not sha256sum txt, requires extra tooling):
- **LLVM/clang+llvm**: `.sig` (PGP) + `.jsonl` — requires GPG key management

### No published checksums at all:
- **protoc**: No checksums file; PR pending but not merged

## Policy Considerations

The current manifest policy is `requireUpstreamChecksum: true` and `allowDownloadAndHash: false`.

For tools that only have `github-asset-digest` (marksman, clangd), the `github-asset-digest` format IS the authoritative upstream source since GitHub computes this at upload time and the release is immutable. This satisfies the policy's intent.

For LLVM, the `.jsonl` file provides SHA256 in machine-readable format alongside the `.sig` PGP signature, which could be parsed if needed. But the current manifest doesn't include LLVM/clang-tools — only clangd standalone. If clangd is needed, the `github-asset-digest` approach is the only simple option.

For protoc, there's currently no way to pin an authoritative upstream checksum from the project directly.
