#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_ROOT = '/opt/openchamber/managed-tools';
const DEFAULT_GO_ROOT = join(process.env.HOME || '/home/openchamber', '.go', 'toolchain');
const DEFAULT_GO_PATH = join(process.env.HOME || '/home/openchamber', '.go', 'path');
const DEFAULT_GO_BIN = join(DEFAULT_GO_PATH, 'bin');
const GO_TOOL_PACKAGES = new Map([
  ['golang.org/x/tools/gopls', 'gopls'],
  ['mvdan.cc/sh/v3', 'shfmt'],
]);

function usage() {
  console.error('Usage: go-managed-tools.mjs <status|init> [--root PATH] [--go-root PATH] [--go-path PATH] [--go-bin PATH]');
}

function parseArgs(argv) {
  const args = {
    command: argv[2],
    root: process.env.MANAGED_TOOLS_ROOT || DEFAULT_ROOT,
    goRoot: process.env.GOROOT || DEFAULT_GO_ROOT,
    goPath: process.env.GOPATH || DEFAULT_GO_PATH,
    goBin: process.env.GOBIN || DEFAULT_GO_BIN,
  };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' || arg === '--go-root' || arg === '--go-path' || arg === '--go-bin') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      args[arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.command !== 'status' && args.command !== 'init') {
    usage();
    process.exit(2);
  }

  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stripLeadingV(version) {
  return version.replace(/^v/i, '');
}

function stripLeadingGo(version) {
  return version.replace(/^go/i, '');
}

function normalizeDevel(version) {
  return version === '(devel)' ? '0.0.0' : version;
}

function commandExists(command) {
  return spawnSync('command', ['-v', command], { shell: true, stdio: 'ignore' }).status === 0;
}

