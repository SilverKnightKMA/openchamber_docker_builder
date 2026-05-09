#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const command = process.argv[2] ?? "status";
const toolchainManifestPath = process.argv[3] ?? "tools/managed-go-toolchain.json";
const goModPath = process.argv[4] ?? "tools/managed-go/go.mod";
const userHome = process.env.HOME ?? homedir();
let toolchainDir = process.env.OPENCHAMBER_MANAGED_GO_TOOLCHAIN_DIR ?? null;
const gobin = process.env.OPENCHAMBER_MANAGED_GO_BIN ?? join(userHome, ".go", "bin");

const managedTools = [
  {
    name: "gopls",
    module: "golang.org/x/tools/gopls",
    installPath: "golang.org/x/tools/gopls",
  },
  {
    name: "shfmt",
    module: "mvdan.cc/sh/v3",
    installPath: "mvdan.cc/sh/v3/cmd/shfmt",
  },
];

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

function actionForState(state) {
  if (state === "missing") return "install";
  if (state === "equal") return "skip";
  if (state === "lower") return "upgrade";
  return "warn_skip";
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function applyManifestDefaults(manifest) {
  if (!toolchainDir) toolchainDir = join(userHome, manifest.installPath ?? join(".go", "toolchain"));
}

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

function run(binary, args, options = {}) {
  return spawnSync(binary, args, { encoding: "utf8", ...options });
}

function goBinary() {
  return join(toolchainDir, "bin", "go");
}

function managedEnv() {
  return {
    ...process.env,
    GOBIN: gobin,
    GOROOT: toolchainDir,
    GOPATH: join(userHome, ".go"),
    GOMODCACHE: join(userHome, ".go", "pkg", "mod"),
    PATH: `${join(toolchainDir, "bin")}:${gobin}:${process.env.PATH ?? ""}`,
  };
}

function extractGoVersion(output) {
  const match = output.match(/\bgo(\d+\.\d+\.\d+)\b/);
  return match ? match[1] : null;
}

function toolchainVersion() {
  const go = goBinary();
  if (!existsSync(go)) return null;
  const result = run(go, ["version"], { env: managedEnv() });
  if (result.status !== 0) return "unparseable";
  return extractGoVersion(result.stdout.trim()) ?? "unparseable";
}

async function wantedToolVersions() {
  const goMod = await readFile(goModPath, "utf8");
  const versions = new Map();
  for (const line of goMod.split("\n")) {
    const match = line.trim().match(/^(\S+)\s+(v\d+\.\d+\.\d+(?:[-+][^\s]+)?)$/);
    if (match) versions.set(match[1], match[2]);
  }
  return managedTools.map((tool) => ({ ...tool, expected: versions.get(tool.module) ?? null }));
}

function installedToolVersion(tool) {
  const bin = join(gobin, tool.name);
  if (!existsSync(bin)) return null;
  const go = goBinary();
  if (!existsSync(go)) return "unparseable";
  const result = run(go, ["version", "-m", bin], { env: managedEnv() });
  if (result.status !== 0) return "unparseable";
  for (const line of result.stdout.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] === "mod" && fields[1] === tool.module) return fields[2] ?? "unparseable";
  }
  return "unparseable";
}

async function collectStatus(manifest) {
  const actualToolchain = toolchainVersion();
  const toolchainState = actualToolchain === null ? "missing" : compareVersions(actualToolchain, manifest.version);
  const rows = [
    {
      type: "toolchain",
      name: "go",
      expected: manifest.version,
      actual: actualToolchain ?? "-",
      state: toolchainState,
    },
  ];
  for (const tool of await wantedToolVersions()) {
    const actual = installedToolVersion(tool);
    const state = actual === null ? "missing" : tool.expected === null ? "unparseable" : compareVersions(actual, tool.expected);
    rows.push({ type: "tool", name: tool.name, expected: tool.expected ?? "-", actual: actual ?? "-", state });
  }
  return rows;
}

