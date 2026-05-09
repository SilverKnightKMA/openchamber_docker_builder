#!/usr/bin/env node
import { mkdtemp, rm, readFile, cp, mkdir, readdir, stat, symlink, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const command = process.argv[2] ?? "status";
const packageJsonPath = process.argv[3] ?? "tools/managed-npm-package.json";
const packageLockPath = process.argv[4] ?? "tools/managed-npm-package-lock.json";
const prefix = process.env.OPENCHAMBER_MANAGED_NPM_PREFIX ?? join(process.env.HOME ?? homedir(), ".npm-global");
const binDir = join(prefix, "bin");
const nodeModulesDir = join(prefix, "node_modules");

function parseVersion(version) {
  if (typeof version !== "string") return null;
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function compareVersions(installed, expected) {
  const current = parseVersion(installed);
  const wanted = parseVersion(expected);
  if (!current || !wanted) return "unparseable";
  for (let index = 0; index < wanted.length; index += 1) {
    if (current[index] < wanted[index]) return "lower";
    if (current[index] > wanted[index]) return "higher";
  }
  return "equal";
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function installedVersion(name) {
  const path = join(nodeModulesDir, name, "package.json");
  if (!existsSync(path)) return null;
  const pkg = await loadJson(path);
  return pkg.version ?? null;
}

async function collectStatus(dependencies) {
  const rows = [];
  for (const [name, expected] of Object.entries(dependencies)) {
    const actual = await installedVersion(name);
    const state = actual === null ? "missing" : compareVersions(actual, expected);
    rows.push({ name, expected, actual: actual ?? "-", state });
  }
  return rows;
}

function printStatus(rows) {
  console.log("name\texpected\tinstalled\tstate\taction");
  for (const row of rows) {
    const action = row.state === "missing" ? "install" : row.state === "equal" ? "skip" : row.state === "lower" ? "upgrade" : "warn_skip";
    console.log(`${row.name}\t${row.expected}\t${row.actual}\t${row.state}\t${action}`);
  }
}

function needsInstall(rows) {
  return rows.some((row) => row.state === "missing" || row.state === "lower");
}

function hasUnsafeSkip(rows) {
  return rows.some((row) => row.state === "higher" || row.state === "unparseable");
}

async function mirrorBins() {
  await mkdir(binDir, { recursive: true });
  const sourceBinDir = join(nodeModulesDir, ".bin");
  if (!existsSync(sourceBinDir)) return;
  for (const entry of await readdir(sourceBinDir)) {
    const source = join(sourceBinDir, entry);
    const target = join(binDir, entry);
    const info = await stat(source);
    if (!info.isFile() && !info.isSymbolicLink()) continue;
    try {
      await unlink(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await symlink(source, target);
  }
}

async function runInstall() {
  const pkg = await loadJson(packageJsonPath);
  const rows = await collectStatus(pkg.dependencies ?? {});
  printStatus(rows);
  if (!needsInstall(rows)) {
    console.log("[managed-npm] all managed npm tools current or intentionally skipped");
    return;
  }
  if (hasUnsafeSkip(rows)) {
    console.log("[managed-npm] warning: newer or unparseable mounted npm tools found; skipping npm ci to avoid forced downgrade");
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "openchamber-managed-npm-"));
  try {
    await mkdir(prefix, { recursive: true });
    await cp(packageJsonPath, join(tempDir, "package.json"));
    await cp(packageLockPath, join(tempDir, "package-lock.json"));
    await cp(join(tempDir, "package.json"), join(prefix, "package.json"));
    await cp(join(tempDir, "package-lock.json"), join(prefix, "package-lock.json"));
    const result = spawnSync("npm", ["ci", "--omit=dev", "--prefix", prefix], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
    await mirrorBins();
    const afterRows = await collectStatus(pkg.dependencies ?? {});
    printStatus(afterRows);
    if (afterRows.some((row) => row.state !== "equal")) process.exit(1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

if (!["install", "status"].includes(command)) {
  console.error("usage: install-managed-npm-tools.mjs [install|status] [package.json] [package-lock.json]");
  process.exit(2);
}

const pkg = await loadJson(packageJsonPath);
if (command === "status") {
  const rows = await collectStatus(pkg.dependencies ?? {});
  printStatus(rows);
  process.exit(hasUnsafeSkip(rows) ? 1 : 0);
}
await runInstall();
