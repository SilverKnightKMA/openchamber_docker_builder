## Task 2: Smaller Baked Core (2026-05-11)

- Full image build and `docker run` runtime checks were not performed because the expected upstream build context `../openchamber` is absent in this workspace. Evidence files include the exact Task 10 build/run commands to execute from a parent directory containing both upstream `openchamber/` and this builder repo.
- `npm ci --prefix` can hit disk pressure in tiny temp dirs; use roomy `/tmp/opencode` temp roots for smoke checks.
- `npm ci` does not expose every binary at prefix/bin by default, so managed installer needs explicit bin exposure.
- Smoke checks need `/tmp/opencode` or similar roomy temp roots because repeated npm prefix installs can exhaust smaller temp dirs.
- Missing managed npm prefix must be treated as empty state; `npm list --prefix` throws ENOENT otherwise. Fixed by short-circuiting absent prefix to empty dependency map.

## Task 4: Managed Go Bootstrap (2026-05-11)

- Host workspace has no ambient `go` on PATH, so `go list -tags=tools -e -json .` cannot run until managed Go is bootstrapped or host Go exists. Smoke verification used the bootstrapped temp Go toolchain instead.
- Parallel metadata checks run before long `go install` completed will race missing binaries; read `go version -m` only after install command exits.

## Task 5: Managed Release-Binary and Rustup Installers (2026-05-11)

- Release-family GitHub tags are not uniform; managed release lookup now tries `v{version}` and `{version}` metadata forms.
- Rust smoke used fixture `rustc` binaries in temp mounted homes instead of a real network toolchain install; real rustup command path is implemented but heavyweight download was skipped.

## Task 5 follow-up: Filtered yq smoke fix (2026-05-11)

- `yq` checksum asset uses multi-column upstream checksum format; parser needs the specific SHA field, not first 64-hex token.
- Filtered `init yq` had been too broad before tool-arg filtering. Fixed so selected release tools run without gh/rust side effects.

## Task 6: Compose and Runtime PATH Wiring (2026-05-11)

- Full Docker image build/runtime validation was not performed because the upstream `../openchamber` build context is absent; Task 10 remains responsible for full image validation.
- Autoinstall verification used fixture `npm`/`sh` commands to prove gate and command wiring without running heavy network installs at startup.

## Task 6 Verification Gotchas (2026-05-11)

- Full Docker build/runtime validation is still deferred because the upstream ../openchamber build context is absent in this workspace; Task 10 should validate the assembled image.
- Entrypoint harnesses need fixture commands under a prepended managed path, such as /home/openchamber/.local/bin, because the wrapper rewrites PATH before invoking npm or the upstream entrypoint.
- Temporary fake shell fixtures must use an absolute shebang like /bin/sh; using /usr/bin/env sh can recursively resolve the fake sh once managed paths are prepended.

## Task 7 Evidence Repair (2026-05-11)

- Verification initially failed because the Task 7 evidence files were absent from `.sisyphus/evidence/`; recreated them directly under the expected paths.
- Rust and release checks remain fixture-based to avoid heavyweight network installs; the evidence captures command output from temp roots rather than Docker image validation.


## Task 8 Final Validation Sweep (2026-05-11)

- Full Docker build, image history inspection, live container startup, and HTTP probing remain blocked because the expected upstream context `/home/openchamber/workspaces/openchamber` is absent in this workspace. Task 8 evidence records the exact commands to run once that context exists.
- When searching docs for stale phrases that include Markdown backticks, quote the shell pattern with single quotes; double-quoted backticks triggered shell command substitution during one local search attempt.

## Workflow Fingerprint Fix (2026-05-11)

- `managed-tools/` (directory) was added to `files=(` arrays in both build workflows, but the fingerprint loop uses `if [ ! -f "${file}" ]` and `sha256sum "${file}"` which fail on directories. Fixed by replacing with explicit `managed-tools/manifest.json` and `managed-tools/policy.json` entries. Path filters `managed-tools/**` remain untouched — they are fine in path filters, only in `files=(` where file operations are performed.
- Lesson: `files=(` arrays feeding `sha256sum` should never contain directory paths. Use explicit file lists. Path filters in `on.pull_request.paths` are glob-based and handle `**` wildcards correctly for directories — no functional issue there, but the `files=(` array is for file hashing.

## Build Upstream Main Docker Tag Fix (2026-05-11)

- Run 25678792900 failed because raw `docker build -t` was given comma-separated tags from `steps.tags.outputs.tags`. Raw Docker requires one `-t` per tag; only docker/build-push-action accepts comma-separated tag lists. Fixed by adding `latest_tag` output and using separate `-t check_tag` and `-t latest_tag` args.

## Build Upstream Main Build Context Fix (2026-05-11)

- Run 25679390178 still failed after tag fix (25678792900). Raw `docker build` after `cd upstream` could not find `builder` directory because working directory is now `upstream/`, but `--build-context toolchain=builder` referenced a non-existent `upstream/builder`. Fixed by changing to `--build-context toolchain=../builder`, which correctly resolves to the checked-out builder repo from the upstream directory. Release workflow uses docker/build-push-action with `context: upstream` and `build-contexts: toolchain=builder` (interpreted relative to workspace root, not affected by `cd upstream`), so it remains unchanged.

## LLVM/protobuf managed release metadata blockers (2026-05-11)

- Root cause: clangd was pointed at the nonexistent `clangd/clangd` tag `20.1.3`, clang-format referenced LLVM asset/checksum names not present on `llvmorg-20.1.3`, and protobuf used desired version `29.4.0` in GitHub release/tag asset names even though upstream publishes `v29.4` and `protoc-29.4-linux-x86_64.zip`.
- Fix: managed release templates now support explicit `tagPattern`/`releaseTag`, `assetVersion`, and `checksumVersion` placeholders through shared template expansion and family-level release settings; LLVM tools use `llvm/llvm-project` tag `llvmorg-20.1.3` plus `LLVM-20.1.3-Linux-X64.tar.xz(.jsonl)`, and protobuf keeps comparable desired version `29.4.0` while selecting release/asset version `29.4`.
- Verification: `node scripts/managed-mounted-tools.mjs metadata clangd clang-format protobuf-compiler` resolved all release metadata and strict JSONL checksums with no 404; protobuf temp init succeeded when `TMPDIR` was moved off full `/tmp`. LLVM full init was not downloaded because the Linux x64 archive is about 2.0 GB.