function printStatus(rows) {
  console.log("type\tname\texpected\tinstalled\tstate\taction");
  for (const row of rows) console.log(`${row.type}\t${row.name}\t${row.expected}\t${row.actual}\t${row.state}\t${actionForState(row.state)}`);
}

function needsInstall(rows) {
  return rows.some((row) => row.state === "missing" || row.state === "lower");
}

function hasUnsafeSkip(rows) {
  return rows.some((row) => row.state === "higher" || row.state === "unparseable");
}

function normalizeChecksum(checksum) {
  return checksum.startsWith("sha256:") ? checksum.slice("sha256:".length) : checksum;
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`download failed for ${url}: HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(target));
}

async function installToolchain(manifest) {
  const actual = toolchainVersion();
  const state = actual === null ? "missing" : compareVersions(actual, manifest.version);
  if (state === "equal") return;
  if (state === "higher" || state === "unparseable") {
    console.log(`[managed-go] warning: mounted Go toolchain is ${state}; skipping toolchain install`);
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "openchamber-managed-go-"));
  const tarball = join(tempDir, basename(new URL(manifest.url).pathname));
  const extractDir = join(tempDir, "extract");
  const nextDir = join(dirname(toolchainDir), `.toolchain-${process.pid}-${Date.now()}`);
  try {
    await mkdir(extractDir, { recursive: true });
    await mkdir(dirname(toolchainDir), { recursive: true });
    console.log(`[managed-go] downloading ${manifest.url}`);
    await download(manifest.url, tarball);
    const actualSha = await sha256(tarball);
    const expectedSha = normalizeChecksum(manifest.checksum);
    if (actualSha !== expectedSha) throw new Error(`SHA256 mismatch for Go toolchain: expected ${expectedSha}, got ${actualSha}`);
    const tar = run("tar", ["-xzf", tarball, "-C", extractDir], { stdio: "inherit" });
    if (tar.status !== 0) process.exit(tar.status ?? 1);
    await rm(nextDir, { recursive: true, force: true });
    await rename(join(extractDir, "go"), nextDir);
    await rm(toolchainDir, { recursive: true, force: true });
    await rename(nextDir, toolchainDir);
  } finally {
    await rm(nextDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function installTools() {
  await mkdir(gobin, { recursive: true });
  const tools = await wantedToolVersions();
  if (tools.some((tool) => tool.expected === null)) throw new Error("managed-go go.mod is missing an expected tool module version");
  const result = run(goBinary(), ["install", "-mod=readonly", ...tools.map((tool) => tool.installPath)], {
    cwd: dirname(goModPath),
    env: managedEnv(),
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function runInstall() {
  const manifest = await loadJson(toolchainManifestPath);
  applyManifestDefaults(manifest);
  let rows = await collectStatus(manifest);
  printStatus(rows);
  const toolchainRow = rows.find((row) => row.type === "toolchain");
  if (toolchainRow && ["missing", "lower"].includes(toolchainRow.state)) {
    await installToolchain(manifest);
    rows = await collectStatus(manifest);
    printStatus(rows);
  }
  if (!needsInstall(rows)) {
    console.log("[managed-go] all managed Go tools current or intentionally skipped");
    return;
  }
  if (hasUnsafeSkip(rows)) {
    console.log("[managed-go] warning: newer or unparseable mounted Go components found; skipping install to avoid unsafe overwrite");
    return;
  }
  await installTools();
  const afterRows = await collectStatus(manifest);
  printStatus(afterRows);
  if (afterRows.some((row) => row.state !== "equal")) process.exit(1);
}

if (!["install", "status"].includes(command)) {
  console.error("usage: install-managed-go-tools.mjs [install|status] [toolchain.json] [go.mod]");
  process.exit(2);
}

const manifest = await loadJson(toolchainManifestPath);
applyManifestDefaults(manifest);
if (command === "status") {
  const rows = await collectStatus(manifest);
  printStatus(rows);
  process.exit(hasUnsafeSkip(rows) ? 1 : 0);
}
await runInstall();
