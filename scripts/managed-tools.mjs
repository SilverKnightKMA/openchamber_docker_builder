#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const command = process.argv[2] ?? "status";
const refFlagIndex = process.argv.indexOf("--ref");
const ref = refFlagIndex >= 0 ? process.argv[refFlagIndex + 1] : null;
const dryRun = process.argv.includes("--dry-run");
const positional = process.argv.slice(3).filter((arg, index, args) => args[index - 1] !== "--ref" && arg !== "--ref" && arg !== "--dry-run");
const configPath = positional[0] ?? "tools/managed-tools.json";
const defaultFetchUrl = "https://raw.githubusercontent.com/SilverKnightKMA/open_chamber_docker/{ref}/{path}";

function run(binary, args, options = {}) {
  return spawnSync(binary, args, { encoding: "utf8", stdio: "pipe", ...options });
}

function installerCommand(installedName, scriptPath, args) {
  if (existsSync(scriptPath)) return ["node", [scriptPath, ...args]];
  return [installedName, args];
}

function parseCommandRef(value) {
  if (!value) return null;
  return value.replace(/^origin\//, "");
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fetchFromGit(refName, path) {
  const result = run("git", ["show", `${refName}:${path}`], { cwd: process.cwd() });
  if (result.status !== 0) return null;
  return result.stdout;
}

async function fetchFromRaw(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  return await response.text();
}

async function loadManagedConfig(effectiveRef) {
  if (existsSync(configPath)) return await loadJson(configPath);
  const refName = effectiveRef ?? "main";
  const gitRef = refName.startsWith("origin/") ? refName : `origin/${refName}`;
  const gitContent = await fetchFromGit(gitRef, "tools/managed-tools.json");
  if (gitContent !== null) return JSON.parse(gitContent);
  const rawUrl = defaultFetchUrl.replaceAll("{ref}", parseCommandRef(refName) ?? refName).replaceAll("{path}", "tools/managed-tools.json");
  const rawContent = await fetchFromRaw(rawUrl);
  if (rawContent !== null) return JSON.parse(rawContent);
  throw new Error(`unable to fetch tools/managed-tools.json from ${refName}`);
}

async function resolveSourceFile(managedConfig, sourcePath, effectiveRef) {
  const refName = effectiveRef ?? managedConfig.sources.defaultRef ?? "main";
  const gitRef = refName.startsWith("origin/") ? refName : `origin/${refName}`;
  const gitContent = await fetchFromGit(gitRef, sourcePath);
  if (gitContent !== null) return gitContent;

  const rawUrl = managedConfig.sources.fetchUrl
    .replaceAll("{ref}", parseCommandRef(refName) ?? refName)
    .replaceAll("{path}", sourcePath);
  const rawContent = await fetchFromRaw(rawUrl);
  if (rawContent !== null) return rawContent;

  if (existsSync(sourcePath)) return await readFile(sourcePath, "utf8");
  throw new Error(`unable to fetch ${sourcePath} from ${refName}`);
}

async function stageManagedConfig(managedConfig, effectiveRef) {
  const tempDir = await mkdtemp(join(tmpdir(), "managed-tools-"));
  try {
    for (const sourcePath of managedConfig.sources.configFiles) {
      const content = await resolveSourceFile(managedConfig, sourcePath, effectiveRef);
      const targetPath = join(tempDir, sourcePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
    }
    return tempDir;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function runInstallers(mode) {
  const effectiveRef = ref ?? "main";
  const managedConfig = await loadManagedConfig(effectiveRef);
  const stagedDir = await stageManagedConfig(managedConfig, effectiveRef);
  const configRoot = stagedDir;
  const managedGoMod = join(configRoot, managedConfig.groups.go.goMod);
  const managedGoSum = join(configRoot, managedConfig.groups.go.goSum);
  const managedGoManifest = join(configRoot, managedConfig.groups.go.toolchainManifest);
  const managedNpmPackage = join(configRoot, managedConfig.groups.npm.packageJson);
  const managedNpmLock = join(configRoot, managedConfig.groups.npm.packageLockJson);
  const managedRustup = join(configRoot, managedConfig.groups.rustup.rustupManifest);
  const managedRelease = join(configRoot, managedConfig.groups.releaseBinaries.manifest);

  const env = {
    ...process.env,
    OPENCHAMBER_MANAGED_GO_GO_MOD: managedGoMod,
    OPENCHAMBER_MANAGED_GO_GO_SUM: managedGoSum,
  };

  const commands = [
    installerCommand("install-managed-npm-tools", "scripts/install-managed-npm-tools.mjs", [mode, managedNpmPackage, managedNpmLock]),
    installerCommand("install-managed-go-tools", "scripts/install-managed-go-tools.mjs", [mode, managedGoManifest, managedGoMod]),
    installerCommand("install-managed-release-binaries", "scripts/install-managed-release-binaries.mjs", [mode, managedRelease]),
    installerCommand("install-managed-rustup", "scripts/install-managed-rustup.mjs", [mode, managedRustup]),
  ];

  try {
    if (dryRun || command === "fetch") {
      console.log(`[managed-tools] fetched ${managedConfig.sources.configFiles.length} config files from ${effectiveRef}`);
      for (const sourcePath of managedConfig.sources.configFiles) console.log(join(configRoot, sourcePath));
      return;
    }
    for (const [binary, args] of commands) {
      const result = run(binary, args, { env, cwd: configRoot });
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      if (result.status !== 0) throw new Error(`${binary} failed with status ${result.status}`);
    }
  } finally {
    await rm(stagedDir, { recursive: true, force: true });
  }
}

if (refFlagIndex >= 0 && !ref) {
  console.error("--ref requires a ref name");
  process.exit(1);
}

if (command === "init" || command === "update" || command === "fetch") {
  await runInstallers("install");
} else if (command === "status") {
  const result = run("node", ["scripts/managed-tools-status.mjs", configPath], { cwd: process.cwd() });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 0);
} else {
  console.error("usage: managed-tools.mjs [init|update|fetch|status] [managed-tools.json] [--ref ref] [--dry-run]");
  process.exit(1);
}
