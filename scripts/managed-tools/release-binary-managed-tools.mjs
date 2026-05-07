#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_ROOT = '/opt/openchamber/managed-tools';
const DEFAULT_RELEASE_TOOLS = '/opt/openchamber/managed-tools/release-tools.json';
const DEFAULT_BIN_DIR = join(process.env.HOME || '/home/openchamber', '.local', 'bin');

function usage() {
  console.error('Usage: release-binary-managed-tools.mjs <status|init> [--root PATH] [--release-tools PATH] [--bin-dir PATH]');
}

function parseArgs(argv) {
  const args = {
    command: argv[2],
    root: process.env.MANAGED_TOOLS_ROOT || DEFAULT_ROOT,
    releaseTools: process.env.MANAGED_RELEASE_TOOLS_MANIFEST || DEFAULT_RELEASE_TOOLS,
    binDir: process.env.MANAGED_TOOLS_BIN_DIR || DEFAULT_BIN_DIR,
  };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' || arg === '--release-tools' || arg === '--bin-dir') {
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

function stripLlvmOrg(version) {
  return version.replace(/^llvmorg-/i, '');
}

function parseSemver(version) {
  const normalized = stripLeadingV(stripLlvmOrg(String(version || '').trim()));
  const dateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    return dateMatch.slice(1, 4).map(Number);
  }
  const match = normalized.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Unsupported semver value: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3] || '0')];
}

