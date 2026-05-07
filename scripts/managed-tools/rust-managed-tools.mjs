#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_ROOT = '/opt/openchamber/managed-tools';
const DEFAULT_CARGO_HOME = join(process.env.HOME || '/home/openchamber', '.cargo');
const DEFAULT_RUSTUP_HOME = join(process.env.HOME || '/home/openchamber', '.rustup');

function usage() {
  console.error('Usage: rust-managed-tools.mjs <status|init> [--root PATH] [--cargo-home PATH] [--rustup-home PATH]');
}

function parseArgs(argv) {
  const args = {
    command: argv[2],
    root: process.env.MANAGED_TOOLS_ROOT || DEFAULT_ROOT,
    cargoHome: process.env.CARGO_HOME || DEFAULT_CARGO_HOME,
    rustupHome: process.env.RUSTUP_HOME || DEFAULT_RUSTUP_HOME,
  };
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' || arg === '--cargo-home' || arg === '--rustup-home') {
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

function parseSemver(version) {
  const normalized = stripLeadingV(String(version || '').trim());
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Unsupported semver value: ${version}`);
  }
  return match.slice(1, 4).map(Number);
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
  const rustToolchain = manifest.ecosystems?.rustToolchain;
  if (manifest.policy?.allowUserMetadata !== false) {
    throw new Error(`${manifestPath} must set policy.allowUserMetadata to false`);
  }
  if (!rustToolchain?.enabled) {
    throw new Error(`${manifestPath} must enable rustToolchain`);
  }
  if (rustToolchain.comparePolicy !== 'semver' || rustToolchain.versionSource !== 'manifest') {
    throw new Error(`${manifestPath} has unsupported Rust toolchain policy`);
  }
  return manifest;
}

function loadToolchain(root, manifest) {
  const toolchainPath = join(root, 'rust', 'toolchain.json');
  const toolchain = readJson(toolchainPath);
  if (stripLeadingV(toolchain.toolchain) !== stripLeadingV(manifest.ecosystems.rustToolchain.version)) {
    throw new Error(`${toolchainPath} toolchain does not match managed-tools manifest rustToolchain.version`);
  }
  if (!toolchain.rustup?.url || !toolchain.rustup?.sha256) {
    throw new Error(`${toolchainPath} must pin rustup url and sha256`);
  }
  if (!toolchain.rustup.url.startsWith('https://static.rust-lang.org/rustup/archive/')) {
    throw new Error(`Unsupported rustup URL: ${toolchain.rustup.url}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(toolchain.rustup.sha256)) {
    throw new Error(`${toolchainPath} has an invalid rustup SHA256 pin`);
  }
  return toolchain;
}

function rustcPath(cargoHome) {
  return join(cargoHome, 'bin', 'rustc');
}

function rustupPath(cargoHome) {
  return join(cargoHome, 'bin', 'rustup');
}

