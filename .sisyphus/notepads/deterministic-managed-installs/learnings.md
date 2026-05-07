# Deterministic Managed Installs — Research Findings

## 1. npm ci into Custom Prefix with Lockfile

**Key mechanism:** `npm ci` installs deterministically from `package-lock.json`, never modifying lockfiles or `package.json`. It deletes existing `node_modules` before installing.

- **Docs:** https://docs.npmjs.com/cli/v8/commands/npm-ci
- **Custom prefix:** Use `--prefix` to redirect install location. Example:

  ```bash
  npm ci --prefix /path/to/install/root
  ```

  With `--global-style` (or setting `global=true` in `.npmrc`), npm installs into `{prefix}/lib/node_modules` with bins linked to `{prefix}/bin`. However, **`npm ci` does not support `--global`** — it always installs into the local project context.

  For global-style deterministic installs from lockfile, the typical workaround is to set `prefix` in `.npmrc` before running `npm ci` in the project directory, or to use `npm install --global-style --package-lock-only` followed by `npm ci` from a prepared tree.

- **Practical caveats:**
  - `npm ci` requires `package-lock.json` to match `package.json`. Mismatch → error.
  - Cannot add individual packages; installs entire project at once.
  - `npm ci` does NOT support `--global` flag. For global-prefix installs, use `npm install -g --global-style` or configure `prefix` in project-level `.npmrc`.
  - Lockfiles generated with flags (`--legacy-peer-deps`, `--install-links`) must use same flags with `npm ci` — persist them in `.npmrc` committed to repo.
  - When using `--prefix`, the lockfile is still read from the project root (CWD), not from the prefix path.

## 2. Go Binary Metadata via `go version -m`

**Key mechanism:** `go version -m` reads embedded module/build information from compiled Go binaries using `runtime/debug.ReadBuildInfo`.

- **Source:** https://pkg.go.dev/cmd/go/internal/version — `go version [-m] [-v] [-json] [file ...]`
- **Output format:** For each binary, prints Go version line then indented module lines. Example:

  ```
  go version go1.22.4 linux/amd64
  	path example.com/hello
  	mod    example.com/hello    (devel)
  	dep    github.com/pkg/errors    v0.9.1
  ```

- **`-json` flag:** Outputs `runtime/debug.BuildInfo` as JSON — requires `-m` to be set; gives structured key/value including `Path`, `Main.Path`, `Main.Version`, `Main.Sum`, `BuildSettings`, `Deps`.

  ```bash
  go version -m -json /path/to/binary
  ```

- **Caveats:**
  - Only works for binaries built with module support (Go 1.13+).
  - Information is embedded at build time by the Go toolchain — not all tools embed it.
  - For currently-running binary, use `runtime/debug.ReadBuildInfo()` directly.
  - `go version` walks directories recursively if given a directory path.

## 3. `go install -mod=readonly`

**Key mechanism:** `-mod=readonly` prevents `go` from automatically updating `go.mod`/`go.sum` — it fails instead if updates are needed.

- **Docs:** https://pkg.go.dev/cmd/go — `-mod mode` flag
- **Modes available:** `readonly`, `vendor`, `mod` (auto-update)
- **Default behavior:** Since Go 1.16, `go` defaults to `-mod=readonly` when `go.mod` exists but needs changes. In earlier versions (1.15 and lower), `-mod=mod` was default.
- **Usage:**

  ```bash
  go build -mod=readonly ./...
  go install -mod=readonly example.com/cmd@v1.2.3
  ```

- **What happens:** If a dependency is missing or `go.mod` needs updating, `go` exits with an error instead of modifying files. This enforces that `go.mod`/`go.sum` must already be in sync.
- **Caveats:**
  - `-mod=vendor` uses the vendor directory exclusively — still respects lockfile semantics.
  - For CI, combine with `go mod download` (which itself is read-only) to pre-populate cache.
  - `go install` with a version suffix (`@v1.2.3`) ignores the local `go.mod` and uses that exact version — this is the recommended way to install tools deterministically.

## 4. rustup — CARGO_HOME / RUSTUP_HOME

**Key mechanism:** `rustup` installs toolchains into `RUSTUP_HOME` (default `~/.rustup`) and Cargo cache/binaries into `CARGO_HOME` (default `~/.cargo`). Setting these before running `rustup-init` redirects the install.

- **Docs:** https://rust-lang.github.io/rustup/installation/ and https://rust-lang.github.io/rustup/environment-variables.html
- **Usage:**

  ```bash
  CARGO_HOME=/custom/cargo RUSTUP_HOME=/custom/rustup rustup-init
  ```

  Or set env vars before calling rustup in scripts:

  ```bash
  export CARGO_HOME=/opt/rust/cargo
  export RUSTUP_HOME=/opt/rust/rustup
  export PATH="$CARGO_HOME/bin:$PATH"
  rustup install stable
  ```

- **Practical patterns:**
  - For relocating an existing install: move the `.cargo` and `.rustup` directories, then set env vars + update PATH.
  - No config file relocation mechanism — user must set env vars consistently.
  - `rustup` itself stores its config in `{RUSTUP_HOME}/rustup/settings.toml`.
  - Toolchain binaries land in `{RUSTUP_HOME}/toolchains/{toolchain}/bin`.
  - `CARGO_HOME/bin` is where `cargo install` puts binaries.
  - Both must be on PATH for toolchain to work.

- **Caveats:**
  - Env vars must be set consistently every time the toolchain is invoked.
  - If you set `CARGO_HOME` to a custom location, `cargo` will use it — but `rustup` does not read Cargo's config file for this.

