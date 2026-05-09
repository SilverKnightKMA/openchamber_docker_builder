#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const command = process.argv[2] ?? "status";
const manifestPath = process.argv[3] ?? "tools/managed-release-binaries.json";
const userHome = process.env.HOME ?? homedir();
const installDir = process.env.OPENCHAMBER_MANAGED_RELEASE_BIN_DIR ?? join(userHome, ".local", "bin");

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

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function download(url, target) {
  if (url.startsWith("file://")) {
    await copyFile(new URL(url), target);
    return;
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`download failed for ${url}: HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(target));
}

function run(binary, args, options = {}) {
  return spawnSync(binary, args, { encoding: "utf8", ...options });
}

function assetUrl(tool) {
  return tool.url ?? `https://github.com/${tool.repo}/releases/download/${tool.version}/${tool.asset}`;
}

function checksumUrl(tool) {
  if (tool.checksumUrl) return tool.checksumUrl;
  if (!tool.checksumAsset) return null;
  return `https://github.com/${tool.repo}/releases/download/${tool.version}/${tool.checksumAsset}`;
}

function normalizeChecksum(checksum) {
  return checksum.startsWith("sha256:") ? checksum.slice("sha256:".length) : checksum;
}

function verifyChecksumLine(tool, checksumText) {
  const expected = normalizeChecksum(tool.sha256).toLowerCase();
  const lines = checksumText.split("\n");
  const match = lines.find((line) => line.includes(tool.asset));
  if (!match) throw new Error(`upstream checksum entry not found for ${tool.asset}`);
  const actual = match.trim().split(/\s+/)[0].replace(/^sha256:/, "").toLowerCase();
  if (actual !== expected) throw new Error(`upstream checksum mismatch for ${tool.name}: expected ${expected}, got ${actual}`);
}

async function verifyUpstreamChecksum(tool, tempDir) {
  const url = checksumUrl(tool);
  if (!url) throw new Error(`missing checksumAsset/checksumUrl for ${tool.name}`);
  const checksumFile = join(tempDir, basename(new URL(url).pathname) || `${tool.name}.checksums.txt`);
  await download(url, checksumFile);
  verifyChecksumLine(tool, await readFile(checksumFile, "utf8"));
}

function extractInstalledVersion(tool) {
  const bin = join(installDir, tool.name);
  if (!existsSync(bin)) return null;
  const result = run(bin, ["--version"]);
  if (result.status !== 0) return "unparseable";
  const match = `${result.stdout} ${result.stderr}`.match(/\bv?(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/);
  return match ? match[1] : "unparseable";
}

async function collectStatus(manifest) {
  return manifest.tools.map((tool) => {
    const actual = extractInstalledVersion(tool);
    const state = actual === null ? "missing" : compareVersions(actual, tool.version);
    return { name: tool.name, expected: tool.version, actual: actual ?? "-", state };
  });
}

function printStatus(rows) {
  console.log("name\texpected\tinstalled\tstate\taction");
  for (const row of rows) console.log(`${row.name}\t${row.expected}\t${row.actual}\t${row.state}\t${actionForState(row.state)}`);
}

function needsInstall(rows) {
  return rows.some((row) => row.state === "missing" || row.state === "lower");
}

function hasUnsafeSkip(rows) {
  return rows.some((row) => row.state === "higher" || row.state === "unparseable");
}

async function installTool(tool) {
  const tempDir = await mkdtemp(join(tmpdir(), "openchamber-managed-release-"));
  const archive = join(tempDir, tool.asset);
  try {
    await mkdir(installDir, { recursive: true });
    await verifyUpstreamChecksum(tool, tempDir);
    await download(assetUrl(tool), archive);
    const actualSha = await sha256(archive);
    const expectedSha = normalizeChecksum(tool.sha256).toLowerCase();
    if (actualSha !== expectedSha) throw new Error(`SHA256 mismatch for ${tool.name}: expected ${expectedSha}, got ${actualSha}`);
    const extractDir = join(tempDir, "extract");
    await mkdir(extractDir, { recursive: true });
    const tar = run("tar", ["-xzf", archive, "-C", extractDir], { stdio: "inherit" });
    if (tar.status !== 0) process.exit(tar.status ?? 1);
    const source = join(extractDir, tool.binaryPath ?? `${tool.name}_${tool.version.replace(/^v/, "")}_linux_amd64/bin/${tool.name}`);
    if (!existsSync(source)) throw new Error(`extracted binary not found for ${tool.name}: ${source}`);
    const target = join(installDir, tool.name);
    await copyFile(source, target);
    await chmod(target, 0o755);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runInstall() {
  const manifest = await loadJson(manifestPath);
  const rows = await collectStatus(manifest);
  printStatus(rows);
  if (!needsInstall(rows)) {
    console.log("[managed-release-binaries] all managed release binaries current or intentionally skipped");
    return;
  }
  if (hasUnsafeSkip(rows)) {
    console.log("[managed-release-binaries] warning: newer or unparseable mounted release binaries found; skipping install to avoid unsafe overwrite");
    return;
  }
  for (const tool of manifest.tools) {
    const row = rows.find((item) => item.name === tool.name);
    if (row && ["missing", "lower"].includes(row.state)) await installTool(tool);
  }
  const afterRows = await collectStatus(manifest);
  printStatus(afterRows);
  if (afterRows.some((row) => row.state !== "equal")) process.exit(1);
}

if (!["install", "status"].includes(command)) {
  console.error("usage: install-managed-release-binaries.mjs [install|status] [managed-release-binaries.json]");
  process.exit(2);
}

const manifest = await loadJson(manifestPath);
if (manifest.policy?.requireUpstreamChecksum !== true || manifest.policy?.allowDownloadAndHash !== false) {
  throw new Error("managed release-binaries policy must require upstream checksums and forbid download-and-hash fallback");
}
if (command === "status") {
  const rows = await collectStatus(manifest);
  printStatus(rows);
  process.exit(hasUnsafeSkip(rows) ? 1 : 0);
}
await runInstall();
