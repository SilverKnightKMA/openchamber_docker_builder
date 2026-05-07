#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_ROOT = '/opt/openchamber/managed-tools';
const DEFAULT_PREFIX = join(process.env.HOME || '/home/openchamber', '.npm-global');

function usage() {
  console.error('Usage: npm-managed-tools.mjs <status|init> [--root PATH] [--prefix PATH]');
}

function parseArgs(argv) {
  const args = { command: argv[2], root: process.env.MANAGED_TOOLS_ROOT || DEFAULT_ROOT, prefix: process.env.NPM_CONFIG_PREFIX || DEFAULT_PREFIX };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' || arg === '--prefix') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      args[arg.slice(2)] = value;
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
  const npmConfig = manifest.ecosystems?.npm;
  if (manifest.policy?.allowUserMetadata !== false) {
    throw new Error(`${manifestPath} must set policy.allowUserMetadata to false`);
  }
  if (!npmConfig?.enabled) {
    throw new Error(`${manifestPath} does not enable the npm ecosystem`);
  }
  if (npmConfig.versionSource !== 'lockfile') {
    throw new Error(`${manifestPath} npm.versionSource must be lockfile`);
  }
  if (npmConfig.comparePolicy !== 'semver') {
    throw new Error(`${manifestPath} npm.comparePolicy must be semver`);
  }
  return manifest;
}

function resolveDesiredPackages(root) {
  loadManifest(root);
  const packageJsonPath = join(root, 'npm', 'package.json');
  const packageLockPath = join(root, 'npm', 'package-lock.json');
  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const rootLockPackage = packageLock.packages?.[''];
  const packageNames = Object.keys(packageJson.dependencies || {});

  if (!rootLockPackage?.dependencies) {
    throw new Error(`${packageLockPath} does not contain root package dependencies`);
  }

  return packageNames.map((name) => {
    const locked = packageLock.packages?.[`node_modules/${name}`];
    const rootDependency = rootLockPackage.dependencies[name];
    const version = locked?.version || rootDependency;
    if (!version) {
      throw new Error(`No lockfile version found for npm package ${name}`);
    }
    return { name, version: stripLeadingV(version) };
  });
}

function installedPackagePath(prefix, packageName) {
  return join(prefix, 'node_modules', packageName, 'package.json');
}

function getInstalledVersion(prefix, packageName) {
  const packagePath = installedPackagePath(prefix, packageName);
  if (!existsSync(packagePath)) {
    return null;
  }
  return stripLeadingV(readJson(packagePath).version);
}

function getStatuses(prefix, desiredPackages) {
  return desiredPackages.map((desired) => {
    const installedVersion = getInstalledVersion(prefix, desired.name);
    if (!installedVersion) {
      return { ...desired, installedVersion: null, path: installedPackagePath(prefix, desired.name), state: 'missing' };
    }

    const comparison = compareSemver(installedVersion, desired.version);
    if (comparison === 0) {
      return { ...desired, installedVersion, path: installedPackagePath(prefix, desired.name), state: 'equal' };
    }
    if (comparison < 0) {
      return { ...desired, installedVersion, path: installedPackagePath(prefix, desired.name), state: 'lower' };
    }
    return { ...desired, installedVersion, path: installedPackagePath(prefix, desired.name), state: 'higher' };
  });
}

function printStatuses(statuses) {
  for (const status of statuses) {
    const pathLabel = status.path || status.installPath || status.prefix || status.name;
    console.log(`[npm-managed] ${status.name}: desired=${status.version} actual=${status.installedVersion || 'missing'} path=${pathLabel} state=${status.state}`);
    if (status.state === 'higher') {
      console.warn(`[npm-managed] warning: ${status.name}: installed ${status.installedVersion} is higher than pinned ${status.version}; skip downgrade`);
    }
  }
}

function packageNameFromNodeModulesEntry(entry, childEntry = null) {
  return childEntry ? `${entry}/${childEntry}` : entry;
}