function installedRustVersion(cargoHome, toolchain) {
  const rustc = rustcPath(cargoHome);
  if (!existsSync(rustc)) {
    return null;
  }
  const result = spawnSync(rustc, [`+${toolchain.toolchain}`, '--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    const fallback = spawnSync(rustc, ['--version'], { encoding: 'utf8' });
    if (fallback.status !== 0) {
      return null;
    }
    const fallbackMatch = fallback.stdout.match(/rustc\s+(\d+\.\d+\.\d+)/);
    return fallbackMatch ? fallbackMatch[1] : null;
  }
  const match = result.stdout.match(/rustc\s+(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function getStatus(cargoHome, toolchain) {
  const desiredVersion = stripLeadingV(toolchain.toolchain);
  const installedVersion = installedRustVersion(cargoHome, toolchain);
  if (!installedVersion) {
    return { name: 'rust toolchain', version: desiredVersion, installedVersion: null, path: rustupPath(cargoHome), state: 'missing' };
  }
  const comparison = compareSemver(installedVersion, desiredVersion);
  if (comparison === 0) {
    return { name: 'rust toolchain', version: desiredVersion, installedVersion, path: rustupPath(cargoHome), state: 'equal' };
  }
  if (comparison < 0) {
    return { name: 'rust toolchain', version: desiredVersion, installedVersion, path: rustupPath(cargoHome), state: 'lower' };
  }
  return { name: 'rust toolchain', version: desiredVersion, installedVersion, path: rustupPath(cargoHome), state: 'higher' };
}

function printStatus(status) {
  console.log(`[rust-managed] ${status.name}: desired=${status.version} actual=${status.installedVersion || 'missing'} path=${status.path} state=${status.state}`);
  if (status.state === 'higher') {
    console.warn(`[rust-managed] warning: installed ${status.installedVersion} is higher than pinned ${status.version}; skip downgrade`);
  }
}

function installRustup(toolchain, cargoHome, rustupHome) {
  mkdirSync(join(cargoHome, 'bin'), { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'openchamber-rust-managed-'));
  try {
    const rustupInit = join(scratch, 'rustup-init');
    const downloadResult = spawnSync('curl', ['-fsSL', toolchain.rustup.url, '-o', rustupInit], { stdio: 'inherit' });
    if (downloadResult.status !== 0) {
      throw new Error(`Failed to download ${toolchain.rustup.url}`);
    }
    const verifyResult = spawnSync('sha256sum', ['-c', '-'], {
      input: `${toolchain.rustup.sha256}  ${rustupInit}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (verifyResult.status !== 0) {
      throw new Error(`SHA256 verification failed for ${toolchain.rustup.url}`);
    }
    const chmodResult = spawnSync('chmod', ['0755', rustupInit], { stdio: 'inherit' });
    if (chmodResult.status !== 0) {
      throw new Error('Failed to make rustup-init executable');
    }
    const installResult = spawnSync(rustupInit, ['-y', '--no-modify-path', '--profile', toolchain.profile || 'minimal', '--default-toolchain', 'none'], {
      stdio: 'inherit',
      env: { ...rustEnv(cargoHome, rustupHome), RUSTUP_INIT_SKIP_PATH_CHECK: 'yes' },
    });
    if (installResult.status !== 0) {
      throw new Error(`rustup-init failed with exit code ${installResult.status}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function rustEnv(cargoHome, rustupHome) {
  return {
    ...process.env,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    PATH: `${join(cargoHome, 'bin')}:${process.env.PATH || ''}`,
  };
}

function installToolchain(toolchain, cargoHome, rustupHome) {
  if (!existsSync(rustupPath(cargoHome))) {
    installRustup(toolchain, cargoHome, rustupHome);
  }
  const args = ['toolchain', 'install', toolchain.toolchain, '--profile', toolchain.profile || 'minimal'];
  const installResult = spawnSync(rustupPath(cargoHome), args, { stdio: 'inherit', env: rustEnv(cargoHome, rustupHome) });
  if (installResult.status !== 0) {
    throw new Error(`rustup ${args.join(' ')} failed with exit code ${installResult.status}`);
  }
  if (toolchain.default !== false) {
    const defaultResult = spawnSync(rustupPath(cargoHome), ['default', toolchain.toolchain], { stdio: 'inherit', env: rustEnv(cargoHome, rustupHome) });
    if (defaultResult.status !== 0) {
      throw new Error(`rustup default ${toolchain.toolchain} failed with exit code ${defaultResult.status}`);
    }
  }
}

function touchBootstrapState() {
  const statePath = process.env.MANAGED_TOOLS_BOOTSTRAP_STATE || join(process.env.HOME || '/home/openchamber', '.local', 'state', 'openchamber', 'bootstrap.lock');
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `rust ${new Date().toISOString()}\n`, { flag: 'a' });
}

function main() {
  const args = parseArgs(process.argv);
  const manifest = loadManifest(args.root);
  const toolchain = loadToolchain(args.root, manifest);
  const status = getStatus(args.cargoHome, toolchain);
  printStatus(status);
  if (args.command === 'status') {
    return;
  }
  if (status.state === 'higher') {
    console.warn(`[rust-managed] warning: installed Rust ${status.installedVersion} is higher than pinned ${status.version}; skip downgrade`);
    touchBootstrapState();
    return;
  }
  if (status.state === 'missing' || status.state === 'lower') {
    installToolchain(toolchain, args.cargoHome, args.rustupHome);
  }
  const updatedStatus = getStatus(args.cargoHome, toolchain);
  printStatus(updatedStatus);
  if (updatedStatus.state === 'missing' || updatedStatus.state === 'lower') {
    throw new Error('rust-managed install did not satisfy the pinned Rust toolchain');
  }
  touchBootstrapState();
}

try {
  main();
} catch (error) {
  console.error(`[rust-managed] error: ${error.message}`);
  process.exit(1);
}
