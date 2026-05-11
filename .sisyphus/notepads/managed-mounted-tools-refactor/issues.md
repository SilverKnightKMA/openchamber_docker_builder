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