function compareSemver(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function loadManifest(root) {
  const manifestPath = join(root, 'manifest.json');
  const manifest = readJson(manifestPath);
  const releaseBinaries = manifest.ecosystems?.releaseBinaries;
  const gh = manifest.ecosystems?.gh;
  if (manifest.policy?.allowUserMetadata !== false) {
    throw new Error(`${manifestPath} must set policy.allowUserMetadata to false`);
  }
  if (!releaseBinaries?.enabled || !gh?.enabled) {
    throw new Error(`${manifestPath} must enable releaseBinaries and gh`);
  }
  if (releaseBinaries.comparePolicy !== 'semver' || gh.comparePolicy !== 'semver') {
    throw new Error(`${manifestPath} has unsupported release-binary compare policies`);
  }
  if (releaseBinaries.versionSource !== 'manifest' || gh.versionSource !== 'manifest') {
    throw new Error(`${manifestPath} has unsupported release-binary version sources`);
  }
  return manifest;
}

function validateReleasePolicy(manifestPath, manifest) {
  if (manifest.policy?.requireUpstreamChecksum !== true) {
    throw new Error(`${manifestPath} must require upstream checksums`);
  }
  if (manifest.policy?.allowDownloadAndHash !== false) {
    throw new Error(`${manifestPath} must not allow download-and-hash fallback`);
  }
  for (const tool of manifest.tools ?? []) {
    if (!tool.name || !tool.repo || !tool.version || !tool.asset || !tool.sha256) {
      throw new Error(`${manifestPath} contains an incomplete release-binary entry`);
    }
    if (!/^[a-f0-9]{64}$/i.test(tool.sha256)) {
      throw new Error(`${tool.name} has an invalid SHA256 pin`);
    }
    if (tool.checksumFormat === 'github-asset-digest' && tool.checksumAsset !== null) {
      throw new Error(`${tool.name} must set checksumAsset to null for GitHub asset digest verification`);
    }
  }
}

function loadReleaseToolsManifest(root, releaseToolsPath) {
  const localPath = join(root, 'release-tools.json');
  const manifestPath = existsSync(releaseToolsPath) ? releaseToolsPath : localPath;
  const manifest = readJson(manifestPath);
  validateReleasePolicy(manifestPath, manifest);
  return manifest.tools.map((tool) => ({ ...tool, managedName: tool.name, outputName: tool.name }));
}

function loadManagedReleaseBinaries(root) {
  const manifestPath = join(root, 'release-binaries.json');
  const manifest = readJson(manifestPath);
  validateReleasePolicy(manifestPath, manifest);
  return manifest.tools.map((tool) => ({ ...tool, managedName: tool.name, outputName: tool.name }));
}

function loadGh(root, manifest) {
  const ghPath = join(root, 'gh.json');
  const gh = readJson(ghPath);
  if (stripLeadingV(gh.version) !== stripLeadingV(manifest.ecosystems.gh.version)) {
    throw new Error(`${ghPath} version does not match managed-tools manifest gh.version`);
  }
  if (!/^[a-f0-9]{64}$/i.test(gh.sha256)) {
    throw new Error(`${ghPath} has an invalid SHA256 pin`);
  }
  return { ...gh, managedName: 'gh', outputName: 'gh' };
}

function desiredTools(root, releaseToolsPath, manifest) {
  return [
    ...loadReleaseToolsManifest(root, releaseToolsPath),
    ...loadManagedReleaseBinaries(root),
    loadGh(root, manifest),
  ];
}

function installedVersion(binaryPath) {
  if (!existsSync(binaryPath)) {
    return null;
  }
  const result = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }
  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/(\d+\.\d+(?:\.\d+)?)/);
  if (match) {
    return match[1];
  }
  const dateMatch = output.match(/(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : null;
}

function statusForTool(binDir, tool) {
  const desiredVersion = stripLeadingV(stripLlvmOrg(tool.version));
  const binaryPath = join(binDir, tool.outputName);
  const version = installedVersion(binaryPath, tool.name);
  if (!version) {
    return { ...tool, version: desiredVersion, installedVersion: null, path: binaryPath, state: 'missing' };
  }
  const comparison = compareSemver(version, desiredVersion);
  if (comparison === 0) {
    return { ...tool, version: desiredVersion, installedVersion: version, path: binaryPath, state: 'equal' };
  }
  if (comparison < 0) {
    return { ...tool, version: desiredVersion, installedVersion: version, path: binaryPath, state: 'lower' };
  }
  return { ...tool, version: desiredVersion, installedVersion: version, path: binaryPath, state: 'higher' };
}

function releaseTag(tool) {
  if (tool.version.startsWith('v') || tool.version.startsWith('llvmorg-')) {
    return tool.version;
  }
  if (tool.name === 'gh' || tool.repo === 'cli/cli' || tool.repo === 'Kitware/CMake' || tool.repo === 'protocolbuffers/protobuf') {
    return `v${stripLeadingV(tool.version)}`;
  }
  return tool.version;
}

function printStatus(status) {
  console.log(`[release-binary-managed] ${status.outputName}: desired=${status.version} actual=${status.installedVersion || 'missing'} path=${status.path} state=${status.state}`);
  if (status.state === 'higher') {
    console.warn(`[release-binary-managed] warning: ${status.outputName}: installed ${status.installedVersion} is higher than pinned ${status.version}; skip downgrade`);
  }
}

function downloadVerified(tool, scratch) {
  const url = `https://github.com/${tool.repo}/releases/download/${releaseTag(tool)}/${tool.asset}`;
  const archivePath = join(scratch, tool.asset);
  const downloadResult = spawnSync('curl', ['-fsSL', url, '-o', archivePath], { stdio: 'inherit' });
  if (downloadResult.status !== 0) {
    throw new Error(`Failed to download ${url}`);
  }
  const verifyResult = spawnSync('sha256sum', ['-c', '-'], {
    input: `${tool.sha256}  ${archivePath}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (verifyResult.status !== 0) {
    throw new Error(`SHA256 verification failed for ${url}`);
  }
  return archivePath;
}

function extractTool(tool, archivePath, extractDir) {
  mkdirSync(extractDir, { recursive: true });
  if (tool.asset.endsWith('.tar.gz')) {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Failed to extract ${tool.asset}`);
  } else if (tool.asset.endsWith('.tar.xz')) {
    const result = spawnSync('tar', ['-xJf', archivePath, '-C', extractDir], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Failed to extract ${tool.asset}`);
  } else if (tool.asset.endsWith('.zip')) {
    const result = spawnSync('unzip', ['-q', archivePath, '-d', extractDir], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Failed to extract ${tool.asset}`);
  } else {
    return archivePath;
  }
  return tool.binaryPath ? join(extractDir, tool.binaryPath) : locateBinary(extractDir, tool.name);
}

function locateBinary(extractDir, name) {
  const result = spawnSync('find', [extractDir, '-type', 'f', '-name', name, '-perm', '/111'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Failed to search ${extractDir} for ${name}`);
  }
  const candidates = result.stdout.trim().split('\n').filter(Boolean);
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one executable ${name} binary inside ${extractDir}, found ${candidates.length}`);
  }
  return candidates[0];
}

function installTools(statuses, binDir) {
  mkdirSync(binDir, { recursive: true });
  for (const status of statuses) {
    if (status.state === 'higher') {
      console.warn(`[release-binary-managed] warning: ${status.outputName} remains higher than pinned ${status.version}; skipped downgrade per policy`);
      continue;
    }
    if (status.state === 'equal') {
      continue;
    }
    const scratch = mkdtempSync(join(tmpdir(), 'openchamber-release-binary-managed-'));
    try {
      const archivePath = downloadVerified(status, scratch);
      const binaryPath = extractTool(status, archivePath, join(scratch, status.name));
      const installResult = spawnSync('install', ['-m', '0755', binaryPath, join(binDir, status.outputName)], { stdio: 'inherit' });
      if (installResult.status !== 0) {
        throw new Error(`Failed to install ${status.outputName}`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

function touchBootstrapState() {
  const statePath = process.env.MANAGED_TOOLS_BOOTSTRAP_STATE || join(process.env.HOME || '/home/openchamber', '.local', 'state', 'openchamber', 'bootstrap.lock');
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `release-binaries ${new Date().toISOString()}\n`, { flag: 'a' });
}

function main() {
  const args = parseArgs(process.argv);
  const manifest = loadManifest(args.root);
  const tools = desiredTools(args.root, args.releaseTools, manifest);
  const statuses = tools.map((tool) => statusForTool(args.binDir, tool));
  statuses.forEach(printStatus);
  if (args.command === 'status') {
    return;
  }
  installTools(statuses, args.binDir);
  const updatedStatuses = tools.map((tool) => statusForTool(args.binDir, tool));
  updatedStatuses.forEach(printStatus);
  const failed = updatedStatuses.filter((status) => status.state === 'missing' || status.state === 'lower');
  if (failed.length > 0) {
    throw new Error(`release-binary install did not satisfy pinned tools: ${failed.map((status) => status.outputName).join(', ')}`);
  }
  touchBootstrapState();
}

try {
  main();
} catch (error) {
  console.error(`[release-binary-managed] error: ${error.message}`);
  process.exit(1);
}