## 5. GitHub CLI — Release Binary Tarballs + Checksums

**Key mechanism:** `gh release download` fetches assets from GitHub releases; `gh release verify` validates attestation signatures; `gh release verify-asset` validates a local file matches a release asset.

- **Docs:** 
  - Download: https://cli.github.com/manual/gh_release_download
  - Verify: https://cli.github.com/manual/gh_release_verify
  - Verify-asset: https://cli.github.com/manual/gh_release_verify-asset

- **Download patterns:**

  ```bash
  # Download tar.gz source archive
  gh release download <tag> --archive=tgz

  # Download matching assets by glob
  gh release download <tag> -p '*.tar.gz' -p '*checksums*'

  # Download to specific dir
  gh release download <tag> -D /tmp/releases
  ```

- **Attestation/verification:**
  ```bash
  # Verify release has valid attestation
  gh release verify <tag>

  # Verify local file matches release asset (by SHA256)
  gh release verify-asset <tag> /path/to/file
  ```

- **Caveats:**
  - `gh release verify-asset` cannot be used on source code zip/tar.gz assets — those are created on-demand when requested.
  - Source archives downloaded with `--archive` are "legacy" format from `go.toolchain` era — they use `.tar.gz` with a known naming scheme.
  - For checksum verification without `gh`: download `*checksums*` file and compare `sha256sum -c`.
  - Releases tagged with "Immutable" badge on GitHub UI indicate cryptographically signed attestations.

## 6. LLVM / CMake / Protobuf — Binary Archive Install Patterns

### LLVM

- **Downloads page:** https://releases.llvm.org/
- **GitHub releases:** https://github.com/llvm/llvm-project/releases
- **Package naming:**
  - `LLVM-{version}-{platform}.tar.xz` — toolchain installer
  - `clang+llvm-{version}-{platform}.tar.xz` — libraries + tools (for software that uses LLVM)
- **Install pattern:** Extract anywhere; bin directory contains `clang`, `clang++`, `lld`, etc.

  ```bash
  tar -xf LLVM-22.1.5-linux-x64.tar.xz -C /opt/llvm
  export PATH="/opt/llvm/bin:$PATH"
  ```

- **Caveats:**
  - Windows has `.exe` installer vs `.tar.xz` archive distinction — installer is preferred for toolchain use.
  - Archives are **not** prefixed with a versioned subdir — extraction creates `LLVM-*/bin`, etc.
  - GPG signatures available (`.sig` files) for verification.

### CMake

- **Downloads page:** https://cmake.org/download/ and https://cmake.org/cmake/resources/software.html
- **GitHub releases:** https://github.com/Kitware/CMake/releases
- **Package naming:** `cmake-{version}-{os}-{arch}.tar.gz` extracts to `cmake-{version}-{os}-{arch}/`
- **Install pattern:**

  ```bash
  tar -xzf cmake-4.2.3-linux-x86_64.tar.gz -C /opt
  export PATH="/opt/cmake-4.2.1-linux-x86_64/bin:$PATH"
  # or use the self-extracting .sh:
  sh cmake-4.2.3-linux-x86_64.sh --skip-license --prefix=/opt/cmake
  ```

- **Verification:** Each release has `cmake-{version}-SHA-256.txt` and `cmake-{version}-SHA-256.txt.asc` (GPG signed).

  ```bash
  sha256sum -c cmake-4.2.3-linux-x86_64.tar.gz.sha256
  ```

### Protocol Buffers (protoc)

- **Downloads page:** https://protobuf.dev/installation/ and https://protobuf.dev/downloads/
- **GitHub releases:** https://github.com/protocolbuffers/protobuf/releases
- **Package naming:** `protoc-{version}-{os}-{arch}.zip`
- **Install pattern:**

  ```bash
  # Using GitHub API to get latest URL
  URL=$(curl -s https://api.github.com/repos/protocolbuffers/protobuf/releases/latest \
    | jq -r '.assets[] | select(.name | endswith("linux-x86_64.zip")) | .browser_download_url')
  curl -LO "$URL"
  unzip -o $(basename "$URL") -d "$HOME/.local"
  export PATH="$HOME/.local/bin:$PATH"
  ```

  Or pinned version:

  ```bash
  unzip -o protoc-34.1-linux-x86_64.zip -d /opt/protobuf
  export PATH="/opt/protobuf/bin:$PATH"
  ```

- **Verification:** GitHub releases include SHA checksums in attestation JSONL files (`.jsonl` assets).
- **Caveats:**
  - Package manager `apt install protobuf-compiler` often installs outdated versions — verify with `protoc --version`.
  - Archives contain `bin/protoc`, `include/google/protobuf/`, and `readme*`.

## Cross-Cutting Notes

1. **Reproducibility in Docker:** All these patterns are suitable for Docker layered installs:
   - Each tool extracted to a fixed prefix path (`/usr/local`, `/opt/{tool}`)
   - Checksums verified before extraction
   - Env vars baked into image or provided at runtime via entrypoint/envd
2. **Determinism guarantee levels:**
   - **Highest:** `npm ci` + lockfile (frozen tree), `go install @version` (exact module version)
   - **High:** LLVM/CMake/protobuf SHA-256 verified tarballs
   - **Moderate:** `go install -mod=readonly` (fails if deps drift, but doesn't prevent drift)
3. **No trusted download-and-hash:** For release-tool binaries, policy requires authoritative upstream checksums — do not compute hashes by downloading unknown artifacts.
4. **Source archives vs release assets:** Source code tarballs from `gh release download --archive` are created on-demand and cannot be cryptographically verified via `gh release verify-asset`.
