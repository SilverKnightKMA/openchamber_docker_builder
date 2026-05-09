#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const command = process.argv[2] ?? "status";
const manifestPath = process.argv[3] ?? "tools/managed-rustup.json";
const userHome = process.env.HOME ?? homedir();
const rustupHome = process.env.RUSTUP_HOME ?? join(userHome, ".rustup");
const cargoHome = process.env.CARGO_HOME ?? join(userHome, ".cargo");
const cargoBin = join(cargoHome, "bin");

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

function managedEnv() {
  return {
    ...process.env,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    PATH: `${cargoBin}:${process.env.PATH ?? ""}`,
  };
}

function bin(name) {
  return join(cargoBin, name);
}

function run(binary, args, options = {}) {
  return spawnSync(binary, args, { encoding: "utf8", ...options });
}

function extractVersion(output) {
  const match = output.match(/\b(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/);
  return match ? match[1] : "unparseable";
}

function executableVersion(name) {
  const path = bin(name);
  if (!existsSync(path)) return null;
  const result = run(path, ["--version"], { env: managedEnv() });
  if (result.status !== 0) return "unparseable";
  return extractVersion(`${result.stdout} ${result.stderr}`);
}

function rustupVersion() {
  return executableVersion("rustup");
}

function installedToolchainVersion(manifest) {
  const rustc = executableVersion("rustc");
  const cargo = executableVersion("cargo");
  if (rustc === null || cargo === null) return { actual: null, cargoActual: cargo };
  if (rustc === "unparseable" || cargo === "unparseable") return { actual: "unparseable", cargoActual: cargo };
  const state = compareVersions(cargo, rustc);
  if (state !== "equal") return { actual: "unparseable", cargoActual: cargo };
  const expected = manifest.version ?? rustc;
  return { actual: rustc, cargoActual: cargo, expected };
}

async function collectStatus(manifest) {
  const rows = [];
  const rustupActual = rustupVersion();
  rows.push({
    type: "bootstrap",
    name: "rustup",
    expected: manifest.rustupVersion ?? "present",
    actual: rustupActual ?? "-",
    state: rustupActual === null ? "missing" : rustupActual === "unparseable" ? "unparseable" : manifest.rustupVersion ? compareVersions(rustupActual, manifest.rustupVersion) : "equal",
  });
  const toolchain = installedToolchainVersion(manifest);
  const expected = manifest.version ?? toolchain.expected ?? manifest.toolchain;
  rows.push({
    type: "toolchain",
    name: manifest.toolchain,
    expected,
    actual: toolchain.actual ?? "-",
    state: toolchain.actual === null ? "missing" : manifest.version ? compareVersions(toolchain.actual, manifest.version) : toolchain.actual === "unparseable" ? "unparseable" : "equal",
  });
  rows.push({
    type: "tool",
    name: "cargo",
    expected,
    actual: toolchain.cargoActual ?? "-",
    state: toolchain.cargoActual === null ? "missing" : manifest.version ? compareVersions(toolchain.cargoActual, manifest.version) : toolchain.cargoActual === "unparseable" ? "unparseable" : "equal",
  });
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

function installerUrl(manifest) {
  return manifest.rustupInitUrl ?? "https://sh.rustup.rs";
}

async function ensureRustup(manifest) {
  if (existsSync(bin("rustup"))) return;
  const result = run("sh", ["-c", "curl --proto '=https' --tlsv1.2 -sSf $RUSTUP_INIT_URL | sh -s -- -y --no-modify-path --default-toolchain none"], {
    env: { ...managedEnv(), RUSTUP_INIT_URL: installerUrl(manifest) },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function installToolchain(manifest) {
  await mkdir(cargoBin, { recursive: true });
  await mkdir(rustupHome, { recursive: true });
  await ensureRustup(manifest);
  const toolchain = manifest.version ?? manifest.toolchain;
  const args = ["toolchain", "install", toolchain, "--profile", manifest.profile ?? "default"];
  for (const target of manifest.targets ?? []) args.push("--target", target);
  for (const component of manifest.components ?? []) args.push("--component", component);
  const install = run(bin("rustup"), args, { env: managedEnv(), stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status ?? 1);
  const setDefault = run(bin("rustup"), ["default", toolchain], { env: managedEnv(), stdio: "inherit" });
  if (setDefault.status !== 0) process.exit(setDefault.status ?? 1);
}

async function runInstall() {
  const manifest = await loadJson(manifestPath);
  let rows = await collectStatus(manifest);
  printStatus(rows);
  if (!needsInstall(rows)) {
    console.log("[managed-rustup] managed Rust toolchain current or intentionally skipped");
    return;
  }
  if (hasUnsafeSkip(rows)) {
    console.log("[managed-rustup] warning: newer or unparseable mounted Rust components found; skipping install to avoid unsafe overwrite");
    return;
  }
  await installToolchain(manifest);
  rows = await collectStatus(manifest);
  printStatus(rows);
  if (rows.some((row) => row.state !== "equal")) process.exit(1);
}

if (!["install", "status"].includes(command)) {
  console.error("usage: install-managed-rustup.mjs [install|status] [managed-rustup.json]");
  process.exit(2);
}

const manifest = await loadJson(manifestPath);
if (command === "status") {
  const rows = await collectStatus(manifest);
  printStatus(rows);
  process.exit(hasUnsafeSkip(rows) ? 1 : 0);
}
await runInstall();