function parseSemver(version, { allowDevel = false } = {}) {
  const normalized = normalizeDevel(stripLeadingV(stripLeadingGo(String(version || '').trim())));
  if (allowDevel && normalized === '0.0.0') {
    return [0, 0, 0];
  }
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Unsupported semver value: ${version}`);
  }
  return match.slice(1, 4).map(Number);
}

function compareSemver(left, right, options = {}) {
  const leftParts = parseSemver(left, options);
  const rightParts = parseSemver(right, options);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function loadManifest(root) {
  const manifestPath = join(root, 'manifest.json');
  const manifest = readJson(manifestPath);
  const goToolchain = manifest.ecosystems?.goToolchain;
  const goTools = manifest.ecosystems?.goTools;
  if (manifest.policy?.allowUserMetadata !== false) {
    throw new Error(`${manifestPath} must set policy.allowUserMetadata to false`);
  }
  if (!goToolchain?.enabled || !goTools?.enabled) {
    throw new Error(`${manifestPath} must enable goToolchain and goTools`);
  }
  if (goToolchain.versionSource !== 'manifest' || goTools.versionSource !== 'go-version-m') {
    throw new Error(`${manifestPath} has unsupported Go version sources`);
  }
  if (goToolchain.comparePolicy !== 'semver' || goTools.comparePolicy !== 'semver-or-devel') {
    throw new Error(`${manifestPath} has unsupported Go compare policies`);
  }
  return manifest;
}

function readDesiredGoToolchain(root, manifest) {
  const toolchainPath = join(root, 'go', 'toolchain.json');
  const toolchain = readJson(toolchainPath);
  if (stripLeadingGo(toolchain.version) !== stripLeadingGo(manifest.ecosystems.goToolchain.version)) {
    throw new Error(`${toolchainPath} version does not match managed-tools manifest goToolchain.version`);
  }
  return toolchain;
}

function readDesiredGoTools(root) {
  const goModPath = join(root, 'go', 'go.mod');
  const goMod = readFileSync(goModPath, 'utf8');
  const tools = [];
  for (const [modulePath, binaryName] of GO_TOOL_PACKAGES.entries()) {
    const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = goMod.match(new RegExp(`^\\s*${escaped}\\s+([^\\s]+)`, 'm'));
    if (!match) {
      throw new Error(`${goModPath} does not pin ${modulePath}`);
    }
    tools.push({ modulePath, binaryName, version: stripLeadingV(match[1]) });
  }
  return tools;
}

function getInstalledGoVersion(goRoot) {
  const goBinary = join(goRoot, 'bin', 'go');
  if (!existsSync(goBinary)) {
    return null;
  }
  const result = spawnSync(goBinary, ['version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }
  const match = result.stdout.match(/\b(go\d+\.\d+\.\d+)\b/);
  return match ? match[1] : null;
}

function statusForVersion(installedVersion, desiredVersion, options = {}) {
  if (!installedVersion) {
    return 'missing';
  }
  const comparison = compareSemver(installedVersion, desiredVersion, options);
  if (comparison === 0) return 'equal';
  if (comparison < 0) return 'lower';
  return 'higher';
}

function statusForInstalled(installedVersion, desiredVersion, options = {}) {
  if (!installedVersion) {
    return { installedVersion: null, state: 'missing' };
  }
  return { installedVersion, state: statusForVersion(installedVersion, desiredVersion, options) };
}

function getGoToolchainStatus(goRoot, desiredToolchain) {
  const desiredVersion = stripLeadingGo(desiredToolchain.version);
  const installedVersion = getInstalledGoVersion(goRoot);
  const status = statusForInstalled(installedVersion ? stripLeadingGo(installedVersion) : null, desiredVersion);
  return {
    kind: 'go-toolchain',
    name: 'go',
    installedVersion: status.installedVersion,
    version: desiredVersion,
    path: join(goRoot, 'bin', 'go'),
    state: status.state,
  };
}

function getModuleVersion(goRoot, binaryPath, modulePath) {
  if (!existsSync(binaryPath)) {
    return null;
  }
  const goBinary = join(goRoot, 'bin', 'go');
  if (!existsSync(goBinary) && !commandExists('go')) {
    return null;
  }
  const result = spawnSync(existsSync(goBinary) ? goBinary : 'go', ['version', '-m', '-json', binaryPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }
  const metadata = JSON.parse(result.stdout);
  if (metadata.Path === modulePath || metadata.Main?.Path === modulePath) {
    return metadata.Main?.Version || '(devel)';
  }
  const dependency = metadata.Deps?.find((dep) => dep.Path === modulePath);
  return dependency?.Version || null;
}

function getGoToolStatuses(goRoot, goBin, desiredTools) {
  return desiredTools.map((desired) => {
    const installedVersion = getModuleVersion(goRoot, join(goBin, desired.binaryName), desired.modulePath);
    const status = statusForInstalled(installedVersion ? stripLeadingV(installedVersion) : null, desired.version, { allowDevel: true });
    return {
      kind: 'go-tool',
      name: desired.binaryName,
      modulePath: desired.modulePath,
      installedVersion: status.installedVersion,
      version: desired.version,
      path: join(goBin, desired.binaryName),
      state: status.state,
    };
  });
}

function printStatus(status) {
  const label = status.kind === 'go-toolchain' ? 'go toolchain' : status.name;
  console.log(`[go-managed] ${label}: desired=${status.version} actual=${status.installedVersion || 'missing'} path=${status.path} state=${status.state}`);
  if (status.state === 'higher') {
    console.warn(`[go-managed] warning: ${label}: installed ${status.installedVersion} is higher than pinned ${status.version}; skip downgrade`);
  }
}

function downloadVerifiedToolchain(toolchain, goRoot) {
  const file = toolchain.files?.['linux-amd64'];
  if (!file?.url || !file?.sha256) {
    throw new Error('go/toolchain.json must pin linux-amd64 url and sha256');
  }
  if (!file.url.startsWith('https://go.dev/dl/')) {
    throw new Error(`Unsupported Go toolchain URL: ${file.url}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(file.sha256)) {
    throw new Error(`Invalid Go toolchain SHA256 for ${file.url}`);
  }

  const scratch = mkdtempSync(join(tmpdir(), 'openchamber-go-managed-'));
  const archivePath = join(scratch, file.filename || 'go.tar.gz');
  const downloadResult = spawnSync('curl', ['-fsSL', '-o', archivePath, file.url], { stdio: 'inherit' });
  if (downloadResult.status !== 0) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error(`Failed to download ${file.url}`);
  }

  const verifyResult = spawnSync('sha256sum', ['-c', '-'], {
    input: `${file.sha256}  ${archivePath}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (verifyResult.status !== 0) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error(`SHA256 verification failed for ${file.url}`);
  }

  rmSync(goRoot, { recursive: true, force: true });
  mkdirSync(dirname(goRoot), { recursive: true });
  const tarResult = spawnSync('tar', ['-C', dirname(goRoot), '-xzf', archivePath], { stdio: 'inherit' });
  rmSync(scratch, { recursive: true, force: true });
  if (tarResult.status !== 0) {
    throw new Error(`Failed to extract ${file.url}`);
  }
  if (goRoot !== join(dirname(goRoot), 'go')) {
    rmSync(goRoot, { recursive: true, force: true });
    const moveResult = spawnSync('mv', [join(dirname(goRoot), 'go'), goRoot], { stdio: 'inherit' });
    if (moveResult.status !== 0) {
      throw new Error(`Failed to move extracted Go toolchain into ${goRoot}`);
    }
  }
}

function installGoTools(root, goRoot, goPath, goBin, statuses) {
  mkdirSync(goBin, { recursive: true });
  const installableNames = new Set(statuses.filter((status) => status.state === 'missing' || status.state === 'lower').map((status) => status.name));
  const targets = Array.from(GO_TOOL_PACKAGES.entries())
    .filter(([, binaryName]) => installableNames.has(binaryName))
    .map(([modulePath]) => (modulePath === 'mvdan.cc/sh/v3' ? `${modulePath}/cmd/shfmt` : modulePath));
  if (targets.length === 0) {
    return;
  }
  const installResult = spawnSync(join(goRoot, 'bin', 'go'), ['install', '-mod=readonly', ...targets], {
    cwd: join(root, 'go'),
    stdio: 'inherit',
    env: { ...process.env, GOBIN: goBin, GOPATH: goPath, GOROOT: goRoot, PATH: `${join(goRoot, 'bin')}:${process.env.PATH || ''}` },
  });
  if (installResult.status !== 0) {
    throw new Error(`go install -mod=readonly ${targets.join(' ')} failed with exit code ${installResult.status}`);
  }

  for (const status of statuses.filter((item) => item.state === 'higher')) {
    console.warn(`[go-managed] warning: ${status.name} remains higher than pinned ${status.version}; skipped downgrade per policy`);
  }
}

function touchBootstrapState() {
  const statePath = process.env.MANAGED_TOOLS_BOOTSTRAP_STATE || join(process.env.HOME || '/home/openchamber', '.local', 'state', 'openchamber', 'bootstrap.lock');
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `go ${new Date().toISOString()}\n`, { flag: 'a' });
}

function main() {
  const args = parseArgs(process.argv);
  const manifest = loadManifest(args.root);
  const desiredToolchain = readDesiredGoToolchain(args.root, manifest);
  const desiredTools = readDesiredGoTools(args.root);
  const toolchainStatus = getGoToolchainStatus(args.goRoot, desiredToolchain);
  const toolStatuses = getGoToolStatuses(args.goRoot, args.goBin, desiredTools);
  [toolchainStatus, ...toolStatuses].forEach(printStatus);

  if (args.command === 'status') {
    return;
  }

  if (toolchainStatus.state === 'lower' || toolchainStatus.state === 'missing') {
    downloadVerifiedToolchain(desiredToolchain, args.goRoot);
  }

  if (toolchainStatus.state === 'higher') {
    console.warn(`[go-managed] warning: installed Go ${toolchainStatus.installedVersion} is higher than pinned ${toolchainStatus.version}; skip downgrade`);
  }

  const installableToolStatuses = toolStatuses.filter((status) => status.state === 'missing' || status.state === 'lower');
  if (installableToolStatuses.length > 0) {
    installGoTools(args.root, args.goRoot, args.goPath, args.goBin, toolStatuses);
  }

  const updatedToolchainStatus = getGoToolchainStatus(args.goRoot, desiredToolchain);
  const updatedToolStatuses = getGoToolStatuses(args.goRoot, args.goBin, desiredTools);
  [updatedToolchainStatus, ...updatedToolStatuses].forEach(printStatus);
  const failed = [updatedToolchainStatus, ...updatedToolStatuses].filter((status) => status.state === 'missing' || status.state === 'lower');
  if (failed.length > 0) {
    throw new Error(`go-managed install did not satisfy pinned tools: ${failed.map((status) => status.name).join(', ')}`);
  }
  touchBootstrapState();
}

try {
  main();
} catch (error) {
  console.error(`[go-managed] error: ${error.message}`);
  process.exit(1);
}
