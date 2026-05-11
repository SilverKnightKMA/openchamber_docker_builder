# Security Policy

## Supported scope

This repository maintains Docker packaging, workflows, dependency manifests, and runtime tooling for the OpenChamber Docker image published from upstream [`openchamber/openchamber`](https://github.com/openchamber/openchamber).

Security issues in upstream OpenChamber application code should be reported to the upstream project. Issues specific to this builder repository, Docker image hardening, GitHub Actions workflows, bundled toolchain dependencies, or published GHCR images are in scope here.

## Reporting a vulnerability

Please report security issues privately using GitHub's private vulnerability reporting if it is available for this repository. If private reporting is not available, open a minimal issue that avoids exposing exploit details and request a private contact path.

Include:

- Affected image tag, commit, or workflow run.
- Impacted component, such as Dockerfile, workflow, dependency, or runtime tool.
- Reproduction steps or enough detail to validate the issue.
- Any known mitigation or patched version.

Please do not publish exploit code or sensitive credentials in public issues.

## Dependency and scanning policy

This repository uses Dependabot, CodeQL/code scanning, and dependency manifests to keep the image auditable:

- Docker base images and GitHub Actions are updated through Dependabot where supported.
- NPM-based editor and language tooling is pinned in `package.json`/`package-lock.json` and installed into mounted tool paths only when managed tools are initialized.
- Go-based tooling is pinned through `go.mod`, `go.sum`, and `tools.go`.
- Managed release binaries must be pinned in repository manifests and verified with an authoritative SHA-256 source, either upstream-published checksum assets or GitHub release asset digest metadata. Updaters and installers must not download binaries only to compute hashes.

Known advisories may be dismissed only with an explicit accepted-risk note when the affected package is used strictly as local editor/LSP tooling and the vulnerable runtime path is not exposed by the image.

Currently accepted examples include:

- `bash-language-server` dependency advisories involving `minimatch`, accepted for LSP/editor use with managed `shfmt` and project-local shell linting available where configured.
- `svelte-language-server` dependency advisories involving Svelte SSR paths, accepted because the image does not serve a Svelte SSR application through that dependency.

These accepted risks should be revisited when upstream packages provide compatible patched dependency paths.

## Runtime security guidance

Operators should treat the container as a developer workstation with persisted credentials:

- Change `UI_PASSWORD` before exposing the web UI.
- Prefer HTTPS and access control at the reverse proxy layer.
- Keep persisted config/auth directories owned by the container user (`UID 1000`).
- Store GitHub CLI auth, SSH keys, OpenCode state, and user-installed tools only in the intended mounted directories.
- Avoid mounting the Docker socket or cloud credentials unless explicitly needed and understood.
- Enable privileged Docker-in-Docker only for trusted users and workspaces.
- Enable `OPENCHAMBER_MANAGED_TOOLS_AUTOINSTALL=true` only for trusted deployments with writable managed-tool mounts; it fetches and installs executable tools during startup using repository-pinned versions and checksum policy.

## Update expectations

Security fixes are handled through normal pull requests or workflow-driven update PRs. Published images are rebuilt after relevant repository changes are merged.