function copyNodeModulesFromScratch(scratch, prefix, higherPackageNames) {
  const scratchNodeModules = join(scratch, 'node_modules');
  const prefixNodeModules = join(prefix, 'node_modules');
  mkdirSync(prefixNodeModules, { recursive: true });

  for (const entry of readdirSync(scratchNodeModules)) {
    if (entry === '.bin') {
      continue;
    }

    if (entry.startsWith('@')) {
      const scopeSource = join(scratchNodeModules, entry);
      for (const childEntry of readdirSync(scopeSource)) {
        const packageName = packageNameFromNodeModulesEntry(entry, childEntry);
        if (higherPackageNames.has(packageName)) {
          continue;
        }
        const destination = join(prefixNodeModules, entry, childEntry);
        rmSync(destination, { recursive: true, force: true });
        mkdirSync(dirname(destination), { recursive: true });
        const copyResult = spawnSync('cp', ['-a', join(scopeSource, childEntry), destination], { stdio: 'inherit' });
        if (copyResult.status !== 0) {
          throw new Error(`Failed to copy ${packageName} from scratch prefix`);
        }
      }
      continue;
    }

    if (higherPackageNames.has(packageNameFromNodeModulesEntry(entry))) {
      continue;
    }
    const destination = join(prefixNodeModules, entry);
    rmSync(destination, { recursive: true, force: true });
    const copyResult = spawnSync('cp', ['-a', join(scratchNodeModules, entry), destination], { stdio: 'inherit' });
    if (copyResult.status !== 0) {
      throw new Error(`Failed to copy ${entry} from scratch prefix`);
    }
  }
}

function linkPackageBins(prefix, packageName) {
  const packageJson = readJson(installedPackagePath(prefix, packageName));
  if (!packageJson.bin) {
    return;
  }

  const bins = typeof packageJson.bin === 'string' ? { [packageJson.name]: packageJson.bin } : packageJson.bin;
  const binDir = join(prefix, 'bin');
  mkdirSync(binDir, { recursive: true });

  for (const [binName, binTarget] of Object.entries(bins)) {
    const linkPath = join(binDir, binName);
    const packageDir = join(prefix, 'node_modules', packageName);
    const targetPath = relative(binDir, join(packageDir, binTarget));
    rmSync(linkPath, { force: true });
    const linkResult = spawnSync('ln', ['-s', targetPath, linkPath], { stdio: 'inherit' });
    if (linkResult.status !== 0) {
      throw new Error(`Failed to link bin ${binName} for ${packageName}`);
    }
  }
}

function runNpmCi(root, prefix, packagesToInstall) {
  mkdirSync(prefix, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'openchamber-npm-managed-'));

  const copyJsonResult = spawnSync('cp', [join(root, 'npm', 'package.json'), join(root, 'npm', 'package-lock.json'), scratch], { stdio: 'inherit' });
  if (copyJsonResult.status !== 0) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error('Failed to copy baked npm lockfiles into scratch prefix');
  }

  const ciResult = spawnSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--prefix', scratch], {
    stdio: 'inherit',
    env: { ...process.env, NPM_CONFIG_PREFIX: prefix },
  });

  if (ciResult.status !== 0) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error(`npm ci failed with exit code ${ciResult.status}`);
  }

  const higherPackageNames = new Set(packagesToInstall.filter((status) => status.state === 'higher').map((status) => status.name));
  copyNodeModulesFromScratch(scratch, prefix, higherPackageNames);

  for (const status of packagesToInstall) {
    linkPackageBins(prefix, status.name);
  }

  rmSync(scratch, { recursive: true, force: true });
}

function touchBootstrapState() {
  const statePath = process.env.MANAGED_TOOLS_BOOTSTRAP_STATE || join(process.env.HOME || '/home/openchamber', '.local', 'state', 'openchamber', 'bootstrap.lock');
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `npm ${new Date().toISOString()}\n`, { flag: 'a' });
}

function main() {
  const args = parseArgs(process.argv);
  const desiredPackages = resolveDesiredPackages(args.root);
  const statuses = getStatuses(args.prefix, desiredPackages);
  printStatuses(statuses);

  if (args.command === 'status') {
    return;
  }

  if (statuses.every((status) => status.state === 'equal' || status.state === 'higher')) {
    console.log('[npm-managed] npm-managed tools are already satisfied');
    touchBootstrapState();
    return;
  }

  runNpmCi(args.root, args.prefix, statuses);
  const updatedStatuses = getStatuses(args.prefix, desiredPackages);
  const failed = updatedStatuses.filter((status) => status.state === 'missing' || status.state === 'lower');
  if (failed.length > 0) {
    throw new Error(`npm-managed install did not satisfy pinned packages: ${failed.map((status) => status.name).join(', ')}`);
  }
  printStatuses(updatedStatuses);
  touchBootstrapState();
}

try {
  main();
} catch (error) {
  console.error(`[npm-managed] error: ${error.message}`);
  process.exit(1);
}
